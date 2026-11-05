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
  assert.deepEqual((await runtime.events(chat.sortieId)).map(e=>e.kind),['sortie.opened','misato.request','ballot','grant.issued','grant.used','action.done','misato.step','misato.reply','sortie.done']);
  assert.ok(!JSON.stringify(chat).includes('grantId'));
  assert.equal((await fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify({message:''})})).status,400);
  assert.equal((await fetch(base+'/api/chat',{method:'POST',body:'{}'})).status,401);
 });
});
test('an unreadable plan is shown back to Misato; a Blue action asks Casper, and its card ends the turn with the service\'s own waiting reply',async()=>{
 await agent(['sure, I will send it','{"action":{"tool":"reminders.add","args":{"title":"Email Ada","due":"2030-01-15T09:00:00+01:00"}}}'],async(runtime,m)=>{
  const chat=await runtime.chat('Remind me to email Ada');
  assert.deepEqual(chat.steps.map(s=>s.outcome),['invalid','approval']);assert.equal(chat.waiting.length,1);
  assert.match(chat.steps[1]!.reason!,/NOT done yet/);assert.equal(chat.waiting[0]!.tool,'reminders.add');
  // Owner report 2026-11-04: asked again after the card, the model claimed the action was already confirmed. The model
  // is no longer asked: the reply is fixed, in the request's language, and never says the action happened.
  assert.equal(chat.reply,'Waiting for your approval: reminders.add (“Email Ada”). The card has the details; I will carry on once you decide.');
  assert.deepEqual(m.asked.map(a=>[a.who,a.model]),[['misato','qwen2.5-coder:14b'],['misato','qwen2.5-coder:14b'],['casper','gemma4:12b']]);
  const cards=await runtime.approvals();assert.equal(cards.length,1);assert.equal(cards[0]!.card.tool,'reminders.add');
 },{blue:['reminders.add']});
});
test('the loop stops at the step limit and the sortie closes failed when nothing ran',async()=>{
 await agent(Array.from({length:MAX_STEPS+2},()=>'not a plan'),async(runtime)=>{
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
  assert.deepEqual((await runtime.events(chat.sortieId)).map(e=>e.kind),['sortie.opened','misato.request','ballot','misato.step','misato.reply','sortie.done']);
 },{deny:['reminders.cancel']});
});
test('without any model route, chat says what to configure instead of blaming the cloud route',async()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-noroute-'));writeFileSync(join(home,'config.json'),JSON.stringify({language:'en'}));
 const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);
 try{await runtime.ready();const chat=await runtime.chat('Remind me');assert.match(chat.error!,/No model route for Misato: add models\.local/);assert.equal((await runtime.events(chat.sortieId)).at(-1)!.kind,'sortie.failed');}
 finally{await runtime.close();rmSync(home,{recursive:true,force:true});}
});
test('a short follow-up keeps its conversation: "delete all" → Misato asks → "sì" cancels them in one reversible action',async()=>{
 const script:string[]=[];
 await agent(script,async(runtime,m)=>{
  const a=await runtime.add('Bere acqua','2030-01-01T09:00:00Z'),b=await runtime.add('Chiamare Ada','2030-01-02T09:00:00Z');
  script.push('{"action":{"tool":"reminders.list","args":{}}}','{"reply":"Hai 2 promemoria. Li cancello tutti?"}',`{"action":{"tool":"reminders.cancel","args":{"ids":["${a.id}","${b.id}"]}}}`,'{"reply":"Fatto: cancellati entrambi."}');
  const first=await runtime.chat('cancella tutti i promemoria','telegram:1111');assert.equal(first.reply,'Hai 2 promemoria. Li cancello tutti?');
  const second=await runtime.chat('sì','telegram:1111');
  const prompt=JSON.parse(m.asked.at(-2)!.prompt) as {earlier:{request:string;reply:string}[];request:string};
  assert.equal(prompt.earlier.length,1);assert.equal(prompt.earlier[0]!.request,'cancella tutti i promemoria');assert.equal(prompt.earlier[0]!.reply,'Hai 2 promemoria. Li cancello tutti?');
  assert.equal(prompt.request,'sì');
  assert.deepEqual(second.steps.map(s=>[s.tool,s.outcome]),[['reminders.cancel','grant']],'one Green action: cancel has an inverse now');
  assert.deepEqual((second.steps[0]!.result as {cancelled:string[]}).cancelled.sort(),[a.id,b.id].sort());
  assert.equal((await runtime.pendingReminders()).length,0);
  const other=await runtime.chat('sì','telegram:2222');void other;
  assert.equal((JSON.parse(m.asked.at(-1)!.prompt) as {earlier?:unknown}).earlier,undefined,'another conversation does not see this one');
 });
});
test('a tool Misato was not offered (a misspelling) goes back to Misato, never to the owner as a card',async()=>{
 await agent(['{"action":{"tool":"memore.remember","args":{"text":"I drink coffee at 8"}}}','{"action":{"tool":"memory.remember","args":{"text":"I drink coffee at 8"}}}','{"reply":"Waiting for your OK."}'],async(runtime,m)=>{
  const chat=await runtime.chat('I always drink coffee at 8','cli');
  assert.deepEqual(chat.steps.map(s=>[s.tool,s.outcome]),[['memore.remember','invalid'],['memory.remember','approval']]);
  assert.match(chat.steps[0]!.error!,/Unknown tool "memore\.remember"\. Use exactly one of: .*memory\.remember/);
  assert.deepEqual((await runtime.approvals()).map(a=>a.card.tool),['memory.remember'],'only the real tool reaches the owner');
  void m;
 });
});
test('"move the brief to 9": Misato changes the schedule with one Green, reversible action; nothing security-relevant is reachable',async()=>{
 const {readSchedule,readConfig}=await import('../src/config.ts');
 await agent(['{"action":{"tool":"settings.schedule","args":{"brief":"09:00","instrumentality":"idle"}}}','{"reply":"Il brief arriverà alle 9."}'],async(runtime,m,_base,_headers)=>{
  const chat=await runtime.chat('sposta il brief alle 9 e fai instrumentality quando sono inattivo','telegram:1');
  assert.deepEqual(chat.steps.map(s=>[s.tool,s.outcome]),[['settings.schedule','grant']]);
  assert.deepEqual((chat.steps[0]!.result as {previous:unknown;now:unknown}),{previous:{brief:'off',instrumentality:'off'},now:{brief:'09:00',instrumentality:'idle'}});
  void m;
 });
 // The executor only touches the two schedules and refuses anything else.
 const {mkdtempSync:mk,writeFileSync:wf,rmSync:rm}=await import('node:fs');const {join:j}=await import('node:path');const {tmpdir:td}=await import('node:os');
 const home=mk(j(td(),'nerv-sched-'));wf(j(home,'config.json'),JSON.stringify({language:'it',models:{}}));
 const {Store}=await import('../src/store.ts');const store=new Store(':memory:',undefined,{home});
 try{
  const run=(args:Record<string,unknown>)=>store.runAction(store.ledger.openSortie('owner','s','trusted'),{tool:'settings.schedule',args,stage:'production'});
  assert.equal(run({brief:'08:30'}).pattern,'green');assert.deepEqual(readSchedule(home),{brief:'08:30',instrumentality:'off'});assert.equal(readConfig(home).language,'it','other settings are kept');
  for(const bad of [{},{brief:'25:00'},{instrumentality:'sometimes'},{models:{}},{telegram:{chatId:1}}])assert.ok(run(bad).error,JSON.stringify(bad));
  run({brief:'off'});assert.equal(readSchedule(home).brief,'off');
 }finally{store.close();rm(home,{recursive:true,force:true});}
});
test('the waiting reply speaks the request\'s language, falls back to the conversation, and names what waits',async()=>{
 const {requestLanguage,waitingReply}=await import('../src/misato.ts');
 assert.equal(requestLanguage('Ricordami di chiamare Ada domani alle 9'),'it');assert.equal(requestLanguage('Remember that I drink coffee at 8'),'en');
 assert.equal(requestLanguage('sì',['Vuoi che li cancelli tutti?']),'it');assert.equal(requestLanguage('ok',[],'it'),'it');
 assert.equal(waitingReply('it','memory.remember',{text:'Bevo caffè alle 8'}),'In attesa della tua approvazione: memory.remember (“Bevo caffè alle 8”). I dettagli sono nella card; proseguo appena decidi.');
 assert.doesNotMatch(waitingReply('en','reminders.cancel',{ids:['a','b']}),/done|confirmed|approved/i);
});
test('an action that already ran is never run again: a repeat ends the turn with the service\'s Done; at the step limit what ran is reported done',async()=>{
 // Owner report 2026-11-05: a small model re-proposed an approved action until the step limit ("could not finish").
 const ADD='{"action":{"tool":"reminders.add","args":{"title":"Stretch","due":"2031-01-01T09:00:00Z"}}}';
 await agent([ADD,ADD,ADD],async(runtime,m)=>{
  const chat=await runtime.chat('Remind me to stretch');
  assert.equal(chat.reply,'Done: reminders.add (“Stretch”).');assert.equal((await runtime.list()).length,1,'it ran once');
  assert.deepEqual(chat.steps.map(s=>s.outcome),['grant']);assert.equal(m.asked.filter(a=>a.who==='misato').length,2,'the repeat is caught, not run');
 });
 await agent(['{"action":{"tool":"reminders.list","args":{}}}',...Array.from({length:MAX_STEPS},()=>'not a plan')],async(runtime)=>{
  const chat=await runtime.chat('Ricordami cosa ho in programma');
  assert.equal(chat.reply,'Fatto: reminders.list.','at the limit, what ran is reported, in the request\'s language');
  assert.equal((await runtime.events(chat.sortieId)).at(-1)!.kind,'sortie.done');
 });
});
