import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { ballot, defaultPolicy, patternOf, validatePolicy, type Ballot, type Pattern, type Policy, type Stage, type Tool, type Trust, type Verdict } from './policy.ts';
import { EVENT_SCHEMA_VERSION, MAX_SPEAR_HAPPENED, encodePayload, readPayload, type EventKind, type EventPayloads, type Happened, type SortieEvent } from './events.ts';
/** Central Dogma (F-024): sorties, actions, grants (A.T. Fields), approvals (Misato's apartment) and append-only events. */
export const LEDGER_SCHEMA=`
 CREATE TABLE IF NOT EXISTS sorties(id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL, trust TEXT NOT NULL, status TEXT NOT NULL, rejects INTEGER NOT NULL DEFAULT 0, spent REAL NOT NULL DEFAULT 0, created TEXT NOT NULL, closed TEXT);
 CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, sortie_id TEXT NOT NULL REFERENCES sorties(id), tool TEXT NOT NULL, args TEXT NOT NULL, ballot TEXT NOT NULL, created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, action_id TEXT NOT NULL UNIQUE REFERENCES actions(id), tool TEXT NOT NULL, args_hash TEXT NOT NULL, expires TEXT NOT NULL, used TEXT, revoked TEXT);
 CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, action_id TEXT NOT NULL UNIQUE REFERENCES actions(id), card TEXT NOT NULL, expires TEXT NOT NULL, decision TEXT, decided TEXT, source TEXT);
 CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, sortie_id TEXT NOT NULL, action_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL, v INTEGER NOT NULL DEFAULT 1);
 CREATE INDEX IF NOT EXISTS events_sortie ON events(sortie_id, sequence);
 CREATE INDEX IF NOT EXISTS approvals_pending ON approvals(expires) WHERE decision IS NULL;
 CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
 CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;`;
