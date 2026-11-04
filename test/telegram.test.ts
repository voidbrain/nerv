import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,statSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Runtime} from '../src/runtime.ts';
import {TelegramApi,TelegramChannel,startChats,telegramBase} from '../src/telegram.ts';
const OWNER=1111,STRANGER=2222;
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function until(check:()=>boolean,ms=8000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw new Error('timed out');await wait(25);}}
/** A loopback Bot API: queued updates, recorded calls. */
async function fakeTelegram(token:string) {
 const updates:object[]=[];const calls:{method:string;body:Record<string,unknown>}[]=[];let next=1;
 const server=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',async()=>{
  const m=/^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');res.setHeader('content-type','application/json');
  if(!m||m[1]!==token){res.statusCode=401;res.end(JSON.stringify({ok:false,description:'Unauthorized'}));return;}
  const body=JSON.parse(raw||'{}') as Record<string,unknown>;calls.push({method:m[2]!,body});
  if(m[2]==='getUpdates'){const from=(body.offset as number|undefined) ?? 0;for(let i=0;i<10&&!updates.some(u=>(u as {update_id:number}).update_id>=from)&&body.timeout;i++)await wait(30);
   res.end(JSON.stringify({ok:true,result:updates.filter(u=>(u as {update_id:number}).update_id>=from)}));return;}
  res.end(JSON.stringify({ok:true,result:{message_id:calls.length}}));
 });});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const now=()=>Math.floor(Date.now()/1000);
 return {calls,base:`http://127.0.0.1:${(server.address() as {port:number}).port}`,
  text:(chat:number,text:string,date=now())=>updates.push({update_id:next++,message:{date,text,chat:{id:chat,type:'private',username:chat===OWNER?'owner':'stranger'},from:{id:chat}}}),
  tap:(chat:number,data:string)=>updates.push({update_id:next++,callback_query:{id:'q'+next,data,from:{id:chat},message:{message_id:7,chat:{id:chat}}}}),
  sent:(chat=OWNER)=>calls.filter(c=>c.method==='sendMessage'&&c.body.chat_id===chat).map(c=>c.body as {text:string;reply_markup?:{inline_keyboard:{callback_data:string}[][]}}),
  close:()=>new Promise<void>(done=>server.close(()=>done()))};
}
async function fakeModel(misato:string[]) {
 const asked:string[]=[];
 const server=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',()=>{const r=JSON.parse(raw) as {messages:{content:string}[]};const casper=r.messages[0]!.content.startsWith('You are Casper');asked.push(casper?'casper':'misato');
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:casper?'{"vote":"approve","reason":"Matches.","confidence":0.9}':(misato.shift() ?? '{"reply":"done"}')},finish_reason:'stop'}]}));});});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 return {asked,url:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,close:()=>new Promise<void>(done=>server.close(()=>done()))};
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
 const model=await fakeModel(['{"action":{"tool":"reminders.add","args":{"title":"Chiamare Ada","due":"2030-01-15T09:00:00+01:00"}}}','{"reply":"Ho bisogno della tua approvazione."}','{"reply":"Fatto: Chiamare Ada è nei promemoria."}']);
 const home=mkdtempSync(join(tmpdir(),'nerv-aoba-'));
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:model.url,model:'m'}}}));
 writeFileSync(join(home,'scrolls.json'),JSON.stringify({blue:['reminders.add']}),{mode:0o600});
 const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);const statePath=join(home,'telegram-state.json');const logs:string[]=[];
 const channel=()=>new TelegramChannel({api:new TelegramApi(token,tg.base),store:runtime,chatId:OWNER,statePath,log:l=>logs.push(l)});
 let aoba=channel();
 try{
  await runtime.ready();runtime.startResumer(100);await aoba.start(100);
  tg.text(STRANGER,'Ricordami di chiamare Ada');await until(()=>logs.some(l=>/another chat/.test(l)));
  assert.deepEqual(tg.sent(STRANGER),[]);assert.equal(model.asked.length,0,'a stranger never reaches Misato');
  tg.text(OWNER,'Ricordami di chiamare Ada il 15 gennaio 2030 alle 9');
  // The card (delivery tick) and Misato's reply (end of its loop) can arrive in either order: wait for both.
  await until(()=>tg.sent().some(m=>m.reply_markup)&&tg.sent().some(m=>/approvazione/.test(m.text)));
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
  assert.equal(statSync(statePath).mode&0o777,0o600);
  tg.text(OWNER,'old news',Math.floor(Date.now()/1000)-3600);await until(()=>tg.sent().some(m=>/offline when you sent/.test(m.text)));
  assert.equal(model.asked.filter(a=>a==='misato').length,3,'a stale message never reaches Misato');
 }finally{await aoba.stop();await runtime.close();await model.close();await tg.close();rmSync(home,{recursive:true,force:true});}
});
test('telegram link (CLI) saves the owner chat into config.json, keeping the other settings, and refuses a readable token file',async()=>{
 const {spawn}=await import('node:child_process');const {readFileSync,chmodSync}=await import('node:fs');
 const token='123456:'+'k'.repeat(35);const tg=await fakeTelegram(token);const home=mkdtempSync(join(tmpdir(),'nerv-link-'));
 const run=(...args:string[])=>new Promise<{status:number|null;out:string;err:string}>(done=>{const c=spawn(process.execPath,['src/cli.ts',...args],{env:{...process.env,NERV_HOME:home,NERV_TELEGRAM_API:tg.base}});let out='',err='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>err+=d);c.on('exit',status=>done({status,out,err}));});
 try{
  writeFileSync(join(home,'config.json'),JSON.stringify({language:'it'}));writeFileSync(join(home,'telegram-token'),token+'\n',{mode:0o600});
  assert.match((await run('telegram','link')).err,/No \/start found/);
  tg.text(OWNER,'/start');const linked=await run('telegram','link');assert.equal(linked.status,0,linked.err);assert.match(linked.out,/linked to owner \(chat 1111\)/);
  assert.deepEqual(JSON.parse(readFileSync(join(home,'config.json'),'utf8')),{language:'it',telegram:{chatId:OWNER}});
  assert.ok(!linked.out.includes(token)&&!linked.err.includes(token));
  chmodSync(join(home,'telegram-token'),0o644);assert.match((await run('telegram','link')).err,/must be private/);
 }finally{await tg.close();rmSync(home,{recursive:true,force:true});}
});
test('Hyuga\'s brief reaches the owner once a day, also across a restart',async()=>{
 const token='123456:'+'b'.repeat(35);const tg=await fakeTelegram(token);const home=mkdtempSync(join(tmpdir(),'nerv-brief-'));
 const runtime=new Runtime(join(home,'nerv.sqlite'));const statePath=join(home,'telegram-state.json');
 const channel=()=>new TelegramChannel({api:new TelegramApi(token,tg.base),store:runtime,chatId:OWNER,statePath,log:()=>{},brief:{at:'00:00',timeZone:'Europe/Rome',language:'it'}});
 let aoba=channel();
 try{
  await runtime.ready();await runtime.add('Rinnovare assicurazione',new Date(Date.now()+3_600_000).toISOString());
  await aoba.start(100);await until(()=>tg.sent().some(m=>/Buongiorno/.test(m.text)));
  const brief=tg.sent().find(m=>/Buongiorno/.test(m.text))!.text;assert.match(brief,/In scadenza nelle prossime 24 h: 1\n• .*Rinnovare assicurazione/);
  await wait(400);await aoba.stop();aoba=channel();await aoba.start(100);await wait(400);
  assert.equal(tg.sent().filter(m=>/Buongiorno/.test(m.text)).length,1,'one brief per day, even after a restart');
 }finally{await aoba.stop();await runtime.close();await tg.close();rmSync(home,{recursive:true,force:true});}
});
