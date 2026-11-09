import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.ts';
import {Ledger} from '../src/ledger.ts';
import {Watch,validateWatch,watchSlot,type WatchTrigger} from '../src/watch.ts';
import type {Pilot} from '../src/pilots.ts';
const now=new Date('2030-01-01T12:00:00Z');
const trigger:WatchTrigger={id:'fixture-check',request:'Read fixture status',schedule:{everyMinutes:10},maxActions:1,maxSteps:3};
const pilot:Pilot={id:'fixture-pilot',name:'Fixture',domain:'Fixtures',keywords:['fixture'],model:'fixture',stage:'production'};

test('F-026: strict neutral trigger validation fails before writes; a pilot stage cannot be supplied by trigger data',()=>{
 assert.deepEqual(validateWatch({triggers:[trigger]}),{triggers:[trigger]});
 for(const bad of [{triggers:[{...trigger,stage:'production'}]},{triggers:[trigger,trigger]},{triggers:[{...trigger,schedule:{everyMinutes:0}}]},{triggers:[{...trigger,schedule:{everyMinutes:1,event:'sortie.done'}}]},{triggers:[{...trigger,maxActions:4,maxSteps:2}]},{triggers:[{...trigger,request:' '}]},{triggers:[],quietHours:{from:'22:00',until:'22:00'}}])assert.throws(()=>validateWatch(bad));
 const store=new Store(':memory:');try{const watch=store.watch;assert.throws(()=>watch.admit({triggers:[trigger,{...trigger,id:'other-check',pilot:'missing-pilot'}]},[],'UTC',now));assert.equal(store.sorties().length,0);}finally{store.close();}
});

test('F-026: heartbeat buckets and local daily slots are stable through DST',()=>{
 assert.equal(watchSlot({everyMinutes:10},now,'UTC'),watchSlot({everyMinutes:10},new Date('2030-01-01T12:09:59Z'),'UTC'));
 assert.notEqual(watchSlot({everyMinutes:10},now,'UTC'),watchSlot({everyMinutes:10},new Date('2030-01-01T12:10:00Z'),'UTC'));
 assert.equal(watchSlot({at:'02:30'},new Date('2030-10-27T00:45:00Z'),'Europe/Rome'),watchSlot({at:'02:30'},new Date('2030-10-27T01:45:00Z'),'Europe/Rome'));
 assert.equal(watchSlot({at:'02:30'},new Date('2030-03-31T01:00:00Z'),'Europe/Rome'),'day:2030-03-31','a skipped clock hour becomes due after the jump');
 assert.equal(watchSlot({at:'15:00'},now,'UTC'),undefined);

});

test('F-026: trigger/run/source identities and immutable budgets survive reopening; interrupted attempts are never replayed',()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-watch-'));const path=join(home,'nerv.sqlite');let store=new Store(path);
 try{
  let watch=store.watch;const [run]=watch.admit({triggers:[trigger]},[],'UTC',now);assert.ok(run);
  assert.equal(store.sortie(run.sortieId)?.source,'hyuga');assert.ok(store.events(run.sortieId).some(e=>e.kind==='sortie.proactive'&&e.payload.trigger===trigger.id));
  assert.equal(watch.admit({triggers:[trigger]},[],'UTC',now).length,0);assert.equal(watch.claim(now)?.sortieId,run.sortieId);assert.equal(watch.claim(now),null);
  store.close();store=new Store(path);watch=store.watch;
  assert.equal(watch.admit({triggers:[trigger]},[],'UTC',now).length,0,'reopening cannot recreate its current slot');
  assert.equal(watch.claim(now),null,'claim is durable');assert.equal(watch.interrupt(new Date(now.getTime()+1),new Date(now.getTime()+2)),1);
  assert.equal(watch.get(run.sortieId)?.state,'interrupted');assert.equal(watch.claim(now),null);assert.equal(store.sortie(run.sortieId)?.status,'revoked');
  const next=watch.admit({triggers:[trigger]},[],'UTC',new Date(now.getTime()+3600_000));assert.equal(next.length,1,'missed heartbeat buckets are not backfilled');
 }finally{store.close();rmSync(home,{recursive:true,force:true});}
});

