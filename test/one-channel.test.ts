import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createServer as httpServer} from 'node:http';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store} from '../src/store.ts';
import {Registry,createRootKey,signRecord,unlockRootKey,type RegistryBody} from '../src/kaji.ts';
import {KajiLink,sanitizeRelay,signedHeaders,type RegistryPort} from '../src/kaji-link.ts';
import {TelegramApi,TelegramChannel,decisionText} from '../src/telegram.ts';
import type {StoreApi} from '../src/runtime.ts';
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function until(check:()=>boolean|Promise<boolean>,ms=10000){const end=Date.now()+ms;while(!(await check())){if(Date.now()>end)throw new Error('timed out');await wait(25);}}
const freePort=async()=>{const s=createServer();await new Promise<void>(d=>s.listen(0,'127.0.0.1',d));const p=(s.address() as {port:number}).port;await new Promise<void>(d=>s.close(()=>d()));return p;};
const keys=()=>{const k=generateKeyPairSync('ed25519');return {privateKey:k.privateKey,publicKey:k.publicKey.export({type:'spki',format:'der'}).toString('base64')};};
const root=(()=>{const f=createRootKey('a long test passphrase');return unlockRootKey(f.file,'a long test passphrase');})();
let serial=0;const rec=(body:Omit<RegistryBody,'serial'|'issued'>)=>signRecord(root.privateKey,{...body,serial:++serial,issued:new Date().toISOString()} as RegistryBody);
const port=(reg:Registry):RegistryPort=>({bases:async()=>reg.bases(),records:async()=>reg.records(),add:async rs=>{let n=0;for(const r of rs){try{if(reg.add(r)==='added')n++;}catch{/* dropped */}}return n;},seen:async u=>reg.seen(u),lastSeen:async()=>reg.lastSeen(),main:async()=>reg.main()});
const OWNER=1204560898;
/** A loopback Bot API that records what was sent and serves queued updates. */
async function fakeBot(token:string){
 const calls:{method:string;body:Record<string,unknown>}[]=[];const updates:object[]=[];let next=1;
 const s=httpServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',async()=>{const m=/^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');res.setHeader('content-type','application/json');
  if(!m||m[1]!==token){res.statusCode=401;res.end('{"ok":false}');return;}const body=JSON.parse(raw||'{}') as Record<string,unknown>;calls.push({method:m[2]!,body});
  if(m[2]==='getUpdates'){const from=(body.offset as number|undefined) ?? 0;for(let i=0;i<10&&!updates.some(u=>(u as {update_id:number}).update_id>=from)&&body.timeout;i++)await wait(30);res.end(JSON.stringify({ok:true,result:updates.filter(u=>(u as {update_id:number}).update_id>=from)}));return;}
  res.end(JSON.stringify({ok:true,result:{message_id:calls.length}}));});});
 await new Promise<void>(d=>s.listen(0,'127.0.0.1',d));
 return {calls,base:`http://127.0.0.1:${(s.address() as {port:number}).port}`,sent:()=>calls.filter(c=>c.method==='sendMessage').map(c=>c.body as {text:string;reply_markup?:{inline_keyboard:{callback_data:string}[][]}}),
  text:(text:string)=>updates.push({update_id:next++,message:{date:Math.floor(Date.now()/1000),text,chat:{id:OWNER,type:'private'},from:{id:OWNER}}}),
  tap:(data:string,rows:unknown)=>updates.push({update_id:next++,callback_query:{id:'q'+next,data,from:{id:OWNER},message:{message_id:7,chat:{id:OWNER},reply_markup:{inline_keyboard:rows}}}}),close:()=>new Promise<void>(d=>{s.close(()=>d());s.closeAllConnections();})};
}
test('the main base is the owner\'s signed choice: newest wins, a revoked base is no main base, and bases() never mistakes it for an enrolment',()=>{
 const st=new Store(':memory:');const reg=new Registry(st.db,root.publicKey);const A=keys(),B=keys();
 try{
  reg.add(rec({kind:'enrol',baseId:'NERV-01',name:'Neo Tokyo-3',publicKey:A.publicKey,address:'100.64.0.1'}));reg.add(rec({kind:'enrol',baseId:'NERV-02',name:'Tabgha',publicKey:B.publicKey,address:'100.64.0.2'}));
  assert.equal(reg.main(),undefined,'no election: unset until the owner names one');
  reg.add(rec({kind:'main',baseId:'NERV-02'}));reg.add(rec({kind:'main',baseId:'NERV-01'}));
  assert.equal(reg.main(),'NERV-01','the newest record wins');assert.deepEqual(reg.bases().map(b=>b.baseId),['NERV-01','NERV-02']);
  reg.add(rec({kind:'revoke',baseId:'NERV-01',publicKey:A.publicKey}));assert.equal(reg.main(),undefined,'a revoked base is no main base');
  assert.throws(()=>reg.add(signRecord(keys().privateKey,{kind:'main',serial:99,baseId:'NERV-02',issued:new Date().toISOString()})),/not signed by your Key/);
 }finally{st.close();}
 assert.deepEqual(sanitizeRelay({text:'hi',cards:[{id:'0'.repeat(8)+'-0000-4000-8000-'+'0'.repeat(12),label:'1'}]})!.cards.length,1);
 for(const bad of [{text:''},{text:'x'.repeat(4000)},{text:'x',cards:[{id:'not-a-uuid',label:''}]},{text:'x',cards:[{id:'0'.repeat(8)+'-0000-4000-8000-'+'0'.repeat(12),label:'x'.repeat(21)}]}])assert.equal(sanitizeRelay(bad),undefined);
});
test('one channel: while the main base is online the other base\'s bot is quiet, its card reaches the owner through Aoba, a tap there decides it on that base; when the main base is gone its own bot speaks again',{timeout:40000},async()=>{
 const A=keys(),B=keys();const pa=await freePort(),pb=await freePort();
 const homeA=mkdtempSync(join(tmpdir(),'nerv-one-a-')),homeB=mkdtempSync(join(tmpdir(),'nerv-one-b-'));
 const sa=new Store(join(homeA,'nerv.sqlite')),sb=new Store(join(homeB,'nerv.sqlite'));const ra=new Registry(sa.db,root.publicKey),rb=new Registry(sb.db,root.publicKey);
 for(const r of [rec({kind:'enrol',baseId:'NERV-01',name:'Neo Tokyo-3',publicKey:A.publicKey,address:`127.0.0.1:${pa}`}),rec({kind:'enrol',baseId:'NERV-02',name:'Tabgha',publicKey:B.publicKey,address:`127.0.0.1:${pb}`}),rec({kind:'main',baseId:'NERV-01'})]){ra.add(r);rb.add(r);}
 const ta='111:'+'a'.repeat(35),tb='222:'+'b'.repeat(35);const botA=await fakeBot(ta),botB=await fakeBot(tb);
 let aoba:TelegramChannel|undefined;let mainUp=true;let relayWorks=true;
 const la=new KajiLink({baseId:'NERV-01',key:A.privateKey,publicKey:A.publicKey,registry:port(ra),log:()=>{},onRelay:async(from,relay)=>relayWorks?aoba!.relayed(from,from==='NERV-02'?'Tabgha':from,relay):false});
 const lb=new KajiLink({baseId:'NERV-02',key:B.privateKey,publicKey:B.publicKey,registry:port(rb),log:()=>{},onDecide:async(id,d)=>decisionText(sb.decide(id,d,'telegram'))});
 aoba=new TelegramChannel({api:new TelegramApi(ta,botA.base),store:sa as unknown as StoreApi,chatId:OWNER,statePath:join(homeA,'tg.json'),log:()=>{},remote:{decide:(b,id,d)=>la.decide(b,id,d)}});
 const tabgha=new TelegramChannel({api:new TelegramApi(tb,botB.base),store:sb as unknown as StoreApi,chatId:OWNER,statePath:join(homeB,'tg.json'),log:()=>{},
  oneChannel:{destination:async()=> 'NERV-01',quiet:async()=>mainUp,relay:(text,cards)=>lb.relay({text,cards})}});
 try{
  await la.start(60_000);await lb.start(60_000);await aoba.start(100);await tabgha.start(100);
  // A card on Tabgha (an owner-only action), while Neo Tokyo-3 is the main base and online.
  const s=sb.ledger.openSortie('owner','Remember it','trusted');assert.equal(sb.runAction(s,{tool:'memory.remember',args:{text:'Coffee at 8'},stage:'production'}).outcome,'approval');
  await until(()=>botA.sent().some(m=>m.text.startsWith('🛰 Tabgha · ')&&!!m.reply_markup),15000);
  assert.equal(botB.sent().length,0,'Tabgha\'s own bot stays quiet');assert.ok(botB.calls.some(c=>c.method==='getUpdates'),'its own bot keeps accepting owner messages while outgoing inbox deliveries route through main');
  const relayed=botA.sent().find(m=>m.text.startsWith('🛰 Tabgha · '))!;const rows=relayed.reply_markup!.inline_keyboard;
  assert.match(rows[0]![0]!.callback_data,/^k:NERV-02:a:[a-f0-9-]{36}$/);
  botA.tap(rows[0]![0]!.callback_data,rows);
  await until(()=>sb.memory.list().length===1);assert.equal(sb.memory.list()[0]!.text,'Coffee at 8','the tap on Aoba decided the card on Tabgha');
  await until(()=>botA.sent().some(m=>/^🛰 NERV-02 · Approved/.test(m.text)));
  assert.equal(tabgha.channelState().mode,'via-main');assert.equal(tabgha.channelState().destination,'NERV-01');
  assert.deepEqual([tabgha.channelState().lastDelivery?.route,tabgha.channelState().lastDelivery?.result],['main','accepted']);
  // Main is online but cannot deliver: the existing fallback sends through this base's own bot.
  relayWorks=false;await sb.add('Fallback test',new Date(Date.now()+300).toISOString());sb.tick(new Date(Date.now()+1000));
  await until(()=>botB.sent().some(m=>/⏰ Fallback test/.test(m.text)));
  assert.equal(tabgha.channelState().mode,'local-fallback');
  assert.deepEqual([tabgha.channelState().lastDelivery?.route,tabgha.channelState().lastDelivery?.result],['local','accepted']);
  relayWorks=true;await sb.add('Relay recovered',new Date(Date.now()+300).toISOString());sb.tick(new Date(Date.now()+1000));
  await until(()=>botA.sent().some(m=>/⏰ Relay recovered/.test(m.text))&&tabgha.channelState().mode==='via-main');assert.equal(tabgha.channelState().mode,'via-main');
  botB.text('/start');await until(()=>botB.sent().some(m=>/Aoba here/.test(m.text)));assert.ok(tabgha.channelState().lastReceived,'the routed bot still receives owner messages');
  // A forged decision from a base that is not the main one is refused by Tabgha.
  const body=JSON.stringify({approvalId:'0'.repeat(8)+'-0000-4000-8000-'+'0'.repeat(12),decision:'approve'});
  const forged=await fetch(`http://127.0.0.1:${pb}/kaji/decide`,{method:'POST',headers:{'content-type':'application/json',...signedHeaders('NERV-02',B.privateKey,'req','POST','/kaji/decide',body)},body});assert.equal(forged.status,403);
  // The main base goes away: Tabgha speaks with its own bot again.
  mainUp=false;await sb.add('Stretch',new Date(Date.now()+300).toISOString());sb.tick(new Date(Date.now()+1000));
  await until(()=>botB.sent().some(m=>/⏰ Stretch/.test(m.text)));assert.equal(tabgha.channelState().mode,'local-fallback');
 }finally{await tabgha.stop();await aoba.stop();await la.stop();await lb.stop();sa.close();sb.close();await botA.close();await botB.close();rmSync(homeA,{recursive:true,force:true});rmSync(homeB,{recursive:true,force:true});}
});
test('dispatch: a request asked on another base is answered by the main base\'s Misato; unreachable, it is answered locally; sent but slow, it is reported and never run twice',{timeout:40000},async()=>{
 const {Runtime}=await import('../src/runtime.ts');
 const A=keys(),B=keys();const pa=await freePort(),pb=await freePort();
 const homeB=mkdtempSync(join(tmpdir(),'nerv-disp-b-'));const sa=new Store(':memory:');const ra=new Registry(sa.db,root.publicKey);
 const records=[rec({kind:'enrol',baseId:'NERV-01',name:'Neo Tokyo-3',publicKey:A.publicKey,address:`127.0.0.1:${pa}`}),rec({kind:'enrol',baseId:'NERV-02',name:'Tabgha',publicKey:B.publicKey,address:`127.0.0.1:${pb}`}),rec({kind:'main',baseId:'NERV-01'})];
 for(const r of records)ra.add(r);
 const heard:{from:string;message:string;conversation?:string}[]=[];let slow=false;
 const la=new KajiLink({baseId:'NERV-01',key:A.privateKey,publicKey:A.publicKey,registry:port(ra),log:()=>{},
  onChat:async(from,message,conversation)=>{heard.push({from,message,...(conversation?{conversation}:{})});if(slow)await wait(1500);return {sortieId:'tokyo-sortie',reply:'Done on Tokyo.',steps:[],waiting:[],base:{id:'NERV-01',name:'Neo Tokyo-3'}};}});
 writeFileSync(join(homeB,'config.json'),JSON.stringify({base:{id:'NERV-02',name:'Tabgha'},kaji:{root:root.publicKey}}));
 const b=new Runtime(join(homeB,'nerv.sqlite'),undefined,homeB);
 try{
  await b.ready();assert.equal(await b.kaji.add(records),3);
  const lb=new KajiLink({baseId:'NERV-02',key:B.privateKey,publicKey:B.publicKey,registry:b.kaji,log:()=>{}});
  // Wired as serve does: the request is recorded here as forwarded (F-051), then sent.
  b.setDispatch(async(m,c,forwarding)=>{await forwarding({id:'NERV-01',name:'Neo Tokyo-3'});return await lb.chat(m,c,800) as never;});
  await la.start(60_000);
  const far=await b.chat('What is on today?','dashboard');
  assert.deepEqual([far.reply,far.base?.name],['Done on Tokyo.','Neo Tokyo-3']);assert.deepEqual(heard,[{from:'NERV-02',message:'What is on today?',conversation:'dashboard'}]);
  // F-051 (changed on purpose): the forwarded request is a sortie on Tabgha too, done, with where it went and what came back.
  const mine=(await b.sorties())[0]!;assert.equal(far.sortieId,mine.id);assert.equal(mine.status,'done');assert.equal(mine.actions,0,'nothing ran on Tabgha');
  const kinds=(await b.events(mine.id)).map(e=>[e.kind,e.payload] as const);
  assert.deepEqual(kinds.find(k=>k[0]==='kaji.forwarded')![1],{base:{id:'NERV-01',name:'Neo Tokyo-3'}});
  assert.deepEqual(kinds.find(k=>k[0]==='kaji.answered')![1],{base:{id:'NERV-01',name:'Neo Tokyo-3'},sortieId:'tokyo-sortie'});
  // Sent but slow: reported, never repeated here.
  slow=true;const late=await b.chat('Slow one','dashboard');assert.match(late.error ?? '',/NERV-01 did not answer .*not repeated here/);
  assert.equal((await b.sorties())[0]!.status,'failed','the forwarded sortie records that no answer came; nothing is repeated here');assert.equal((await b.sorties()).length,2);
  // The main base is gone: answered here (this base has no model route, so its Misato says so).
  await la.stop();const local=await b.chat('Anyone there?','dashboard');assert.equal(local.base,undefined);assert.match(local.error ?? '',/No model route for Misato/);
  assert.equal((await b.sorties()).length,3,'the main base gone: answered here, in the sortie opened when it was forwarded');assert.equal((await b.sorties())[0]!.id,local.sortieId);
  // Only the main base takes requests: Tabgha refuses one signed by Neo Tokyo-3.
  const lb2=new KajiLink({baseId:'NERV-02',key:B.privateKey,publicKey:B.publicKey,registry:b.kaji,log:()=>{},onChat:async()=>({sortieId:'',steps:[],waiting:[]})});await lb2.start(60_000);
  try{const body=JSON.stringify({message:'x'});const res=await fetch(`http://127.0.0.1:${pb}/kaji/chat`,{method:'POST',headers:{'content-type':'application/json',...signedHeaders('NERV-01',A.privateKey,'req','POST','/kaji/chat',body)},body});assert.equal(res.status,409);}
  finally{await lb2.stop();}
 }finally{await la.stop();await b.close();sa.close();rmSync(homeB,{recursive:true,force:true});}
});
test('a dispatched conversation has its own key per base and channel',()=>{
 const st=new Store(':memory:');try{assert.deepEqual(st.ledger.conversation('kaji:nerv-02-dashboard'),[]);assert.throws(()=>st.ledger.conversation('kaji:NERV 02'),/Invalid conversation/);}finally{st.close();}
});
