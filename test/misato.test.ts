import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {misatoAsk,parsePlan,MAX_STEPS} from '../src/misato.ts';
import {toolDocs} from '../src/executors.ts';
import {Runtime} from '../src/runtime.ts';
import {makeServer} from '../src/server.ts';
test('Misato is asked for one JSON step with the tools, the time and the latest steps; its reply is read strictly',()=>{
 const ask=misatoAsk({request:'Ricordami di chiamare Ada',history:[{tool:'reminders.list',args:{},outcome:'grant',result:[]}],tools:toolDocs,now:'2030-01-01T08:00:00.000Z',timeZone:'Europe/Rome'},'local');
 assert.equal(ask.privacy,'local-only');assert.equal(ask.route,'local');
 assert.match(ask.system!,/Now: 2030-01-01T08:00:00.000Z\. The owner's time zone: Europe\/Rome/);assert.match(ask.system!,/reminders\.add \(write-local\)/);assert.match(ask.system!,/same language as the "request" field/);assert.match(ask.system!,/"dueLocal" already in the owner's time zone \(Europe\/Rome\)/);
 assert.deepEqual(JSON.parse(ask.prompt),{request:'Ricordami di chiamare Ada',steps:[{tool:'reminders.list',args:{},outcome:'grant',result:[]}]});
 assert.equal(misatoAsk({request:'x',history:[],tools:toolDocs,now:'n',timeZone:'z'},'cloud').privacy,'any');
 const due=JSON.parse(misatoAsk({request:'x',history:[{tool:'reminders.list',args:{},outcome:'grant',result:[{title:'Insurance',due:'2030-01-15T08:00:00.000Z'}]}],tools:toolDocs,now:'n',timeZone:'Europe/Rome'},'local').prompt).steps[0].result[0];
 assert.match(due.dueLocal,/15 January 2030 at 09:00/,'UTC is converted to the owner\'s zone in code, not by the model');
 const long=Array.from({length:12},(_,i)=>({tool:'reminders.list',args:{},outcome:'grant' as const,result:'r'.repeat(1500)+i}));
 const kept=JSON.parse(misatoAsk({request:'x',history:long,tools:toolDocs,now:'n',timeZone:'Europe/Rome'},'local').prompt).steps as {result:string}[];
 assert.ok(kept.length<12&&kept.at(-1)!.result.endsWith('11'),'the newest steps are kept');
 assert.deepEqual(parsePlan('ok {"action":{"tool":"reminders.list"}}'),{action:{tool:'reminders.list',args:{}}});
 assert.deepEqual(parsePlan('{"reply":" Fatto. "}'),{reply:'Fatto.'});
 for(const bad of ['nothing','{"reply":""}','{"action":{"tool":"x","args":[]}}','{"action":{"args":{}}}','{"reply":"a","action":{"tool":"x"}}','{"reply":'])assert.equal(parsePlan(bad),undefined,bad);
});
/** A loopback model: Casper answers from one script, Misato from another; every request is recorded. */
async function models(misato:string[],casper='{"vote":"approve","reason":"Matches.","confidence":0.9}') {
 const asked:{who:string;model:string;prompt:string}[]=[];
 const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c).on('end',()=>{
  const r=JSON.parse(body) as {model:string;messages:{role:string;content:string}[]};const who=r.messages[0]!.content.startsWith('You are Casper')?'casper':'misato';
  asked.push({who,model:r.model,prompt:r.messages.at(-1)!.content});
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:who==='casper'?casper:(misato.shift() ?? '{"reply":"done"}')},finish_reason:'stop'}]}));
 });});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 return {asked,url:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,close:()=>new Promise<void>(done=>server.close(()=>done()))};
}
async function agent(script:string[],work:(r:Runtime,m:Awaited<ReturnType<typeof models>>,base:string,headers:Record<string,string>)=>Promise<void>,scrolls?:object) {
 const m=await models(script);const home=mkdtempSync(join(tmpdir(),'nerv-misato-'));
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:m.url,model:'gemma4:12b'},roles:{misato:{route:'local',model:'qwen2.5-coder:14b'},casper:{model:'gemma4:12b'}}}}));
 if(scrolls)writeFileSync(join(home,'scrolls.json'),JSON.stringify(scrolls),{mode:0o600});
 const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);const token='c'.repeat(32);const server=makeServer(runtime,token);
 try{await runtime.ready();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));await work(runtime,m,`http://127.0.0.1:${(server.address() as {port:number}).port}`,{authorization:'Bearer '+token,'content-type':'application/json'});}
 finally{await new Promise<void>(done=>server.close(()=>done()));await runtime.close();await m.close();rmSync(home,{recursive:true,force:true});}
}
test('through every process: an Italian request is planned by Misato, gated, executed and answered in Italian',async()=>{
 await agent(['{"action":{"tool":"reminders.add","args":{"title":"Rinnovare assicurazione","due":"2030-01-15T09:00:00+01:00"}}}','{"reply":"Fatto: ti ricorderò di rinnovare l\'assicurazione il 15 gennaio alle 9."}'],async(runtime,m,base,headers)=>{
  const res=await fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify({message:'Ricordami di rinnovare l\'assicurazione il 15 gennaio 2030 alle 9'})});
  const chat=await res.json() as {sortieId:string;reply:string;steps:{tool:string;outcome:string;result:{title:string}}[];waiting:unknown[]};
  assert.equal(res.status,200);assert.match(chat.reply,/^Fatto/);assert.deepEqual(chat.waiting,[]);
  assert.deepEqual(chat.steps.map(s=>[s.tool,s.outcome,s.result.title]),[['reminders.add','grant','Rinnovare assicurazione']]);
  assert.equal((await runtime.list()).length,1);
  assert.deepEqual(m.asked.map(a=>[a.who,a.model]),[['misato','qwen2.5-coder:14b'],['misato','qwen2.5-coder:14b']],'Green work never asks Casper');
  assert.equal((JSON.parse(m.asked[1]!.prompt) as {steps:{outcome:string}[]}).steps[0]!.outcome,'grant','Misato sees the outcome of its step');
  assert.deepEqual((await runtime.events(chat.sortieId)).map(e=>e.kind),['sortie.opened','ballot','grant.issued','grant.used','action.done','misato.reply','sortie.done']);
  assert.ok(!JSON.stringify(chat).includes('grantId'));
  assert.equal((await fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify({message:''})})).status,400);
  assert.equal((await fetch(base+'/api/chat',{method:'POST',body:'{}'})).status,401);
 });
});
test('an unreadable plan is shown back to Misato; a Blue action asks Casper and then waits for the owner',async()=>{
 await agent(['sure, I will send it','{"action":{"tool":"mail.send","args":{"to":"ada@example.com"}}}','{"action":{"tool":"mail.send","args":{"to":"ada@example.com"}}}','{"reply":"I asked for your approval before sending the mail."}'],async(runtime,m)=>{
  const chat=await runtime.chat('Email Ada that I am late');
  assert.deepEqual(chat.steps.map(s=>s.outcome),['invalid','approval','invalid'],'the repeated proposal never reaches the gate');assert.equal(chat.waiting.length,1);
  assert.match(chat.steps[1]!.reason!,/NOT done yet/);assert.match(chat.steps[2]!.error!,/already waits for the owner/);assert.equal(chat.waiting[0]!.tool,'mail.send');
  assert.match(chat.reply!,/approval/);
  assert.deepEqual(m.asked.map(a=>[a.who,a.model]),[['misato','qwen2.5-coder:14b'],['misato','qwen2.5-coder:14b'],['casper','gemma4:12b'],['misato','qwen2.5-coder:14b'],['misato','qwen2.5-coder:14b']]);
  const cards=await runtime.approvals();assert.equal(cards.length,1);assert.equal(cards[0]!.card.tool,'mail.send');
 });
});
test('the loop stops at the step limit and the sortie closes failed',async()=>{
 await agent(Array.from({length:MAX_STEPS+2},()=>'{"action":{"tool":"reminders.list","args":{}}}'),async(runtime)=>{
  const chat=await runtime.chat('Keep listing');
  assert.equal(chat.steps.length,MAX_STEPS);assert.match(chat.error!,/Step limit/);assert.equal(chat.reply,undefined);
  assert.equal((await runtime.events(chat.sortieId)).at(-1)!.kind,'sortie.failed');
 });
});
test('a reject from the gate goes back to Misato with its reason, and nothing runs',async()=>{
 await agent(['{"action":{"tool":"reminders.cancel","args":{"id":"r1"}}}','{"reply":"I could not cancel it: the owner\'s rules deny that tool."}'],async(runtime,m)=>{
  const chat=await runtime.chat('Cancel my reminder');
  assert.deepEqual(chat.steps.map(s=>[s.outcome,s.reason]),[['reject','melchior: Tool denied by the Scrolls.']]);
  assert.match(JSON.parse(m.asked[1]!.prompt).steps[0].reason,/denied by the Scrolls/);
  assert.deepEqual((await runtime.events(chat.sortieId)).map(e=>e.kind),['sortie.opened','ballot','misato.reply','sortie.done']);
 },{deny:['reminders.cancel']});
});