test('F-026: event subscriptions baseline at current head, exclude their own sorties, and advance once across duplicate polls',()=>{
 const store=new Store(':memory:');try{
  const watch=store.watch;const definition={triggers:[{...trigger,schedule:{event:'sortie.done'}}]};
  const old=store.ledger.openSortie('owner','Old fixture','trusted',now);store.ledger.close(old,'done',now);
  assert.equal(watch.admit(definition,[],'UTC',now).length,0,'no replay of historical events');
  const fresh=store.ledger.openSortie('owner','Fresh fixture','tainted',now);store.ledger.close(fresh,'done',now);
  const runs=watch.admit(definition,[],'UTC',now);assert.equal(runs.length,1);assert.match(runs[0]!.slot,/^event:/);assert.equal(store.ledger.trust(runs[0]!.sortieId),'tainted','event provenance retains its source taint');
  assert.equal(watch.admit(definition,[],'UTC',now).length,0);watch.claim(now);watch.finish(runs[0]!.sortieId,'done',now);
  assert.equal(watch.admit(definition,[],'UTC',now).length,0,'proactive completion does not retrigger itself');
  assert.equal(watch.admit({triggers:[{...trigger,schedule:{event:'sortie.failed'}}]},[],'UTC',now).length,0,'changed subscription begins at the current head');
 }finally{store.close();}
});

test('F-026: pending queue is bounded and a Spear cancellation is never claimed',()=>{
 const store=new Store(':memory:');try{
  const watch=store.watch;let first:string|undefined;
  for(let n=0;n<25;n++){const runs=watch.admit({triggers:[trigger]},[],'UTC',new Date(now.getTime()+n*600_000));first ??= runs[0]?.sortieId;}
  assert.equal(store.sorties(50).length,20);store.spear(first!,'Owner cancelled');const next=watch.claim(now);assert.notEqual(next?.sortieId,first);assert.equal(watch.get(first!)?.state,'cancelled');
 }finally{store.close();}
});

test('F-026: stage/call arguments cannot widen proactive read-only or action budgets, even past maxRejects',()=>{
 const store=new Store(':memory:');try{
  const ledger=new Ledger(store.db,{tools:[{name:'fixture.read',effect:'read'},{name:'fixture.write',effect:'write-local'},{name:'fixture.send',effect:'write-external'}],policy:{...store.ledger.policy,syncThreshold:0}});
  const watch=new Watch(store.db,ledger);const [run]=watch.admit({triggers:[trigger]},[],'UTC',now);assert.ok(run);
  for(let n=0;n<8;n++){const rejected=ledger.propose(run.sortieId,{tool:'fixture.write',args:{n},stage:'production'},now);assert.equal(rejected.ballot.outcome,'reject');assert.equal(rejected.ballot.blocked,'proactive');assert.equal(rejected.approvalId,undefined);}
  const read=ledger.propose(run.sortieId,{tool:'fixture.read',args:{},stage:'production'},now);assert.equal(read.ballot.executor,'eva-00');assert.equal(read.ballot.outcome,'grant');
  for(let n=0;n<8;n++){const denied=ledger.propose(run.sortieId,{tool:'fixture.read',args:{n},stage:'production'},now);assert.equal(denied.ballot.outcome,'reject');assert.equal(denied.ballot.blocked,'budget');assert.equal(denied.approvalId,undefined);}
  const [prod]=watch.admit({triggers:[{...trigger,id:'prod-check',pilot:pilot.id}]},[pilot],'UTC',now);assert.ok(prod);
  assert.equal(ledger.propose(prod.sortieId,{tool:'fixture.write',args:{},stage:'production'},now).ballot.outcome,'grant');
  const [limited]=watch.admit({triggers:[{...trigger,id:'limited-check',pilot:pilot.id}]},[pilot],'UTC',now);assert.ok(limited);
  assert.equal(ledger.propose(limited.sortieId,{tool:'fixture.write',args:{},stage:'prototype'},now).ballot.outcome,'reject','caller can always request a stricter stage');
 }finally{store.close();}
});

test('F-026: a proactive outside-code read cannot bypass missing confinement through an owner card',()=>{
 const store=new Store(':memory:');try{
  const watch=store.watch;const [run]=watch.admit({triggers:[trigger]},[],'UTC',now);assert.ok(run);
  store.ledger.setExternal([{name:'fixture.mcp',effect:'read',eva:'eva-02'}]);
  for(let n=0;n<8;n++){const p=store.ledger.propose(run.sortieId,{tool:'fixture.mcp',args:{n},stage:'production'},now);assert.equal(p.ballot.outcome,'reject');assert.equal(p.ballot.blocked,'isolation');assert.equal(p.approvalId,undefined);}
 }finally{store.close();}
});


