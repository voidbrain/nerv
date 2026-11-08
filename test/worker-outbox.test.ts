import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.ts';
import {Runtime} from '../src/runtime.ts';
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function until(check:()=>Promise<boolean>){const end=Date.now()+10000;while(!(await check())){if(Date.now()>end)throw Error('Outbox condition timed out');await wait(20);}}
test('F-014: upgrade preserves completed receipts and quarantines every old pending request until explicit reconciliation',()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-worker-upgrade-')),path=join(home,'db');let store=new Store(path);
 try{const sortie=store.ledger.openSortie('owner','Neutral old queue','trusted'),first=store.queueRemote(sortie,'NERV-02','reminders.list',{}),second=store.queueRemote(sortie,'NERV-02','reminders.list',{}),sequence=store.outbox()[0]!.sequence;
  store.db.exec('CREATE TABLE kaji_runs(id TEXT PRIMARY KEY,from_base TEXT NOT NULL,result TEXT NOT NULL,created TEXT NOT NULL)');const completed='00000000-0000-4000-8000-000000000333';store.db.prepare('INSERT INTO kaji_runs VALUES(?,?,?,?)').run(completed,'NERV-01',JSON.stringify({outcome:'grant',result:[]}),new Date().toISOString());store.close();store=new Store(path);
  assert.deepEqual(store.outbox(),[]);assert.equal(store.heldWorkerOutbox().length,2);assert.equal(store.workerJobs.claim('NERV-01',{id:completed,request:'',tool:'reminders.list',args:{}}).state,'completed');
  assert.throws(()=>store.reconcileWorkerOutbox(first.id,'retry','Verified not executed',false),/confirmation/);assert.deepEqual(store.outbox(),[]);
  store.reconcileWorkerOutbox(first.id,'retry','Destination trace verified not executed',true);assert.equal(store.outbox()[0]!.id,first.id);assert.equal(store.outbox()[0]!.sequence,sequence);assert.ok(store.outbox()[0]!.deadline>Date.now());assert.equal(store.outbox()[0]!.attempted,false);
  store.reconcileWorkerOutbox(second.id,'abandon','Prior effects remain unknown; no replay requested');assert.equal(store.heldWorkerOutbox().length,0);const row=store.db.prepare('SELECT result FROM kaji_outbox WHERE id=?').get(second.id) as {result:string};assert.equal(JSON.parse(row.result).outcome,'uncertain');assert.equal((store.db.prepare('SELECT count(*) AS n FROM worker_outbox_reconciliations').get() as {n:number}).n,2);
 }finally{store.close();rmSync(home,{recursive:true,force:true});}
});
for(const attempted of [false,true])test(`F-014: expired ${attempted?'attempted':'unsent'} work is never dispatched again and its uncertainty stays honest`,{timeout:15000},async()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-worker-expired-')),path=join(home,'nerv.sqlite');writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{model:'unused-fixture',baseUrl:'http://127.0.0.1:9/v1'}}}));const store=new Store(path);let id:string;try{const sortie=store.ledger.openSortie('owner','Neutral expired queue','trusted');id=store.queueRemote(sortie,'NERV-02','reminders.list',{}).id;store.db.prepare('UPDATE kaji_outbox SET created=? WHERE id=?').run('2000-01-01T00:00:00.000Z',id);if(attempted)store.attemptWorkerOutbox(id);}finally{store.close();}
 const runtime=new Runtime(path,undefined,home);let sent=0;
 try{await runtime.ready();runtime.startOutbox(async()=>{sent++;return {reached:false};},30);await until(async()=>!(await runtime.nervous.call('kaji.outbox') as unknown[]).length);assert.equal(sent,0);const read=new Store(path);try{const result=JSON.parse((read.db.prepare('SELECT result FROM kaji_outbox WHERE id=?').get(id!) as {result:string}).result);assert.equal(result.outcome,attempted?'uncertain':'reject');if(attempted)assert.doesNotMatch(JSON.stringify(result),/nothing was sent|nothing ran/);}finally{read.close();}
 }finally{await runtime.close();rmSync(home,{recursive:true,force:true});}
});
test('F-014: remote waiting progress is reported once and remains pending until the actual owner decision',()=>{
 const store=new Store(':memory:');try{const sortie=store.ledger.openSortie('owner','Neutral remote approval','trusted'),q=store.queueRemote(sortie,'NERV-02','memory.remember',{text:'Neutral fact'}),result={outcome:'approval',approvalId:'neutral-card'},said={base:'Harbor',text:'Waiting for destination approval.'};
  assert.equal(store.outboxProgress(q.id,result,said),true);assert.equal(store.outboxProgress(q.id,result,said),false);assert.equal(store.outbox().length,1);assert.equal(store.events(sortie).filter(e=>e.kind==='kaji.result').length,1);
  assert.equal(store.outboxDone(q.id,{outcome:'grant',result:{text:'Neutral fact'}},{base:'Harbor',text:'Completed after approval.'}),true);assert.equal(store.outbox().length,0);assert.equal(store.events(sortie).filter(e=>e.kind==='kaji.result').length,2);
 }finally{store.close();}
});
