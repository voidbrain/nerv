import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export type Reminder = { id: string; title: string; due: string; created: string; delivered: string | null; cancelled: string | null };
export interface InboxCheckpoint {sequence:number;id?:string}
export interface InboxEntry {sequence:number;id:string;message:string;created:string}
export interface InboxPage {items:InboxEntry[];head:InboxCheckpoint;next:InboxCheckpoint;reset:boolean}
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if(path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    const version = this.db.prepare('PRAGMA user_version').get() as {user_version:number};
    if(version.user_version > 1) {this.db.close();throw new Error('Database schema is newer than this Nodo version.');}
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY, title TEXT NOT NULL, due TEXT NOT NULL, created TEXT NOT NULL, delivered TEXT, cancelled TEXT);
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, reminder_id TEXT NOT NULL UNIQUE REFERENCES reminders(id), message TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT);
      CREATE INDEX IF NOT EXISTS reminders_due ON reminders(due);
      PRAGMA user_version=1;`);
  }
  add(title: string, due: string, now = new Date()): Reminder {
    if(typeof title !== 'string' || !title.trim() || title.length > 500) throw new Error('Title must contain 1–500 characters.');
    if(typeof due !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.test(due) || !Number.isFinite(Date.parse(due))) throw new Error('Use an ISO date with an explicit timezone offset.');
    const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,3})?)?(Z|[+-](\d\d):(\d\d))$/.exec(due)!;
    const [,year,month,day,hour,minute,second,zone,offsetHour,offsetMinute] = match;
    const days = new Date(Date.UTC(Number(year),Number(month),0)).getUTCDate();
    if(Number(month)<1 || Number(month)>12 || Number(day)<1 || Number(day)>days || Number(hour)>23 || Number(minute)>59 || Number(second ?? 0)>59 || (zone !== 'Z' && (Number(offsetHour)>14 || Number(offsetMinute)>59 || (Number(offsetHour)===14 && Number(offsetMinute)!==0)))) throw new Error('Invalid calendar date or timezone offset.');
    if(Date.parse(due) <= now.getTime()) throw new Error('Reminder must be in the future.');
    const r: Reminder = {id:randomUUID(),title:title.trim(),due:new Date(due).toISOString(),created:now.toISOString(),delivered:null,cancelled:null};
    this.db.prepare('INSERT INTO reminders VALUES(?,?,?,?,?,?)').run(r.id,r.title,r.due,r.created,null,null); return r;
  }
  list(): Reminder[] { return this.db.prepare('SELECT * FROM reminders ORDER BY due').all() as Reminder[]; }
  pendingReminders(): Reminder[] { return this.db.prepare('SELECT * FROM reminders WHERE delivered IS NULL AND cancelled IS NULL ORDER BY due LIMIT 5').all() as Reminder[]; }
  cancel(id: string): boolean { return Number(this.db.prepare('UPDATE reminders SET cancelled=? WHERE id=? AND delivered IS NULL AND cancelled IS NULL').run(new Date().toISOString(),id).changes) > 0; }
  tick(now = new Date()): number {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const due = this.db.prepare('SELECT * FROM reminders WHERE due<=? AND delivered IS NULL AND cancelled IS NULL').all(now.toISOString()) as Reminder[];
      for(const r of due) {
        this.db.prepare('INSERT OR IGNORE INTO deliveries VALUES(?,?,?,?,NULL)').run(randomUUID(),r.id,r.title,now.toISOString());
        this.db.prepare('UPDATE reminders SET delivered=? WHERE id=?').run(now.toISOString(),r.id);
      }
      this.db.exec('COMMIT'); return due.length;
    } catch(e) {this.db.exec('ROLLBACK'); throw e;}
  }
  inbox() { return this.db.prepare('SELECT * FROM deliveries ORDER BY created DESC').all(); }
  inboxPage(after=0,limit=5,afterId?:string):InboxPage {
    if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>20||(after>0&&(typeof afterId!=='string'||!afterId||afterId.length>100)))throw new Error('Invalid inbox checkpoint or limit.');
    this.db.exec('BEGIN');
    try {
      const head=(this.db.prepare('SELECT rowid AS sequence,id FROM deliveries ORDER BY rowid DESC LIMIT 1').get() as unknown as InboxCheckpoint|undefined) ?? {sequence:0};
      const previous=after?this.db.prepare('SELECT id FROM deliveries WHERE rowid=?').get(after) as {id:string}|undefined:undefined;
      if(after>0&&previous?.id!==afterId){this.db.exec('COMMIT');return {items:[],head,next:head,reset:true};}
      const items=this.db.prepare('SELECT rowid AS sequence,id,message,created FROM deliveries WHERE rowid>? ORDER BY rowid LIMIT ?').all(after,limit) as unknown as InboxEntry[];
      const last=items.at(-1);const next=last?{sequence:last.sequence,id:last.id}:after?{sequence:after,id:afterId}:{sequence:0};
      this.db.exec('COMMIT');return {items,head,next,reset:false};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  doctor() { return {database:this.db.prepare('PRAGMA quick_check').get(),schema:this.db.prepare('PRAGMA user_version').get(),pending:this.db.prepare('SELECT count(*) AS count FROM reminders WHERE delivered IS NULL AND cancelled IS NULL').get()}; }
  close() { this.db.close(); }
}
