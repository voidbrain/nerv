import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { ballot, defaultPolicy, patternOf, validatePolicy, type Ballot, type Pattern, type Policy, type Stage, type Tool, type Trust, type Verdict } from './policy.ts';
import type { Step } from './misato.ts';
import { explainSortie,type WhyRecord } from './why.ts';
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
export interface SortieSummary {id:string;source:string;title:string;trust:string;status:string;created:string;closed:string|null;actions:number;waiting:number;patterns:string[];why:string}
export interface ActionDetail {id:string;tool:string;args:Record<string,unknown>;ballot:Ballot;created:string;status:'proposed'|'waiting'|'done'|'failed'|'rejected'|'stood-down'}
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
  const t=this.tools.get(tool);const effect=t?.effect ?? 'irreversible';return {pattern:patternOf(effect,sortie.trust,tool,this.policy,t?.owner===true),effect};
 }
 /** The reviewed action behind a grant, and whether the grant is still unused. Grant IDs stay inside this process. */
 grantAction(grantId:string):{sortieId:string;actionId:string;tool:string;args:Record<string,unknown>;used:boolean}|undefined {
  const row=this.db.prepare('SELECT x.sortie_id,x.id,x.tool,x.args,g.used FROM grants g JOIN actions x ON x.id=g.action_id WHERE g.id=?').get(grantId) as {sortie_id:string;id:string;tool:string;args:string;used:string|null}|undefined;
  return row&&{sortieId:row.sortie_id,actionId:row.id,tool:row.tool,args:JSON.parse(row.args) as Record<string,unknown>,used:row.used!==null};
 }
 /** Misato's loop state, kept in the ledger so a resume after the owner's decision needs no coordinator memory (F-033). */
 note<K extends 'misato.request'|'misato.step'|'misato.waiting'|'misato.consult'>(sortieId:string,kind:K,payload:EventPayloads[K],now=new Date()):void {this.tx(()=>this.event(sortieId,null,kind,payload,now));}
 private exchange(sortieId:string,requestPayload:string):{request:string;reply?:string;actions?:string[]} {
  const reply=this.db.prepare("SELECT payload FROM events WHERE sortie_id=? AND kind='misato.reply' ORDER BY sequence DESC LIMIT 1").get(sortieId) as {payload:string}|undefined;
  const ran=(this.db.prepare("SELECT payload FROM events WHERE sortie_id=? AND kind='action.done' ORDER BY sequence").all(sortieId) as {payload:string}[]).map(e=>{const p=JSON.parse(e.payload) as {tool:string;result:unknown};return `${p.tool} → ${JSON.stringify(p.result).slice(0,300)}`;});
  return {request:(JSON.parse(requestPayload) as {text:string}).text,...(reply?{reply:(JSON.parse(reply.payload) as {text:string}).text}:{}),...(ran.length?{actions:ran}:{})};
 }
 /** The last exchanges of one conversation within `withinMs`, oldest first: request, Misato's reply and the actions that ran. */
 conversation(key:string,withinMs=30*60_000,limit=3,now=new Date()):{request:string;reply?:string;actions?:string[]}[] {
  if(typeof key!=='string'||!/^[a-z]+(:[a-z0-9-]{1,30})?$/.test(key)||key.length>40)throw new Error('Invalid conversation.');
  const rows=this.db.prepare("SELECT sortie_id,payload FROM events WHERE kind='misato.request' AND json_extract(payload,'$.conversation')=? AND created>? ORDER BY sequence DESC LIMIT ?").all(key,iso(now,-withinMs),limit) as {sortie_id:string;payload:string}[];
  return rows.reverse().map(r=>this.exchange(r.sortie_id,r.payload));
 }
 /** When the owner last asked Misato anything, for Instrumentality's idle mode. */
 lastRequestAt():string|null {return (this.db.prepare("SELECT max(created) AS t FROM events WHERE kind='misato.request'").get() as {t:string|null}).t;}
 /** Every exchange with Misato in [since, until), oldest first, across conversations: Instrumentality's input. */
 exchangesBetween(since:string,until:string,limit=200):{request:string;reply?:string;actions?:string[]}[] {
  const rows=this.db.prepare("SELECT sortie_id,payload FROM events WHERE kind='misato.request' AND created>=? AND created<? ORDER BY sequence LIMIT ?").all(since,until,limit) as {sortie_id:string;payload:string}[];
  return rows.map(r=>this.exchange(r.sortie_id,r.payload));
 }
 /** Open Misato sorties whose latest wait is over: every approval it waited for is decided, and no resume has claimed it. */
 resumable():string[] {
  return (this.db.prepare(`SELECT s.id FROM sorties s WHERE s.source='misato' AND s.status='open'
   AND (SELECT max(sequence) FROM events WHERE sortie_id=s.id AND kind='misato.waiting') > coalesce((SELECT max(sequence) FROM events WHERE sortie_id=s.id AND kind='misato.resumed'),0)
   AND NOT EXISTS (SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=s.id AND a.decision IS NULL)
   ORDER BY s.created LIMIT 20`).all() as {id:string}[]).map(r=>r.id);
 }
 /** Claims one resume, once: records misato.resumed and returns the request, the steps so far and what became of each awaited approval. */
 claimResume(sortieId:string,now=new Date()):{request:string;steps:{step:Step;actionId?:string}[];decisions:{actionId:string;tool:string;args:Record<string,unknown>;decision:string;result?:unknown;error?:string}[]}|null {
  return this.tx(()=>{
   if(!this.resumable().includes(sortieId))return null;
   const read=(kind:string)=>(this.db.prepare('SELECT payload FROM events WHERE sortie_id=? AND kind=? ORDER BY sequence').all(sortieId,kind) as {payload:string}[]).map(r=>JSON.parse(r.payload) as unknown);
   const request=(read('misato.request').at(-1) as {text:string}|undefined)?.text ?? (this.db.prepare('SELECT title FROM sorties WHERE id=?').get(sortieId) as {title:string}).title;
   const ids=(read('misato.waiting').at(-1) as {approvalIds:string[]}).approvalIds;
   const decisions=ids.flatMap(id=>{
    const row=this.db.prepare('SELECT a.decision,x.id AS action_id,x.tool,x.args FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?').get(id) as {decision:string;action_id:string;tool:string;args:string}|undefined;
    if(!row)return [];
    const done=this.db.prepare("SELECT kind,payload FROM events WHERE action_id=? AND kind IN ('action.done','action.failed') ORDER BY sequence DESC LIMIT 1").get(row.action_id) as {kind:string;payload:string}|undefined;
    const outcome=done?JSON.parse(done.payload) as {result?:unknown;error?:string}:{};
    return [{actionId:row.action_id,tool:row.tool,args:JSON.parse(row.args) as Record<string,unknown>,decision:row.decision,...(done?.kind==='action.done'?{result:outcome.result}:{}),...(done?.kind==='action.failed'?{error:outcome.error}:{})}];
   });
   this.event(sortieId,null,'misato.resumed',{},now);
   return {request,steps:read('misato.step') as {step:Step;actionId?:string}[],decisions};
  });
 }
 private summarize(r:{id:string;source:string;title:string;trust:string;status:string;created:string;closed:string|null}):SortieSummary {
  const actions=this.db.prepare('SELECT id,tool,ballot FROM actions WHERE sortie_id=? ORDER BY created, rowid').all(r.id) as {id:string;tool:string;ballot:string}[];
  const waiting=(this.db.prepare('SELECT count(*) AS n FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=? AND a.decision IS NULL').get(r.id) as {n:number}).n;
  const ballots=actions.map(a=>JSON.parse(a.ballot) as Ballot);
  return {...r,actions:actions.length,waiting,patterns:ballots.map(b=>b.pattern),why:this.why(r,actions.length,actions.at(-1),ballots.at(-1))};
 }
 /** The facts explainSortie needs: the latest action's ballot, the owner's decision and what became of it. */
 private why(r:{id:string;status:string},count:number,last:{id:string;tool:string}|undefined,ballot:Ballot|undefined):string {
  const one=(sql:string,...args:string[])=>this.db.prepare(sql).get(...args) as {kind?:string;payload?:string;decision?:string|null}|undefined;
  const ran=last?one("SELECT kind,payload FROM events WHERE action_id=? AND kind IN ('action.done','action.failed') ORDER BY sequence DESC LIMIT 1",last.id):undefined;
  const spear=r.status==='revoked'?one("SELECT payload FROM events WHERE sortie_id=? AND kind='spear' ORDER BY sequence DESC LIMIT 1",r.id):undefined;
  const replied=!!one("SELECT 1 AS kind FROM events WHERE sortie_id=? AND kind='misato.reply' LIMIT 1",r.id);
  const error=ran?.kind==='action.failed'?(JSON.parse(ran.payload!) as {error?:string}).error:undefined;
  return explainSortie({status:r.status,actions:count,replied,
   spearReason:spear?(JSON.parse(spear.payload!) as {reason?:string}).reason:undefined,
   last:last&&ballot?{tool:last.tool,outcome:ballot.outcome,reason:ballot.reason,decision:one('SELECT decision FROM approvals WHERE action_id=?',last.id)?.decision ?? null,ran:ran?.kind==='action.done'?'done':ran?.kind==='action.failed'?'failed':null,error}:undefined});
 }
 /** Newest sorties first, for the dashboard (F-019): status, counts, each action's Pattern and one sentence of why, never
  grant IDs. `before` pages back through history; `q` keeps sorties whose title contains it (case-insensitive, literal). */
 sorties(limit=20,before?:string,q?:string):SortieSummary[] {
  if(!Number.isInteger(limit)||limit<1||limit>50||(before!==undefined&&(typeof before!=='string'||!Number.isFinite(Date.parse(before))))||(q!==undefined&&(typeof q!=='string'||!q.trim()||q.length>200)))throw new Error('Invalid sortie page.');
  const where=[...(before?['created<?']:[]),...(q?["title LIKE ? ESCAPE '\\'"]:[])];
  const like=q?'%'+q.trim().replace(/[\\%_]/g,c=>'\\'+c)+'%':undefined;
  const rows=this.db.prepare(`SELECT id,source,title,trust,status,created,closed FROM sorties ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY created DESC LIMIT ?`).all(...(before?[before]:[]),...(like?[like]:[]),limit) as Parameters<Ledger['summarize']>[0][];
  return rows.map(r=>this.summarize(r));
 }
 /** One sortie with its actions: tool, arguments, ballot and what became of each. */
 sortie(id:string):(SortieSummary&{detail:ActionDetail[]})|undefined {
  if(typeof id!=='string'||!id||id.length>100)throw new Error('Invalid sortie.');
  const row=this.db.prepare('SELECT id,source,title,trust,status,created,closed FROM sorties WHERE id=?').get(id) as Parameters<Ledger['summarize']>[0]|undefined;if(!row)return undefined;
  const actions=this.db.prepare(`SELECT x.id,x.tool,x.args,x.ballot,x.created,a.decision,
    (SELECT kind FROM events e WHERE e.action_id=x.id AND e.kind IN ('action.done','action.failed') ORDER BY sequence DESC LIMIT 1) AS ran
    FROM actions x LEFT JOIN approvals a ON a.action_id=x.id WHERE x.sortie_id=? ORDER BY x.created`).all(id) as {id:string;tool:string;args:string;ballot:string;created:string;decision:string|null;ran:string|null}[];
  const detail=actions.map((x):ActionDetail=>{const ballot=JSON.parse(x.ballot) as Ballot;
   const status:ActionDetail['status']=x.ran==='action.done'?'done':x.ran==='action.failed'?'failed':ballot.outcome==='reject'?'rejected':ballot.outcome==='approval'&&x.decision===null?'waiting':ballot.outcome==='approval'&&x.decision!=='approve'?'stood-down':'proposed';
   return {id:x.id,tool:x.tool,args:JSON.parse(x.args) as Record<string,unknown>,ballot,created:x.created,status};});
  return {...this.summarize(row),detail};
 }
 /** A sortie by the short ID shown to the owner (a hex prefix of its ID), with what a "why" answer needs (B-004). */
 explain(ref:string):{found:'none'|'many';count?:number}|{found:'one';record:WhyRecord} {
  if(typeof ref!=='string'||!/^[0-9a-f]{4,36}$/.test(ref))throw new Error('Invalid sortie reference.');
  const ids=(this.db.prepare("SELECT id FROM sorties WHERE id LIKE ? ORDER BY created DESC LIMIT 6").all(ref+'%') as {id:string}[]).map(r=>r.id);
  if(!ids.length)return {found:'none'};if(ids.length>1)return {found:'many',count:ids.length};
  const s=this.sortie(ids[0]!)!;
  const consult=this.db.prepare("SELECT payload FROM events WHERE sortie_id=? AND kind='misato.consult' ORDER BY sequence LIMIT 1").get(s.id) as {payload:string}|undefined;
  const advice=consult?JSON.parse(consult.payload) as {advice?:string;model?:string}:undefined;
  const actions=s.detail.map(d=>{
   const ap=this.db.prepare('SELECT decision,decided,source FROM approvals WHERE action_id=?').get(d.id) as {decision:string|null;decided:string|null;source:string|null}|undefined;
   const done=this.db.prepare("SELECT kind,payload FROM events WHERE action_id=? AND kind IN ('action.done','action.failed') ORDER BY sequence DESC LIMIT 1").get(d.id) as {kind:string;payload:string}|undefined;
   return {tool:d.tool,pattern:d.ballot.pattern,outcome:d.ballot.outcome,reason:d.ballot.reason,verdicts:d.ballot.verdicts.map(v=>({seat:v.seat,vote:v.vote,reason:v.reason,...(v.shadow?{shadow:true}:{})})),
    decision:ap?.decision ?? null,decided:ap?.decided ?? null,source:ap?.source ?? null,ran:done?.kind==='action.done'?'done' as const:done?.kind==='action.failed'?'failed' as const:null,
    ...(done?.kind==='action.failed'?{error:(JSON.parse(done.payload) as {error?:string}).error}:{})};});
  return {found:'one',record:{id:s.id,title:s.title,status:s.status,why:s.why,...(advice?.advice?{advice:{text:advice.advice,model:advice.model ?? ''}}:{}),actions}};
 }
 /** Misato's reply to the owner, kept with the sortie it answers. */
 reply(sortieId:string,text:string,now=new Date()):void {this.tx(()=>this.event(sortieId,null,'misato.reply',{text:text.slice(0,4000)},now));}
 /** Records what an executor did after `authorize` let it run. */
 finished(sortieId:string,actionId:string,tool:string,outcome:{result:unknown}|{error:string},now=new Date()):void {
  this.tx(()=>{if('error' in outcome)this.event(sortieId,actionId,'action.failed',{tool,error:outcome.error.slice(0,500)},now);else this.event(sortieId,actionId,'action.done',{tool,result:outcome.result},now);});
 }
 pendingApprovals(now=new Date(),limit=5):Approval[] {
  // Up to 20: one Instrumentality night can propose 10 facts, sent to the owner as one bundled card (F-022).
  if(!Number.isInteger(limit)||limit<1||limit>20)throw new Error('Invalid approval page.');
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
 /** Approvals that expired without the owner deciding, since a time (F-028): what the brief reports as not done. */
 expiredSince(since:string,limit=20):{tool:string;sortieId:string;title:string;expired:string}[] {
  if(typeof since!=='string'||!Number.isFinite(Date.parse(since)))throw new Error('Invalid time.');
  return this.db.prepare(`SELECT x.tool,x.sortie_id AS sortieId,s.title,a.decided AS expired FROM approvals a JOIN actions x ON x.id=a.action_id JOIN sorties s ON s.id=x.sortie_id
    WHERE a.decision='expired' AND a.decided>? ORDER BY a.decided LIMIT ?`).all(new Date(Date.parse(since)).toISOString(),Math.min(Math.max(1,limit),50)) as {tool:string;sortieId:string;title:string;expired:string}[];
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
