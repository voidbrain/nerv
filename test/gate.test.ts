import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {casperAsk,parseCasper} from '../src/casper.ts';
import {Store,OWNER_SOURCE} from '../src/store.ts';
import {Runtime} from '../src/runtime.ts';
import {makeServer} from '../src/server.ts';
import {defaultPolicy} from '../src/policy.ts';
test('Casper is asked on the local route with the request and the action only, and its reply is read strictly',()=>{
 const ask=casperAsk({request:'Remind me to call Ada',tool:'reminders.add',args:{title:'Call Ada',due:'2030-01-01T09:00:00Z'},effect:'write-local'});
 assert.equal(ask.privacy,'local-only');assert.equal(ask.route,'local');
 assert.deepEqual(JSON.parse(ask.prompt),{request:'Remind me to call Ada',action:{tool:'reminders.add',effect:'write-local',args:{title:'Call Ada',due:'2030-01-01T09:00:00Z'}}});
 assert.deepEqual(parseCasper('Sure. {"vote":"approve","reason":" Matches. ","confidence":0.9} done'),{seat:'casper',vote:'approve',reason:'Matches.',confidence:0.9});
 for(const bad of ['no json','{"vote":"yes","reason":"x","confidence":0.5}','{"vote":"approve","reason":"","confidence":0.5}','{"vote":"approve","reason":"x","confidence":2}','{"vote":"approve","reason":"x"}','{"vote":"approve",'])assert.equal(parseCasper(bad),undefined,bad);
 assert.equal(parseCasper(`{"vote":"reject","reason":"${'r'.repeat(900)}","confidence":0.1}`)!.reason.length,500);
});
test('a Green owner action runs at once through the grant; a failing executor is recorded and the sortie closes failed',()=>{
 const store=new Store(':memory:');
 try{
  const sortie=store.ledger.openSortie(OWNER_SOURCE,'Remind me','trusted');
  const done=store.runAction(sortie,{tool:'reminders.add',args:{title:'Call Ada',due:'2030-01-01T09:00:00Z'},stage:'production'});
  assert.equal(done.outcome,'grant');assert.equal(done.pattern,'green');assert.deepEqual(done.result,{id:(done.result as {id:string}).id,title:'Call Ada',due:'2030-01-01T09:00:00.000Z'});
  assert.equal(store.list().length,1);assert.ok(!JSON.stringify(done).includes('grantId'));
  assert.deepEqual(store.events(sortie).map(e=>e.kind),['sortie.opened','ballot','grant.issued','grant.used','action.done','sortie.done']);
  const bad=store.ledger.openSortie(OWNER_SOURCE,'Remind me badly','trusted');
  const failed=store.runAction(bad,{tool:'reminders.add',args:{title:'x',due:'yesterday'},stage:'production'});
  assert.match(failed.error!,/ISO date/);assert.deepEqual(store.events(bad).slice(-2).map(e=>e.kind),['action.failed','sortie.failed']);
  const extra=store.ledger.openSortie(OWNER_SOURCE,'List','trusted');assert.match(store.runAction(extra,{tool:'reminders.list',args:{all:true},stage:'production'}).error!,/Arguments allowed: none/);
 }finally{store.close();}
});
/** A loopback OpenAI-compatible model that answers as Casper and records what it was asked. */
async function fakeModel(answer:()=>string) {
 const asked:{model:string;messages:{role:string;content:string}[]}[]=[];
 const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c).on('end',()=>{asked.push(JSON.parse(body));res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:answer()},finish_reason:'stop'}]}));});});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const port=(server.address() as {port:number}).port;
 return {asked,url:`http://127.0.0.1:${port}/v1`,close:()=>new Promise<void>(done=>server.close(()=>done()))};
}
test('through every process: REST act, Casper on the local model, the owner approves and the executor runs once',async()=>{
 let answer='{"vote":"approve","reason":"Adds the reminder the owner asked for.","confidence":0.93}';
 const model=await fakeModel(()=>answer);const home=mkdtempSync(join(tmpdir(),'nerv-gate-'));
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:model.url,model:'casper-test'}}}));
 // The owner's Scrolls make reminders.add Blue, so it needs Casper and then the owner.
 writeFileSync(join(home,'scrolls.json'),JSON.stringify({...defaultPolicy,blue:['reminders.add']}),{mode:0o600});
 const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);const token='b'.repeat(32);const server=makeServer(runtime,token);
 try{
  await runtime.ready();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  const act=(body:object)=>fetch(base+'/api/actions',{method:'POST',headers,body:JSON.stringify(body)});
  const request='Remind me to renew the car insurance';const args={title:'Renew car insurance',due:'2030-01-15T09:00:00+01:00'};
  const reply=await (await act({request,tool:'reminders.add',args})).json() as {sortieId:string;outcome:string;pattern:string;approvalId:string;reason:string};
  assert.equal(reply.pattern,'blue');assert.equal(reply.outcome,'approval');assert.ok(reply.approvalId);assert.ok(!JSON.stringify(reply).includes('grantId'));
  assert.equal(model.asked.length,1);assert.equal(model.asked[0]!.model,'casper-test');
  assert.deepEqual(JSON.parse(model.asked[0]!.messages.at(-1)!.content),{request,action:{tool:'reminders.add',effect:'write-local',args}});
  const ballot=(await runtime.events(reply.sortieId)).find(e=>e.kind==='ballot');assert.ok(ballot&&ballot.kind==='ballot');
  assert.deepEqual(ballot.payload.verdicts.find(v=>v.seat==='casper'),{seat:'casper',vote:'approve',reason:'Adds the reminder the owner asked for.',confidence:0.93});
  assert.equal((await runtime.list()).length,0,'nothing runs before the owner decides');
  const decided=await (await fetch(base+'/api/approvals/'+reply.approvalId,{method:'POST',headers,body:JSON.stringify({decision:'approve'})})).json() as {decision:string;result:{title:string}};
  assert.equal(decided.decision,'approve');assert.equal(decided.result.title,'Renew car insurance');
  const again=await (await fetch(base+'/api/approvals/'+reply.approvalId,{method:'POST',headers,body:JSON.stringify({decision:'approve'})})).json();
  assert.deepEqual(again,{decision:'approve'});assert.equal((await runtime.list()).length,1,'a repeated decision never runs the tool twice');
  assert.deepEqual((await runtime.events(reply.sortieId)).map(e=>e.kind),['sortie.opened','ballot','approval.requested','approval.approve','grant.issued','grant.used','action.done','sortie.done']);
  // An unreadable Casper reply is no verdict: the card says why, and the owner decides.
  answer='I think it is fine';
  const unsure=await (await act({request:'Remind me again',tool:'reminders.add',args})).json() as {outcome:string;casperError:string;reason:string};
  assert.equal(unsure.outcome,'approval');assert.match(unsure.casperError,/not a readable verdict/);assert.match(unsure.reason,/Casper \(intent\) verdict unavailable/);
  // Green work never calls the model.
  const asked=model.asked.length;const list=await (await act({request:'What is due?',tool:'reminders.list',args:{}})).json() as {outcome:string;result:unknown[]};
  assert.equal(list.outcome,'grant');assert.equal(list.result.length,1);assert.equal(model.asked.length,asked);
  assert.equal((await act({request:'x',tool:'reminders.list'})).status,400);assert.equal((await act({request:'x',tool:'reminders.list',args:[]})).status,400);
  assert.equal((await fetch(base+'/api/actions',{method:'POST',body:'{}'})).status,401);
  const reload=await fetch(base+'/api/models/reload',{method:'POST',headers});assert.equal(reload.status,200);assert.match(JSON.stringify(await reload.json()),/casper-test/);
  assert.equal((await fetch(base+'/api/models/reload',{method:'POST'})).status,401);
 }finally{await new Promise<void>(done=>server.close(()=>done()));await runtime.close();await model.close();rmSync(home,{recursive:true,force:true});}
});

