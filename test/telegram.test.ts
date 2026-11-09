import {test} from 'node:test';
import assert from 'node:assert/strict';
import {POSIX,assertPrivateFile} from './fixtures/posix.ts';
import {mkdtempSync,rmSync,writeFileSync,statSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Runtime} from '../src/runtime.ts';
import {TelegramApi,TelegramChannel,startChats,telegramBase,BUNDLE_WAIT_MS} from '../src/telegram.ts';
import {Store} from '../src/store.ts';
import type {StoreApi} from '../src/runtime.ts';
const OWNER=1111,STRANGER=2222;
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function until(check:()=>boolean,ms=8000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw new Error('timed out');await wait(25);}}
/** A loopback Bot API: queued updates, recorded calls. */
async function fakeTelegram(token:string) {
 let failing=false,failedSends=0;const updates:object[]=[];const calls:{method:string;body:Record<string,unknown>}[]=[];let next=1;
 const server=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',async()=>{
  const m=/^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');res.setHeader('content-type','application/json');
  if(!m||m[1]!==token){res.statusCode=401;res.end(JSON.stringify({ok:false,description:'Unauthorized'}));return;}
  const body=JSON.parse(raw||'{}') as Record<string,unknown>;if(m[2]==='sendMessage'&&failing){failedSends++;res.statusCode=503;res.end(JSON.stringify({ok:false,description:'temporary failure'}));return;}calls.push({method:m[2]!,body});
  if(m[2]==='getUpdates'){const from=(body.offset as number|undefined) ?? 0;for(let i=0;i<10&&!updates.some(u=>(u as {update_id:number}).update_id>=from)&&body.timeout;i++)await wait(30);
   res.end(JSON.stringify({ok:true,result:updates.filter(u=>(u as {update_id:number}).update_id>=from)}));return;}
  res.end(JSON.stringify({ok:true,result:{message_id:calls.length}}));
 });});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const now=()=>Math.floor(Date.now()/1000);
 return {calls,updates,failSends:(on:boolean)=>{failing=on;},failedSends:()=>failedSends,base:`http://127.0.0.1:${(server.address() as {port:number}).port}`,
  text:(chat:number,text:string,date=now())=>updates.push({update_id:next++,message:{date,text,chat:{id:chat,type:'private',username:chat===OWNER?'owner':'stranger'},from:{id:chat}}}),
  tap:(chat:number,data:string)=>updates.push({update_id:next++,callback_query:{id:'q'+next,data,from:{id:chat},message:{message_id:7,chat:{id:chat}}}}),
  sent:(chat=OWNER)=>calls.filter(c=>c.method==='sendMessage'&&c.body.chat_id===chat).map(c=>c.body as {text:string;reply_markup?:{inline_keyboard:{callback_data:string}[][]}}),
  close:()=>new Promise<void>(done=>server.close(()=>done()))};
}
async function fakeModel(misato:string[]) {
 const asked:string[]=[];const systems:string[]=[];
 const server=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',()=>{const r=JSON.parse(raw) as {messages:{content:string}[]};systems.push(r.messages[0]!.content);const casper=r.messages[0]!.content.startsWith('You are Casper');asked.push(casper?'casper':'misato');
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:casper?'{"vote":"approve","reason":"Matches.","confidence":0.9}':(misato.shift() ?? '{"reply":"done"}')},finish_reason:'stop'}]}));});});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 return {asked,systems,url:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,close:()=>new Promise<void>(done=>server.close(()=>done()))};
}
test('the Bot API base is Telegram or loopback only, and link finds the private chats that sent /start',async()=>{
 const before=process.env.NERV_TELEGRAM_API;
 try{delete process.env.NERV_TELEGRAM_API;assert.equal(telegramBase(),'https://api.telegram.org');
  process.env.NERV_TELEGRAM_API='https://evil.example/';assert.throws(()=>telegramBase(),/loopback/);
  process.env.NERV_TELEGRAM_API='http://127.0.0.1:9/';assert.equal(telegramBase(),'http://127.0.0.1:9');}
 finally{if(before===undefined)delete process.env.NERV_TELEGRAM_API;else process.env.NERV_TELEGRAM_API=before;}
 const tg=await fakeTelegram('123456:'+'x'.repeat(35));
 try{tg.text(OWNER,'/start');tg.text(OWNER,'hello');assert.deepEqual(await startChats(new TelegramApi('123456:'+'x'.repeat(35),tg.base)),[{chatId:OWNER,name:'owner'}]);
  await assert.rejects(new TelegramApi('999999:'+'y'.repeat(35),tg.base).updates(undefined,0),(e:Error)=>/Unauthorized/.test(e.message)&&!e.message.includes('999999'),'errors never echo the token');}
 finally{await tg.close();}
});
test('through every process: Aoba answers only the owner, sends cards with buttons, applies a tap once and delivers reminders',async()=>{
 const token='123456:'+'t'.repeat(35);const tg=await fakeTelegram(token);
 const model=await fakeModel(['{"action":{"tool":"reminders.add","args":{"title":"Chiamare Ada","due":"2030-01-15T09:00:00+01:00"}}}','{"reply":"Fatto: Chiamare Ada è nei promemoria."}']);
 const home=mkdtempSync(join(tmpdir(),'nerv-aoba-'));
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:model.url,model:'m'}}}));
 writeFileSync(join(home,'scrolls.json'),JSON.stringify({blue:['reminders.add']}),{mode:0o600});
 const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);const statePath=join(home,'telegram-state.json');const logs:string[]=[];
 const channel=()=>new TelegramChannel({api:new TelegramApi(token,tg.base),store:runtime,chatId:OWNER,statePath,log:l=>logs.push(l)});
 let aoba=channel();
 try{
  assert.equal(aoba.channelState().api,undefined,'configured alone is not a live API check');
  await runtime.ready();runtime.startResumer(100);await aoba.start(100);
  tg.text(STRANGER,'Ricordami di chiamare Ada');await until(()=>logs.some(l=>/another chat/.test(l)));
  assert.equal(aoba.channelState().api?.state,'responding','a successful poll checks the API even with no owner message');assert.equal(aoba.channelState().lastReceived,undefined,'strangers never produce owner-message activity');
  assert.deepEqual(tg.sent(STRANGER),[]);assert.equal(model.asked.length,0,'a stranger never reaches Misato');
  tg.text(OWNER,'/status');await until(()=>tg.sent().some(m=>/Source: local records/.test(m.text)));assert.equal(model.asked.length,0,'status never asks a model');assert.deepEqual(await runtime.sorties(),[],'read commands open no sortie');
  tg.text(OWNER,'Ricordami di chiamare Ada il 15 gennaio 2030 alle 9');
  // The card (delivery tick) and the waiting reply (the service's own, in the request's language) can arrive in either order: wait for both.
  await until(()=>tg.sent().some(m=>m.reply_markup)&&tg.sent().some(m=>/approvazione/.test(m.text)));
  assert.ok(aoba.channelState().lastReceived,'real owner traffic is observed without storing message contents');
  const [reply,cardMessage]=[tg.sent().find(m=>/approvazione/.test(m.text))!,tg.sent().find(m=>m.reply_markup)!];
  assert.ok(reply);assert.match(cardMessage.text,/Pattern BLUE/);assert.match(cardMessage.text,/reminders\.add/);
  const approve=cardMessage.reply_markup!.inline_keyboard[0]![0]!.callback_data;assert.match(approve,/^a:[a-f0-9-]{36}$/);
  assert.ok(tg.calls.some(c=>c.method==='sendChatAction'),'typing while Misato works');
  tg.tap(STRANGER,approve);await until(()=>logs.some(l=>/button press from another account/.test(l)));assert.equal((await runtime.list()).length,0);
  tg.tap(OWNER,approve);await until(()=>tg.sent().some(m=>/^Approved and done/.test(m.text)));
  assert.equal((await runtime.list()).length,1);
  // F-033: after the tap, Misato resumes with the outcome and its follow-up reaches the chat, after the decision message.
  await until(()=>tg.sent().some(m=>/^Fatto: Chiamare Ada/.test(m.text)));
  const texts=tg.sent().map(m=>m.text);assert.ok(texts.findIndex(x=>/^Approved and done/.test(x))<texts.findIndex(x=>/^Fatto/.test(x)));
  tg.tap(OWNER,approve);await until(()=>tg.calls.filter(c=>c.method==='answerCallbackQuery').length>=2);await wait(200);
  assert.equal((await runtime.list()).length,1,'a second tap never runs the tool again');
  assert.ok(tg.calls.some(c=>c.method==='editMessageReplyMarkup'),'buttons are removed after a decision');
  // Pen Pen: a due reminder reaches the phone too.
  await runtime.add('Bere acqua',new Date(Date.now()+400).toISOString());
  await until(()=>tg.sent().some(m=>m.text.startsWith('⏰')&&/Bere acqua/.test(m.text)));
  // Restart: nothing is sent twice and old updates are not handled again.
  const before=tg.sent().length;await aoba.stop();aoba=channel();await aoba.start(100);await wait(500);
  assert.equal(tg.sent().length,before,'no card or reminder is resent after a restart');
  assert.equal(tg.sent().filter(m=>/Approval needs review/.test(m.text)).length,0,'native inbox notices never duplicate Telegram cards');
  assertPrivateFile(statePath);
  tg.text(OWNER,'old news',Math.floor(Date.now()/1000)-3600);await until(()=>tg.sent().some(m=>/offline when you sent/.test(m.text)));
  assert.equal(model.asked.filter(a=>a==='misato').length,2,'a stale message never reaches Misato (two calls: the plan and the follow-up; the card ends the first turn)');
 }finally{await aoba.stop();await runtime.close();await model.close();await tg.close();rmSync(home,{recursive:true,force:true});}
});
test('telegram link (CLI) saves the owner chat into config.json, keeping the other settings, and refuses a readable token file',async()=>{
 const {spawn}=await import('node:child_process');const {readFileSync,chmodSync}=await import('node:fs');
 const token='123456:'+'k'.repeat(35);const tg=await fakeTelegram(token);const home=mkdtempSync(join(tmpdir(),'nerv-link-'));
 const run=(...args:string[])=>new Promise<{status:number|null;out:string;err:string}>(done=>{const c=spawn(process.execPath,['src/cli.ts',...args],{env:{...process.env,NERV_HOME:home,NERV_TELEGRAM_API:tg.base}});let out='',err='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>err+=d);c.on('exit',status=>done({status,out,err}));});
 try{
  writeFileSync(join(home,'config.json'),JSON.stringify({language:'it'}));writeFileSync(join(home,'telegram-token'),token+'\n',{mode:0o600});
  assert.match((await run('telegram','link')).err,/No \/start found\. Nothing is waiting for this bot\. Either \/start went to a different bot.*or another program reads this bot/);
  tg.updates.push({update_id:900,message:{date:Math.floor(Date.now()/1000),text:'/start',chat:{id:-5,type:'group'},from:{id:5}}});
  assert.match((await run('telegram','link')).err,/1 update\(s\) waiting, but no \/start in a private chat \(a message in a group chat\)/);
  tg.text(OWNER,'/start');const linked=await run('telegram','link');assert.equal(linked.status,0,linked.err);assert.match(linked.out,/linked to owner \(chat 1111\)/);
  assert.deepEqual(JSON.parse(readFileSync(join(home,'config.json'),'utf8')),{language:'it',telegram:{chatId:OWNER}});
  assert.match((await run('telegram','link')).out,/Already linked to chat 1111: nothing to do/);
  assert.ok(!linked.out.includes(token)&&!linked.err.includes(token));
  chmodSync(join(home,'telegram-token'),0o644);if(POSIX)assert.match((await run('telegram','link')).err,/must be private/,'Unix modes only; on Windows the profile ACL protects it');
 }finally{await tg.close();rmSync(home,{recursive:true,force:true});}
});
test('Hyuga\'s brief goes into the inbox once a day, Telegram delivers it from there once, also across a restart (F-028)',async()=>{
 const token='123456:'+'b'.repeat(35);const tg=await fakeTelegram(token);const home=mkdtempSync(join(tmpdir(),'nerv-brief-'));
 const statePath=join(home,'telegram-state.json');const schedule=()=>({at:'00:00',timeZone:'Europe/Rome',language:'it' as const});
 let runtime=new Runtime(join(home,'nerv.sqlite'));
 const channel=()=>new TelegramChannel({api:new TelegramApi(token,tg.base),store:runtime,chatId:OWNER,statePath,log:()=>{}});
 let aoba=channel();
 try{
  await runtime.ready();await runtime.add('Rinnovare assicurazione',new Date(Date.now()+3_600_000).toISOString());
  await aoba.start(100);runtime.startBrief(schedule,undefined,100);
  await until(()=>tg.sent().some(m=>/Il brief di Hyuga/.test(m.text)));
  const brief=tg.sent().find(m=>/Il brief di Hyuga/.test(m.text))!.text;assert.match(brief,/^☀️ (?:Buongiorno\. |Buon pomeriggio\. |Buonasera\. )?Il brief di Hyuga/,'sent as the brief, not as a reminder');assert.match(brief,/In scadenza nelle prossime 24 h: 1\n• .*Rinnovare assicurazione/);
  const page=await runtime.inboxPage(0,20);assert.deepEqual(page.items.filter(i=>i.kind==='brief').length,1,'kept in the inbox');
  await wait(400);await aoba.stop();await runtime.close();
  runtime=new Runtime(join(home,'nerv.sqlite'));await runtime.ready();aoba=channel();await aoba.start(100);runtime.startBrief(schedule,undefined,100);await wait(600);
  assert.equal(tg.sent().filter(m=>/Il brief di Hyuga/.test(m.text)).length,1,'one brief per day, even after a restart of both');
 }finally{await aoba.stop();await runtime.close();await tg.close();rmSync(home,{recursive:true,force:true});}
});
test('on the upgrade day a brief Telegram already sent the old way is not sent again',async()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-brief-up-'));const runtime=new Runtime(join(home,'nerv.sqlite'));
 try{
  await runtime.ready();runtime.startBrief(()=>({at:'00:00',timeZone:'Europe/Rome',language:'en'}),new Date().toISOString(),100);await wait(400);
  assert.equal((await runtime.inboxPage(0,20)).items.filter(i=>i.kind==='brief').length,0);
 }finally{await runtime.close();rmSync(home,{recursive:true,force:true});}
});
test('nerv telegram token saves a BotFather token privately (refusing anything else), and link names the real path when it is missing',()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-tgtoken-'));
 const run=(args:string[],input?:string)=>spawnSync(process.execPath,['src/cli.ts','telegram',...args],{env:{...process.env,NERV_HOME:home},encoding:'utf8',...(input!==undefined?{input}:{})});
 try{
  const missing=run(['link']);assert.match(missing.stderr,new RegExp(`No Telegram bot token at ${join(home,'telegram-token').replace(/[\\/.]/g,'\\$&')}\\. Run: nerv telegram token`));
  assert.match(run(['token','--stdin'],'not a token\n').stderr,/does not look like a BotFather token.*Nothing was saved/);
  const token='123456:'+'s'.repeat(35);const saved=run(['token','--stdin'],token+'\n');assert.equal(saved.status,0,saved.stderr);assert.match(saved.stdout,/Now send \/start to your bot/);
  assert.equal(readFileSync(join(home,'telegram-token'),'utf8').trim(),token);assertPrivateFile(join(home,'telegram-token'));
  assert.ok(!saved.stdout.includes(token)&&!saved.stderr.includes(token),'the token is never printed');
 }finally{rmSync(home,{recursive:true,force:true});}
});
test('facts proposed together reach Telegram as one message with a ✅/❌ row each; a tap decides that fact and removes only its row',{timeout:20000},async()=>{
 const token='123456:'+'b'.repeat(35);const tg=await fakeTelegram(token);const home=mkdtempSync(join(tmpdir(),'nerv-bundle-'));
 const store=new Store(join(home,'nerv.sqlite'));
 const sortie=store.ledger.openSortie('instrumentality','Instrumentality','trusted');
 for(const text of ['Coffee at 8','Ada is a sister','Runs on Sundays'])assert.equal(store.runAction(sortie,{tool:'memory.remember',args:{text},stage:'production'}).outcome,'approval');
 const aoba=new TelegramChannel({api:new TelegramApi(token,tg.base),store:store as unknown as StoreApi,chatId:OWNER,statePath:join(home,'telegram-state.json'),log:()=>{}});
 try{
  await aoba.start(100);
  await wait(BUNDLE_WAIT_MS/2);assert.equal(tg.sent().filter(m=>m.reply_markup).length,0,'held while the night\'s cards may still arrive');
  await until(()=>tg.sent().some(m=>m.reply_markup));
  const sent=tg.sent().filter(m=>m.reply_markup);assert.equal(sent.length,1,'one message for the three facts');
  assert.match(sent[0]!.text,/3 facts to remember[\s\S]*1\. Coffee at 8\n2\. Ada is a sister\n3\. Runs on Sundays/);
  const rows=sent[0]!.reply_markup!.inline_keyboard;assert.equal(rows.length,3);
  // Tap ✅ 2, with the message's buttons as Telegram sends them back.
  tg.updates.push({update_id:900,callback_query:{id:'q900',data:rows[1]![0]!.callback_data,from:{id:OWNER},message:{message_id:7,chat:{id:OWNER},reply_markup:{inline_keyboard:rows}}}});
  await until(()=>tg.calls.some(c=>c.method==='editMessageReplyMarkup'));
  const left=(tg.calls.find(c=>c.method==='editMessageReplyMarkup')!.body.reply_markup as {inline_keyboard:{callback_data:string}[][]}).inline_keyboard;
  assert.deepEqual(left.map(r=>r.map(b=>b.callback_data)),[rows[0]!.map(b=>b.callback_data),rows[2]!.map(b=>b.callback_data)],'the other facts keep their buttons');
  assert.deepEqual(store.memory.list().map(f=>f.text),['Ada is a sister'],'only that fact is stored');
  assert.equal(store.approvals(20).length,2);
 }finally{await aoba.stop();store.close();await tg.close();rmSync(home,{recursive:true,force:true});}
});

