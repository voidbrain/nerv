import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {consultantAsk,misatoAsk,parseAdvice} from '../src/misato.ts';
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
/** A fake local model: the consultant gives `advice`, Casper approves, Misato follows its script; every Misato prompt is kept. */
async function fake(advice:string,script:string[]){
 const asked={consultant:0,misato:[] as string[],systems:[] as string[]};
 const s=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',()=>{const r=JSON.parse(raw) as {model:string;messages:{content:string}[]};const sys=r.messages[0]!.content;let out:string;
  if(sys.startsWith('You are a consultant')){asked.consultant++;out=advice;}
  else if(sys.startsWith('You are Casper'))out='{"vote":"approve","reason":"Matches.","confidence":0.9}';
  else{asked.misato.push(r.messages.at(-1)!.content);asked.systems.push(sys);out=script.shift() ?? '{"reply":"ok"}';}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({model:r.model,choices:[{message:{content:out},finish_reason:'stop'}]}));});});
 await new Promise<void>(d=>s.listen(0,'127.0.0.1',d));return {url:`http://127.0.0.1:${(s.address() as {port:number}).port}/v1`,asked,close:()=>new Promise<void>(d=>{s.close(()=>d());s.closeAllConnections();})};
}
async function runtimeWith(url:string,consultant:boolean,scrolls?:object){
 const {Runtime}=await import('../src/runtime.ts');const home=mkdtempSync(join(tmpdir(),'nerv-consult-'));
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:url,model:'m'},roles:{misato:{route:'local'},...(consultant?{consultant:{model:'advisor'}}:{})}}}));
 if(scrolls)writeFileSync(join(home,'scrolls.json'),JSON.stringify(scrolls),{mode:0o600});
 const r=new Runtime(join(home,'nerv.sqlite'),undefined,home);await r.ready();return {r,close:async()=>{await r.close();rmSync(home,{recursive:true,force:true});}};
}
test('the advice is plain text up to 600 characters, "none" is no advice, and it never goes to the cloud route',()=>{
 assert.equal(parseAdvice(' "Check the date first." '),'Check the date first.');assert.equal(parseAdvice('none'),undefined);assert.equal(parseAdvice('None.'),undefined);assert.equal(parseAdvice('x'.repeat(900))!.length,600);
 const ask=consultantAsk('Remind me tomorrow');assert.equal(ask.privacy,'local-only');assert.equal(ask.route,'local');
 const input={request:'Remind me',history:[],tools:[],now:'2030-01-01T08:00:00Z',timeZone:'Europe/Rome',advice:'Ask for the time.'};
 assert.equal(JSON.parse(misatoAsk(input,'local').prompt).advice,'Ask for the time.');assert.equal(JSON.parse(misatoAsk(input,'cloud').prompt).advice,undefined);
});
test('a consultant advises Misato once per request, before it plans: the advice is in Misato\'s prompt and in the trace, and a resume does not ask again',{timeout:30000},async()=>{
 const ADD='{"action":{"tool":"reminders.add","args":{"title":"Call Ada","due":"2031-01-01T09:00:00Z"}}}';
 const f=await fake('The owner wants a reminder; check the date is in the future.',[ADD,'{"reply":"Done: Ada tomorrow."}','{"reply":"Added after your approval."}']);
 const t=await runtimeWith(f.url,true,{blue:['reminders.add']});
 try{
  const chat=await t.r.chat('Remind me to call Ada');
  assert.equal(f.asked.consultant,1);assert.equal(JSON.parse(f.asked.misato[0]!).advice,'The owner wants a reminder; check the date is in the future.');
  const consult=(await t.r.events(chat.sortieId)).find(e=>e.kind==='misato.consult')!;assert.deepEqual(consult.payload,{advice:'The owner wants a reminder; check the date is in the future.',model:'advisor'});
  t.r.startResumer(100);await t.r.decide(chat.waiting[0]!.approvalId,'approve','api');await wait(800);
  assert.equal(f.asked.consultant,1,'no second consultation on the resume');
 }finally{await t.close();await f.close();}
});
test('no consultant set, or one with nothing to say: Misato plans without advice and nothing is recorded',{timeout:30000},async()=>{
 const f=await fake('none',['{"reply":"Hello."}','{"reply":"Hello again."}']);
 const off=await runtimeWith(f.url,false),on=await runtimeWith(f.url,true);
 try{
  const a=await off.r.chat('Hi');assert.equal(f.asked.consultant,0,'off: never asked');assert.equal(JSON.parse(f.asked.misato[0]!).advice,undefined);
  const b=await on.r.chat('Hi');assert.equal(f.asked.consultant,1);assert.equal(JSON.parse(f.asked.misato[1]!).advice,undefined,'"none" is no advice');
  for(const [r,id] of [[off.r,a.sortieId],[on.r,b.sortieId]] as const)assert.ok(!(await r.events(id)).some(e=>e.kind==='misato.consult'));
 }finally{await off.close();await on.close();await f.close();}
});
test('Misato is told the reply language outright, from the owner\'s message, also after an approval and after Italian exchanges (owner report 2026-11-05)',{timeout:30000},async()=>{
 const {requestLanguage}=await import('../src/misato.ts');
 assert.equal(requestLanguage('How is weather today?'),'en');assert.equal(requestLanguage('Remember I don’t like beer'),'en');assert.equal(requestLanguage('Ricordami di comprare il latte domani'),'it');
 const input={request:'x',history:[],tools:[],now:'2030-01-01T08:00:00Z',timeZone:'Europe/Rome'};
 assert.match(misatoAsk({...input,language:'en'},'local').system!,/Write the reply in English: the owner wrote in English\. Use it even when tool results, memory, advice or earlier exchanges are in another language\./);
 assert.match(misatoAsk({...input,language:'it'},'local').system!,/Write the reply in Italian/);
 const f=await fake('none',['{"reply":"Ciao."}','{"action":{"tool":"memory.remember","args":{"text":"I don\'t like beer"}}}','{"reply":"Saved."}']);
 const t=await runtimeWith(f.url,false);
 try{
  await t.r.chat('Ricordami cosa ho in programma oggi','telegram');
  const chat=await t.r.chat('Remember I don’t like beer','telegram');
  assert.match(f.asked.systems[0]!,/Write the reply in Italian/);assert.match(f.asked.systems[1]!,/Write the reply in English/,'English after an Italian exchange');
  t.r.startResumer(100);await t.r.decide(chat.waiting[0]!.approvalId,'approve','api');
  for(let i=0;i<60&&f.asked.systems.length<3;i++)await wait(50);
  assert.match(f.asked.systems[2]!,/Write the reply in English/,'the follow-up after the approval too');
 }finally{await t.close();await f.close();}
});