test('reload changes the brain\'s models in place; a broken file keeps the last working settings',async()=>{
 const model=await fakeModel(()=>'{"vote":"approve","reason":"Matches.","confidence":0.9}');const home=mkdtempSync(join(tmpdir(),'nerv-reload-'));
 const config=(models:object)=>writeFileSync(join(home,'config.json'),JSON.stringify({models}));
 config({local:{baseUrl:model.url,model:'gemma4:12b'}});writeFileSync(join(home,'scrolls.json'),JSON.stringify({blue:['reminders.list']}),{mode:0o600});
 const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);const brainPid=()=>runtime.brain.child.pid;
 try{
  await runtime.ready();const pid=brainPid();
  await runtime.act({request:'What is due?',tool:'reminders.list',args:{}});assert.equal(model.asked.at(-1)!.model,'gemma4:12b');
  config({local:{baseUrl:model.url,model:'gemma4:12b'},roles:{casper:{model:'gemma4:e2b-it-q4_K_M'}}});
  const reloaded=await runtime.reloadModels();assert.equal(reloaded.error,undefined);assert.deepEqual((reloaded.models as {roles:{casper:string}}).roles.casper,'local (gemma4:e2b-it-q4_K_M)');
  await runtime.act({request:'What is due?',tool:'reminders.list',args:{}});assert.equal(model.asked.at(-1)!.model,'gemma4:e2b-it-q4_K_M');
  writeFileSync(join(home,'config.json'),'{"models":{"local":{"baseUrl":"http://10.0.0.1/v1","model":"x"}}}');
  const broken=await runtime.reloadModels();assert.match(broken.error!,/loopback/);assert.equal(broken.kept,true);
  await runtime.act({request:'What is due?',tool:'reminders.list',args:{}});assert.equal(model.asked.at(-1)!.model,'gemma4:e2b-it-q4_K_M','the last working settings stay');
  assert.equal(brainPid(),pid,'no process restart');
 }finally{await runtime.close();await model.close();rmSync(home,{recursive:true,force:true});}
});
test('reminders.cancel takes one id or up to 20 ids, and reminders.restore undoes it while the reminder is still ahead',()=>{
 const store=new Store(':memory:');
 try{
  const a=store.add('A','2031-01-01T09:00:00Z'),b=store.add('B','2031-01-02T09:00:00Z');
  // B-009: a removal runs only with Casper's intent check (here: approved); without one the owner decides.
  const run=(tool:string,args:Record<string,unknown>)=>{const s=store.ledger.openSortie(OWNER_SOURCE,tool,'trusted');return store.runAction(s,{tool,args,stage:'production',casper:{seat:'casper',vote:'approve',reason:'Asked for.',confidence:0.9}});};
  const cancel=run('reminders.cancel',{ids:[a.id,b.id]});assert.equal(cancel.pattern,'green');assert.deepEqual((cancel.result as {cancelled:string[]}).cancelled,[a.id,b.id]);
  assert.equal(store.pendingReminders().length,0);
  assert.deepEqual((run('reminders.restore',{id:a.id}).result as {restored:string[]}).restored,[a.id]);assert.deepEqual(store.pendingReminders().map(r=>r.id),[a.id]);
  for(const args of [{},{id:'x',ids:['y']},{ids:[]},{ids:['x','x']},{ids:Array.from({length:21},(_,i)=>'r'+i)},{ids:[1]}])assert.ok(run('reminders.cancel',args).error,JSON.stringify(args));
 }finally{store.close();}
});
test('the ballot: a Green removal needs Casper (no verdict: the owner decides; reject: refused; approve: granted); a Green add does not (B-009)',async()=>{
 const {ballot,intentChecked}=await import('../src/policy.ts');
 const cancel={name:'reminders.cancel',effect:'write-local' as const,inverse:'reminders.restore',removes:true as const},add={name:'reminders.add',effect:'write-local' as const,inverse:'reminders.cancel'};
 const act=(tool:string)=>({tool,args:{},stage:'production' as const,trust:'trusted' as const,cost:0,proactive:false});
 assert.equal(intentChecked('green',cancel),true);assert.equal(intentChecked('green',add),false);assert.equal(intentChecked('orange',add),true);
 const none=ballot(act('reminders.cancel'),cancel,defaultPolicy,0);assert.equal(none.pattern,'green');assert.equal(none.outcome,'approval');
 const no=ballot(act('reminders.cancel'),cancel,defaultPolicy,0,{seat:'casper',vote:'reject',reason:'Not asked for.'});assert.equal(no.outcome,'reject');assert.match(no.reason,/^casper: Not asked for/);
 const yes=ballot(act('reminders.cancel'),cancel,defaultPolicy,0,{seat:'casper',vote:'approve',reason:'Asked for.',confidence:0.9});assert.equal(yes.outcome,'grant');
 assert.equal(ballot(act('reminders.add'),add,defaultPolicy,0).outcome,'grant','a Green add runs without Casper, as before');
});
