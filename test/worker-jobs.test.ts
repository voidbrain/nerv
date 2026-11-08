import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkerJobs} from '../src/worker-jobs.ts';
const owner='NERV-01',session='00000000-0000-4000-8000-000000000001';
const item=(n=1)=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sequence:n,request:'List neutral reminders',tool:'reminders.list',args:{}});
test('F-014: durable worker receipts bind owner, sequence and payload; completed results replay without another claim',()=>{
 const db=new DatabaseSync(':memory:'),jobs=new WorkerJobs(db);try{
  const state=jobs.open(owner,session,1000),context={session,epoch:state.epoch,expires:301000};const first=jobs.claim(owner,item(),context,1000);assert.equal(first.state,'claimed');assert.ok(first.lease);
  assert.equal(jobs.claim(owner,item(),context,1001).state,'uncertain');assert.throws(()=>jobs.claim(owner,{...item(),args:{different:true}},context,1001),/conflict/);
  jobs.finish(first.lease!,{outcome:'grant',result:[]});assert.deepEqual(jobs.claim(owner,item(),context,1002),{state:'completed',result:{outcome:'grant',result:[]}});
  assert.throws(()=>jobs.claim('NERV-03',item(),undefined,1002),/conflict/);assert.throws(()=>jobs.claim(owner,{...item(2),sequence:1},context,1002),/sequence/);assert.equal(jobs.open(owner,session,1003).cursor,1);
 }finally{db.close();}
});
test('F-014: reconnect and lease expiry fence new execution but never imply the old work stopped or release its lock',()=>{
 const db=new DatabaseSync(':memory:'),jobs=new WorkerJobs(db);try{
  const state=jobs.open(owner,session,1000),context={session,epoch:state.epoch,expires:301000};const first=jobs.claim(owner,item(),context,1000);jobs.assertLease(first.lease!,1001);
  jobs.close(owner,session);assert.throws(()=>jobs.assertLease(first.lease!,1002),/lease/);const next=jobs.open(owner,'00000000-0000-4000-8000-000000000002',1003);assert.ok(next.epoch>state.epoch);
  assert.equal(jobs.claim(owner,item(2),{session:'00000000-0000-4000-8000-000000000002',epoch:next.epoch,expires:301003},1004).state,'busy');
  assert.throws(()=>jobs.assertLease(first.lease!,401000),/lease/);assert.equal(jobs.pending().length,1);
  assert.throws(()=>jobs.release(item().id,'Verified stopped',false),/confirm/);jobs.release(item().id,'Verified stopped',true);
  assert.throws(()=>jobs.finish(first.lease!,{late:true}),/lease/);assert.equal(jobs.claim(owner,item(2),{session:'00000000-0000-4000-8000-000000000002',epoch:next.epoch,expires:301003},1005).state,'claimed');
 }finally{db.close();}
});
test('F-014: a worker restart preserves uncertain work, locks and the replay cursor',()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-worker-jobs-')),path=join(home,'db');let db=new DatabaseSync(path);
 try{let jobs=new WorkerJobs(db);const state=jobs.open(owner,session);const first=jobs.claim(owner,item(),{session,epoch:state.epoch,expires:Date.now()+300000});assert.equal(first.state,'claimed');db.close();db=new DatabaseSync(path);jobs=new WorkerJobs(db);
  const next=jobs.open(owner,'00000000-0000-4000-8000-000000000003');assert.equal(next.cursor,1);assert.equal(jobs.claim(owner,item(),{session:'00000000-0000-4000-8000-000000000003',epoch:next.epoch,expires:Date.now()+300000}).state,'uncertain');assert.equal(jobs.claim(owner,item(2),undefined).state,'busy');
 }finally{db.close();rmSync(home,{recursive:true,force:true});}
});
