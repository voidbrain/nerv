import {test} from 'node:test';
import type {ChannelState} from '../src/channel-state.ts';
import {makeServer} from '../src/server.ts';
import assert from 'node:assert/strict';
import {generateKeyPairSync,type KeyObject} from 'node:crypto';
import {createServer} from 'node:net';
import {Store} from '../src/store.ts';
import {Registry,createRootKey,signRecord,unlockRootKey,type BaseEntry,type RegistryBody,type SignedRecord} from '../src/kaji.ts';
import {KajiLink,Nonces,endpoint,missesToLog,sanitizeHealth,signedHeaders,verifySigned,type BaseHealth,type HeardHealth,type RegistryPort} from '../src/kaji-link.ts';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function until(check:()=>Promise<boolean>|boolean,ms=6000){const end=Date.now()+ms;while(!(await check())){if(Date.now()>end)throw new Error('timed out');await wait(25);}}
const freePort=async()=>{const s=createServer();await new Promise<void>(d=>s.listen(0,'127.0.0.1',d));const p=(s.address() as {port:number}).port;await new Promise<void>(d=>s.close(()=>d()));return p;};
const keys=()=>{const k=generateKeyPairSync('ed25519');return {privateKey:k.privateKey,publicKey:k.publicKey.export({type:'spki',format:'der'}).toString('base64')};};
const root=(()=>{const f=createRootKey('a long test passphrase');return {...unlockRootKey(f.file,'a long test passphrase')};})();
let serial=0;const rec=(body:Omit<RegistryBody,'serial'|'issued'>)=>signRecord(root.privateKey,{...body,serial:++serial,issued:new Date().toISOString()} as RegistryBody);
const port=(reg:Registry):RegistryPort=>({bases:async()=>reg.bases(),records:async()=>reg.records(),add:async(rs)=>{let n=0;for(const r of rs){try{if(reg.add(r)==='added')n++;}catch{/* dropped */}}return n;},seen:async(u)=>reg.seen(u),lastSeen:async()=>reg.lastSeen()});
test('requests and replies are signed by enrolled base keys; unknown, revoked, stale, replayed and tampered messages are refused',()=>{
 const a=keys(),b=keys();const bases:BaseEntry[]=[{baseId:'NERV-01',name:'A',publicKey:a.publicKey,address:'127.0.0.1',fingerprint:'',status:'enrolled',serial:1},{baseId:'NERV-02',name:'B',publicKey:b.publicKey,address:'127.0.0.1',fingerprint:'',status:'revoked',serial:2}];
 const body='{"x":1}';const h=signedHeaders('NERV-01',a.privateKey,'req','POST','/kaji/heartbeat',body);const n=new Nonces();
 assert.equal(verifySigned(h,'req','POST','/kaji/heartbeat',body,bases,n),'NERV-01');
 assert.throws(()=>verifySigned(h,'req','POST','/kaji/heartbeat',body,bases,n),/replayed/);
 assert.throws(()=>verifySigned(signedHeaders('NERV-01',a.privateKey,'req','POST','/kaji/heartbeat',body),'req','POST','/kaji/heartbeat','{"x":2}',bases,n),/bad signature/);
 assert.throws(()=>verifySigned(signedHeaders('NERV-01',a.privateKey,'req','POST','/kaji/heartbeat',body),'res','POST','/kaji/heartbeat',body,bases,n),/bad signature/,'a request cannot pass as a reply');
 assert.throws(()=>verifySigned(signedHeaders('NERV-02',b.privateKey,'req','GET','/kaji/registry',''),'req','GET','/kaji/registry','',bases,n),/revoked/);
 assert.throws(()=>verifySigned(signedHeaders('EVIL-01',keys().privateKey,'req','GET','/kaji/registry',''),'req','GET','/kaji/registry','',bases,n),/unknown/);
 assert.throws(()=>verifySigned(signedHeaders('NERV-01',a.privateKey,'req','GET','/x','',new Date(Date.now()-10*60_000)),'req','GET','/x','',bases,n),/stale/);
 assert.throws(()=>verifySigned(signedHeaders('NERV-01',keys().privateKey,'req','GET','/x',''),'req','GET','/x','',bases,n),/bad signature/,'right id, wrong key');
 assert.deepEqual(endpoint('100.64.0.2'),{host:'100.64.0.2',port:4320});assert.deepEqual(endpoint('127.0.0.1:4555'),{host:'127.0.0.1',port:4555});
});
test('two bases over the link: heartbeats mark each other online, last-seen merges, a base behind on the registry catches up, an impostor and a revoked base are refused',async()=>{
 const A=keys(),B=keys(),C=keys(),evil=keys();const pa=await freePort(),pb=await freePort();
 const sa=new Store(':memory:'),sb=new Store(':memory:');const ra=new Registry(sa.db,root.publicKey),rb=new Registry(sb.db,root.publicKey);
 const ea=rec({kind:'enrol',baseId:'NERV-01',name:'Neo Tokyo-3',publicKey:A.publicKey,address:`127.0.0.1:${pa}`}),eb=rec({kind:'enrol',baseId:'NERV-02',name:'Tabgha',publicKey:B.publicKey,address:`127.0.0.1:${pb}`});
 for(const r of [ea,eb]){ra.add(r);rb.add(r);}
 const logs:string[]=[];const link=(id:string,k:{privateKey:KeyObject;publicKey:string},reg:Registry)=>new KajiLink({baseId:id,key:k.privateKey,publicKey:k.publicKey,registry:port(reg),log:l=>logs.push(id+' '+l)});
 const la=link('NERV-01',A,ra),lb=link('NERV-02',B,rb);
 try{
  await la.start(200);await lb.start(200);
  await until(()=>!!ra.lastSeen()['NERV-02']&&!!rb.lastSeen()['NERV-01']);
  assert.ok(logs.some(l=>/NERV-01 Kaji: listening on 127\.0\.0\.1:/.test(l)));
  // A new base enrolled on the main base reaches the other base by itself, verified against its own pinned root.
  ra.add(rec({kind:'enrol',baseId:'NERV-03',name:'Bethany',publicKey:C.publicKey,address:'127.0.0.1:9'}));
  await until(()=>rb.bases().some(b=>b.baseId==='NERV-03'));assert.ok(logs.some(l=>/NERV-02 Kaji: 1 new registry record\(s\) from NERV-01/.test(l)));
  // An impostor with a valid-looking request but no enrolment is refused.
  const h=signedHeaders('EVIL-01',evil.privateKey,'req','GET','/kaji/registry','');const res=await fetch(`http://127.0.0.1:${pa}/kaji/registry`,{headers:h});assert.equal(res.status,403);
  await until(()=>logs.some(l=>/NERV-01 Kaji: refused a request \(unknown or revoked base\)/.test(l)));
  // A forged registry record pushed by a peer is never accepted: records must verify against the base's own root.
  const forged:SignedRecord=signRecord(keys().privateKey,{kind:'enrol',serial:99,baseId:'EVIL-02',name:'x',publicKey:evil.publicKey,address:'127.0.0.1',issued:new Date().toISOString()});
  assert.equal(await port(rb).add([forged]),0);
  // Revoke Tabgha on the main base: from then on its requests are refused there.
  ra.add(rec({kind:'revoke',baseId:'NERV-02',publicKey:B.publicKey}));const before=logs.length;
  await until(()=>logs.slice(before).some(l=>/NERV-01 Kaji: refused a request \(unknown or revoked base\)/.test(l)));
 }finally{await la.stop();await lb.stop();sa.close();sb.close();}
});
test('a health report keeps only its state and up to three short reasons',()=>{
 assert.deepEqual(sanitizeHealth({state:'degraded',reasons:['a','b','c','d',7,'','x'.repeat(300)]}),{state:'degraded',reasons:['a','b','c']});
 assert.equal(sanitizeHealth({state:'degraded',reasons:['x'.repeat(300)]})!.reasons[0]!.length,200);
 assert.deepEqual(sanitizeHealth({state:'degraded',reasons:['line\nbreak\u0007']}),{state:'degraded',reasons:['line break ']});
 assert.deepEqual(sanitizeHealth({state:'online',reasons:['ignored']}),{state:'online',reasons:[]});
 for(const bad of [null,'online',[],{state:'evil'},{reasons:[]}])assert.equal(sanitizeHealth(bad),undefined);
});
test('heartbeats carry each base\'s own health, both ways; a malformed report from a peer is dropped',async()=>{
 const A=keys(),B=keys();const pa=await freePort(),pb=await freePort();
 const sa=new Store(':memory:'),sb=new Store(':memory:');const ra=new Registry(sa.db,root.publicKey),rb=new Registry(sb.db,root.publicKey);
 for(const r of [rec({kind:'enrol',baseId:'NERV-01',name:'Neo Tokyo-3',publicKey:A.publicKey,address:`127.0.0.1:${pa}`}),rec({kind:'enrol',baseId:'NERV-02',name:'Tabgha',publicKey:B.publicKey,address:`127.0.0.1:${pb}`})]){ra.add(r);rb.add(r);}
 const heardA:Record<string,HeardHealth>={},heardB:Record<string,HeardHealth>={};let healthB:BaseHealth={state:'online',reasons:[]};
 const la=new KajiLink({baseId:'NERV-01',key:A.privateKey,publicKey:A.publicKey,registry:port(ra),log:()=>{},health:async()=>({state:'degraded',reasons:['S² local route down since 09:00: Local route (S²) unreachable.']}),onHealth:(id,h)=>{heardA[id]=h;}});
 const lb=new KajiLink({baseId:'NERV-02',key:B.privateKey,publicKey:B.publicKey,registry:port(rb),log:()=>{},health:async()=>healthB,onHealth:(id,h)=>{heardB[id]=h;}});
 try{
  await la.start(150);await lb.start(150);
  await until(()=>!!heardA['NERV-02']&&!!heardB['NERV-01']);
  assert.deepEqual([heardB['NERV-01']!.state,heardB['NERV-01']!.reasons],['degraded',['S² local route down since 09:00: Local route (S²) unreachable.']]);
  assert.equal(heardA['NERV-02']!.state,'online');assert.ok(Date.parse(heardA['NERV-02']!.at)<=Date.now());
  healthB={state:'degraded',reasons:['brain process not alive']};await until(()=>heardA['NERV-02']!.state==='degraded');
  // A signed heartbeat from NERV-02 whose health is malformed: last-seen still merges, the report is ignored.
  // Stop both links and let any heartbeat already in flight land before taking the reference time.
  await la.stop();await lb.stop();await wait(1000);
  const before=heardA['NERV-02']!.at;const body=JSON.stringify({seen:{},health:{state:'evil',reasons:['<script>']}});
  const lc=new KajiLink({baseId:'NERV-01',key:A.privateKey,publicKey:A.publicKey,registry:port(ra),log:()=>{},onHealth:(id,h)=>{heardA[id]=h;}});await lc.start(60_000);
  try{const res=await fetch(`http://127.0.0.1:${pa}/kaji/heartbeat`,{method:'POST',headers:{'content-type':'application/json',...signedHeaders('NERV-02',B.privateKey,'req','POST','/kaji/heartbeat',body)},body});
   assert.equal(res.status,200);assert.equal(heardA['NERV-02']!.at,before,'the malformed report changed nothing');
   assert.equal(((await res.json()) as {health?:unknown}).health,undefined,'a base with no health check sends none');}
  finally{await lc.stop();}
 }finally{await la.stop();await lb.stop();sa.close();sb.close();}
});
test('through two runtimes wired as serve does: a base whose model route is down shows as degraded, with its reason, in the other base\'s /api/bases',{timeout:20000},async()=>{
 const {Runtime}=await import('../src/runtime.ts');
 const A=keys(),B=keys();const pa=await freePort(),pb=await freePort(),dead=await freePort();
 const ha=mkdtempSync(join(tmpdir(),'nerv-kh-a-')),hb=mkdtempSync(join(tmpdir(),'nerv-kh-b-'));
 writeFileSync(join(ha,'config.json'),JSON.stringify({base:{id:'NERV-01',name:'Neo Tokyo-3'},kaji:{root:root.publicKey},models:{local:{baseUrl:`http://127.0.0.1:${dead}/v1`,model:'m'}}}));
 writeFileSync(join(hb,'config.json'),JSON.stringify({base:{id:'NERV-02',name:'Tabgha'},kaji:{root:root.publicKey}}));
 const records=[rec({kind:'enrol',baseId:'NERV-01',name:'Neo Tokyo-3',publicKey:A.publicKey,address:`127.0.0.1:${pa}`}),rec({kind:'enrol',baseId:'NERV-02',name:'Tabgha',publicKey:B.publicKey,address:`127.0.0.1:${pb}`})];
 const a=new Runtime(join(ha,'nerv.sqlite'),undefined,ha),b=new Runtime(join(hb,'nerv.sqlite'),undefined,hb);const links:KajiLink[]=[];
 try{
  await a.ready();await b.ready();assert.equal(await a.kaji.add(records),2);assert.equal(await b.kaji.add(records),2);
  a.setBaseKey(A.publicKey);b.setBaseKey(B.publicKey);
  let report:ChannelState={mode:'local-fallback',destination:'NERV-01',checkedAt:new Date().toISOString(),polling:true,api:{state:'responding',at:new Date().toISOString()},lastReceived:new Date().toISOString(),lastDelivery:{route:'local',result:'accepted',at:new Date().toISOString()}};
  a.setChannelState(()=>({mode:'unavailable',checkedAt:new Date().toISOString()}));b.setChannelState(()=>report);
  for(const [r,id,k] of [[a,'NERV-01',A],[b,'NERV-02',B]] as const)links.push(new KajiLink({baseId:id,key:k.privateKey,publicKey:k.publicKey,registry:r.kaji,log:()=>{},health:()=>r.baseHealth(),onHealth:(peer,h)=>r.notePeerHealth(peer,h),channel:()=>r.channelState(),onChannel:(peer,c)=>r.notePeerChannel(peer,c)}));
  for(const l of links)await l.start(200);
  type Base={baseId:string;online:boolean;self:boolean;health:{state:string;reasons:string[]}|null};
  await until(async()=>((await b.bases()) as Base[]).find(x=>x.baseId==='NERV-01')?.health?.state==='degraded',15000);
  const seenByB=(await b.bases()) as Base[];const tokyo=seenByB.find(x=>x.baseId==='NERV-01')!;
  assert.ok(tokyo.online);assert.match(tokyo.health!.reasons[0]!,/^S² local route down since .*: Local route \(S²\) unreachable\./);
  assert.equal(seenByB.find(x=>x.self)!.health!.state,'online','Tabgha has no model route configured: nothing is down');
  await until(async()=>((await a.bases()) as Base[]).find(x=>x.baseId==='NERV-02')?.health?.state==='online');
  await until(async()=>(await a.bases()).find(x=>x.baseId==='NERV-02')?.channel?.mode==='local-fallback');
  const api=makeServer(a,'a'.repeat(32));await new Promise<void>(done=>api.listen(0,'127.0.0.1',done));
  const base=`http://127.0.0.1:${(api.address() as {port:number}).port}`;
  const read=async()=>await (await fetch(base+'/api/bases',{headers:{authorization:'Bearer '+'a'.repeat(32)}})).json() as Awaited<ReturnType<typeof a.bases>>;
  try{
   assert.equal((await fetch(base+'/api/bases')).status,401);
   let peer=(await read()).find(x=>x.baseId==='NERV-02')!;
   assert.equal(peer.channelFresh,true);assert.equal(peer.channel?.lastDelivery?.result,'accepted');assert.equal(peer.channel?.destination,'NERV-01');assert.equal(peer.channel?.api?.state,'responding');assert.ok(peer.channel?.lastReceived);assert.equal(peer.channel?.polling,true);
   assert.equal((await b.bases()).find(x=>x.baseId==='NERV-01')?.channel?.mode,'unavailable','reply reports only its own channel');
   report={...report,checkedAt:new Date(Date.now()-100_000).toISOString()};
   await until(async()=>(await read()).find(x=>x.baseId==='NERV-02')?.channelFresh===false);
   peer=(await read()).find(x=>x.baseId==='NERV-02')!;assert.equal(peer.online,true,'heartbeat can be online with stale channel state');
   report={mode:'via-main',destination:'NERV-01',checkedAt:new Date().toISOString()};
   await until(async()=>(await read()).find(x=>x.baseId==='NERV-02')?.channel?.mode==='via-main');
   // An older peer that omits telemetry clears the previous report, rather than refreshing it.
   await links[1]!.stop();
   const old=new KajiLink({baseId:'NERV-02',key:B.privateKey,publicKey:B.publicKey,registry:b.kaji,log:()=>{}});
   try{await old.start(200);await until(async()=>(await read()).find(x=>x.baseId==='NERV-02')?.channel===null);}finally{await old.stop();}
  }finally{await new Promise<void>(done=>api.close(()=>done()));}

 }finally{for(const l of links)await l.stop();await a.close();await b.close();rmSync(ha,{recursive:true,force:true});rmSync(hb,{recursive:true,force:true});}
});
test('one missed heartbeat is not logged: a peer is logged unreachable only after a full online window of misses, once',async()=>{
 assert.equal(missesToLog(30_000),3);assert.equal(missesToLog(200_000),1);
 const A=keys(),B=keys();const dead=await freePort();const st=new Store(':memory:');const reg=new Registry(st.db,root.publicKey);
 for(const r of [rec({kind:'enrol',baseId:'NERV-01',name:'Neo Tokyo-3',publicKey:A.publicKey,address:'127.0.0.1:1'}),rec({kind:'enrol',baseId:'NERV-02',name:'Tabgha',publicKey:B.publicKey,address:`127.0.0.1:${dead}`})])reg.add(r);
 const logs:string[]=[];const link=new KajiLink({baseId:'NERV-01',key:A.privateKey,publicKey:A.publicKey,registry:port(reg),log:l=>logs.push(l)});
 try{
  const down=()=>logs.filter(l=>/NERV-02 unreachable/.test(l));
  await link.heartbeat();await link.heartbeat();assert.deepEqual(down(),[],'two misses at 30 s are still within the 90 s online window');
  await link.heartbeat();assert.equal(down().length,1);assert.match(down()[0]!,/; 3 heartbeats missed\.$/);
  await link.heartbeat();assert.equal(down().length,1,'logged once, not on every miss');
 }finally{st.close();}
});
test('a stop while a tick is still looking up the address leaves no listener and no timer behind (B-001)',async()=>{
 const A=keys();const free=await freePort();const st=new Store(':memory:');const reg=new Registry(st.db,root.publicKey);
 reg.add(rec({kind:'enrol',baseId:'NERV-01',name:'Neo Tokyo-3',publicKey:A.publicKey,address:`127.0.0.1:${free}`}));
 let release=()=>{};const gate=new Promise<void>(d=>{release=d;});const logs:string[]=[];
 const slow:RegistryPort={...port(reg),bases:async()=>{await gate;return reg.bases();}};
 const link=new KajiLink({baseId:'NERV-01',key:A.privateKey,publicKey:A.publicKey,registry:slow,log:l=>logs.push(l)});
 try{
  const started=link.start(50);const stopped=link.stop();release();await started;await stopped;await wait(150);
  assert.ok(!logs.some(l=>/listening on/.test(l)),'no listener opened after the stop');
  const s=createServer();await new Promise<void>((d,f)=>{s.once('error',f);s.listen(free,'127.0.0.1',()=>d());});await new Promise<void>(d=>s.close(()=>d()));
  assert.equal((link as unknown as {timer?:unknown}).timer,undefined,'no heartbeat timer set after the stop');
 }finally{await link.stop();st.close();}
});
test('F-014: invalid signatures cannot consume a legitimate request nonce',()=>{
 const a=keys(),body='{}',headers=signedHeaders('NERV-01',a.privateKey,'req','GET','/neutral',body),nonces=new Nonces();
 const bases:BaseEntry[]=[{baseId:'NERV-01',name:'Neutral',publicKey:a.publicKey,address:'127.0.0.1:9',fingerprint:'neutral',status:'enrolled',serial:1}];
 const forged={...headers,'x-kaji-signature':signedHeaders('NERV-01',keys().privateKey,'req','GET','/neutral',body)['x-kaji-signature']!};
 assert.throws(()=>verifySigned(forged,'req','GET','/neutral',body,bases,nonces),/bad signature/);
 assert.equal(verifySigned(headers,'req','GET','/neutral',body,bases,nonces),'NERV-01','authentication must precede replay-cache admission');
});
