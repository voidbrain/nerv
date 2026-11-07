import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../src/runtime.ts';
import {Store} from '../src/store.ts';
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function until(check:()=>boolean){const deadline=Date.now()+8000;while(!check()){if(Date.now()>deadline)throw new Error('Brief recovery condition timed out');await wait(10);}}
const schedule=()=>({at:'00:00',timeZone:'UTC',language:'en' as const,base:'Neutral fixture'});
async function fixture(existing=false){
 const home=mkdtempSync(join(tmpdir(),'nerv-brief-recovery-')),path=join(home,'db');
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:'http://127.0.0.1:9/v1',model:'unreachable-fixture'}}}));
 const store=new Store(path);if(existing)store.addBrief('Existing daily brief');store.close();
 const runtime=new Runtime(path,undefined,home);await runtime.ready();const health=await runtime.health();runtime.health=async()=>health;
 return {home,path,runtime,close:async()=>{await runtime.close();rmSync(home,{recursive:true,force:true});}};
}
test('B-041: failed last-brief read never means no brief exists',{timeout:15000},async()=>{
 const f=await fixture(true),call=f.runtime.nervous.call.bind(f.runtime.nervous);let reads=0,gathered=0;
 f.runtime.nervous.call=async(method,params={},timeout)=>{if(method==='inbox.lastBrief'&&++reads===1)throw new Error('Synthetic read failure');return call(method,params,timeout);};
 f.runtime.approvals=async()=>{gathered++;return [];};
 try{f.runtime.startBrief(schedule,undefined,20);await until(()=>reads>=3);assert.equal(gathered,0,'unknown checkpoint must retry, never compose a duplicate');assert.equal((await f.runtime.inboxPage(0,20)).items.length,1);}
 finally{await f.close();}
});
test('B-041: complete source outage defers the brief and recovery writes one useful report',{timeout:15000},async()=>{
 const f=await fixture(),r=f.runtime,call=r.nervous.call.bind(r.nervous);let reads=0,writes=0;
 const original={approvals:r.approvals.bind(r),list:r.list.bind(r),closedSince:r.closedSince.bind(r),expiredApprovals:r.expiredApprovals.bind(r),health:r.health.bind(r)};
 const fail=async()=>{reads++;throw new Error('Synthetic source outage');};r.approvals=fail;r.list=fail;r.closedSince=fail;r.expiredApprovals=fail;r.health=fail;
 r.nervous.call=async(method,params={},timeout)=>{if(method==='inbox.brief')writes++;return call(method,params,timeout);};
 try{r.startBrief(schedule,undefined,20);await until(()=>reads>=5);await wait(30);assert.equal(writes,0,'an entirely unread report is deferred rather than sent');
  Object.assign(r,original);await until(()=>writes>=1);await wait(80);const items=(await r.inboxPage(0,20)).items;assert.equal(items.length,1);assert.doesNotMatch(items[0]!.message,/could not be read/);
 }finally{await f.close();}
});
test('B-041: overlapping schedulers commit one daily delivery through the real IPC/store join',{timeout:20000},async()=>{
 const f=await fixture(),second=new Runtime(f.path,undefined,f.home);let arrived=0,writes=0;let release!:()=>void;const gate=new Promise<void>(done=>release=done);
 try{await second.ready();const health=await second.health();second.health=async()=>health;
  for(const r of [f.runtime,second]){const call=r.nervous.call.bind(r.nervous);r.nervous.call=async(method,params={},timeout)=>{if(method==='inbox.lastBrief'){arrived++;if(arrived===2)release();await gate;return null;}const result=await call(method,params,timeout);if(method==='inbox.brief')writes++;return result;};r.startBrief(schedule,undefined,60_000);}
  await until(()=>writes===2);const items=(await f.runtime.inboxPage(0,20)).items;assert.equal(items.length,1,'the local day is a durable inbox identity across schedulers');
 }finally{release();await second.close();await f.close();}
});
test('B-041: daily checkpoint and inbox delivery roll back together, survive reopen and preserve cursors',()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-daily-atomic-')),path=join(home,'db');let store=new Store(path);
 try{
  store.addBrief('Existing neutral inbox item');const checkpoint=store.inboxPage(0,20).head;
  store.db.exec("CREATE TRIGGER fail_daily BEFORE INSERT ON daily_briefs BEGIN SELECT RAISE(ABORT,'synthetic checkpoint failure'); END");
  assert.throws(()=>store.addBrief('Candidate report',new Date('2030-01-01T08:00:00Z'),'2030-01-01'),/checkpoint failure/);
  assert.equal(store.inboxPage(checkpoint.sequence,20,checkpoint.id).items.length,0,'failed checkpoint leaves no delivery');
  store.db.exec('DROP TRIGGER fail_daily');const first=store.addBrief('Candidate report',new Date('2030-01-01T08:00:00Z'),'2030-01-01');
  store.close();store=new Store(path);const again=store.addBrief('Retry report',new Date('2030-01-01T09:00:00Z'),'2030-01-01');assert.equal(again.id,first.id);assert.equal(again.existing,true);
  const page=store.inboxPage(checkpoint.sequence,20,checkpoint.id);assert.equal(page.reset,false);assert.equal(page.items.length,1);assert.equal(page.items[0]!.id,first.id);
  store.addBrief('Next local day',new Date('2030-01-02T08:00:00Z'),'2030-01-02');assert.equal(store.inboxPage(checkpoint.sequence,20,checkpoint.id).items.length,2);
  for(const day of ['2030-02-30','not-a-date'])assert.throws(()=>store.addBrief('Invalid day',new Date(),day),/Invalid daily brief/);
 }finally{store.close();rmSync(home,{recursive:true,force:true});}
});
