import {transaction} from './sqlite-transaction.ts';
import type {WorkerLease} from './worker-jobs.ts';
import {readConfig} from './config.ts';
import {WorkerJobs,WORKER_RESULT_BYTES,WORKER_LEASE_MS} from './worker-jobs.ts';
import {InstrumentalityRuns} from './instrumentality-runs.ts';
import {UsageStore} from './model-usage.ts';
import {checkHistory,historyPage,type HistoryPage} from './history.ts';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LEDGER_SCHEMA, Ledger, type Decision, type Proposal } from './ledger.ts';
import { builtinTools, execute, hasExecutor } from './executors.ts';
import { MEMORY_SCHEMA, Memory, type Episode } from './memory.ts';
import {Registry, REGISTRY_SCHEMA } from './kaji.ts';
import { defaultPolicy, type Ballot, type Policy } from './policy.ts';
export type Reminder = { id: string; title: string; due: string; created: string; delivered: string | null; cancelled: string | null };
export interface InboxCheckpoint {sequence:number;id?:string}
export interface InboxEntry {sequence:number;id:string;message:string;created:string;kind:'reminder'|'brief'}
export interface InboxPage {items:InboxEntry[];head:InboxCheckpoint;next:InboxCheckpoint;reset:boolean}
/** What one gated action came to: granted and run (result or error), waiting for the owner (approvalId), or rejected. */
export interface ActResult {external?:boolean;sortieId:string;actionId:string;outcome:Ballot['outcome'];pattern:Ballot['pattern'];reason:string;sync:Ballot['sync'];approvalId?:string;result?:unknown;error?:string}
/** Sorties the owner starts directly hold one action and close once it settles. */
export const OWNER_SOURCE='owner';
/** Sorties Misato plans hold several actions; the coordinator closes them when the loop ends. */
export const MISATO_SOURCE='misato';
export class Store {
  readonly db: DatabaseSync;
  readonly workerJobs:WorkerJobs;
  readonly usage: UsageStore;
  readonly instrumentality: InstrumentalityRuns;
  readonly ledger: Ledger;
  readonly memory: Memory;
  readonly policySource: string;
  /** The data home, when known: the schedule tool writes config.json there. */
  readonly home?: string;
  constructor(path: string, scrolls: {policy:Policy;source:string} = {policy:defaultPolicy,source:'default'}, options: {home?:string} = {}) {
    if(options.home)this.home=options.home;
    if(path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    const version = this.db.prepare('PRAGMA user_version').get() as {user_version:number};
    if(version.user_version > 5) {this.db.close();throw new Error('Database schema is newer than this NERV Agency version.');}
    this.usage=new UsageStore(this.db);this.instrumentality=new InstrumentalityRuns(this.db);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY, title TEXT NOT NULL, due TEXT NOT NULL, created TEXT NOT NULL, delivered TEXT, cancelled TEXT);
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, reminder_id TEXT UNIQUE REFERENCES reminders(id), kind TEXT NOT NULL DEFAULT 'reminder', message TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT);
      CREATE INDEX IF NOT EXISTS reminders_due ON reminders(due);
      CREATE INDEX IF NOT EXISTS reminders_pending_due ON reminders(due) WHERE delivered IS NULL AND cancelled IS NULL;
      ${LEDGER_SCHEMA}`);
    // Schema 3: events record the event schema version they were written under (F-024); earlier rows read as version 1.
    if(!(this.db.prepare('PRAGMA table_info(events)').all() as {name:string}[]).some(c=>c.name==='v'))this.db.exec('ALTER TABLE events ADD COLUMN v INTEGER NOT NULL DEFAULT 1');
    // Schema 4: Lilith's facts, their append-only history and the FTS5 index (F-022).
    this.db.exec(MEMORY_SCHEMA);
    // The Gehirn registry of bases for the Kaji line (F-036): signed, append-only records; an additive table, no version change.
    this.db.exec(REGISTRY_SCHEMA);
    // F-036 slice 3b, additive: actions queued for other bases, and actions other bases asked of this one (by their id, so a
    // resend after a crash returns the first result instead of running twice).
    this.db.exec(`CREATE TABLE IF NOT EXISTS kaji_outbox(id TEXT PRIMARY KEY, sortie_id TEXT NOT NULL, base TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, request TEXT NOT NULL, created TEXT NOT NULL, done TEXT, result TEXT);`);
    // Schema 5: the inbox holds Hyuga's briefs as well as reminders (F-028). The table is rebuilt once, keeping every
    // row's rowid: inbox cursors (Telegram, the menu-bar app) are rowids, so none of them jumps or repeats.
    if(!(this.db.prepare('PRAGMA table_info(deliveries)').all() as {name:string}[]).some(c=>c.name==='kind')){
      this.db.exec('BEGIN IMMEDIATE');
      try{
        this.db.exec(`CREATE TABLE deliveries_v5(id TEXT PRIMARY KEY, reminder_id TEXT UNIQUE REFERENCES reminders(id), kind TEXT NOT NULL DEFAULT 'reminder', message TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT);
          INSERT INTO deliveries_v5(rowid,id,reminder_id,kind,message,created,read_at) SELECT rowid,id,reminder_id,'reminder',message,created,read_at FROM deliveries;
          DROP TABLE deliveries;ALTER TABLE deliveries_v5 RENAME TO deliveries;`);
        this.db.exec('COMMIT');
      }catch(e){this.db.exec('ROLLBACK');throw e;}
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS deliveries_kind_created ON deliveries(kind,created); PRAGMA user_version=5');
    // Additive daily identities preserve the inbox's existing rowids and UUIDs.
    this.db.exec('CREATE TABLE IF NOT EXISTS daily_briefs(day TEXT PRIMARY KEY,delivery_id TEXT NOT NULL UNIQUE REFERENCES deliveries(id))');
    this.ledger = new Ledger(this.db,{policy:scrolls.policy,tools:builtinTools});this.memory = new Memory(this.db);this.policySource = scrolls.source;
    this.db.exec("CREATE TABLE IF NOT EXISTS worker_legacy_outbox(id TEXT PRIMARY KEY,state TEXT NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL); CREATE TABLE IF NOT EXISTS worker_outbox_cancels(id TEXT PRIMARY KEY,reason TEXT NOT NULL,created TEXT NOT NULL); CREATE TABLE IF NOT EXISTS worker_outbox_attempts(id TEXT PRIMARY KEY,attempted TEXT NOT NULL); CREATE TABLE IF NOT EXISTS worker_outbox_reconciliations(id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL,created TEXT NOT NULL)");
    try{this.workerJobs=transaction(this.db,()=>{
      const legacy=!!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kaji_runs'").get();const jobs=new WorkerJobs(this.db,raw=>this.legacyWorkerResult(raw));
      if(legacy)this.db.prepare("INSERT OR IGNORE INTO worker_legacy_outbox SELECT id,'pending','Predates durable worker receipts; verify the destination before replay.',? FROM kaji_outbox WHERE done IS NULL").run(new Date().toISOString());return jobs;
    });}catch(error){this.db.close();throw error;}

  }
  private legacyWorkerResult(raw:string):{state:'completed'|'running';result?:unknown} {
    const result=JSON.parse(raw) as {outcome?:string;approvalId?:string;external?:boolean};
    if(result.outcome!=='approval')return result.external?{state:'running'}:{state:'completed',result};
    const row=this.db.prepare('SELECT action_id,decision FROM approvals WHERE id=?').get(result.approvalId ?? '') as {action_id:string;decision:string|null}|undefined;if(!row)return {state:'running'};
    if(!row.decision)this.decideCore(result.approvalId!,'reject','worker-upgrade');
    if(row.decision!=='approve')return {state:'completed',result:{outcome:'reject',reason:'Pre-protocol remote approval stood down or already declined; request again explicitly if needed.'}};
    const grant=this.db.prepare('SELECT used FROM grants WHERE action_id=?').get(row.action_id) as {used:string|null}|undefined;
    if(grant&&!grant.used){const action=this.db.prepare('SELECT sortie_id FROM actions WHERE id=?').get(row.action_id) as {sortie_id:string};this.ledger.spear(action.sortie_id,'Worker upgrade revoked the unused pre-protocol grant.');return {state:'completed',result:{outcome:'reject',reason:'The pre-protocol grant was revoked before use; no execution occurred.'}};}
    const done=this.db.prepare("SELECT kind,payload FROM events WHERE action_id=? AND kind IN ('action.done','action.failed') ORDER BY sequence DESC LIMIT 1").get(row.action_id) as {kind:string;payload:string}|undefined;
    return done?{state:'completed',result:{outcome:'grant',...JSON.parse(done.payload) as {result?:unknown;error?:string}}}:{state:'running'};
  }
  /** Same-connection writes plus external SQLite commits, without scanning events or running integrity checks. */
  dashboardRevision():string {
    const own=this.db.prepare('SELECT total_changes() AS n').get() as {n:number};
    const external=this.db.prepare('PRAGMA data_version').get() as {data_version:number};
    return `${external.data_version}:${own.n}`;
  }
  /** A valid title and a future ISO date with an explicit timezone, as UTC; the same rules for a new reminder and an edit. */
  private checkReminder(title: string, due: string, now: Date): {title: string; due: string} {
    if(typeof title !== 'string' || !title.trim() || title.length > 500) throw new Error('Title must contain 1–500 characters.');
    if(typeof due !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.test(due) || !Number.isFinite(Date.parse(due))) throw new Error('Use an ISO date with an explicit timezone offset.');
    const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,3})?)?(Z|[+-](\d\d):(\d\d))$/.exec(due)!;
    const [,year,month,day,hour,minute,second,zone,offsetHour,offsetMinute] = match;
    const days = new Date(Date.UTC(Number(year),Number(month),0)).getUTCDate();
    if(Number(month)<1 || Number(month)>12 || Number(day)<1 || Number(day)>days || Number(hour)>23 || Number(minute)>59 || Number(second ?? 0)>59 || (zone !== 'Z' && (Number(offsetHour)>14 || Number(offsetMinute)>59 || (Number(offsetHour)===14 && Number(offsetMinute)!==0)))) throw new Error('Invalid calendar date or timezone offset.');
    if(Date.parse(due) <= now.getTime()) throw new Error('Reminder must be in the future.');
    return {title:title.trim(),due:new Date(due).toISOString()};
  }
  /** Adds a reminder, or returns the pending one with the same title (ignoring case and outer spaces) and the same moment,
      marked `existing`: a request sent twice (a retry, two channels) never makes two reminders (B-003). */
  add(title: string, due: string, now = new Date()): Reminder & {existing?: true} {
    const checked = this.checkReminder(title,due,now);
    const same = this.db.prepare('SELECT * FROM reminders WHERE delivered IS NULL AND cancelled IS NULL AND due=? AND lower(trim(title))=lower(trim(?)) LIMIT 1').get(checked.due,checked.title) as Reminder | undefined;
    if(same) return {...same,existing:true};
    const r: Reminder = {id:randomUUID(),title:checked.title,due:checked.due,created:now.toISOString(),delivered:null,cancelled:null};
    this.db.prepare('INSERT INTO reminders VALUES(?,?,?,?,?,?)').run(r.id,r.title,r.due,r.created,null,null); return r;
  }
  list(): Reminder[] { return this.db.prepare('SELECT * FROM reminders ORDER BY due').all() as Reminder[]; }
  reminderPage(before=0,limit=20):HistoryPage<Reminder&{sequence:number}> {
    checkHistory(before,limit);
    return historyPage(this.db.prepare('SELECT rowid AS sequence,* FROM reminders WHERE rowid<? ORDER BY rowid DESC LIMIT ?').all(before||Number.MAX_SAFE_INTEGER,limit+1) as unknown as (Reminder&{sequence:number})[],limit);
  }
  inboxHistory(before=0,limit=20):HistoryPage<InboxEntry> {
    checkHistory(before,limit);
    return historyPage(this.db.prepare('SELECT rowid AS sequence,* FROM deliveries WHERE rowid<? ORDER BY rowid DESC LIMIT ?').all(before||Number.MAX_SAFE_INTEGER,limit+1) as unknown as InboxEntry[],limit);
  }
  /** Bounded dashboard facts; counts are SQL aggregates, never a downloaded full inbox. */
  dashboardHistory(since:string) {
    if(typeof since!=='string'||!Number.isFinite(Date.parse(since)))throw new Error('Invalid dashboard time.');
    const delivered=(this.db.prepare("SELECT count(*) AS count FROM deliveries WHERE kind='reminder' AND created>?").get(new Date(since).toISOString()) as {count:number}).count;
    const brief=this.db.prepare("SELECT message,created FROM deliveries WHERE kind='brief' ORDER BY rowid DESC LIMIT 1").get() ?? null;
    const pending=(this.db.prepare('SELECT count(*) AS count FROM reminders WHERE delivered IS NULL AND cancelled IS NULL').get() as {count:number}).count;
    const reminders=this.db.prepare('SELECT * FROM reminders WHERE delivered IS NULL AND cancelled IS NULL ORDER BY due LIMIT 10').all() as Reminder[];
    return {delivered,brief,pending,reminders};
  }
  pendingReminders(limit=5): Reminder[] { if(!Number.isInteger(limit)||limit<1||limit>20)throw new Error('Invalid pending reminder limit.');return this.db.prepare('SELECT * FROM reminders WHERE delivered IS NULL AND cancelled IS NULL ORDER BY due LIMIT ?').all(limit) as Reminder[]; }
  /** Undoes a cancellation while the reminder is still in the future and undelivered: the inverse of cancel. */
  restore(id: string): boolean { return Number(this.db.prepare('UPDATE reminders SET cancelled=NULL WHERE id=? AND delivered IS NULL AND cancelled IS NOT NULL AND due>?').run(id,new Date().toISOString()).changes) > 0; }
  /** Changes the title and/or the time of a reminder that has not fired or been cancelled; undefined when there is none. */
  update(id: string, patch: {title?: string; due?: string}, now = new Date()): Reminder | undefined {
    if(typeof id !== 'string' || !id || (patch.title === undefined && patch.due === undefined)) throw new Error('Give a new title or a new due time.');
    const row = this.db.prepare('SELECT * FROM reminders WHERE id=? AND delivered IS NULL AND cancelled IS NULL').get(id) as Reminder | undefined; if(!row) return undefined;
    const checked = this.checkReminder(patch.title ?? row.title, patch.due ?? row.due, now);
    this.db.prepare('UPDATE reminders SET title=?,due=? WHERE id=? AND delivered IS NULL AND cancelled IS NULL').run(checked.title,checked.due,id);
    return {...row,...checked};
  }
  cancel(id: string): boolean { return Number(this.db.prepare('UPDATE reminders SET cancelled=? WHERE id=? AND delivered IS NULL AND cancelled IS NULL').run(new Date().toISOString(),id).changes) > 0; }
  tick(now = new Date()): number {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const due = this.db.prepare('SELECT * FROM reminders WHERE due<=? AND delivered IS NULL AND cancelled IS NULL').all(now.toISOString()) as Reminder[];
      for(const r of due) {
        this.db.prepare("INSERT OR IGNORE INTO deliveries(id,reminder_id,kind,message,created,read_at) VALUES(?,?,'reminder',?,?,NULL)").run(randomUUID(),r.id,r.title,now.toISOString());
        this.db.prepare('UPDATE reminders SET delivered=? WHERE id=?').run(now.toISOString(),r.id);
      }
      this.db.exec('COMMIT'); return due.length;
    } catch(e) {this.db.exec('ROLLBACK'); throw e;}
  }
  queueRemote(sortieId: string, base: string, tool: string, args: Record<string,unknown>): {id:string} {
    const id=randomUUID();const title=(this.db.prepare('SELECT title FROM sorties WHERE id=?').get(sortieId) as {title:string}|undefined)?.title ?? '';
    this.db.prepare('INSERT INTO kaji_outbox VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(id,sortieId,base,tool,JSON.stringify(args),title.slice(0,500),new Date().toISOString());return {id};
  }
  /** Queued actions not settled yet, oldest first: the coordinator sends them (the same id each time). */
  outbox(): {attempted:boolean;deadline:number;sequence:number;id:string;sortieId:string;base:string;tool:string;args:Record<string,unknown>;request:string}[] {
    return (this.db.prepare(`SELECT rowid AS sequence,id,sortie_id,base,tool,args,request,created,EXISTS(SELECT 1 FROM worker_outbox_attempts a WHERE a.id=q.id) AS attempted FROM kaji_outbox q WHERE done IS NULL AND NOT EXISTS (SELECT 1 FROM worker_legacy_outbox h WHERE h.id=q.id AND h.state='pending') AND NOT EXISTS (SELECT 1 FROM worker_outbox_cancels c WHERE c.id=q.id) ORDER BY created LIMIT 10`).all() as {sequence:number;id:string;sortie_id:string;base:string;tool:string;args:string;request:string;created:string;attempted:number}[]).map(r=>({attempted:!!r.attempted,deadline:Date.parse(r.created)+WORKER_LEASE_MS,sequence:r.sequence,id:r.id,sortieId:r.sortie_id,base:r.base,tool:r.tool,args:JSON.parse(r.args) as Record<string,unknown>,request:r.request}));
  }
  cancelWorker(owner:string,id:string,reason:string,source:'coordinator'|'cli'):{status:string;result?:unknown} {
    return transaction(this.db,()=>{
      const existingOwner=this.workerJobs.owner(id);if(existingOwner&&existingOwner!==owner)throw new Error('Worker cancellation owner differs.');
      const pending=this.workerJobs.waitingApprovals().find(p=>p.lease.id===id&&!p.decision);
      if(pending){this.decideCore(pending.id,'reject','worker-cancel');this.workerJobs.finish(pending.lease,{outcome:'reject',reason:'Owner cancelled the pending worker approval; no execution occurred.'});}
      return this.workerJobs.cancel(owner,id,reason,source);
    });
  }
  cancelWorkerOutbox(id:string,reason:string):void {
    if(typeof reason!=='string'||!reason.trim()||reason.length>500)throw new Error('A cancellation reason is required.');
    if(!this.db.prepare('SELECT 1 FROM kaji_outbox WHERE id=? AND done IS NULL').get(id))throw new Error('No pending remote request with that ID.');this.db.prepare('INSERT OR IGNORE INTO worker_outbox_cancels VALUES(?,?,?)').run(id,reason,new Date().toISOString());
  }
  cancelledWorkerOutbox():{sortieId:string;id:string;base:string;tool:string;reason:string;attempted:boolean;legacy:boolean}[]{
    return (this.db.prepare("SELECT q.sortie_id AS sortieId,q.id,q.base,q.tool,c.reason,EXISTS(SELECT 1 FROM worker_outbox_attempts a WHERE a.id=q.id) AS attempted,EXISTS(SELECT 1 FROM worker_legacy_outbox h WHERE h.id=q.id AND h.state='pending') AS legacy FROM kaji_outbox q JOIN worker_outbox_cancels c ON c.id=q.id WHERE q.done IS NULL ORDER BY q.rowid LIMIT 4").all() as {sortieId:string;id:string;base:string;tool:string;reason:string;attempted:number;legacy:number}[]).map(r=>({...r,attempted:!!r.attempted,legacy:!!r.legacy}));
  }
  spear(id:string,reason:string){
    return transaction(this.db,()=>{const result=this.ledger.spear(id,reason);this.db.prepare('INSERT OR IGNORE INTO worker_outbox_cancels SELECT id,?,? FROM kaji_outbox WHERE sortie_id=? AND done IS NULL').run(reason.slice(0,500),new Date().toISOString(),id);const remotePending=(this.db.prepare('SELECT count(*) AS n FROM kaji_outbox WHERE sortie_id=? AND done IS NULL').get(id) as {n:number}).n;return {...result,...(remotePending?{remotePending}:{})};});
  }
  attemptWorkerOutbox(id:string):void {
    transaction(this.db,()=>{const row=this.db.prepare('SELECT created FROM kaji_outbox WHERE id=? AND done IS NULL AND NOT EXISTS (SELECT 1 FROM worker_outbox_cancels c WHERE c.id=kaji_outbox.id)').get(id) as {created:string}|undefined;
      if(!row||Date.parse(row.created)+WORKER_LEASE_MS<=Date.now())throw new Error('Worker request was cancelled or expired before dispatch.');this.db.prepare('INSERT OR IGNORE INTO worker_outbox_attempts VALUES(?,?)').run(id,new Date().toISOString());});
  }
  heldWorkerOutbox(before=Number.MAX_SAFE_INTEGER):{sequence:number;id:string;base:string;tool:string;reason:string}[]{
    if(!Number.isSafeInteger(before)||before<1)throw new Error('Invalid held-outbox cursor.');return this.db.prepare("SELECT q.rowid AS sequence,q.id,q.base,q.tool,h.reason FROM kaji_outbox q JOIN worker_legacy_outbox h ON h.id=q.id WHERE h.state='pending' AND q.done IS NULL AND q.rowid<? ORDER BY q.rowid DESC LIMIT 20").all(before) as {sequence:number;id:string;base:string;tool:string;reason:string}[];
  }
  reconcileWorkerOutbox(id:string,action:'retry'|'abandon',reason:string,confirmedNotRun=false):void {
    if(!['retry','abandon'].includes(action)||typeof reason!=='string'||reason.trim().length<8||reason.length>500||(action==='retry'&&!confirmedNotRun))throw new Error('A reason and explicit not-run confirmation for retry are required.');
    transaction(this.db,()=>{
      const row=this.db.prepare("SELECT q.base FROM kaji_outbox q JOIN worker_legacy_outbox h ON h.id=q.id WHERE q.id=? AND q.done IS NULL AND h.state='pending'").get(id) as {base:string}|undefined;if(!row)throw new Error('No held legacy request with that ID.');
      if(action==='retry'){this.db.prepare('UPDATE kaji_outbox SET created=?,result=NULL WHERE id=?').run(new Date().toISOString(),id);this.db.prepare('DELETE FROM worker_outbox_attempts WHERE id=?').run(id);}
      else this.outboxDone(id,{outcome:'uncertain',error:'Owner stood down legacy retries; effects were not assumed undone.'},{base:row.base,text:'Owner stood down the pre-upgrade request; its prior effects remain unknown.'});
      this.db.prepare('UPDATE worker_legacy_outbox SET state=? WHERE id=?').run(action,id);this.db.prepare("INSERT INTO worker_outbox_reconciliations VALUES(?,?,?,'cli',?)").run(id,action,reason,new Date().toISOString());
    });
  }
  /** Marks a sent action done with its result and, the first time only, records what the other base did on the sortie (B-011). */
  outboxDone(id:string,result:unknown,said?:{base:string;text:string}):boolean {return this.recordOutbox(id,result,said,true);}
  outboxProgress(id:string,result:unknown,said:{base:string;text:string}):boolean {return this.recordOutbox(id,result,said,false);}
  private recordOutbox(id:string,result:unknown,said:{base:string;text:string}|undefined,terminal:boolean):boolean {
    const encoded=JSON.stringify(result);if(!encoded||Buffer.byteLength(encoded)>WORKER_RESULT_BYTES)throw new Error('Remote result exceeds its persistence bound.');
    return transaction(this.db,()=>{
      const row=this.db.prepare('SELECT sortie_id,tool,result,done FROM kaji_outbox WHERE id=?').get(id) as {sortie_id:string;tool:string;result:string|null;done:string|null}|undefined;if(!row)return false;
      if(row.done){const previous=row.result?JSON.parse(row.result) as {outcome?:string}:{};const next=result as {outcome?:string;refused?:unknown};if(!terminal||previous.outcome!=='uncertain'||!(['grant','reject','invalid'].includes(next.outcome ?? '')||typeof next.refused==='string'))return false;}
      if(!terminal&&row.result&&(JSON.parse(row.result) as {approvalId?:unknown}).approvalId===(result as {approvalId?:unknown}).approvalId)return false;
      this.db.prepare('UPDATE kaji_outbox SET done=?,result=? WHERE id=?').run(terminal?new Date().toISOString():null,encoded,id);
      if(said){const r=result as {outcome?:unknown;refused?:unknown};this.ledger.remoteResult(row.sortie_id,{base:said.base.slice(0,60),tool:row.tool,outcome:typeof r.refused==='string'?'refused':typeof r.outcome==='string'?r.outcome:'answered',text:said.text.slice(0,600)});}return true;
    });
  }

  inbox() { return this.db.prepare('SELECT * FROM deliveries ORDER BY created DESC').all(); }
  /** Hyuga's brief into the inbox (F-028): every channel delivers it from here, once. */
  addBrief(message: string, now = new Date(), day?:string): {id:string;created:string;existing?:true} {
    if(typeof message !== 'string' || !message.trim() || message.length > 4000) throw new Error('A brief is 1–4000 characters.');
    if(day!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day))throw new Error('Invalid daily brief date.');
    const insert=()=>{const id=randomUUID(),created=now.toISOString();this.db.prepare("INSERT INTO deliveries(id,reminder_id,kind,message,created,read_at) VALUES(?,NULL,'brief',?,?,NULL)").run(id,message,created);return {id,created};};
    if(day===undefined)return insert();
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const previous=this.db.prepare('SELECT delivery_id AS id FROM daily_briefs WHERE day=?').get(day) as {id:string}|undefined;
      if(previous){const delivery=this.db.prepare('SELECT id,created FROM deliveries WHERE id=?').get(previous.id) as {id:string;created:string}|undefined;if(!delivery)throw new Error('Daily brief checkpoint has no delivery.');this.db.exec('COMMIT');return {...delivery,existing:true};}
      const delivery=insert();this.db.prepare('INSERT INTO daily_briefs(day,delivery_id) VALUES(?,?)').run(day,delivery.id);this.db.exec('COMMIT');return delivery;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  /** When the latest brief was written, if any: the next brief covers what happened since. */
  lastBrief(): string | null { return (this.db.prepare("SELECT created FROM deliveries WHERE kind='brief' ORDER BY rowid DESC LIMIT 1").get() as {created:string}|undefined)?.created ?? null; }
  inboxPage(after=0,limit=5,afterId?:string):InboxPage {
    if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>20||(after>0&&(typeof afterId!=='string'||!afterId||afterId.length>100)))throw new Error('Invalid inbox checkpoint or limit.');
    this.db.exec('BEGIN');
    try {
      const head=(this.db.prepare('SELECT rowid AS sequence,id FROM deliveries ORDER BY rowid DESC LIMIT 1').get() as unknown as InboxCheckpoint|undefined) ?? {sequence:0};
      const previous=after?this.db.prepare('SELECT id FROM deliveries WHERE rowid=?').get(after) as {id:string}|undefined:undefined;
      if(after>0&&previous?.id!==afterId){this.db.exec('COMMIT');return {items:[],head,next:head,reset:true};}
      const items=this.db.prepare('SELECT rowid AS sequence,id,message,created,kind FROM deliveries WHERE rowid>? ORDER BY rowid LIMIT ?').all(after,limit) as unknown as InboxEntry[];
      const last=items.at(-1);const next=last?{sequence:last.sequence,id:last.id}:after?{sequence:after,id:afterId}:{sequence:0};
      this.db.exec('COMMIT');return {items,head,next,reset:false};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  approvals(limit=5) { return this.ledger.pendingApprovals(new Date(),limit); }
  pendingApprovalIds(ids:string[]) { return this.ledger.pendingApprovalIds(ids); }
  expiredApprovals(since: string) { return this.ledger.expiredSince(since); }
  /** The grant ID stays inside the coordinator: callers learn only the outcome. */
  /** Applies the owner's decision; an approval of a tool with an executor runs it once, here, with the grant it issued. */
  assertWorkerAuthority(owner:string,key:string,ownerKey:string):void {
    if(!this.home)throw new Error('Worker identity unavailable.');const config=readConfig(this.home),registry=new Registry(this.db,config.kaji?.root);
    if(registry.main()!==owner||!registry.bases().some(b=>b.baseId===owner&&b.status==='enrolled'&&b.publicKey===ownerKey)||!registry.bases().some(b=>b.baseId===config.base.id&&b.status==='enrolled'&&b.publicKey===key))throw new Error('Worker authority or destination enrollment changed.');
  }
  releaseWorker(id:string,reason:string,confirmedStopped:boolean):void {
    transaction(this.db,()=>{if(!confirmedStopped)throw new Error('Explicit owner confirmation required.');for(const pending of this.workerJobs.waitingApprovals())if(pending.lease.id===id&&!pending.decision)this.decideCore(pending.id,'reject','worker-release');this.workerJobs.release(id,reason,confirmedStopped);});
  }
  private assertWorker(lease:WorkerLease){this.assertWorkerAuthority(lease.owner,lease.key,lease.ownerKey);this.workerJobs.assertLease(lease);}
  decide(id: string, decision: Decision, source='api'):{decision:string;result?:unknown;error?:string} {
    const lease=this.workerJobs.approval(id);if(!lease)return this.decideCore(id,decision,source);
    return transaction(this.db,()=>{
      const row=this.db.prepare('SELECT decision FROM approvals WHERE id=?').get(id) as {decision:string|null}|undefined;if(row?.decision)return this.decideCore(id,decision,source);
      if(decision==='approve')try{this.assertWorker(lease);}catch{
        const rejected=this.decideCore(id,'reject','worker-fence');this.workerJobs.finish(lease,{outcome:'reject',error:'Worker lease or authority changed before approval; nothing ran.'});return {...rejected,error:'Worker lease or authority changed; nothing ran.'};
      }
      const result=this.decideCore(id,decision,source);this.workerJobs.finish(lease,{outcome:result.decision==='approve'&&!result.error?'grant':'reject',...result});return result;
    });
  }
  private decideCore(id: string, decision: Decision, source='api'):{decision:string;result?:unknown;error?:string} {
    const applied=this.ledger.decide(id,decision,source);
    const action=applied.grantId?this.ledger.grantAction(applied.grantId):undefined;
    if(applied.grantId&&action&&!action.used&&hasExecutor(action.tool)){const outcome=this.run(action.sortieId,action.actionId,applied.grantId,action.tool,action.args);this.settle(action.sortieId,'error' in outcome?'failed':'done');return {decision:applied.decision,...outcome};}
    const sortie=this.db.prepare('SELECT x.sortie_id AS id FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?').get(id) as {id:string}|undefined;
    if(sortie&&applied.decision!=='approve')this.settle(sortie.id,'failed');
    return {decision:applied.decision};
  }
  /** One owner action through the gate (F-017): ballot, then on a grant the executor runs at once; otherwise it waits for the owner or stops. */
  runAction(sortieId:string,proposal:Proposal,worker?:WorkerLease):ActResult {
    if(!worker)return this.runActionCore(sortieId,proposal);
    return transaction(this.db,()=>{this.assertWorker(worker);const result=this.runActionCore(sortieId,proposal,worker.expires);if(result.approvalId)this.workerJobs.bindApproval(worker,result.approvalId,result);return result;});
  }
  private runActionCore(sortieId: string, proposal: Proposal,approvalUntil?:number):ActResult {
    const p=this.ledger.propose(sortieId,proposal,new Date(),approvalUntil);
    const base:ActResult={sortieId,actionId:p.actionId,outcome:p.ballot.outcome,pattern:p.ballot.pattern,reason:p.ballot.reason,sync:p.ballot.sync,...(p.approvalId?{approvalId:p.approvalId}:{})};
    if(p.grantId&&hasExecutor(proposal.tool)){const outcome=this.run(sortieId,p.actionId,p.grantId,proposal.tool,proposal.args);this.settle(sortieId,'error' in outcome?'failed':'done');return {...base,...outcome};}
    // F-021: a granted MCP tool: the single-use grant is used here, the call is made by the tools process.
    if(p.grantId&&this.ledger.isExternal(proposal.tool)){this.ledger.authorize(p.grantId,proposal.tool,proposal.args);return {...base,external:true};}
    if(p.ballot.outcome==='reject')this.settle(sortieId,'failed');
    return base;
  }
  private run(sortieId:string,actionId:string,grantId:string,tool:string,args:Record<string,unknown>):{result:unknown}|{error:string} {
    this.ledger.authorize(grantId,tool,args);
    let outcome:{result:unknown}|{error:string};
    try{outcome={result:execute(this,tool,args,{sortieId})};}catch(e){outcome={error:e instanceof Error?e.message:'Executor failed.'};}
    this.ledger.finished(sortieId,actionId,tool,outcome);return outcome;
  }
  private settle(sortieId:string,status:'done'|'failed') {
    const sortie=this.db.prepare('SELECT source FROM sorties WHERE id=?').get(sortieId) as {source:string}|undefined;
    if(sortie?.source===OWNER_SOURCE)this.ledger.close(sortieId,status);
    // Proposals (Instrumentality; Marduk Institute pilots, B-026): the sortie is done once the owner has decided every
    // card, whatever the decisions: nothing resumes after them.
    if((sortie?.source==='instrumentality'||sortie?.source==='marduk')&&!(this.db.prepare('SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=? AND a.decision IS NULL').get(sortieId)))this.ledger.close(sortieId,'done');
  }
  private settledOnce=false;
  /**
   * Scheduler tick: stands down approvals past their TTL, then closes the sorties nothing will finish any more (B-026):
   * an owner action or a proposal whose every card is decided (an expired card included). Misato's sorties resume
   * instead. The first tick also closes those left open by an earlier version.
   */
  expire(now=new Date()):number {
   const n=this.ledger.expire(now);
   for(const pending of this.workerJobs.waitingApprovals())transaction(this.db,()=>{
    // An already issued grant without a terminal receipt is uncertain, never proof that nothing ran.
    if(pending.decision==='approve')return;
    let invalid=!!pending.decision;
    try{this.assertWorkerAuthority(pending.lease.owner,pending.lease.key,pending.lease.ownerKey);this.workerJobs.assertLease(pending.lease,now.getTime());}catch{invalid=true;}
    if(invalid){if(!pending.decision)this.decideCore(pending.id,'reject','worker-fence');this.workerJobs.finish(pending.lease,{outcome:'reject',error:'Worker approval expired or its lease/authority ended; nothing ran.'});}
   });
   if(n||!this.settledOnce){this.settledOnce=true;
    const stuck=this.db.prepare(`SELECT s.id,s.source FROM sorties s WHERE s.status='open' AND s.source IN (?,'instrumentality','marduk')
     AND EXISTS (SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=s.id)
     AND NOT EXISTS (SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=s.id AND a.decision IS NULL)`).all(OWNER_SOURCE) as {id:string;source:string}[];
    for(const s of stuck){
     // An owner action whose card expired or was refused did not happen; a proposal is settled whatever was decided.
     const ran=this.db.prepare("SELECT 1 FROM events WHERE sortie_id=? AND kind='action.done'").get(s.id);
     this.ledger.close(s.id,s.source===OWNER_SOURCE&&!ran?'failed':'done',now);
    }
   }
   return n;
  }
  events(sortieId: string, after=0, limit=50) { return this.ledger.events(sortieId,after,limit); }
  sorties(limit=20, before?: string, q?: string) { return this.ledger.sorties(limit,before,q); }
  sortie(id: string) { return this.ledger.sortie(id) ?? null; }
  closedSince(since: string) { return this.ledger.closedSince(since); }
  /** F-021: what an external tool returned, recorded on its action like a built-in tool's result. */
  finishedExternal(sortieId: string, actionId: string, tool: string, outcome: {text:string}|{error:string}) { this.ledger.finished(sortieId,actionId,tool,'error' in outcome?{error:outcome.error}:{result:{text:outcome.text}}); return true; }
  unmatched(domain: string, since: string) { return this.ledger.unmatched(domain,since); }
  shadowVote(sortieId: string, actionId: string, vote: {seat:string;vote:'approve'|'reject'|'abstain';reason:string;confidence?:number}) { this.ledger.shadowVote(sortieId,actionId,vote); return true; }
  explain(ref: string) { return this.ledger.explain(ref); }
  /** The scheduled outcome and episode checkpoint commit together, or neither does. */
  saveEpisode(value:Omit<Episode,'id'|'created'>&{runId?:string}):Episode {
    const {runId,...episode}=value;const now=new Date();
    return this.memory.saveEpisode(episode,now,runId?()=>{
      if(!this.instrumentality.finish(runId,episode.exchanges?'completed':'skipped',episode.exchanges?null:'no-exchanges',now.toISOString()))throw new Error('Stale consolidation claim.');
    }:undefined);
  }
  health() { return {integrityCheck:"not-run",instrumentality:this.instrumentality.latest()}; }
  doctor() { return {instrumentality:this.instrumentality.latest(),database:this.db.prepare('PRAGMA quick_check').get(),schema:this.db.prepare('PRAGMA user_version').get(),pending:this.db.prepare('SELECT count(*) AS count FROM reminders WHERE delivered IS NULL AND cancelled IS NULL').get(),policy:{source:this.policySource,...this.ledger.policy}}; }
  close() { this.db.close(); }
}