test('F-026: removed event subscriptions re-enable at current head without disabled-period replay',()=>{
 const store=new Store(':memory:');try{
  const watch=store.watch;const config={triggers:[{...trigger,schedule:{event:'sortie.done'}}]};
  watch.admit(config,[],'UTC',now);watch.admit({triggers:[]},[],'UTC',now);
  const id=store.ledger.openSortie('owner','Disabled fixture','trusted',now);store.ledger.close(id,'done',now);
  assert.equal(watch.admit(config,[],'UTC',now).length,0);
  const fresh=store.ledger.openSortie('owner','Re-enabled fixture','trusted',now);store.ledger.close(fresh,'done',now);
  assert.equal(watch.admit(config,[],'UTC',now).length,1);
 }finally{store.close();}
});

test('F-026: cancellation after claim survives restart and cannot become successful completion',()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-watch-cancel-'));const path=join(home,'nerv.sqlite');let store=new Store(path);
 try{
  const [run]=store.watch.admit({triggers:[trigger]},[],'UTC',now);assert.ok(run);store.watch.claim(now);store.spear(run.sortieId,'Owner stopped fixture');store.close();store=new Store(path);
  assert.equal(store.watch.finish(run.sortieId,'done',now),false);assert.equal(store.watch.get(run.sortieId)?.state,'cancelled');assert.equal(store.sortie(run.sortieId)?.status,'revoked');
 }finally{store.close();rmSync(home,{recursive:true,force:true});}
});

test('F-026: definition edits, removal and pilot demotion revoke pending/running work without replacing its slot',()=>{
 const store=new Store(':memory:');try{
  const config={triggers:[{...trigger,pilot:pilot.id}]};const [run]=store.watch.admit(config,[pilot],'UTC',now);assert.ok(run);store.watch.claim(now);
  assert.equal(store.watch.admit(config,[{...pilot,stage:'prototype'}],'UTC',now).length,0);assert.equal(store.watch.get(run.sortieId)?.state,'cancelled');
  assert.throws(()=>store.ledger.propose(run.sortieId,{tool:'reminders.add',args:{},stage:'production'},now),/not open/);
  const later=new Date(now.getTime()+600_000);const [next]=store.watch.admit(config,[pilot],'UTC',later);assert.ok(next);
  assert.equal(store.watch.admit({triggers:[{...trigger,pilot:pilot.id,request:'Changed request'}]},[pilot],'UTC',later).length,0);assert.equal(store.watch.get(next.sortieId)?.state,'cancelled');
  const [last]=store.watch.admit(config,[pilot],'UTC',new Date(later.getTime()+600_000));assert.ok(last);store.watch.admit({triggers:[]},[],'UTC',new Date(later.getTime()+600_000));assert.equal(store.watch.get(last.sortieId)?.state,'cancelled');
 }finally{store.close();}
});


test('F-026: missing or retired pilots revoke old pending/running authority before rejecting new admission',()=>{
 for(const started of [false,true])for(const removed of [false,true]){
  const store=new Store(':memory:');try{
   const config={triggers:[{...trigger,pilot:pilot.id}]};const [run]=store.watch.admit(config,[pilot],'UTC',now);assert.ok(run);if(started)store.watch.claim(now);
   assert.throws(()=>store.watch.admit(config,removed?[]:[{...pilot,retired:true}],'UTC',now),/missing or retired/);
   assert.equal(store.watch.get(run.sortieId)?.state,'cancelled');assert.equal(store.sortie(run.sortieId)?.status,'revoked');
   assert.throws(()=>store.ledger.propose(run.sortieId,{tool:'reminders.add',args:{title:'Fixture',due:'2030-01-02T00:00:00Z'},stage:'production'},now),/not open/);
  }finally{store.close();}
 }
});

test('F-026: recovery preserves cancellation and recorded completion rather than reclassifying them as interruption',()=>{
 const store=new Store(':memory:');try{
  const [cancelled]=store.watch.admit({triggers:[trigger]},[],'UTC',now);assert.ok(cancelled);store.watch.claim(now);store.spear(cancelled.sortieId,'Owner cancelled');
  const [finished]=store.watch.admit({triggers:[trigger,{...trigger,id:'finished-check'}]},[],'UTC',now);assert.ok(finished);store.watch.claim(now);store.ledger.close(finished.sortieId,'done',now);
  assert.equal(store.watch.interrupt(new Date(now.getTime()+1),new Date(now.getTime()+2)),0);assert.equal(store.watch.get(cancelled.sortieId)?.state,'cancelled');assert.equal(store.watch.get(finished.sortieId)?.state,'done');
 }finally{store.close();}
});
