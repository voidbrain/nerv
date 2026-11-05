import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createServer as httpServer} from 'node:http';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createRootKey,signRecord,unlockRootKey,type RegistryBody} from '../src/kaji.ts';
import {KajiLink,sanitizeVerdict,signedHeaders} from '../src/kaji-link.ts';
import {ballot,defaultPolicy} from '../src/policy.ts';
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function until(check:()=>boolean|Promise<boolean>,ms=15000){const end=Date.now()+ms;while(!(await check())){if(Date.now()>end)throw new Error('timed out');await wait(25);}}
const freePort=async()=>{const s=createServer();await new Promise<void>(d=>s.listen(0,'127.0.0.1',d));const p=(s.address() as {port:number}).port;await new Promise<void>(d=>s.close(()=>d()));return p;};
const keys=()=>{const k=generateKeyPairSync('ed25519');return {privateKey:k.privateKey,publicKey:k.publicKey.export({type:'spki',format:'der'}).toString('base64')};};
const root=(()=>{const f=createRootKey('a long test passphrase');return unlockRootKey(f.file,'a long test passphrase');})();
let serial=0;const rec=(body:Omit<RegistryBody,'serial'|'issued'>)=>signRecord(root.privateKey,{...body,serial:++serial,issued:new Date().toISOString()} as RegistryBody);
/** A fake local model whose Casper always gives the same vote. */
async function casperSays(vote:'approve'|'reject'){
 const s=httpServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',()=>{res.setHeader('content-type','application/json');
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({vote,reason:vote==='approve'?'Matches the request.':'This does not match what the owner asked.',confidence:0.9})},finish_reason:'stop'}]}));});});
 await new Promise<void>(d=>s.listen(0,'127.0.0.1',d));return {url:`http://127.0.0.1:${(s.address() as {port:number}).port}/v1`,close:()=>new Promise<void>(d=>{s.close(()=>d());s.closeAllConnections();})};
}
test('peer seats are veto-only: a shadow reject is shown and never counted, a veto reject stops the action, an approve adds nothing',()=>{
 const action={tool:'reminders.cancel',args:{id:'x'},trust:'trusted' as const,stage:'production' as const,cost:0};
 const tool={name:'reminders.cancel',effect:'write-local' as const};const policy={...defaultPolicy,blue:['reminders.cancel']};
 const casper={seat:'casper',vote:'approve' as const,reason:'ok',confidence:0.9};
 assert.equal(ballot(action,tool,policy,0,casper,[{seat:'NERV-02',vote:'reject',reason:'no',shadow:true}]).outcome,'approval','shadow: counted nowhere');
 const veto=ballot(action,tool,policy,0,casper,[{seat:'NERV-02',vote:'reject',reason:'no'}]);assert.equal(veto.outcome,'reject');assert.match(veto.reason,/^extra:NERV-02: no/);
 assert.equal(ballot(action,tool,policy,0,undefined,[{seat:'NERV-02',vote:'approve',reason:'yes'}]).outcome,'approval','a peer approve never replaces Casper');
 assert.deepEqual(sanitizeVerdict({vote:'reject',reason:'x\nnope'}),{vote:'reject',reason:'x nope'});assert.equal(sanitizeVerdict({vote:'maybe',reason:''}),undefined);
});
test('through two runtimes: the main base asks the other base\'s Casper; shadow shows its vote, veto lets it stop the action, an absent base abstains',{timeout:60000},async()=>{
 const {Runtime}=await import('../src/runtime.ts');
 const A=keys(),B=keys();const pa=await freePort(),pb=await freePort();const yes=await casperSays('approve'),no=await casperSays('reject');
 const ha=mkdtempSync(join(tmpdir(),'nerv-seat-a-')),hb=mkdtempSync(join(tmpdir(),'nerv-seat-b-'));
 writeFileSync(join(ha,'config.json'),JSON.stringify({base:{id:'NERV-01',name:'Neo Tokyo-3'},kaji:{root:root.publicKey},models:{local:{baseUrl:yes.url,model:'m'}}}));
 writeFileSync(join(ha,'scrolls.json'),JSON.stringify({blue:['reminders.cancel']}),{mode:0o600});
 writeFileSync(join(hb,'config.json'),JSON.stringify({base:{id:'NERV-02',name:'Tabgha'},kaji:{root:root.publicKey},models:{local:{baseUrl:no.url,model:'m'}}}));
 const records=[rec({kind:'enrol',baseId:'NERV-01',name:'Neo Tokyo-3',publicKey:A.publicKey,address:`127.0.0.1:${pa}`}),rec({kind:'enrol',baseId:'NERV-02',name:'Tabgha',publicKey:B.publicKey,address:`127.0.0.1:${pb}`}),rec({kind:'main',baseId:'NERV-01'})];
 const a=new Runtime(join(ha,'nerv.sqlite'),undefined,ha),b=new Runtime(join(hb,'nerv.sqlite'),undefined,hb);
 let seats:Record<string,string>={};let lb:KajiLink|undefined;
 const la=new KajiLink({baseId:'NERV-01',key:A.privateKey,publicKey:A.publicKey,registry:a.kaji,log:()=>{}});
 try{
  await a.ready();await b.ready();await a.kaji.add(records);await b.kaji.add(records);a.setBaseKey(A.publicKey);b.setBaseKey(B.publicKey);
  lb=new KajiLink({baseId:'NERV-02',key:B.privateKey,publicKey:B.publicKey,registry:b.kaji,log:()=>{},onVerdict:(_f,ask)=>b.peerVerdict(ask)});
  await la.start(200);await lb.start(200);
  // Wired as serve does on the main base.
  a.setPeerSeats(async ask=>{const main=await a.mainBase();if(!main?.self)return [];const peers=(await a.bases()).filter(x=>!x.self&&x.online&&x.status==='enrolled'&&seats[x.baseId]!=='off');
   return Promise.all(peers.map(async x=>({seat:x.baseId,...await la.verdict(x.baseId,ask,3000),shadow:seats[x.baseId]!=='veto'})));});
  await until(async()=>(await a.bases()).some(x=>x.baseId==='NERV-02'&&x.online));
  const shadow=await a.act({request:'Cancel it',tool:'reminders.cancel',args:{id:'x'}});
  assert.equal(shadow.outcome,'approval','in shadow Tabgha\'s reject is not counted: the card goes to the owner');
  const card=(await a.approvals(5))[0]!.card;const peer=card.verdicts.find(v=>v.seat==='extra:NERV-02')!;
  assert.deepEqual([peer.vote,peer.shadow],['reject',true],'and its vote is on the card');
  seats={'NERV-02':'veto'};
  const vetoed=await a.act({request:'Cancel it again',tool:'reminders.cancel',args:{id:'y'}});
  assert.equal(vetoed.outcome,'reject');assert.match(vetoed.reason ?? '',/^extra:NERV-02: This does not match/);
  await lb.stop();lb=undefined;
  const alone=await a.act({request:'Cancel a third',tool:'reminders.cancel',args:{id:'z'}});
  assert.equal(alone.outcome,'approval','Tabgha gone: it abstains, nothing is blocked');
  // Only the main base asks for votes: Tabgha's link refuses an ask signed by a base that is not the main one.
  const lb2=new KajiLink({baseId:'NERV-02',key:B.privateKey,publicKey:B.publicKey,registry:b.kaji,log:()=>{},onVerdict:async()=>null});await lb2.start(60_000);
  try{const body=JSON.stringify({request:'x',tool:'reminders.add',args:{},effect:'write-local'});
   assert.equal((await fetch(`http://127.0.0.1:${pb}/kaji/verdict`,{method:'POST',headers:{'content-type':'application/json',...signedHeaders('NERV-02',B.privateKey,'req','POST','/kaji/verdict',body)},body})).status,403);}
  finally{await lb2.stop();}
 }finally{await la.stop();if(lb)await lb.stop();await a.close();await b.close();await yes.close();await no.close();rmSync(ha,{recursive:true,force:true});rmSync(hb,{recursive:true,force:true});}
});
