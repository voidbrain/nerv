import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Runtime,type ChatReply} from '../src/runtime.ts';
import {Store} from '../src/store.ts';
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function until(check:()=>boolean,ms=8000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw new Error('timed out');await wait(25);}}
const ADD='{"action":{"tool":"reminders.add","args":{"title":"Call Ada","due":"2030-01-15T09:00:00+01:00"}}}';
/** Misato answers from a script (recording each prompt); Casper always approves. reminders.add is Blue by the Scrolls. */
async function setup(script:string[]) {
 const prompts:{steps:{tool?:string;outcome:string;reason?:string;result?:unknown}[]}[]=[];
 const model=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',()=>{const r=JSON.parse(raw) as {messages:{content:string}[]};const casper=r.messages[0]!.content.startsWith('You are Casper');
  if(!casper)prompts.push(JSON.parse(r.messages.at(-1)!.content));
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:casper?'{"vote":"approve","reason":"Matches.","confidence":0.9}':(script.shift() ?? '{"reply":"done"}')},finish_reason:'stop'}]}));});});
 await new Promise<void>(done=>model.listen(0,'127.0.0.1',done));
 const home=mkdtempSync(join(tmpdir(),'nerv-resume-'));const db=join(home,'nerv.sqlite');
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:`http://127.0.0.1:${(model.address() as {port:number}).port}/v1`,model:'m'}}}));
 writeFileSync(join(home,'scrolls.json'),JSON.stringify({blue:['reminders.add']}),{mode:0o600});
 const runtimes:Runtime[]=[];
 const start=async()=>{const r=new Runtime(db,undefined,home);runtimes.push(r);await r.ready();r.startResumer(100);const follow:ChatReply[]=[];r.onResumed(x=>follow.push(x));return {r,follow};};
 return {prompts,home,db,start,close:async()=>{for(const r of runtimes)await r.close();await new Promise<void>(done=>model.close(()=>done()));rmSync(home,{recursive:true,force:true});}};
}
test('after the owner approves, Misato resumes with the outcome, replies once and the sortie closes',async()=>{
 const t=await setup([ADD,'{"reply":"Done: Ada is in your reminders."}']);
 try{
  const {r,follow}=await t.start();const chat=await r.chat('Remind me to call Ada');
  assert.equal(chat.waiting.length,1);assert.match(chat.reply!,/^Waiting for your approval: reminders\.add \(“Call Ada”\)\./);
  assert.equal((await r.events(chat.sortieId)).at(-1)!.kind,'misato.waiting','the sortie stays open while it waits');
  await r.decide(chat.waiting[0]!.approvalId,'approve','telegram');
  await until(()=>follow.length===1);
  assert.equal(follow[0]!.reply,'Done: Ada is in your reminders.');assert.equal(follow[0]!.sortieId,chat.sortieId);
  const resumed=t.prompts.at(-1)!.steps;assert.deepEqual(resumed.map(s=>[s.tool,s.outcome]),[['reminders.add','approval'],['reminders.add','grant']]);
  assert.match(resumed[1]!.reason!,/owner approved it; it ran/);assert.equal((resumed[1]!.result as {title:string}).title,'Call Ada');
  assert.equal((await r.list()).length,1);
  const kinds=(await r.events(chat.sortieId)).map(e=>e.kind);
  assert.deepEqual(kinds.slice(-4),['misato.resumed','misato.step','misato.reply','sortie.done']);
  await wait(400);assert.equal(follow.length,1,'one resume per wait');
 }finally{await t.close();}
});
test('a rejection resumes too, nothing runs; a decision made outside the service (CLI) is found by the sweep',async()=>{
 const t=await setup([ADD,'{"reply":"Understood, I did not add it."}',ADD,'{"reply":"Added now."}']);
 try{
  const {r,follow}=await t.start();
  const first=await r.chat('Remind me to call Ada');await r.decide(first.waiting[0]!.approvalId,'reject','api');
  await until(()=>follow.length===1);assert.equal(follow[0]!.reply,'Understood, I did not add it.');assert.equal((await r.list()).length,0);
  assert.match(t.prompts.at(-1)!.steps.at(-1)!.reason!,/did not approve it \(reject\); nothing ran/);
  const second=await r.chat('Remind me to call Ada');
  const cli=new Store(t.db);try{cli.decide(second.waiting[0]!.approvalId,'approve','cli');}finally{cli.close();}
  await until(()=>follow.length===2);assert.equal(follow[1]!.reply,'Added now.');assert.equal((await r.list()).length,1);
 }finally{await t.close();}
});
test('the resume lives in the ledger: decided while the service was down, it resumes after a restart',async()=>{
 const t=await setup([ADD,'{"reply":"Done after the restart."}']);
 try{
  const a=await t.start();const chat=await a.r.chat('Remind me to call Ada');await a.r.close();
  const cli=new Store(t.db);try{cli.decide(chat.waiting[0]!.approvalId,'approve','cli');}finally{cli.close();}
  const b=await t.start();await until(()=>b.follow.length===1);assert.equal(b.follow[0]!.reply,'Done after the restart.');
  const claimed=new Store(t.db);try{assert.equal(claimed.ledger.claimResume(chat.sortieId),null,'a claimed resume is never handed out twice');}finally{claimed.close();}
 }finally{await t.close();}
});
test('after the owner approves, an action proposed again is not run twice: the follow-up says it is done',async()=>{
 // Owner report 2026-11-05 (Tabgha, small model): the resumed loop re-proposed the approved action until the step limit.
 const t=await setup([ADD,ADD,ADD,ADD]);
 try{
  const {r,follow}=await t.start();const chat=await r.chat('Remind me to call Ada');
  await r.decide(chat.waiting[0]!.approvalId,'approve','telegram');
  await until(()=>follow.length===1);
  assert.equal(follow[0]!.reply,'Done: reminders.add (“Call Ada”).');assert.equal((await r.list()).length,1,'it ran once, at the approval');
 }finally{await t.close();}
});
