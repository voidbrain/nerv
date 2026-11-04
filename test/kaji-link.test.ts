import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,type KeyObject} from 'node:crypto';
import {createServer} from 'node:net';
import {Store} from '../src/store.ts';
import {Registry,createRootKey,signRecord,unlockRootKey,type BaseEntry,type RegistryBody,type SignedRecord} from '../src/kaji.ts';
import {KajiLink,Nonces,endpoint,signedHeaders,verifySigned,type RegistryPort} from '../src/kaji-link.ts';
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
