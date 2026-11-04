import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store,OWNER_SOURCE} from '../src/store.ts';
import {ftsQuery} from '../src/memory.ts';
import {misatoAsk} from '../src/misato.ts';
import {toolDocs} from '../src/executors.ts';
import {Runtime} from '../src/runtime.ts';
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function until(check:()=>boolean,ms=8000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw new Error('timed out');await wait(25);}}
test('Lilith keeps facts with provenance: duplicates merge, recall ranks by keywords, edits and forgets keep an append-only history',()=>{
 const store=new Store(':memory:');const m=store.memory;
 try{
  const dentist=m.add('My dentist is Dr. Rossi in Treviso','owner');assert.equal(m.add('my dentist is dr. rossi in treviso','owner').id,dentist.id,'the same fact is stored once');
  m.add('I prefer replies in Italian','owner');m.add('Ada is my sister','owner');
  assert.deepEqual(m.recall('who is my dentist?').map(f=>f.text),['My dentist is Dr. Rossi in Treviso']);
  for(const hostile of ['"','*','NEAR(a b)','dentist" OR 1','-',''])assert.doesNotThrow(()=>m.recall(hostile),hostile);
  assert.equal(ftsQuery('?? !!'),undefined);assert.equal(ftsQuery('Dentist dentist "Rossi"'),'"dentist" OR "rossi"');
  m.edit(dentist.id,'My dentist is Dr. Bianchi','owner');assert.deepEqual(m.recall('dentist').map(f=>f.text),['My dentist is Dr. Bianchi']);assert.deepEqual(m.recall('Rossi'),[]);
  assert.equal(m.forget(dentist.id,'owner'),true);assert.deepEqual(m.recall('dentist'),[]);assert.equal(m.list().length,2);assert.equal(m.forget(dentist.id,'owner'),false);
  assert.deepEqual(m.historyOf(dentist.id).map(h=>h.kind),['created','edited','forgotten']);
  assert.throws(()=>store.db.prepare("UPDATE fact_history SET text='x'").run(),/append-only/);assert.throws(()=>store.db.prepare('DELETE FROM fact_history').run(),/append-only/);
  assert.throws(()=>m.add('x'.repeat(501),'owner'),/1–500/);assert.throws(()=>m.add('  ','owner'));
 }finally{store.close();}
});
test('memory.remember always reaches the owner, even with no Scrolls; recall is Green; an approval stores the fact with its sortie',()=>{
 const store=new Store(':memory:');
 try{
  const s=store.ledger.openSortie(OWNER_SOURCE,'Remember','trusted');
  const r=store.runAction(s,{tool:'memory.remember',args:{text:'Ada is my sister'},stage:'production'});
  assert.equal(r.pattern,'blue');assert.equal(r.outcome,'approval');assert.equal(store.memory.list().length,0,'nothing is stored before the owner approves');
  const decided=store.decide(r.approvalId!,'approve','telegram');assert.equal((decided.result as {text:string}).text,'Ada is my sister');
  const f=store.memory.list()[0]!;assert.equal(f.source,'misato');assert.equal(f.sortieId,s);
  const q=store.runAction(store.ledger.openSortie(OWNER_SOURCE,'Who','trusted'),{tool:'memory.recall',args:{query:'sister'},stage:'production'});
  assert.equal(q.pattern,'green');assert.deepEqual((q.result as {text:string}[]).map(x=>x.text),['Ada is my sister']);
 }finally{store.close();}
});
test('local-only facts never reach the cloud route; tainted facts keep their mark',()=>{
 const memory=[{id:'a',text:'Private: my PIN hint',shareable:false,tainted:false},{id:'b',text:'I like short replies',shareable:true,tainted:false},{id:'c',text:'From a web page',shareable:false,tainted:true}];
 const base={request:'x',history:[],tools:toolDocs,now:'n',timeZone:'Europe/Rome',memory};
 assert.deepEqual(JSON.parse(misatoAsk(base,'local').prompt).memory,[{id:'a',text:'Private: my PIN hint'},{id:'b',text:'I like short replies'},{id:'c',text:'From a web page',tainted:true}]);
 assert.deepEqual(JSON.parse(misatoAsk(base,'cloud').prompt).memory,[{id:'b',text:'I like short replies'}]);
});
test('through every process: Misato proposes a fact, the owner approves, and the next request recalls it',async()=>{
 const prompts:{memory?:{text:string}[];request:string}[]=[];const script=['{"action":{"tool":"memory.remember","args":{"text":"My dentist is Dr. Rossi"}}}','{"reply":"I asked you to confirm that."}','{"reply":"Done, I will remember it."}','{"reply":"Your dentist is Dr. Rossi."}'];
 const model=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',()=>{const r=JSON.parse(raw) as {messages:{content:string}[]};const casper=r.messages[0]!.content.startsWith('You are Casper');if(!casper)prompts.push(JSON.parse(r.messages.at(-1)!.content));
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:casper?'{"vote":"approve","reason":"Matches.","confidence":0.9}':(script.shift() ?? '{"reply":"ok"}')},finish_reason:'stop'}]}));});});
 await new Promise<void>(done=>model.listen(0,'127.0.0.1',done));const home=mkdtempSync(join(tmpdir(),'nerv-lilith-'));
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:`http://127.0.0.1:${(model.address() as {port:number}).port}/v1`,model:'m'}}}));
 const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);
 try{
  await runtime.ready();runtime.startResumer(100);const follow:unknown[]=[];runtime.onResumed(x=>follow.push(x));
  const first=await runtime.chat('Remember that my dentist is Dr. Rossi','cli');assert.equal(first.waiting.length,1);assert.equal(first.waiting[0]!.tool,'memory.remember');
  await runtime.decide(first.waiting[0]!.approvalId,'approve','api');await until(()=>follow.length===1);
  await runtime.chat('Who is my dentist?','dashboard');
  assert.deepEqual(prompts.at(-1)!.memory!.map(f=>f.text),['My dentist is Dr. Rossi'],'the confirmed fact reaches the next request, in another conversation');
 }finally{await runtime.close();await new Promise<void>(done=>model.close(()=>done()));rmSync(home,{recursive:true,force:true});}
});
test('nerv memory: add, list, edit, history and forget from the CLI',()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-memcli-'));const run=(...a:string[])=>spawnSync(process.execPath,['src/cli.ts','memory',...a],{env:{...process.env,NERV_HOME:home},encoding:'utf8'});
 try{
  const added=run('add','I','drink','coffee','at','8');assert.equal(added.status,0,added.stderr);const id=/Remembered ([a-f0-9]{8})/.exec(added.stdout)![1]!;
  assert.match(run('list').stdout,/I drink coffee at 8 {2}\(owner\)/);
  assert.match(run('edit',id,'I drink tea at 8').stdout,/Updated .*tea/);
  assert.match(run('history',id).stdout,/created .*coffee[\s\S]*edited .*tea/);
  assert.match(run('forget',id).stdout,/Forgot/);assert.match(run('list').stdout,/No facts yet/);
  assert.match(run('forget','zzzz').stderr,/No active fact/);
 }finally{rmSync(home,{recursive:true,force:true});}
});
