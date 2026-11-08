import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {runNodeCommand,type CommandRequest} from '../src/node-inspection.ts';
import {bootstrapPlan} from '../src/node-bootstrap.ts';
import {bootstrapOperation,validateBootstrapPlan} from '../src/node-bootstrap-execution.ts';
import {fixture,now,publicKey} from './fixtures/node-bootstrap.ts';
test('F-005: confirmation and reconstructed plans gate effects; untrusted saved commands cannot execute',async()=>{
 const f=await fixture();let calls=0;try{
  const runner=async()=>{calls++;return '{}';};await assert.rejects(bootstrapOperation(f.plan,'apply',{confirm:'wrong'},runner,now),/exact/);assert.equal(calls,0);
  assert.throws(()=>validateBootstrapPlan({...f.plan,steps:[{id:'arbitrary',program:'sh',args:['-c','untrusted']}]},now),/differs/);assert.throws(()=>validateBootstrapPlan({...f.plan,digest:'b'.repeat(64)},now),/differs/);
  const blocked=bootstrapPlan(f.plan.inspection,{sourceProtocol:1,revision:f.plan.source.revision,checkout:f.plan.checkout,home:f.plan.home,base:f.plan.base,installService:true},now);await assert.rejects(bootstrapOperation(blocked,'apply',{confirm:blocked.digest},runner,now),/blocked/);assert.equal(calls,0);
 }finally{f.close();}
});
test('F-005: fixed bootstrap helper performs only typed steps and persists replayable success without duplicate effects',async()=>{
 const f=await fixture();try{
  const first=await bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},f.runner(),now);assert.equal(first.state,'completed',first.reason);assert.equal(first.publicKey,publicKey);assert.equal(first.pairing,'required');assert.equal(first.service,'not-installed');assert.ok(existsSync(join(f.plan.home,'config.json')));const before=readFileSync(f.calls,'utf8');assert.equal(before.split('\n').filter(Boolean).length,8);assert.ok(before.includes('--no-model-setup'));assert.ok(before.includes('--engine-strict'));assert.ok(!before.includes('service'));
  const replay=await bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},f.runner(),now);assert.deepEqual(replay,first);assert.equal(readFileSync(f.calls,'utf8'),before);
  const later=new Date(now.getTime()+2*86400000);assert.equal((await bootstrapOperation(f.plan,'status',{},f.runner(),later)).state,'completed','recovery reads survive plan expiry');await assert.rejects(bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},f.runner(),later),/expire/);
 }finally{f.close();}
});
test('F-005: partial effect failure remains uncertain, holds its resource and never silently retries',async()=>{
 const f=await fixture();try{
  const first=await bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},f.runner('ci'),now);assert.equal(first.state,'uncertain');assert.equal(first.reason,'step-failed:locked-dependencies');const before=readFileSync(f.calls,'utf8');assert.ok(existsSync(f.plan.checkout));
  assert.equal((await bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},f.runner(),now)).state,'uncertain');assert.equal(readFileSync(f.calls,'utf8'),before,'stored uncertainty never launches another step');
  const second=bootstrapPlan(f.plan.inspection,{sourceProtocol:1,revision:'b'.repeat(40),checkout:join(f.home,'other-checkout'),home:join(f.home,'other-data'),base:f.plan.base,installService:false},now);assert.equal((await bootstrapOperation(second,'apply',{confirm:second.digest},f.runner(),now)).state,'busy');assert.equal(readFileSync(f.calls,'utf8'),before);
  await assert.rejects(bootstrapOperation(f.plan,'release',{confirm:f.plan.digest,reason:'Verified stopped'},f.runner(),now),/confirmation/);
  const released=await bootstrapOperation(f.plan,'release',{confirm:f.plan.digest,reason:'Verified fixture handler and descendants stopped',confirmedStopped:true},f.runner(),now);assert.equal(released.state,'released',released.reason);assert.ok(existsSync(f.plan.checkout),'release does not delete or undo effects');
  assert.equal((await bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},f.runner(),now)).state,'released');assert.equal(readFileSync(f.calls,'utf8'),before,'old digest cannot execute again after release');
 }finally{f.close();}
});
test('F-005: status is read-only and target drift/uncertain transport cannot report completion',async()=>{
 const f=await fixture();try{
  assert.equal((await bootstrapOperation(f.plan,'status',{},f.runner(),now)).state,'absent');assert.deepEqual(readdirSync(f.home),[]);
  const failed=await bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},async()=>{throw Error('private transport error');},now);assert.equal(failed.state,'uncertain');assert.ok(!JSON.stringify(failed).includes('private transport error'));
  const drift=async(request:CommandRequest)=>runNodeCommand({program:process.execPath,args:['--input-type=commonjs','-'],input:`require('node:os').hostname=()=>"different-target";`+request.input,timeoutMs:5000,maxBytes:32768,mayWrite:true});assert.equal((await bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},drift,now)).state,'refused');assert.deepEqual(readdirSync(f.home),[]);
  await assert.rejects(bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},async()=>JSON.stringify({version:1,digest:f.plan.digest,state:'completed',steps:[]}),now),/Incomplete/);
 }finally{f.close();}
});

test('F-005: lost terminal reply replays the durable receipt and a crashed handler retains uncertainty',async()=>{
 const f=await fixture();try{
  const runner=f.runner();const lost=await bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},async request=>{await runner(request);throw Error('lost reply');},now);assert.equal(lost.state,'uncertain');const before=readFileSync(f.calls,'utf8');assert.equal((await bootstrapOperation(f.plan,'status',{},runner,now)).state,'completed');assert.equal((await bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},runner,now)).state,'completed');assert.equal(readFileSync(f.calls,'utf8'),before);
 }finally{f.close();}
 const crashed=await fixture();try{
  const receipt=await bootstrapOperation(crashed.plan,'apply',{confirm:crashed.plan.digest},crashed.runner('crash-build'),now);assert.equal(receipt.state,'uncertain');const status=await bootstrapOperation(crashed.plan,'status',{},crashed.runner(),now);assert.equal(status.state,'uncertain');assert.ok(status.steps.includes('build:started'));const before=readFileSync(crashed.calls,'utf8');assert.equal((await bootstrapOperation(crashed.plan,'apply',{confirm:crashed.plan.digest},crashed.runner(),now)).state,'uncertain');assert.equal(readFileSync(crashed.calls,'utf8'),before);
 }finally{crashed.close();}
});
test('F-005: concurrent operators execute one plan once',async()=>{
 const f=await fixture();try{
  const results=await Promise.all([bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},f.runner(),now),bootstrapOperation(f.plan,'apply',{confirm:f.plan.digest},f.runner(),now)]);assert.ok(results.some(receipt=>receipt.state==='completed'));assert.equal(readFileSync(f.calls,'utf8').split('\n').filter(Boolean).length,8);

 }finally{f.close();}
});