export interface Proposal {tool:string;args:Record<string,unknown>;stage:Stage;cost?:number;casper?:Verdict;extras?:Verdict[]}
export interface Card {sortieId:string;actionId:string;tool:string;args:Record<string,unknown>;effect:string;pattern:string;sync:Ballot['sync'];verdicts:Verdict[];reason:string;expires:string}
export interface Approval {id:string;card:Card;expires:string;decision:string|null}
export interface Proposed {actionId:string;ballot:Ballot;grantId?:string;approvalId?:string}
export type Decision='approve'|'reject'|'edit';
/** Bounded so a page of approval cards fits one IPC frame (rpc.ts MAX_FRAME_BYTES). */
const MAX_ARGS_BYTES=8192;
/** A verdict reason is shown to the owner, not scored: long model text is cut so the ballot event stays bounded. */
const MAX_REASON_CHARS=500;
/** Payload bytes per event page, so a page fits one IPC frame (rpc.ts MAX_FRAME_BYTES) with room for the envelope. */
const EVENT_PAGE_BYTES=32_768;
const clampVerdict=(v:Verdict|undefined)=>v&&typeof v.reason==='string'?{...v,reason:v.reason.slice(0,MAX_REASON_CHARS)}:v;
/** Key order never changes the hash, so a grant binds the exact arguments that were reviewed. */
const canonical=(v:unknown):string=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')}}`:JSON.stringify(v);
export const argsHash=(args:Record<string,unknown>)=>createHash('sha256').update(canonical(args)).digest('hex');
const iso=(now:Date,plus=0)=>new Date(now.getTime()+plus).toISOString();
export class Ledger {
 readonly db:DatabaseSync;readonly tools:ReadonlyMap<string,Tool>;readonly policy:Policy;readonly grantTtlMs:number;readonly approvalTtlMs:number;
 constructor(db:DatabaseSync,options:{tools?:Tool[];policy?:Policy;grantTtlMs?:number;approvalTtlMs?:number}={}) {
  this.db=db;this.tools=new Map((options.tools ?? []).map(t=>[t.name,t]));this.policy=validatePolicy(options.policy ?? defaultPolicy);
  this.grantTtlMs=options.grantTtlMs ?? 60_000;this.approvalTtlMs=options.approvalTtlMs ?? 3_600_000;
 }
 private event<K extends EventKind>(sortieId:string,actionId:string|null,kind:K,payload:EventPayloads[K],now:Date) {this.db.prepare('INSERT INTO events(sortie_id,action_id,kind,payload,created,v) VALUES(?,?,?,?,?,?)').run(sortieId,actionId,kind,encodePayload(kind,payload),iso(now),EVENT_SCHEMA_VERSION);}
 private tx<T>(work:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const value=work();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 private issue(actionId:string,tool:string,args:Record<string,unknown>,sortieId:string,now:Date):string {
  const id=randomUUID();this.db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,NULL,NULL)').run(id,actionId,tool,argsHash(args),iso(now,this.grantTtlMs));
  this.event(sortieId,actionId,'grant.issued',{expires:iso(now,this.grantTtlMs)},now);return id;
 }
 openSortie(source:string,title:string,trust:Trust,now=new Date()):string {
  if(typeof source!=='string'||!source||source.length>100||typeof title!=='string'||!title.trim()||title.length>500||(trust!=='trusted'&&trust!=='tainted'))throw new Error('Invalid sortie.');
  const id=randomUUID();
  return this.tx(()=>{this.db.prepare('INSERT INTO sorties(id,source,title,trust,status,created) VALUES(?,?,?,?,?,?)').run(id,source,title.trim(),trust,'open',iso(now));this.event(id,null,'sortie.opened',{source,title:title.trim(),trust},now);return id;});
 }
 /** Every agent action passes here. A reject goes back to the planner; after maxRejects it escalates to the owner. */
 propose(sortieId:string,p:Proposal,now=new Date()):Proposed {
  if(!p||typeof p.tool!=='string'||!p.tool||p.tool.length>100||!p.args||typeof p.args!=='object'||Array.isArray(p.args)||Buffer.byteLength(JSON.stringify(p.args))>MAX_ARGS_BYTES)throw new Error('Invalid action.');
  return this.tx(()=>{
   const sortie=this.db.prepare('SELECT * FROM sorties WHERE id=?').get(sortieId) as {trust:Trust;status:string;rejects:number;spent:number}|undefined;
   if(!sortie||sortie.status!=='open')throw new Error('Sortie is not open.');
   const result=ballot({tool:p.tool,args:p.args,trust:sortie.trust,stage:p.stage,cost:p.cost ?? 0},this.tools.get(p.tool),this.policy,sortie.spent,clampVerdict(p.casper),p.extras?.map(v=>clampVerdict(v)!));
   if(result.outcome==='reject'&&sortie.rejects+1>this.policy.maxRejects)Object.assign(result,{outcome:'approval',reason:`Reject limit reached (${result.reason}); the owner decides.`});
   const actionId=randomUUID();this.db.prepare('INSERT INTO actions VALUES(?,?,?,?,?,?)').run(actionId,sortieId,p.tool,JSON.stringify(p.args),JSON.stringify(result),iso(now));
   this.event(sortieId,actionId,'ballot',result,now);
   if(result.outcome==='reject'){this.db.prepare('UPDATE sorties SET rejects=rejects+1 WHERE id=?').run(sortieId);return {actionId,ballot:result};}
   this.db.prepare('UPDATE sorties SET spent=spent+? WHERE id=?').run(p.cost ?? 0,sortieId);
   if(result.outcome==='grant')return {actionId,ballot:result,grantId:this.issue(actionId,p.tool,p.args,sortieId,now)};
   const approvalId=randomUUID();const card:Card={sortieId,actionId,tool:p.tool,args:p.args,effect:result.effect,pattern:result.pattern,sync:result.sync,verdicts:result.verdicts,reason:result.reason,expires:iso(now,this.approvalTtlMs)};
   this.db.prepare('INSERT INTO approvals VALUES(?,?,?,?,NULL,NULL,NULL)').run(approvalId,actionId,JSON.stringify(card),card.expires);
   this.event(sortieId,actionId,'approval.requested',{approvalId,expires:card.expires,reason:result.reason},now);
   return {actionId,ballot:result,approvalId};
  });
 }
 /** The Pattern a proposal would get, without recording anything: the coordinator asks Casper only when it is not Green. */
 preview(sortieId:string,tool:string):{pattern:Pattern;effect:Ballot['effect']} {
  const sortie=this.db.prepare('SELECT trust,status FROM sorties WHERE id=?').get(sortieId) as {trust:Trust;status:string}|undefined;
  if(!sortie||sortie.status!=='open')throw new Error('Sortie is not open.');
  const effect=this.tools.get(tool)?.effect ?? 'irreversible';return {pattern:patternOf(effect,sortie.trust,tool,this.policy),effect};
 }
 /** The reviewed action behind a grant, and whether the grant is still unused. Grant IDs stay inside this process. */
 grantAction(grantId:string):{sortieId:string;actionId:string;tool:string;args:Record<string,unknown>;used:boolean}|undefined {
  const row=this.db.prepare('SELECT x.sortie_id,x.id,x.tool,x.args,g.used FROM grants g JOIN actions x ON x.id=g.action_id WHERE g.id=?').get(grantId) as {sortie_id:string;id:string;tool:string;args:string;used:string|null}|undefined;
  return row&&{sortieId:row.sortie_id,actionId:row.id,tool:row.tool,args:JSON.parse(row.args) as Record<string,unknown>,used:row.used!==null};
 }
 /** Misato's reply to the owner, kept with the sortie it answers. */
 reply(sortieId:string,text:string,now=new Date()):void {this.tx(()=>this.event(sortieId,null,'misato.reply',{text:text.slice(0,4000)},now));}
 /** Records what an executor did after `authorize` let it run. */
 finished(sortieId:string,actionId:string,tool:string,outcome:{result:unknown}|{error:string},now=new Date()):void {
  this.tx(()=>{if('error' in outcome)this.event(sortieId,actionId,'action.failed',{tool,error:outcome.error.slice(0,500)},now);else this.event(sortieId,actionId,'action.done',{tool,result:outcome.result},now);});
 }
 pendingApprovals(now=new Date(),limit=5):Approval[] {
  if(!Number.isInteger(limit)||limit<1||limit>5)throw new Error('Invalid approval page.');
  return (this.db.prepare('SELECT id,card,expires,decision FROM approvals WHERE decision IS NULL AND expires>? ORDER BY expires LIMIT ?').all(iso(now),limit) as {id:string;card:string;expires:string;decision:null}[]).map(r=>({...r,card:JSON.parse(r.card) as Card}));
 }
 /** Applied once: repeating a decision returns the first outcome. Expiry never approves. */
 decide(approvalId:string,decision:Decision,source:string,now=new Date()):{decision:string;grantId?:string} {
  if(!['approve','reject','edit'].includes(decision)||typeof source!=='string'||!source||source.length>100)throw new Error('Invalid decision.');
  return this.tx(()=>{
   const row=this.db.prepare('SELECT a.*,x.sortie_id,x.tool,x.args FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?').get(approvalId) as {action_id:string;expires:string;decision:string|null;sortie_id:string;tool:string;args:string}|undefined;
   if(!row)throw new Error('No approval with that ID.');
   if(row.decision){const grant=this.db.prepare('SELECT id FROM grants WHERE action_id=?').get(row.action_id) as {id:string}|undefined;return {decision:row.decision,...(grant?{grantId:grant.id}:{})};}
   const final=row.expires<=iso(now)?'expired':decision;
   this.db.prepare('UPDATE approvals SET decision=?,decided=?,source=? WHERE id=?').run(final,iso(now),final==='expired'?'ttl':source,approvalId);
   if(final==='expired')this.event(row.sortie_id,row.action_id,'approval.expired',{approvalId,source:'ttl'},now);else this.event(row.sortie_id,row.action_id,`approval.${final}`,{approvalId,source},now);
   return final==='approve'?{decision:final,grantId:this.issue(row.action_id,row.tool,JSON.parse(row.args) as Record<string,unknown>,row.sortie_id,now)}:{decision:final};
  });
 }
 /** Run on scheduler ticks: stand down approvals whose TTL passed. */
 expire(now=new Date()):number {
  return this.tx(()=>{
   const due=this.db.prepare('SELECT a.id,a.action_id,x.sortie_id FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.decision IS NULL AND a.expires<=?').all(iso(now)) as {id:string;action_id:string;sortie_id:string}[];
   for(const r of due){this.db.prepare('UPDATE approvals SET decision=?,decided=?,source=? WHERE id=?').run('expired',iso(now),'ttl',r.id);this.event(r.sortie_id,r.action_id,'approval.expired',{approvalId:r.id,source:'ttl'},now);}
   return due.length;
  });
 }
 /** The executor's check, on every call: exact tool and arguments, unexpired, unrevoked, single use. */
 authorize(grantId:string,tool:string,args:Record<string,unknown>,now=new Date()):void {
  // The denial is committed as an event before the caller sees the error.
  const reason=this.tx(()=>{
   const g=this.db.prepare('SELECT g.*,x.sortie_id FROM grants g JOIN actions x ON x.id=g.action_id WHERE g.id=?').get(grantId) as {action_id:string;tool:string;args_hash:string;expires:string;used:string|null;revoked:string|null;sortie_id:string}|undefined;
   if(!g)return 'unknown grant';
   const denied=g.revoked?'revoked':g.used?'already used':g.expires<=iso(now)?'expired':g.tool!==tool||g.args_hash!==argsHash(args)?'action differs from the reviewed one':undefined;
   if(denied){this.event(g.sortie_id,g.action_id,'grant.denied',{reason:denied},now);return denied;}
   this.db.prepare('UPDATE grants SET used=? WHERE id=?').run(iso(now),grantId);this.event(g.sortie_id,g.action_id,'grant.used',{},now);return undefined;
  });
  if(reason)throw new Error(`A.T. Field denied: ${reason}.`);
 }
 /** Spear of Longinus: revoke grants, stand down approvals, close the sortie. Effects already executed are reported, never assumed undone. */
 spear(sortieId:string,reason:string,now=new Date()):{revoked:number;stoodDown:number;happened:Happened[]} {
  return this.tx(()=>{
   const sortie=this.db.prepare('SELECT status FROM sorties WHERE id=?').get(sortieId) as {status:string}|undefined;if(!sortie)throw new Error('No sortie with that ID.');
   const revoked=Number(this.db.prepare('UPDATE grants SET revoked=? WHERE revoked IS NULL AND used IS NULL AND action_id IN (SELECT id FROM actions WHERE sortie_id=?)').run(iso(now),sortieId).changes);
   const stoodDown=Number(this.db.prepare("UPDATE approvals SET decision='revoked',decided=?,source='spear' WHERE decision IS NULL AND action_id IN (SELECT id FROM actions WHERE sortie_id=?)").run(iso(now),sortieId).changes);
   const happened=(this.db.prepare('SELECT x.id AS actionId,x.tool FROM grants g JOIN actions x ON x.id=g.action_id WHERE x.sortie_id=? AND g.used IS NOT NULL ORDER BY g.used').all(sortieId) as {actionId:string;tool:string}[]).map(h=>({...h,inverse:this.tools.get(h.tool)?.inverse ?? null}));
   this.db.prepare("UPDATE sorties SET status='revoked',closed=? WHERE id=? AND status='open'").run(iso(now),sortieId);
   this.event(sortieId,null,'spear',{reason:String(reason).slice(0,500),revoked,stoodDown,happenedCount:happened.length,happened:happened.slice(0,MAX_SPEAR_HAPPENED)},now);
   return {revoked,stoodDown,happened};
  });
 }
 close(sortieId:string,status:'done'|'failed',now=new Date()):boolean {
  return this.tx(()=>{const changed=Number(this.db.prepare("UPDATE sorties SET status=?,closed=? WHERE id=? AND status='open'").run(status,iso(now),sortieId).changes)>0;if(changed)this.event(sortieId,null,`sortie.${status}`,{},now);return changed;});
 }
 /** Events in order after `after`: at most `limit`, and fewer when their payloads would exceed one frame (always at least one). Page on with the last sequence. */
 events(sortieId:string,after=0,limit=50):SortieEvent[] {
  if(typeof sortieId!=='string'||!sortieId||sortieId.length>100||!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>50)throw new Error('Invalid event page.');
  const rows=this.db.prepare('SELECT v,sequence,sortie_id AS sortieId,action_id AS actionId,kind,payload,created FROM events WHERE sortie_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(sortieId,after,limit) as unknown as (Omit<SortieEvent,'payload'>&{payload:string})[];
  const page:SortieEvent[]=[];let bytes=0;
  for(const r of rows){bytes+=Buffer.byteLength(r.payload);if(page.length&&bytes>EVENT_PAGE_BYTES)break;page.push({...r,payload:readPayload(r.kind,r.payload)} as SortieEvent);}
  return page;
 }
}
