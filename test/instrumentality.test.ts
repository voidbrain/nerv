import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {digestAsk,factLimit,parseDigest} from '../src/instrumentality.ts';
import {OWNER_SOURCE} from '../src/store.ts';
import {Runtime} from '../src/runtime.ts';
import {Store} from '../src/store.ts';
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
test('the digest prompt asks only for facts the owner stated, in the configured language; the reply is read strictly',()=>{
 const ask=digestAsk([{request:'Ricordami il dentista',reply:'Fatto.'}],'it','local');
 assert.equal(ask.privacy,'local-only');assert.match(ask.system!,/in Italian/);assert.match(ask.system!,/the OWNER stated/);assert.match(ask.system!,/Never infer/);
 assert.deepEqual(JSON.parse(ask.prompt),{exchanges:[{request:'Ricordami il dentista',reply:'Fatto.'}]});
 assert.deepEqual(parseDigest('ok {"summary":" A day. ","facts":["Ada is my sister","Ada is my sister","x",7]}'),{summary:'A day.',facts:['Ada is my sister']});
 assert.deepEqual(parseDigest('{"summary":"Quiet."}'),{summary:'Quiet.',facts:[]});
 for(const bad of ['nothing','{"facts":["a fact"]}','{"summary":"","facts":[]}','{"summary":"s","facts":"no"}'])assert.equal(parseDigest(bad),undefined,bad);
 assert.equal(parseDigest(`{"summary":"s","facts":${JSON.stringify(Array.from({length:12},(_,i)=>'fact number '+i))}}`,4)!.facts.length,4);
 assert.deepEqual([0,2,6,7,40].map(factLimit),[3,3,3,4,10],'about one per two exchanges, between 3 and 10');
 assert.match(digestAsk(Array.from({length:14},()=>({request:'x'})),'en','local').system!,/At most 7 facts/);
});
async function setup(misato:string[],digest:string) {
 const asked:string[]=[];
 const model=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',()=>{const r=JSON.parse(raw) as {messages:{content:string}[]};const sys=r.messages[0]!.content;
  const who=sys.startsWith('You are Casper')?'casper':sys.startsWith('You consolidate')?'digest':'misato';asked.push(who);
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:who==='digest'?digest:who==='casper'?'{"vote":"approve","reason":"ok","confidence":0.9}':(misato.shift() ?? '{"reply":"ok"}')},finish_reason:'stop'}]}));});});
 await new Promise<void>(done=>model.listen(0,'127.0.0.1',done));const home=mkdtempSync(join(tmpdir(),'nerv-instr-'));
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:`http://127.0.0.1:${(model.address() as {port:number}).port}/v1`,model:'m'}}}));
 const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);await runtime.ready();
 return {asked,home,runtime,close:async()=>{await runtime.close();await new Promise<void>(done=>model.close(()=>done()));rmSync(home,{recursive:true,force:true});}};
}
test('through every process: the day\'s exchanges become a summary and cards for new facts only; approving stores them; the ledger is untouched',async()=>{
 const t=await setup(['{"reply":"Noted the dentist."}','{"reply":"Coffee at 8, ok."}'],'{"summary":"The owner talked about the dentist and coffee.","facts":["My dentist is Dr. Rossi","I drink coffee at 8"]}');
 try{
  const seeded=new Store(join(t.home,'nerv.sqlite'));try{seeded.memory.add('I drink coffee at 8','owner');}finally{seeded.close();}
  await t.runtime.chat('My dentist is Dr. Rossi','telegram:1');await t.runtime.chat('I drink coffee at 8','cli');
  const before=(await t.runtime.sorties(50)).length;
  const r=await t.runtime.consolidate!();
  assert.deepEqual({exchanges:r.exchanges,proposed:r.proposed,skipped:r.skipped},{exchanges:2,proposed:1,skipped:1});assert.match(r.summary!,/dentist and coffee/);
  assert.equal(t.asked.filter(a=>a==='casper').length,0,'Casper is not asked about Instrumentality proposals');
  const cards=await t.runtime.approvals();assert.deepEqual(cards.map(c=>[c.card.tool,c.card.args]),[['memory.remember',{text:'My dentist is Dr. Rossi'}]]);
  assert.equal((await t.runtime.sorties(50)).length,before+1,'one Instrumentality sortie; nothing else in the ledger changes');
  const again=await t.runtime.consolidate!();assert.deepEqual({exchanges:again.exchanges,proposed:again.proposed},{exchanges:0,proposed:0},'the next run starts where the last ended');
  await t.runtime.decide(cards[0]!.id,'approve','telegram');
  const store=new Store(join(t.home,'nerv.sqlite'));
  try{
   assert.deepEqual(store.memory.list().map(f=>f.text).sort(),['I drink coffee at 8','My dentist is Dr. Rossi']);
   assert.equal(store.memory.episodes().length,2);
   const sortie=(await t.runtime.sorties(50)).find(s=>s.source==='instrumentality')!;assert.equal(sortie.status,'done','closed once every card is decided');
  }finally{store.close();}
 }finally{await t.close();}
});
test('Instrumentality runs once a local day at its time, and a failed digest is not retried in a loop',async()=>{
 const t=await setup(['{"reply":"ok"}'],'not json');
 try{
  await t.runtime.chat('hello','cli');
  t.runtime.startInstrumentality(()=>({mode:{at:'00:00'},timeZone:'Europe/Rome'}),50);await wait(400);
  assert.equal(t.asked.filter(a=>a==='digest').length,2,'one attempt today (with one retry of an unreadable reply), even though it failed');
  const store=new Store(join(t.home,'nerv.sqlite'));try{assert.equal(store.memory.episodes().length,0,'a failed digest saves no episode');}finally{store.close();}
 }finally{await t.close();}
});
test('idle mode: consolidates after an hour without requests, at most once in 20 hours, only when there is something new',async()=>{
 const t=await setup([],'{"summary":"Quiet day.","facts":[]}');
 try{
  const store=new Store(join(t.home,'nerv.sqlite'));
  try{const s=store.ledger.openSortie('misato','old','trusted');store.ledger.note(s,'misato.request',{text:'I like tea'},new Date(Date.now()-2*3_600_000));}finally{store.close();}
  t.runtime.startInstrumentality(()=>({mode:{when:'idle'},timeZone:'Europe/Rome'}),50);
  // Until it happened (a fixed 300 ms failed under a loaded full run), then a settle time for a wrong second one.
  for(let i=0;i<100&&!t.asked.includes('digest');i++)await wait(50);await wait(300);
  assert.equal(t.asked.filter(a=>a==='digest').length,1,'idle for two hours: one consolidation');
  const again=new Store(join(t.home,'nerv.sqlite'));
  try{const s=again.ledger.openSortie('misato','new','trusted');again.ledger.note(s,'misato.request',{text:'I like coffee'},new Date(Date.now()-2*3_600_000+60_000));assert.equal(again.memory.episodes().length,1);}finally{again.close();}
  await wait(300);assert.equal(t.asked.filter(a=>a==='digest').length,1,'not again within 20 hours of the last episode');
  void OWNER_SOURCE;
 }finally{await t.close();}
});
