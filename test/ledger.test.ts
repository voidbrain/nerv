import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';import {WebSocket} from 'ws';
import {Store} from '../src/store.ts';import {Ledger} from '../src/ledger.ts';import {makeServer} from '../src/server.ts';import type {StoreApi} from '../src/runtime.ts';
import {EVENT_SCHEMA_VERSION,MAX_EVENT_PAYLOAD_BYTES,encodePayload} from '../src/events.ts';
import {ballot,defaultPolicy,patternOf,validatePolicy,type Tool,type Verdict} from '../src/policy.ts';
const now=new Date('2030-01-01T00:00:00Z');const at=(ms:number)=>new Date(now.getTime()+ms);
const tools:Tool[]=[{name:'notes.read',effect:'read'},{name:'notes.write',effect:'write-local',inverse:'notes.restore'},{name:'mail.send',effect:'write-external'},{name:'repo.force-push',effect:'irreversible'},{name:'charger.start',effect:'physical'}];
const casper=(confidence=0.95):Verdict=>({seat:'casper',vote:'approve',reason:'Matches the request.',confidence});
function setup(options:ConstructorParameters<typeof Ledger>[1]={}) {const store=new Store(':memory:');return {store,ledger:new Ledger(store.db,{tools,...options})};}
test('Pattern follows the effect class, taint and the Scrolls; unregistered tools are Blue',()=>{
 assert.equal(patternOf('read','trusted','x',defaultPolicy),'green');assert.equal(patternOf('write-local','tainted','x',defaultPolicy),'green');
 assert.equal(patternOf('write-external','trusted','x',defaultPolicy),'orange');assert.equal(patternOf('write-external','tainted','x',defaultPolicy),'blue');
 assert.equal(patternOf('irreversible','trusted','x',defaultPolicy),'blue');assert.equal(patternOf('physical','trusted','x',defaultPolicy),'blue');
 assert.equal(patternOf('read','trusted','x',{...defaultPolicy,blue:['x']}),'blue');
 assert.equal(ballot({tool:'unknown',args:{},trust:'trusted',stage:'production',cost:0},undefined,defaultPolicy,0,casper()).pattern,'blue');
});
test('Green work is granted without a model seat; the grant binds the exact action once',()=>{
 const {store,ledger}=setup();
 try{
  const sortie=ledger.openSortie('cli','Read notes','trusted',now);
  const p=ledger.propose(sortie,{tool:'notes.read',args:{path:'a',limit:1},stage:'test'},now);
  assert.equal(p.ballot.outcome,'grant');assert.equal(p.ballot.verdicts.some(v=>v.seat==='casper'),false);assert.ok(p.grantId);
  assert.throws(()=>ledger.authorize(p.grantId!,'notes.read',{path:'b',limit:1},now),/differs/);
  ledger.authorize(p.grantId!,'notes.read',{limit:1,path:'a'},now);
  assert.throws(()=>ledger.authorize(p.grantId!,'notes.read',{path:'a',limit:1},now),/already used/);
  const late=ledger.propose(sortie,{tool:'notes.read',args:{},stage:'test'},now);
  assert.throws(()=>ledger.authorize(late.grantId!,'notes.read',{},at(61_000)),/expired/);
  assert.throws(()=>ledger.authorize('missing','notes.read',{},now),/unknown grant/);
  assert.deepEqual(ledger.events(sortie).map(e=>e.kind),['sortie.opened','ballot','grant.issued','grant.denied','grant.used','grant.denied','ballot','grant.issued','grant.denied']);
 }finally{store.close();}
});
test('Orange needs Casper and a Sync Ratio at threshold; Blue always reaches the owner',()=>{
 const {store,ledger}=setup();
 try{
  const sortie=ledger.openSortie('cli','Mail','trusted',now);
  assert.equal(ledger.propose(sortie,{tool:'mail.send',args:{to:'x'},stage:'production'},now).ballot.outcome,'approval');
  const low=ledger.propose(sortie,{tool:'mail.send',args:{to:'x'},stage:'test',casper:casper()},now);
  assert.equal(low.ballot.sync.value,73);assert.equal(low.ballot.outcome,'approval');assert.deepEqual(low.ballot.sync.inputs,{effect:0.9,stage:0.85,casper:0.95});
  const ok=ledger.propose(sortie,{tool:'mail.send',args:{to:'x'},stage:'production',casper:casper()},now);
  assert.equal(ok.ballot.sync.value,86);assert.equal(ok.ballot.outcome,'grant');
  const blue=ledger.propose(sortie,{tool:'repo.force-push',args:{},stage:'production',casper:casper(1)},now);
  assert.equal(blue.ballot.pattern,'blue');assert.equal(blue.ballot.outcome,'approval');assert.ok(blue.approvalId);
 }finally{store.close();}
});
test('extra seats are veto-only and shadow seats never count',()=>{
 const action={tool:'mail.send',args:{},trust:'trusted' as const,stage:'production' as const,cost:0};const tool=tools[2];
 assert.equal(ballot(action,tool,defaultPolicy,0,casper(),[{seat:'tests',vote:'approve',reason:'ok',confidence:1}]).sync.value,86);
 assert.equal(ballot(action,tool,defaultPolicy,0,casper(),[{seat:'tests',vote:'reject',reason:'failing test'}]).outcome,'reject');
 assert.equal(ballot(action,tool,defaultPolicy,0,casper(),[{seat:'expert',vote:'reject',reason:'no',shadow:true}]).outcome,'grant');
 assert.equal(ballot(action,tool,defaultPolicy,0,{seat:'casper',vote:'reject',reason:'Not what was asked.'}).outcome,'reject');
});
test('rejects return to the planner, then escalate to the owner after the limit',()=>{
 const {store,ledger}=setup({policy:{...defaultPolicy,deny:['mail.send'],maxRejects:2}});
 try{
  const sortie=ledger.openSortie('cli','Mail','trusted',now);const outcomes=[1,2,3].map(()=>ledger.propose(sortie,{tool:'mail.send',args:{},stage:'production',casper:casper()},now).ballot.outcome);
  assert.deepEqual(outcomes,['reject','reject','approval']);
 }finally{store.close();}
});
test('Balthasar enforces the battery and keeps shadow pilots and proactive work in EVA-00',()=>{
 const {store,ledger}=setup({policy:{...defaultPolicy,budget:0.05}});
 try{
  const sortie=ledger.openSortie('cli','Budget','trusted',now);
  assert.equal(ledger.propose(sortie,{tool:'notes.read',args:{},stage:'test',cost:0.04},now).ballot.outcome,'grant');
  assert.match(ledger.propose(sortie,{tool:'notes.read',args:{},stage:'test',cost:0.02},now).ballot.reason,/Battery/);
  const shadow=ballot({tool:'mail.send',args:{},trust:'trusted',stage:'prototype',cost:0},tools[2],defaultPolicy,0,casper());
  assert.equal(shadow.executor,'eva-00');assert.equal(shadow.outcome,'reject');
  const proactive=ballot({tool:'mail.send',args:{},trust:'trusted',stage:'test',cost:0,proactive:true},tools[2],defaultPolicy,0,casper());
  assert.equal(proactive.outcome,'reject');
  assert.equal(ballot({tool:'notes.read',args:{},trust:'tainted',stage:'production',cost:0},tools[0],defaultPolicy,0).executor,'eva-03');
 }finally{store.close();}
});
test('approval decisions apply once, expiry never approves and pending cards survive restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nerv-'));const path=join(dir,'db');
 try{
  let store=new Store(path);let ledger=new Ledger(store.db,{tools});
  const sortie=ledger.openSortie('telegram','Email from a stranger','tainted',now);
  const first=ledger.propose(sortie,{tool:'mail.send',args:{to:'x'},stage:'production',casper:casper()},now);
  const second=ledger.propose(sortie,{tool:'mail.send',args:{to:'y'},stage:'production',casper:casper()},now);
  const third=ledger.propose(sortie,{tool:'mail.send',args:{to:'z'},stage:'production',casper:casper()},now);
  assert.equal(first.ballot.pattern,'blue');assert.equal(ledger.pendingApprovals(now).length,3);
  const card=ledger.pendingApprovals(now)[0]!.card;assert.deepEqual(card.args,{to:'x'});assert.equal(card.pattern,'blue');assert.ok(card.reason);
  store.close();store=new Store(path);ledger=new Ledger(store.db,{tools});
  const approved=ledger.decide(first.approvalId!,'approve','cli',now);assert.equal(approved.decision,'approve');assert.ok(approved.grantId);
  const events=ledger.events(sortie).length;
  assert.deepEqual(ledger.decide(first.approvalId!,'reject','cli',now),approved);assert.equal(ledger.events(sortie).length,events);
  assert.equal(ledger.decide(second.approvalId!,'approve','cli',at(3_600_000)).decision,'expired');
  assert.equal(ledger.expire(at(3_600_000)),1);assert.equal(ledger.decide(third.approvalId!,'approve','cli',at(3_600_001)).decision,'expired');
  assert.equal(ledger.pendingApprovals(now).length,0);
  store.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('the Spear revokes unused grants, stands down approvals and reports effects that happened',()=>{
 const {store,ledger}=setup();
 try{
  const sortie=ledger.openSortie('cli','Edit notes','trusted',now);
  const used=ledger.propose(sortie,{tool:'notes.write',args:{text:'a'},stage:'test'},now);ledger.authorize(used.grantId!,'notes.write',{text:'a'},now);
  const unused=ledger.propose(sortie,{tool:'notes.write',args:{text:'b'},stage:'test'},now);
  ledger.propose(sortie,{tool:'repo.force-push',args:{},stage:'production',casper:casper()},now);
  const result=ledger.spear(sortie,'owner stop',now);
  assert.equal(result.revoked,1);assert.equal(result.stoodDown,1);assert.deepEqual(result.happened,[{actionId:used.actionId,tool:'notes.write',inverse:'notes.restore'}]);
  assert.throws(()=>ledger.authorize(unused.grantId!,'notes.write',{text:'b'},now),/revoked/);
  assert.throws(()=>ledger.propose(sortie,{tool:'notes.read',args:{},stage:'test'},now),/not open/);
 }finally{store.close();}
});
test('events are append-only and invalid input is rejected',()=>{
 const {store,ledger}=setup();
 try{
  const sortie=ledger.openSortie('cli','x','trusted',now);
  assert.throws(()=>store.db.prepare("UPDATE events SET kind='x'").run(),/append-only/);assert.throws(()=>store.db.prepare('DELETE FROM events').run(),/append-only/);
  assert.throws(()=>ledger.openSortie('cli','x','unknown' as 'trusted',now));assert.throws(()=>ledger.propose(sortie,{tool:'notes.read',args:[] as unknown as Record<string,unknown>,stage:'test'},now));
  assert.throws(()=>ledger.propose(sortie,{tool:'notes.read',args:{blob:'x'.repeat(20_000)},stage:'test'},now));
  assert.throws(()=>validatePolicy({budget:1,typo:true}));assert.throws(()=>validatePolicy({syncThreshold:120}));assert.equal(validatePolicy({budget:2}).syncThreshold,80);
 }finally{store.close();}
});
test('an existing version 1 database gains the ledger without losing reminders',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nerv-'));const path=join(dir,'db');
 try{
  const old=new DatabaseSync(path);old.exec(`CREATE TABLE reminders(id TEXT PRIMARY KEY, title TEXT NOT NULL, due TEXT NOT NULL, created TEXT NOT NULL, delivered TEXT, cancelled TEXT);CREATE TABLE deliveries(id TEXT PRIMARY KEY, reminder_id TEXT NOT NULL UNIQUE REFERENCES reminders(id), message TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT);INSERT INTO reminders VALUES('r','Insurance','2030-01-01T01:00:00.000Z','2029-12-31T00:00:00.000Z',NULL,NULL);PRAGMA user_version=1;`);old.close();
  const store=new Store(path);
  try{assert.equal(store.list().length,1);assert.equal((store.db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version,3);new Ledger(store.db).openSortie('cli','x','trusted',now);}finally{store.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('the scheduler process stands down expired approvals on its own ticks',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nerv-'));const path=join(dir,'db');
 const store=new Store(path);const ledger=new Ledger(store.db,{tools,approvalTtlMs:300});
 const sortie=ledger.openSortie('cli','Force push','trusted');const {approvalId}=ledger.propose(sortie,{tool:'repo.force-push',args:{},stage:'production'});
 const {Runtime}=await import('../src/runtime.ts');const runtime=new Runtime(path);
 try{await runtime.ready();await new Promise(done=>setTimeout(done,900));assert.equal(ledger.pendingApprovals().length,0);assert.equal(ledger.events(sortie).at(-1)?.kind,'approval.expired');assert.equal(ledger.decide(approvalId!,'approve','cli').decision,'expired');}
 finally{await runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
async function serve(store:StoreApi,work:(host:string,headers:Record<string,string>)=>Promise<void>) {
 const token='a'.repeat(32);const server=makeServer(store,token);await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const addr=server.address();assert.ok(addr&&typeof addr==='object');
 try{await work(`127.0.0.1:${addr.port}`,{Authorization:'Bearer '+token,'Content-Type':'application/json'});}finally{await new Promise<void>(done=>server.close(()=>done()));}
}
test('REST lists approval cards and applies a decision once without exposing the grant',async()=>{
 const store=new Store(':memory:');const ledger=new Ledger(store.db,{tools});
 const sortie=ledger.openSortie('cli','Force push','trusted');const {approvalId}=ledger.propose(sortie,{tool:'repo.force-push',args:{branch:'main'},stage:'production'});
 try{await serve(store,async(host,headers)=>{
  const base='http://'+host;
  assert.equal((await fetch(base+'/api/approvals')).status,401);
  const cards=await (await fetch(base+'/api/approvals',{headers})).json() as {id:string;card:{args:unknown;pattern:string}}[];
  assert.equal(cards.length,1);assert.equal(cards[0]!.id,approvalId);assert.deepEqual(cards[0]!.card.args,{branch:'main'});assert.equal(cards[0]!.card.pattern,'blue');
  assert.equal((await fetch(base+'/api/approvals?limit=9',{headers})).status,400);assert.equal((await fetch(base+'/api/approvals?x=1',{headers})).status,400);
  const decide=(decision:string)=>fetch(base+'/api/approvals/'+approvalId,{method:'POST',headers,body:JSON.stringify({decision})});
  assert.equal((await decide('yolo')).status,400);
  assert.deepEqual(await (await decide('approve')).json(),{decision:'approve'});assert.deepEqual(await (await decide('reject')).json(),{decision:'approve'});
  const events=await (await fetch(base+`/api/sorties/${sortie}/events?after=0&limit=50`,{headers})).json() as {kind:string}[];
  assert.deepEqual(events.map(e=>e.kind),['sortie.opened','ballot','approval.requested','approval.approve','grant.issued']);
  assert.ok(!JSON.stringify(events).includes('grantId'),'grant IDs never leave the scheduler process');
  assert.equal((await fetch(base+`/api/sorties/${sortie}/events?limit=500`,{headers})).status,400);
 });}finally{store.close();}
});
test('decisions travel through the scheduler process; the socket can read cards but never decide',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nerv-'));const path=join(dir,'db');
 const store=new Store(path);const ledger=new Ledger(store.db,{tools});
 const sortie=ledger.openSortie('cli','Mail','trusted');const {approvalId}=ledger.propose(sortie,{tool:'mail.send',args:{to:'x'},stage:'production'});
 const {Runtime}=await import('../src/runtime.ts');const runtime=new Runtime(path);let client:WebSocket|undefined;
 try{await runtime.ready();await serve(runtime,async(host,headers)=>{
  client=new WebSocket(`ws://${host}/rpc`,{headers:{Authorization:headers.Authorization!}});client.on('error',()=>{});await once(client,'open');
  const rpc=async(method:string,params:object)=>{const message=once(client!,'message');client!.send(JSON.stringify({jsonrpc:'2.0',id:method,method,params}));return JSON.parse((await message)[0].toString());};
  assert.equal((await rpc('approvals.pending',{})).result[0].id,approvalId);
  assert.equal((await rpc('approvals.decide',{id:approvalId,decision:'approve',source:'api'})).error.code,-32003);
  assert.deepEqual(await (await fetch(`http://${host}/api/approvals/${approvalId}`,{method:'POST',headers,body:JSON.stringify({decision:'reject'})})).json(),{decision:'reject'});
  assert.equal(ledger.events(sortie).at(-1)?.kind,'approval.reject');assert.equal((await rpc('events.page',{sortieId:sortie})).result.length,4);
  const closed=once(client,'close');client.close();await closed;
 });}finally{await runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('every event records its schema version; a schema 2 database upgrades and its old events read as version 1',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nerv-'));const path=join(dir,'db');
 try{
  const old=new DatabaseSync(path);old.exec(`CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, sortie_id TEXT NOT NULL, action_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL);CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;INSERT INTO events(sortie_id,action_id,kind,payload,created) VALUES('s',NULL,'sortie.opened','{"source":"cli","title":"Old","trust":"trusted"}','2029-12-31T00:00:00.000Z');INSERT INTO events(sortie_id,action_id,kind,payload,created) VALUES('s','a','grant.used','{"grantId":"secret-grant"}','2029-12-31T00:00:01.000Z');PRAGMA user_version=2;`);old.close();
  const store=new Store(path);
  try{
   assert.equal((store.db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version,3);
   assert.deepEqual(store.ledger.events('s').map(e=>[e.v,e.kind]),[[1,'sortie.opened'],[1,'grant.used']]);
   assert.deepEqual(store.ledger.events('s')[1]!.payload,{},'version 1 grant IDs are removed on read');assert.equal(EVENT_SCHEMA_VERSION,2);
   const sortie=store.ledger.openSortie('cli','New','trusted',now);assert.equal(store.ledger.events(sortie)[0]!.v,EVENT_SCHEMA_VERSION);
   assert.throws(()=>store.db.prepare('UPDATE events SET v=2').run(),/append-only/);
  }finally{store.close();}
  const again=new Store(path);try{assert.equal(again.ledger.events('s').length,2);}finally{again.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('event payloads are bounded: unknown kinds and oversized payloads are refused, model reasons and the Spear list are cut',()=>{
 assert.throws(()=>encodePayload('made.up' as 'sortie.done',{}),/Unknown event kind/);
 assert.throws(()=>encodePayload('grant.denied',{reason:'x'.repeat(MAX_EVENT_PAYLOAD_BYTES)}),/too large/);
 const {store,ledger}=setup({policy:{...defaultPolicy,budget:1000}});
 try{
  const sortie=ledger.openSortie('cli','Bounded','trusted',now);
  ledger.propose(sortie,{tool:'mail.send',args:{to:'x'},stage:'production',casper:{...casper(),reason:'y'.repeat(5000)}},now);
  const ballotEvent=ledger.events(sortie).find(e=>e.kind==='ballot');assert.ok(ballotEvent&&ballotEvent.kind==='ballot');
  assert.equal(ballotEvent.payload.verdicts.find(v=>v.seat==='casper')!.reason.length,500);
  for(let i=0;i<55;i++){const p=ledger.propose(sortie,{tool:'notes.read',args:{i},stage:'test'},now);ledger.authorize(p.grantId!,'notes.read',{i},now);}
  const result=ledger.spear(sortie,'stop',now);assert.equal(result.happened.length,55);
  let last=0,spear;for(;;){const page=ledger.events(sortie,last);if(!page.length)break;last=page.at(-1)!.sequence;spear=page.find(e=>e.kind==='spear')??spear;}
  assert.ok(spear&&spear.kind==='spear');assert.equal(spear.payload.happenedCount,55);assert.equal(spear.payload.happened.length,50);
 }finally{store.close();}
});
test('event pages fit one scheduler frame and page on to the end, through the scheduler process',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nerv-'));const path=join(dir,'db');
 const store=new Store(path);const ledger=new Ledger(store.db,{tools});
 const sortie=ledger.openSortie('cli','Long reasons','trusted');
 const extras=Array.from({length:12},(_,i)=>({seat:'seat'+i,vote:'approve' as const,reason:'z'.repeat(500)}));
 for(let i=0;i<60;i++)ledger.propose(sortie,{tool:'notes.read',args:{i},stage:'test',extras});
 const {Runtime}=await import('../src/runtime.ts');const runtime=new Runtime(path);
 try{
  await runtime.ready();let after=0,pages=0;const kinds:string[]=[];
  for(;;){const page=await runtime.events(sortie,after,50);if(!page.length)break;pages++;after=page.at(-1)!.sequence;kinds.push(...page.map(e=>e.kind));assert.ok(page.every(e=>e.v===EVENT_SCHEMA_VERSION));}
  assert.deepEqual(kinds,['sortie.opened',...Array.from({length:60},()=>['ballot','grant.issued']).flat()]);assert.ok(pages>3);
 }finally{await runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
test('the Scrolls load from scrolls.json; an invalid or tamperable file stops startup instead of relaxing the gate',async()=>{
 const {readScrolls}=await import('../src/config.ts');const {chmodSync,writeFileSync}=await import('node:fs');
 const home=mkdtempSync(join(tmpdir(),'nerv-scrolls-'));const file=join(home,'scrolls.json');
 const cli=(...args:string[])=>spawnSync(process.execPath,['src/cli.ts',...args],{env:{...process.env,NERV_HOME:home},encoding:'utf8'});
 try{
  assert.deepEqual(readScrolls(home),{policy:defaultPolicy,source:'default'});
  writeFileSync(file,JSON.stringify({deny:['mail.send'],syncThreshold:90}),{mode:0o600});chmodSync(file,0o600);
  const loaded=readScrolls(home);assert.equal(loaded.source,'scrolls.json');assert.deepEqual(loaded.policy.deny,['mail.send']);assert.equal(loaded.policy.syncThreshold,90);
  const store=new Store(':memory:',loaded);const ledger=new Ledger(store.db,{tools,policy:loaded.policy});
  try{const sortie=ledger.openSortie('cli','Mail','trusted',now);assert.equal(ledger.propose(sortie,{tool:'mail.send',args:{},stage:'production',casper:casper()},now).ballot.outcome,'reject');assert.equal((store.doctor() as {policy:{source:string}}).policy.source,'scrolls.json');}finally{store.close();}
  // Through the scheduler process: the data home reaches the nervous process and its ledger reports the file's rules.
  const {Runtime}=await import('../src/runtime.ts');const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);
  try{await runtime.ready();const doctor=await runtime.nervous.call('runtime.doctor') as {policy:{source:string;deny:string[]}};assert.equal(doctor.policy.source,'scrolls.json');assert.deepEqual(doctor.policy.deny,['mail.send']);}finally{await runtime.close();}
  for(const [content,message] of [['{"budget":1,"typo":true}',/Invalid scrolls.json: Invalid policy/],['not json',/not JSON/],['{"syncThreshold":120}',/Invalid policy values/]] as const){
   writeFileSync(file,content);assert.throws(()=>readScrolls(home),message);
   const run=cli('doctor');assert.equal(run.status,1);assert.match(run.stderr,message);
  }
  writeFileSync(file,'{}');chmodSync(file,0o666);assert.throws(()=>readScrolls(home),/writable by others/);
 }finally{rmSync(home,{recursive:true,force:true});}
});