test('B-021: Telegram question and owner answer continue one durable sortie; another chat cannot answer it',{timeout:20000},async()=>{
 const token='345678:'+'q'.repeat(35);const tg=await fakeTelegram(token);const model=await fakeModel(['{"ask":"Which file?"}','{"reply":"File checked"}']);
 const home=mkdtempSync(join(tmpdir(),'nerv-aoba-question-'));writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:model.url,model:'m'}}}));
 const runtime=new Runtime(join(home,'db'),undefined,home);const aoba=new TelegramChannel({api:new TelegramApi(token,tg.base),store:runtime,chatId:OWNER,statePath:join(home,'telegram-state.json'),log:()=>{}});
 try{
  await runtime.ready();await aoba.start(50);tg.text(OWNER,'Read a file');await until(()=>tg.sent().some(m=>m.text==='Which file?'));
  const first=(await runtime.sorties())[0]!;assert.equal(first.status,'open');assert.ok(first.question);
  tg.text(STRANGER,'another.txt');tg.text(OWNER,'shopping.txt');await until(()=>tg.sent().some(m=>m.text==='File checked'));
  const sorties=await runtime.sorties();assert.equal(sorties.length,1);assert.equal(sorties[0]!.id,first.id);assert.equal(sorties[0]!.status,'done');
  const answers=(await runtime.events(first.id)).filter(e=>e.kind==='misato.answered');assert.equal(answers.length,1);assert.equal(answers[0]!.payload.text,'shopping.txt');
 }finally{await aoba.stop();await runtime.close();await model.close();await tg.close();rmSync(home,{recursive:true,force:true});}
});
test('F-003: failed Bot delivery keeps its checkpoint across restart, retries once accepted, and is not replayed',{timeout:15000},async()=>{
 const token='123456:'+'r'.repeat(35),tg=await fakeTelegram(token);const home=mkdtempSync(join(tmpdir(),'nerv-channel-retry-'));const path=join(home,'telegram-state.json');let runtime=new Runtime(join(home,'nerv.sqlite'));
 const channel=()=>new TelegramChannel({api:new TelegramApi(token,tg.base),store:runtime,chatId:OWNER,statePath:path,log:()=>{}});let aoba=channel();
 try{
  await runtime.ready();await aoba.start(50);tg.failSends(true);await runtime.nervous.call('inbox.brief',{message:'Neutral brief after a channel outage'});
  await until(()=>tg.failedSends()>0);assert.equal((JSON.parse(readFileSync(path,'utf8')) as {inbox:{sequence:number}}).inbox.sequence,0);
  await aoba.stop();await runtime.close();tg.failSends(false);runtime=new Runtime(join(home,'nerv.sqlite'));await runtime.ready();aoba=channel();await aoba.start(50);
  await until(()=>tg.sent().some(m=>m.text==='Neutral brief after a channel outage'));await aoba.stop();await runtime.close();
  runtime=new Runtime(join(home,'nerv.sqlite'));await runtime.ready();aoba=channel();await aoba.start(50);await wait(150);
  assert.equal(tg.sent().filter(m=>m.text==='Neutral brief after a channel outage').length,1,'accepted delivery is checkpointed across the next restart');
 }finally{await aoba.stop();await runtime.close();await tg.close();rmSync(home,{recursive:true,force:true});}
});
test('F-003: owner Italian then English messages keep their language through the real Telegram and model-process join',{timeout:15000},async()=>{
 const token='123456:'+'b'.repeat(35),tg=await fakeTelegram(token),model=await fakeModel(['{"reply":"Ciao, sono qui."}','{"reply":"Hello, I am here."}']);const home=mkdtempSync(join(tmpdir(),'nerv-channel-language-'));
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:model.url,model:'m'}}}));const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);const channel=new TelegramChannel({api:new TelegramApi(token,tg.base),store:runtime,chatId:OWNER,statePath:join(home,'telegram-state.json'),log:()=>{}});
 try{
  await runtime.ready();await channel.start(50);tg.text(OWNER,'Ciao, come stai?');await until(()=>tg.sent().some(m=>m.text==='Ciao, sono qui.'));
  tg.text(OWNER,'How are you today?');await until(()=>tg.sent().some(m=>m.text==='Hello, I am here.'));
  assert.match(model.systems[0]!,/Write the reply in Italian/);assert.match(model.systems[1]!,/Write the reply in English/);assert.equal((await runtime.sorties()).filter(s=>s.status==='done').length,2);
 }finally{await channel.stop();await runtime.close();await model.close();await tg.close();rmSync(home,{recursive:true,force:true});}
});
