import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
export const RETRY_AFTER_MS=3_600_000;
export type RunReason='local-unavailable'|'cloud-unavailable'|'unreadable'|'unavailable'|'interrupted'|'no-exchanges';
export interface InstrumentalityRun {id:string;slot:string;started:string;attempts:number;status:'pending'|'failed'|'completed'|'skipped';reason:RunReason|null;finished:string|null}
/** A durable claim bounds scheduled attempts across coordinator restarts. No conversation/provider error text is stored. */
export class InstrumentalityRuns {
 private readonly db:DatabaseSync;
 constructor(db:DatabaseSync){this.db=db;db.exec('CREATE TABLE IF NOT EXISTS instrumentality_runs(slot TEXT PRIMARY KEY,id TEXT NOT NULL,started TEXT NOT NULL,attempts INTEGER NOT NULL,status TEXT NOT NULL,reason TEXT,finished TEXT)');}
 claim(slot:string,now:string):InstrumentalityRun|null {
  if(!/^(at|idle):\d{4}-\d{2}-\d{2}$/.test(slot)||!Number.isFinite(Date.parse(now))||new Date(now).toISOString()!==now)throw new Error('Invalid consolidation schedule claim.');
  const day=slot.slice(slot.indexOf(':')+1);if(!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)throw new Error('Invalid consolidation date.');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const old=this.db.prepare('SELECT * FROM instrumentality_runs WHERE slot=?').get(slot) as unknown as InstrumentalityRun|undefined;
   if(old&&(old.status==='completed'||old.status==='skipped'||old.attempts>=2||Date.parse(now)-Date.parse(old.finished ?? old.started)<RETRY_AFTER_MS)){this.db.exec('COMMIT');return null;}
   const run:InstrumentalityRun={id:randomUUID(),slot,started:now,attempts:(old?.attempts ?? 0)+1,status:'pending',reason:old?.status==='pending'?'interrupted':old?.reason ?? null,finished:null};
   this.db.prepare('INSERT INTO instrumentality_runs VALUES(?,?,?,?,?,?,?) ON CONFLICT(slot) DO UPDATE SET id=excluded.id,started=excluded.started,attempts=excluded.attempts,status=excluded.status,reason=excluded.reason,finished=NULL').run(run.slot,run.id,run.started,run.attempts,run.status,run.reason,null);
   this.db.exec('COMMIT');return run;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 finish(id:string,status:'failed'|'completed'|'skipped',reason:RunReason|null,now:string):boolean {
  if((status==='failed'&&(reason===null||reason==='no-exchanges'))||(status==='completed'&&reason!==null)||(status==='skipped'&&reason!=='no-exchanges')||!['failed','completed','skipped'].includes(status)||!Number.isFinite(Date.parse(now))||new Date(now).toISOString()!==now||reason!==null&&!['local-unavailable','cloud-unavailable','unreadable','unavailable','interrupted','no-exchanges'].includes(reason))throw new Error('Invalid consolidation result.');
  return this.db.prepare("UPDATE instrumentality_runs SET status=?,reason=?,finished=? WHERE id=? AND status='pending'").run(status,reason,now,id).changes>0;
 }
 latest():InstrumentalityRun|null {return this.db.prepare('SELECT * FROM instrumentality_runs ORDER BY started DESC,rowid DESC LIMIT 1').get() as unknown as InstrumentalityRun|undefined ?? null;}
}
export function runFailure(error:string):RunReason {
 if(/not readable|unreadable/i.test(error))return 'unreadable';
 if(/Local route|S²/i.test(error))return 'local-unavailable';
 if(/Cloud route|Umbilical/i.test(error))return 'cloud-unavailable';
 return 'unavailable';
}
/** Diagnostic English, localized when the daily brief is composed. */
export function runMessage(run:InstrumentalityRun,language:'en'|'it'='en'):string {
 const it=language==='it';const reasons:Record<RunReason,string>=it?{'local-unavailable':'il percorso locale non era disponibile','cloud-unavailable':'il percorso cloud non era disponibile',unreadable:'il riepilogo non era leggibile',unavailable:'il consolidamento non era disponibile',interrupted:'il tentativo precedente non ha un esito registrato','no-exchanges':'nessuno scambio nuovo'}:{'local-unavailable':'the local route was unavailable','cloud-unavailable':'the cloud route was unavailable',unreadable:'the digest was unreadable',unavailable:'consolidation was unavailable',interrupted:'the previous attempt has no recorded outcome','no-exchanges':'no new exchanges'};
 const why=run.reason?reasons[run.reason]:'';
 if(run.status==='pending')return it?'Instrumentality: tentativo avviato, esito non ancora registrato.':'Instrumentality: attempt started; outcome not yet recorded.';
 if(run.status==='completed')return run.attempts>1?(it?'Instrumentality: recuperata al secondo tentativo.':'Instrumentality: recovered on the second attempt.'):(it?'Instrumentality: completata.':'Instrumentality: completed.');
 if(run.status==='skipped')return (it?'Instrumentality: saltata — ':'Instrumentality: skipped — ')+why+'.';
 return (it?'Instrumentality: non completata — ':'Instrumentality: did not complete — ')+why+(run.attempts<2?(it?'; un nuovo tentativo dopo un’ora.':'; one retry after an hour.'):(it?'; riprenderà nella prossima finestra programmata.':'; next scheduled window will try again.'));
}
