import {transaction} from './sqlite-transaction.ts';
import type {DatabaseSync} from 'node:sqlite';
import {argsHash} from './ledger.ts';
export const WORKER_LEASE_MS=300_000;
export const WORKER_RESULT_BYTES=24*1024;
export interface WorkerItem {id:string;sequence?:number;request:string;tool:string;args:Record<string,unknown>}
export interface WorkerContext {session:string;epoch:number;expires:number;ownerKey?:string}
export interface WorkerLease extends WorkerContext {owner:string;id:string;fence:number;key:string;ownerKey:string}
export interface WorkerClaim {state:'claimed'|'completed'|'waiting'|'busy'|'uncertain';lease?:WorkerLease;result?:unknown}
interface JobRow {fence:number;id:string;owner:string;sequence:number|null;hash:string|null;session:string;epoch:number;expires:number;state:string;result:string|null;worker_key:string;owner_key:string}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const base=(v:string)=>typeof v==='string'&&/^[A-Z0-9-]{1,16}$/.test(v);
/** Scheduler-owned receipts. An expired lease fences new execution; it never proves an effect stopped. */
export class WorkerJobs {
 readonly db:DatabaseSync;
 constructor(db:DatabaseSync){
  this.db=db;db.exec(`CREATE TABLE IF NOT EXISTS worker_sessions(owner TEXT PRIMARY KEY,session TEXT NOT NULL,epoch INTEGER NOT NULL,active INTEGER NOT NULL,worker_key TEXT NOT NULL,owner_key TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS worker_jobs(fence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,owner TEXT NOT NULL,sequence INTEGER,hash TEXT,session TEXT NOT NULL,epoch INTEGER NOT NULL,expires INTEGER NOT NULL,state TEXT NOT NULL,result TEXT,worker_key TEXT NOT NULL DEFAULT '',owner_key TEXT NOT NULL DEFAULT '',UNIQUE(owner,sequence));
   CREATE TABLE IF NOT EXISTS worker_approvals(approval_id TEXT PRIMARY KEY,lease TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS worker_releases(id TEXT NOT NULL,fence INTEGER NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL,created TEXT NOT NULL);`);
  // Older Kaji receipts already represent completed work; keep them as non-executable tombstones.
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kaji_runs'").get())this.tx(()=>{
   db.exec("INSERT OR IGNORE INTO worker_jobs(id,owner,sequence,hash,session,epoch,expires,state,result) SELECT id,from_base,NULL,NULL,'legacy',0,0,'completed',result FROM kaji_runs; DROP TABLE kaji_runs;");
  });
 }
 private tx<T>(f:()=>T):T {return transaction(this.db,f);}
 open(owner:string,session:string,_now=Date.now(),key='',ownerKey=''):{epoch:number;cursor:number}{
  if(!base(owner)||!uuid.test(session))throw new Error('Invalid worker session.');
  return this.tx(()=>{
   const old=this.db.prepare('SELECT session,epoch,active FROM worker_sessions WHERE owner=?').get(owner) as {session:string;epoch:number;active:number}|undefined;
   if(old?.session===session&&!old.active)throw new Error('Closed worker session cannot be reused.');
   const epoch=old?.session===session?old.epoch:(old?.epoch ?? 0)+1;if(!Number.isSafeInteger(epoch))throw new Error('Worker epoch exhausted.');
   this.db.prepare('INSERT INTO worker_sessions VALUES(?,?,?,1,?,?) ON CONFLICT(owner) DO UPDATE SET session=excluded.session,epoch=excluded.epoch,active=1,worker_key=excluded.worker_key,owner_key=excluded.owner_key').run(owner,session,epoch,key,ownerKey);
   return {epoch,cursor:(this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS cursor FROM worker_jobs WHERE owner=?').get(owner) as {cursor:number}).cursor};
  });
 }
 close(owner:string,session:string):void {this.db.prepare('UPDATE worker_sessions SET active=0 WHERE owner=? AND session=?').run(owner,session);}
 claim(owner:string,item:WorkerItem,context?:WorkerContext,now=Date.now(),key='',ownerKey=''):WorkerClaim {
  if(!base(owner)||!item||!uuid.test(item.id)||typeof item.request!=='string'||item.request.length>500||typeof item.tool!=='string'||!/^[a-z]+\.[a-z]+$/.test(item.tool)||!item.args||typeof item.args!=='object'||Array.isArray(item.args)||Buffer.byteLength(JSON.stringify(item.args))>8192||(item.sequence!==undefined&&(!Number.isSafeInteger(item.sequence)||item.sequence<1)))throw new Error('Invalid worker request.');
  if(context&&(!uuid.test(context.session)||!Number.isSafeInteger(context.epoch)||context.epoch<1||!Number.isSafeInteger(context.expires)||context.expires<=now||context.expires>now+WORKER_LEASE_MS+120000))throw new Error('Invalid worker lease.');
  const hash=argsHash({request:item.request,tool:item.tool,args:item.args});
  return this.tx(()=>{
   const old=this.db.prepare('SELECT * FROM worker_jobs WHERE id=?').get(item.id) as unknown as JobRow|undefined;
   if(old){
    if(old.owner!==owner||(old.hash!==null&&old.hash!==hash)||(old.sequence!==null&&item.sequence!==undefined&&old.sequence!==item.sequence))throw new Error('Worker request identity conflict.');
    return old.state==='completed'?{state:'completed',result:JSON.parse(old.result!)}:old.state==='running'&&old.result?{state:'waiting',result:JSON.parse(old.result)}:{state:'uncertain',result:{outcome:'uncertain',error:'This request may have run; inspect its local trace before releasing its resource.'}};
   }
   if(item.sequence!==undefined&&this.db.prepare('SELECT 1 FROM worker_jobs WHERE owner=? AND sequence=?').get(owner,item.sequence))throw new Error('Worker stream sequence conflict.');
   if(context)this.session(owner,context,key,ownerKey);
   // One conservative resource for current built-in actions: the base's local gate/database.
   if(this.db.prepare("SELECT 1 FROM worker_jobs WHERE state='running'").get())return {state:'busy'};
   const session=context?.session ?? 'legacy',epoch=context?.epoch ?? 0,expires=context?.expires ?? now+WORKER_LEASE_MS;
   const row=this.db.prepare("INSERT INTO worker_jobs(id,owner,sequence,hash,session,epoch,expires,state,result,worker_key,owner_key) VALUES(?,?,?,?,?,?,?,'running',NULL,?,?)").run(item.id,owner,item.sequence ?? null,hash,session,epoch,expires,key,ownerKey);
   const fence=Number(row.lastInsertRowid);if(!Number.isSafeInteger(fence))throw new Error('Worker fence exhausted.');
   return {state:'claimed',lease:{id:item.id,owner,session,epoch,expires,fence,key,ownerKey}};
  });
 }
 private session(owner:string,context:WorkerContext,key:string,ownerKey:string){
  const row=this.db.prepare('SELECT session,epoch,active,worker_key,owner_key FROM worker_sessions WHERE owner=?').get(owner) as {session:string;epoch:number;active:number;worker_key:string;owner_key:string}|undefined;
  if(!row?.active||row.session!==context.session||row.epoch!==context.epoch||row.worker_key!==key||row.owner_key!==ownerKey)throw new Error('Worker lease session is stale.');
 }
 private row(lease:WorkerLease):JobRow {
  const row=this.db.prepare('SELECT * FROM worker_jobs WHERE id=? AND fence=? AND owner=? AND session=? AND epoch=?').get(lease.id,lease.fence,lease.owner,lease.session,lease.epoch) as unknown as JobRow|undefined;
  if(!row)throw new Error('Worker lease does not own this request.');return row;
 }
 assertLease(lease:WorkerLease,now=Date.now()):void {
  const row=this.row(lease);if(row.state!=='running'||row.expires<=now||row.expires!==lease.expires||row.worker_key!==lease.key||row.owner_key!==lease.ownerKey)throw new Error('Worker lease is no longer executable.');if(row.epoch)this.session(row.owner,lease,lease.key,lease.ownerKey);
 }
 bindApproval(lease:WorkerLease,approvalId:string,result:unknown):void {
  this.assertLease(lease);this.db.prepare('INSERT INTO worker_approvals VALUES(?,?)').run(approvalId,JSON.stringify(lease));this.db.prepare('UPDATE worker_jobs SET result=? WHERE id=? AND fence=?').run(JSON.stringify(result),lease.id,lease.fence);
 }
 approval(approvalId:string):WorkerLease|undefined {const row=this.db.prepare('SELECT lease FROM worker_approvals WHERE approval_id=?').get(approvalId) as {lease:string}|undefined;return row?JSON.parse(row.lease) as WorkerLease:undefined;}
 waitingApprovals():{id:string;lease:WorkerLease;decision:string|null}[]{
  return (this.db.prepare("SELECT a.approval_id AS id,a.lease,p.decision FROM worker_approvals a JOIN worker_jobs j ON j.id=json_extract(a.lease,'$.id') JOIN approvals p ON p.id=a.approval_id WHERE j.state='running' LIMIT 20").all() as {id:string;lease:string;decision:string|null}[]).map(r=>({...r,lease:JSON.parse(r.lease) as WorkerLease}));
 }
 finish(lease:WorkerLease,result:unknown):void {
  const encoded=JSON.stringify(result);if(!encoded||Buffer.byteLength(encoded)>WORKER_RESULT_BYTES)throw new Error('Worker result exceeds its bound.');
  this.tx(()=>{const row=this.row(lease);if(row.state==='completed')return;if(row.state!=='running')throw new Error('Worker lease was released.');this.db.prepare("UPDATE worker_jobs SET state='completed',result=? WHERE id=? AND fence=?").run(encoded,lease.id,lease.fence);});
 }
 pending(before=Number.MAX_SAFE_INTEGER):{id:string;owner:string;fence:number;expires:number}[]{
  if(!Number.isSafeInteger(before)||before<1)throw new Error('Invalid worker receipt cursor.');
  return this.db.prepare("SELECT id,owner,fence,expires FROM worker_jobs WHERE state='running' AND fence<? ORDER BY fence DESC LIMIT 20").all(before) as {id:string;owner:string;fence:number;expires:number}[];
 }
 history(before=Number.MAX_SAFE_INTEGER):{id:string;owner:string;sequence:number|null;fence:number;state:string}[]{
  if(!Number.isSafeInteger(before)||before<1)throw new Error('Invalid worker receipt cursor.');return this.db.prepare('SELECT id,owner,sequence,fence,state FROM worker_jobs WHERE fence<? ORDER BY fence DESC LIMIT 20').all(before) as {id:string;owner:string;sequence:number|null;fence:number;state:string}[];
 }
 receipt(id:string):{id:string;state:string;result:unknown}|undefined {
  if(!uuid.test(id))throw new Error('Invalid worker request ID.');const row=this.db.prepare('SELECT id,state,result FROM worker_jobs WHERE id=?').get(id) as {id:string;state:string;result:string|null}|undefined;return row?{...row,result:row.result?JSON.parse(row.result):null}:undefined;
 }
 release(id:string,reason:string,confirmedStopped:boolean):void {
  if(!confirmedStopped||typeof reason!=='string'||reason.trim().length<8||reason.length>500)throw new Error('Explicit owner confirmation and a reason are required.');
  this.tx(()=>{const row=this.db.prepare("SELECT fence FROM worker_jobs WHERE id=? AND state='running'").get(id) as {fence:number}|undefined;if(!row)throw new Error('No uncertain worker request with that ID.');
   this.db.prepare("INSERT INTO worker_releases VALUES(?,?,?,'cli',?)").run(id,row.fence,reason,new Date().toISOString());this.db.prepare("UPDATE worker_jobs SET state='released',result=? WHERE id=?").run(JSON.stringify({outcome:'uncertain',error:'Owner confirmed stopped and released the resource; effects were not assumed undone.'}),id);
  });
 }
}
