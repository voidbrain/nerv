import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,lstatSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {serviceFixture} from './mac-service-fixture.ts';
import {planService,applyService,serviceReceipt,releaseService,macServiceHost,type ServiceReceipt} from '../src/node-lifecycle-execution.ts';
import {canonical} from '../src/kaji.ts';
const supported={skip:process.platform==='win32'||process.getuid?.()===0};
test('Mac lifecycle joins exact files, durable started receipts and OS adapter; cached replay never reinstalls',supported,async()=>{
 const f=serviceFixture();try{
  assert.deepEqual(serviceReceipt(f.host,'a'.repeat(64)),{state:'absent'});assert.equal(existsSync(join(f.directory,'.nerv-lifecycle')),false);
  const plan=await planService(f.host,'install');assert.deepEqual(plan.blockers,[]);await assert.rejects(applyService(f.host,plan,'wrong'),/exact/);assert.equal(existsSync(f.definition),false);
  const installed=await applyService(f.host,plan,plan.digest);assert.equal(installed.state,'completed');assert.equal(lstatSync(f.definition).mode&0o777,0o600);assert.deepEqual(f.calls,['register']);
  assert.deepEqual(await applyService(f.host,plan,plan.digest),installed);assert.equal(f.calls.length,1);
  const stop=await planService(f.host,'stop');const stopped=await applyService(f.host,stop,stop.digest);assert.ok(stopped.fence>installed.fence);assert.equal((await f.host.inspect()).runtime,'stopped');
  const remove=await planService(f.host,'uninstall');await applyService(f.host,remove,remove.digest);assert.equal(existsSync(f.definition),false);assert.equal(existsSync(f.data),true);assert.equal(readFileSync(join(f.host.context.home,'base-key'),'utf8'),'neutral-fixture-private');
  assert.deepEqual(await applyService(f.host,plan,plan.digest),installed);assert.equal(existsSync(f.definition),false,'replaying a historical install must not create a fresh service');
 }finally{f.close();}
});
test('ownership, drift, legacy, pending work and incompatible source block effects',supported,async()=>{
 const f=serviceFixture();try{
  const plan=await planService(f.host,'install');f.controls.pending=true;await assert.rejects(applyService(f.host,plan,plan.digest),/changed/);assert.equal(existsSync(f.definition),false);f.controls.pending=false;
  for(const key of ['legacy','pending'] as const){f.controls[key]=true;assert.ok((await planService(f.host,'install')).blockers.length);f.controls[key]=false;}
  writeFileSync(f.definition,'foreign definition',{mode:0o600});const foreign=await planService(f.host,'install');assert.ok(foreign.blockers.length);await assert.rejects(applyService(f.host,foreign,foreign.digest),/blocked/);assert.equal(readFileSync(f.definition,'utf8'),'foreign definition');
  const altered=structuredClone(plan);altered.context.home=join(f.directory,'another-profile');const {digest,...body}=altered;altered.digest=createHash('sha256').update(canonical(body)).digest('hex');await assert.rejects(applyService(f.host,altered,altered.digest),/Invalid local/);
 }finally{f.close();}
});
test('partial failure retains a changed foreign definition and resource; replay has no effects',supported,async()=>{
 const f=serviceFixture();try{const plan=await planService(f.host,'install');f.setBeforeCommand(()=>{writeFileSync(f.definition,'changed by another owner');throw Error('neutral injected failure');});await assert.rejects(applyService(f.host,plan,plan.digest),/injected/);const receipt=serviceReceipt(f.host,plan.digest) as ServiceReceipt;assert.equal(receipt.state,'uncertain');assert.equal(readFileSync(f.definition,'utf8'),'changed by another owner');assert.equal((await applyService(f.host,plan,plan.digest)).state,'uncertain');assert.equal(f.calls.length,1);assert.ok((await planService(f.host,'install')).blockers.some(s=>s.includes('owns')));assert.throws(()=>releaseService(f.host,receipt,{...receipt,handlerStopped:true,descendantsStopped:true,operatorConfirmed:true,reason:'Neutral handler still running'}),/handler/);}finally{f.close();}
});
test('concurrent callers return the accepted receipt without a second manager registration',supported,async()=>{
 const f=serviceFixture();let release!:()=>void;const gate=new Promise<void>(done=>release=done);let entered!:()=>void;const started=new Promise<void>(done=>entered=done);
 try{f.setBeforeCommand(async()=>{entered();await gate;});const p=await planService(f.host,'install'),first=applyService(f.host,p,p.digest);await started;const replay=await applyService(f.host,p,p.digest);assert.equal(replay.state,'running');assert.equal(f.calls.length,1);release();assert.equal((await first).state,'completed');}finally{release();f.close();}
});
test('update backs up existing data before source effects and refuses source drift between steps',supported,async()=>{
 const f=serviceFixture();try{const install=await planService(f.host,'install');await applyService(f.host,install,install.digest);const stop=await planService(f.host,'stop');await applyService(f.host,stop,stop.digest);const next='b'.repeat(40);f.controls.compatible=false;assert.ok((await planService(f.host,'update',next)).blockers.length);f.controls.compatible=true;
  const update=await planService(f.host,'update',next);f.setBeforeCommand(step=>{if(step==='fetch'){const backup=new DatabaseSync(join(f.directory,'.nerv-lifecycle/backups',update.digest,'database.sqlite'),{readOnly:true});try{assert.equal(backup.prepare('SELECT title FROM reminders WHERE id=?').get('original')!.title,'Neutral existing reminder');}finally{backup.close();}}});assert.equal((await applyService(f.host,update,update.digest)).state,'completed');assert.equal((await f.host.inspect()).revision,next);assert.deepEqual(f.calls.slice(-5),['fetch','checkout','dependencies','build','register']);
  const stopped=await planService(f.host,'stop');await applyService(f.host,stopped,stopped.digest);const drift=await planService(f.host,'update','c'.repeat(40));f.setBeforeCommand(step=>{if(step==='fetch')f.controls.clean=false;});await assert.rejects(applyService(f.host,drift,drift.digest),/source changed/);assert.equal((serviceReceipt(f.host,drift.digest) as ServiceReceipt).state,'uncertain');assert.equal(readFileSync(f.revision,'utf8'),next);
 }finally{f.close();}
});
for(const phase of ['accepted','definition:completed','start:completed'])test('real handler interruption at '+phase+' requires exact stopped recovery; new plans take a higher fence',supported,async()=>{
 const f=serviceFixture();try{const plan=await planService(f.host,'install'),path=join(f.directory,'plan.json');writeFileSync(path,JSON.stringify(plan));const code='const {serviceFixture}=await import('+JSON.stringify(new URL('./mac-service-fixture.ts',import.meta.url).href)+');const {applyService}=await import('+JSON.stringify(new URL('../src/node-lifecycle-execution.ts',import.meta.url).href)+');const {readFileSync}=await import(\'node:fs\');const f=serviceFixture('+JSON.stringify(f.directory)+');const p=JSON.parse(readFileSync('+JSON.stringify(path)+',\'utf8\'));await applyService(f.host,p,p.digest,step=>{if(step==='+JSON.stringify(phase)+')process.exit(86)});';assert.throws(()=>execFileSync(process.execPath,['--input-type=module','-e',code],{stdio:'pipe'}));const old=serviceReceipt(f.host,plan.digest) as ServiceReceipt;assert.equal(old.state,'running');const evidence={...old,handlerStopped:true,descendantsStopped:true,operatorConfirmed:true,reason:'Neutral child exited; simulated service and descendants stopped'};assert.throws(()=>releaseService(f.host,{...old,fence:old.fence+1},evidence),/ownership|changed/);assert.throws(()=>releaseService(f.host,old,{...evidence,descendantsStopped:false}),/stopped/);f.setManager(false);assert.equal(releaseService(f.host,old,evidence).state,'released');assert.equal((await applyService(f.host,plan,plan.digest)).state,'released');const action=existsSync(f.definition)?'uninstall':'install',next=await planService(f.host,action);const result=await applyService(f.host,next,next.digest);assert.ok(result.fence>old.fence);assert.equal(result.state,'completed');}finally{f.close();}
});
test('clock rollback and symlinked journal never initialize replacement fencing state',supported,async()=>{
 const f=serviceFixture();try{const p=await planService(f.host,'install');await applyService(f.host,p,p.digest);const db=new DatabaseSync(join(f.directory,'.nerv-lifecycle/journal.sqlite'));db.prepare('UPDATE clock SET value=0').run();db.close();await assert.rejects(planService(f.host,'stop'),/rolled back/);}finally{f.close();}
 const g=serviceFixture();try{symlinkSync(join(g.directory,'missing'),join(g.directory,'.nerv-lifecycle'));await assert.rejects(planService(g.host,'install'));assert.equal(lstatSync(join(g.directory,'.nerv-lifecycle')).isSymbolicLink(),true);}finally{g.close();}
});
test('production adapter refuses additional profiles and unsupported/root hosts without installing anything',()=>{assert.throws(()=>macServiceHost('/neutral/additional-profile'),/additional|unprivileged/);});
