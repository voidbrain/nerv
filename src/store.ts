import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LEDGER_SCHEMA, Ledger, type Decision, type Proposal } from './ledger.ts';
import { builtinTools, execute, hasExecutor } from './executors.ts';
import { MEMORY_SCHEMA, Memory } from './memory.ts';
import { REGISTRY_SCHEMA } from './kaji.ts';
import { defaultPolicy, type Ballot, type Policy } from './policy.ts';
export type Reminder = { id: string; title: string; due: string; created: string; delivered: string | null; cancelled: string | null };
export interface InboxCheckpoint {sequence:number;id?:string}
export interface InboxEntry {sequence:number;id:string;message:string;created:string;kind:'reminder'|'brief'}
export interface InboxPage {items:InboxEntry[];head:InboxCheckpoint;next:InboxCheckpoint;reset:boolean}
/** What one gated action came to: granted and run (result or error), waiting for the owner (approvalId), or rejected. */
export interface ActResult {sortieId:string;actionId:string;outcome:Ballot['outcome'];pattern:Ballot['pattern'];reason:string;sync:Ballot['sync'];approvalId?:string;result?:unknown;error?:string}
/** Sorties the owner starts directly hold one action and close once it settles. */
export const OWNER_SOURCE='owner';
/** Sorties Misato plans hold several actions; the coordinator closes them when the loop ends. */
export const MISATO_SOURCE='misato';
export class Store {
  readonly db: DatabaseSync;
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
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY, title TEXT NOT NULL, due TEXT NOT NULL, created TEXT NOT NULL, delivered TEXT, cancelled TEXT);
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, reminder_id TEXT UNIQUE REFERENCES reminders(id), kind TEXT NOT NULL DEFAULT 'reminder', message TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT);
      CREATE INDEX IF NOT EXISTS reminders_due ON reminders(due);
      ${LEDGER_SCHEMA}`);
    // Schema 3: events record the event schema version they were written under (F-024); earlier rows read as version 1.
    if(!(this.db.prepare('PRAGMA table_info(events)').all() as {name:string}[]).some(c=>c.name==='v'))this.db.exec('ALTER TABLE events ADD COLUMN v INTEGER NOT NULL DEFAULT 1');
    // Schema 4: Lilith's facts, their append-only history and the FTS5 index (F-022).
    this.db.exec(MEMORY_SCHEMA);
    // Marduk's registry for the Kaji line (F-036): signed, append-only records; an additive table, no version change.
    this.db.exec(REGISTRY_SCHEMA);
    // F-036 slice 3b, additive: actions queued for other bases, and actions other bases asked of this one (by their id, so a
    // resend after a crash returns the first result instead of running twice).
    this.db.exec(`CREATE TABLE IF NOT EXISTS kaji_outbox(id TEXT PRIMARY KEY, sortie_id TEXT NOT NULL, base TEXT NOT NULL, tool TEXT NOT NULL, args TEXT NOT NULL, request TEXT NOT NULL, created TEXT NOT NULL, done TEXT, result TEXT);
      CREATE TABLE IF NOT EXISTS kaji_runs(id TEXT PRIMARY KEY, from_base TEXT NOT NULL, result TEXT NOT NULL, created TEXT NOT NULL);`);
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
    this.db.exec('PRAGMA user_version=5');
    this.ledger = new Ledger(this.db,{policy:scrolls.policy,tools:builtinTools});this.memory = new Memory(this.db);this.policySource = scrolls.source;
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
  pendingReminders(): Reminder[] { return this.db.prepare('SELECT * FROM reminders WHERE delivered IS NULL AND cancelled IS NULL ORDER BY due LIMIT 5').all() as Reminder[]; }
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
  outbox(): {id:string;sortieId:string;base:string;tool:string;args:Record<string,unknown>;request:string}[] {
    return (this.db.prepare('SELECT id,sortie_id,base,tool,args,request FROM kaji_outbox WHERE done IS NULL ORDER BY created LIMIT 10').all() as {id:string;sortie_id:string;base:string;tool:string;args:string;request:string}[]).map(r=>({id:r.id,sortieId:r.sortie_id,base:r.base,tool:r.tool,args:JSON.parse(r.args) as Record<string,unknown>,request:r.request}));
  }
  /** Marks a sent action done with its result and, the first time only, records what the other base did on the sortie (B-011). */
  outboxDone(id: string, result: unknown, said?: {base:string;text:string}): boolean {
    const row=this.db.prepare('SELECT sortie_id,tool FROM kaji_outbox WHERE id=? AND done IS NULL').get(id) as {sortie_id:string;tool:string}|undefined;
    const done=Number(this.db.prepare('UPDATE kaji_outbox SET done=?,result=? WHERE id=? AND done IS NULL').run(new Date().toISOString(),JSON.stringify(result).slice(0,8000),id).changes)>0;
    if(done&&row&&said){const r=result as {outcome?:unknown;refused?:unknown};this.ledger.remoteResult(row.sortie_id,{base:said.base.slice(0,60),tool:row.tool,outcome:typeof r.refused==='string'?'refused':typeof r.outcome==='string'?r.outcome:'answered',text:said.text.slice(0,600)});}
    return done;
  }
  /** On the target base: the result of an action asked by another base, if it already ran here. */
  remoteRun(id: string): unknown { const r=this.db.prepare('SELECT result FROM kaji_runs WHERE id=?').get(id) as {result:string}|undefined;return r?JSON.parse(r.result):undefined; }
  saveRemoteRun(id: string, from: string, result: unknown): void { this.db.prepare('INSERT OR IGNORE INTO kaji_runs VALUES(?,?,?,?)').run(id,from,JSON.stringify(result).slice(0,8000),new Date().toISOString()); }
  inbox() { return this.db.prepare('SELECT * FROM deliveries ORDER BY created DESC').all(); }
  /** Hyuga's brief into the inbox (F-028): every channel delivers it from here, once. */
  addBrief(message: string, now = new Date()): {id:string;created:string} {
    if(typeof message !== 'string' || !message.trim() || message.length > 4000) throw new Error('A brief is 1–4000 characters.');
    const id=randomUUID();this.db.prepare("INSERT INTO deliveries(id,reminder_id,kind,message,created,read_at) VALUES(?,NULL,'brief',?,?,NULL)").run(id,message,now.toISOString());
    return {id,created:now.toISOString()};
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
  expiredApprovals(since: string) { return this.ledger.expiredSince(since); }
  /** The grant ID stays inside the coordinator: callers learn only the outcome. */
  /** Applies the owner's decision; an approval of a tool with an executor runs it once, here, with the grant it issued. */
  decide(id: string, decision: Decision, source='api'):{decision:string;result?:unknown;error?:string} {
    const applied=this.ledger.decide(id,decision,source);
    const action=applied.grantId?this.ledger.grantAction(applied.grantId):undefined;
    if(applied.grantId&&action&&!action.used&&hasExecutor(action.tool)){const outcome=this.run(action.sortieId,action.actionId,applied.grantId,action.tool,action.args);this.settle(action.sortieId,'error' in outcome?'failed':'done');return {decision:applied.decision,...outcome};}
    const sortie=this.db.prepare('SELECT x.sortie_id AS id FROM approvals a JOIN actions x ON x.id=a.action_id WHERE a.id=?').get(id) as {id:string}|undefined;
    if(sortie&&applied.decision!=='approve')this.settle(sortie.id,'failed');
    return {decision:applied.decision};
  }
  /** One owner action through the gate (F-017): ballot, then on a grant the executor runs at once; otherwise it waits for the owner or stops. */
  runAction(sortieId: string, proposal: Proposal):ActResult {
    const p=this.ledger.propose(sortieId,proposal);
    const base:ActResult={sortieId,actionId:p.actionId,outcome:p.ballot.outcome,pattern:p.ballot.pattern,reason:p.ballot.reason,sync:p.ballot.sync,...(p.approvalId?{approvalId:p.approvalId}:{})};
    if(p.grantId&&hasExecutor(proposal.tool)){const outcome=this.run(sortieId,p.actionId,p.grantId,proposal.tool,proposal.args);this.settle(sortieId,'error' in outcome?'failed':'done');return {...base,...outcome};}
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
    // Instrumentality proposals: the sortie is done once the owner has decided every card, whatever the decisions.
    if(sortie?.source==='instrumentality'&&!(this.db.prepare('SELECT 1 FROM approvals a JOIN actions x ON x.id=a.action_id WHERE x.sortie_id=? AND a.decision IS NULL').get(sortieId)))this.ledger.close(sortieId,'done');
  }
  events(sortieId: string, after=0, limit=50) { return this.ledger.events(sortieId,after,limit); }
  sorties(limit=20, before?: string, q?: string) { return this.ledger.sorties(limit,before,q); }
  sortie(id: string) { return this.ledger.sortie(id) ?? null; }
  closedSince(since: string) { return this.ledger.closedSince(since); }
  explain(ref: string) { return this.ledger.explain(ref); }
  health() { return {integrityCheck:"not-run"}; }
  doctor() { return {database:this.db.prepare('PRAGMA quick_check').get(),schema:this.db.prepare('PRAGMA user_version').get(),pending:this.db.prepare('SELECT count(*) AS count FROM reminders WHERE delivered IS NULL AND cancelled IS NULL').get(),policy:{source:this.policySource,...this.ledger.policy}}; }
  close() { this.db.close(); }
}
