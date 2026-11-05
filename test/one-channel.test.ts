import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createServer as httpServer} from 'node:http';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
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
  tap:(data:string,rows:unknown)=>updates.push({update_id:next++,callback_query:{id:'q'+next,data,from:{id:OWNER},message:{message_id:7,chat:{id:OWNER},reply_markup:{inline_keyboard:rows}}}}),close:()=>new Promise<void>(d=>s.close(()=>d()))};
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
 let aoba:TelegramChannel|undefined;let mainUp=true;
 const la=new KajiLink({baseId:'NERV-01',key:A.privateKey,publicKey:A.publicKey,registry:port(ra),log:()=>{},onRelay:async(from,relay)=>aoba!.relayed(from,from==='NERV-02'?'Tabgha':from,relay)});
 const lb=new KajiLink({baseId:'NERV-02',key:B.privateKey,publicKey:B.publicKey,registry:port(rb),log:()=>{},onDecide:async(id,d)=>decisionText(sb.decide(id,d,'telegram'))});
 aoba=new TelegramChannel({api:new TelegramApi(ta,botA.base),store:sa as unknown as StoreApi,chatId:OWNER,statePath:join(homeA,'tg.json'),log:()=>{},remote:{decide:(b,id,d)=>la.decide(b,id,d)}});
 const tabgha=new TelegramChannel({api:new TelegramApi(tb,botB.base),store:sb as unknown as StoreApi,chatId:OWNER,statePath:join(homeB,'tg.json'),log:()=>{},
  oneChannel:{quiet:async()=>mainUp,relay:(text,cards)=>lb.relay({text,cards})}});
 try{
  await la.start(60_000);await lb.start(60_000);await aoba.start(100);await tabgha.start(100);
  // A card on Tabgha (an owner-only action), while Neo Tokyo-3 is the main base and online.
  const s=sb.ledger.openSortie('owner','Remember it','trusted');assert.equal(sb.runAction(s,{tool:'memory.remember',args:{text:'Coffee at 8'},stage:'production'}).outcome,'approval');
  await until(()=>botA.sent().some(m=>m.text.startsWith('🛰 Tabgha · ')&&!!m.reply_markup),15000);
  assert.equal(botB.sent().length,0,'Tabgha\'s own bot stays quiet');assert.ok(!botB.calls.some(c=>c.method==='getUpdates'),'and does not read its updates');
  const relayed=botA.sent().find(m=>m.text.startsWith('🛰 Tabgha · '))!;const rows=relayed.reply_markup!.inline_keyboard;
  assert.match(rows[0]![0]!.callback_data,/^k:NERV-02:a:[a-f0-9-]{36}$/);
  botA.tap(rows[0]![0]!.callback_data,rows);
  await until(()=>sb.memory.list().length===1);assert.equal(sb.memory.list()[0]!.text,'Coffee at 8','the tap on Aoba decided the card on Tabgha');
  await until(()=>botA.sent().some(m=>/^🛰 NERV-02 · Approved/.test(m.text)));
  // A forged decision from a base that is not the main one is refused by Tabgha.
  const body=JSON.stringify({approvalId:'0'.repeat(8)+'-0000-4000-8000-'+'0'.repeat(12),decision:'approve'});
  const forged=await fetch(`http://127.0.0.1:${pb}/kaji/decide`,{method:'POST',headers:{'content-type':'application/json',...signedHeaders('NERV-02',B.privateKey,'req','POST','/kaji/decide',body)},body});assert.equal(forged.status,403);
  // The main base goes away: Tabgha speaks with its own bot again.
  mainUp=false;await sb.add('Stretch',new Date(Date.now()+300).toISOString());sb.tick(new Date(Date.now()+1000));
  await until(()=>botB.sent().some(m=>/⏰ Stretch/.test(m.text)));
 }finally{await tabgha.stop();await aoba.stop();await la.stop();await lb.stop();sa.close();sb.close();await botA.close();await botB.close();rmSync(homeA,{recursive:true,force:true});rmSync(homeB,{recursive:true,force:true});}
});
