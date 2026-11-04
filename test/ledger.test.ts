import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.ts';import {Ledger} from '../src/ledger.ts';
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
 const dir=mkdtempSync(join(tmpdir(),'nodo-'));const path=join(dir,'db');
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
 const dir=mkdtempSync(join(tmpdir(),'nodo-'));const path=join(dir,'db');
 try{
  const old=new DatabaseSync(path);old.exec(`CREATE TABLE reminders(id TEXT PRIMARY KEY, title TEXT NOT NULL, due TEXT NOT NULL, created TEXT NOT NULL, delivered TEXT, cancelled TEXT);CREATE TABLE deliveries(id TEXT PRIMARY KEY, reminder_id TEXT NOT NULL UNIQUE REFERENCES reminders(id), message TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT);INSERT INTO reminders VALUES('r','Insurance','2030-01-01T01:00:00.000Z','2029-12-31T00:00:00.000Z',NULL,NULL);PRAGMA user_version=1;`);old.close();
  const store=new Store(path);
  try{assert.equal(store.list().length,1);assert.equal((store.db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version,2);new Ledger(store.db).openSortie('cli','x','trusted',now);}finally{store.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('the scheduler process stands down expired approvals on its own ticks',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nodo-'));const path=join(dir,'db');
 const store=new Store(path);const ledger=new Ledger(store.db,{tools,approvalTtlMs:300});
 const sortie=ledger.openSortie('cli','Force push','trusted');const {approvalId}=ledger.propose(sortie,{tool:'repo.force-push',args:{},stage:'production'});
 const {Runtime}=await import('../src/runtime.ts');const runtime=new Runtime(path);
 try{await runtime.ready();await new Promise(done=>setTimeout(done,900));assert.equal(ledger.pendingApprovals().length,0);assert.equal(ledger.events(sortie).at(-1)?.kind,'approval.expired');assert.equal(ledger.decide(approvalId!,'approve','cli').decision,'expired');}
 finally{await runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
