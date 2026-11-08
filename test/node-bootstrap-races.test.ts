import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,now} from './fixtures/node-bootstrap.ts';
import {bootstrapPlan} from '../src/node-bootstrap.ts';
import {bootstrapOperation} from '../src/node-bootstrap-execution.ts';
async function until(check:()=>boolean){const end=Date.now()+15000;while(!check()){if(Date.now()>end)throw Error('Bootstrap barrier timed out');await new Promise(done=>setTimeout(done,10));}}
const resume=(home:string,name:string)=>writeFileSync(join(home,name),'go');
const nextPlan=(f:Awaited<ReturnType<typeof fixture>>,suffix:string)=>bootstrapPlan(f.plan.inspection,{sourceProtocol:1,revision:'b'.repeat(40),checkout:join(f.home,'checkout-'+suffix),home:join(f.home,'data-'+suffix),base:f.plan.base,installService:false},now);
test('F-005: a delayed apply cannot overwrite the completed receipt observed after acquisition',{timeout:30000},async()=>{
 const f=await fixture();let delayed:ReturnType<typeof bootstrapOperation>|undefined;
 try{
  delayed=bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},f.runner('pause-acquire'),now);await until(()=>existsSync(join(f.home,'acquire-paused')));
  assert.equal((await bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},f.runner(),now)).state,'completed');const before=readFileSync(f.calls,'utf8');resume(f.home,'acquire-go');
  assert.equal((await delayed).state,'completed','the second actor must replay the terminal receipt instead of replacing it');assert.equal(readFileSync(f.calls,'utf8'),before,'no operation is executed again');assert.equal((await bootstrapOperation(f.plan,'status',{},f.runner(),now)).state,'completed');
 }finally{resume(f.home,'acquire-go');await delayed;f.close();}
});
test('F-005: a stale release cannot remove a new live resource after another operator reconciled it',{timeout:30000},async()=>{
 const f=await fixture();let stale:ReturnType<typeof bootstrapOperation>|undefined,working:ReturnType<typeof bootstrapOperation>|undefined;
 try{
  assert.equal((await bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},f.runner('ci'),now)).state,'uncertain');
  const release={confirm:f.plan.digest,reason:'Verified fixture process and descendants stopped',confirmedStopped:true};stale=bootstrapOperation(f.plan,'release',release,f.runner('pause-release'),now);await until(()=>existsSync(join(f.home,'release-paused')));
  assert.equal((await bootstrapOperation(f.plan,'release',release,f.runner(),now)).state,'released');
  const next=nextPlan(f,'next');working=bootstrapOperation(next,'apply',{confirm:next.digest},f.runner('hold-build'),now);await until(()=>existsSync(join(f.home,'build-held')));resume(f.home,'release-go');
  assert.equal((await stale).state,'refused','stale reconciliation must not remove a different nonce/owner');
  const third=nextPlan(f,'third');assert.equal((await bootstrapOperation(third,'apply',{confirm:third.digest},f.runner(),now)).state,'busy','the new owner still holds its resource');
  const liveRelease=await bootstrapOperation(next,'release',{...release,confirm:next.digest},f.runner(),now);assert.equal(liveRelease.state,'refused','even owner confirmation cannot release a handler still running');resume(f.home,'build-go');assert.equal((await working).state,'completed');
 }finally{resume(f.home,'release-go');resume(f.home,'build-go');await stale;await working;f.close();}
});
