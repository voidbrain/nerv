import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createServer as httpServer} from 'node:http';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createRootKey,signRecord,unlockRootKey,type RegistryBody} from '../src/kaji.ts';
import {KajiLink,sanitizeOffers,signedHeaders} from '../src/kaji-link.ts';
import type {ChatReply} from '../src/runtime.ts';
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function until(check:()=>boolean|Promise<boolean>,ms=15000){const end=Date.now()+ms;while(!(await check())){if(Date.now()>end)throw new Error('timed out');await wait(25);}}
const freePort=async()=>{const s=createServer();await new Promise<void>(d=>s.listen(0,'127.0.0.1',d));const p=(s.address() as {port:number}).port;await new Promise<void>(d=>s.close(()=>d()));return p;};
const keys=()=>{const k=generateKeyPairSync('ed25519');return {privateKey:k.privateKey,publicKey:k.publicKey.export({type:'spki',format:'der'}).toString('base64')};};
const root=(()=>{const f=createRootKey('a long test passphrase');return unlockRootKey(f.file,'a long test passphrase');})();
let serial=0;const rec=(body:Omit<RegistryBody,'serial'|'issued'>)=>signRecord(root.privateKey,{...body,serial:++serial,issued:new Date().toISOString()} as RegistryBody);
/** A fake local model: Misato follows a script and its system prompt is kept; Casper always approves. */
async function fakeModel(script:string[]){
 const systems:string[]=[];const casperPrompts:string[]=[];
 const s=httpServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',()=>{const r=JSON.parse(raw) as {messages:{content:string}[]};const casper=r.messages[0]!.content.startsWith('You are Casper');
  if(!casper)systems.push(r.messages[0]!.content);else casperPrompts.push(r.messages.at(-1)!.content);res.setHeader('content-type','application/json');
  res.end(JSON.stringify({choices:[{message:{content:casper?'{"vote":"approve","reason":"Matches.","confidence":0.9}':(script.shift() ?? '{"reply":"ok"}')},finish_reason:'stop'}]}));});});
 await new Promise<void>(d=>s.listen(0,'127.0.0.1',d));return {url:`http://127.0.0.1:${(s.address() as {port:number}).port}/v1`,systems,casperPrompts,close:()=>new Promise<void>(d=>{s.close(()=>d());s.closeAllConnections();})};
}
test('offers keep action names only',()=>{
 assert.deepEqual(sanitizeOffers(['reminders.add','reminders.add','kaji.run']),['reminders.add'],'never kaji.run itself');
 for(const bad of [null,'reminders.add',['Reminders Add'],Array.from({length:21},(_,i)=>'a.b'+String.fromCharCode(97+i))])assert.equal(sanitizeOffers(bad),undefined);
});
test('kaji.run: the main base\'s Misato sends one action to a base that offers it; the owner approves it there; that base runs it once through its own gate; the result comes back as a follow-up',{timeout:60000},async()=>{
 const {Runtime}=await import('../src/runtime.ts');
 const A=keys(),B=keys();const pa=await freePort(),pb=await freePort();
 const RUN='{"action":{"tool":"kaji.run","args":{"base":"NERV-02","tool":"reminders.add","args":{"title":"Stretch","due":"2031-01-01T09:00:00Z"}}}}';
 const model=await fakeModel(['{"action":{"tool":"kaji.run","args":{"base":"NERV-02","tool":"reminders.cancel","args":{"id":"x"}}}}',RUN,'{"reply":"Sent to Tabgha."}']);
 const ha=mkdtempSync(join(tmpdir(),'nerv-run-a-')),hb=mkdtempSync(join(tmpdir(),'nerv-run-b-'));
 writeFileSync(join(ha,'config.json'),JSON.stringify({base:{id:'NERV-01',name:'Neo Tokyo-3'},kaji:{root:root.publicKey},models:{local:{baseUrl:model.url,model:'m'}}}));
 writeFileSync(join(hb,'config.json'),JSON.stringify({base:{id:'NERV-02',name:'Tabgha'},kaji:{root:root.publicKey,offers:['reminders.add']}}));
 const records=[rec({kind:'enrol',baseId:'NERV-01',name:'Neo Tokyo-3',publicKey:A.publicKey,address:`127.0.0.1:${pa}`}),rec({kind:'enrol',baseId:'NERV-02',name:'Tabgha',publicKey:B.publicKey,address:`127.0.0.1:${pb}`}),rec({kind:'main',baseId:'NERV-01'})];
 const a=new Runtime(join(ha,'nerv.sqlite'),undefined,ha),b=new Runtime(join(hb,'nerv.sqlite'),undefined,hb);const links:KajiLink[]=[];
 const follow:ChatReply[]=[];a.onResumed(r=>follow.push(r));
 try{
  await a.ready();await b.ready();await a.kaji.add(records);await b.kaji.add(records);a.setBaseKey(A.publicKey);b.setBaseKey(B.publicKey);
  // Wired as serve does: offers from config, heard offers kept, actions run by runFromPeer.
  const la=new KajiLink({baseId:'NERV-01',key:A.privateKey,publicKey:A.publicKey,registry:a.kaji,log:()=>{},onOffers:(id,t)=>a.notePeerOffers(id,t)});
  const lb=new KajiLink({baseId:'NERV-02',key:B.privateKey,publicKey:B.publicKey,registry:b.kaji,log:()=>{},offers:()=>['reminders.add'],onRun:(from,item)=>b.runFromPeer(from,item,['reminders.add'])});
  links.push(la,lb);await la.start(200);await lb.start(200);a.startResumer(100);
  await until(async()=>(await a.remoteOffers()).length===1);
  const chat=await a.chat('Remind me on Tabgha to stretch');
  assert.match(model.systems[0]!,/kaji\.run[\s\S]*NERV-02 \(Tabgha\): reminders\.add/,'Misato sees what Tabgha offers');
  assert.equal(chat.steps[0]!.outcome,'invalid','an action Tabgha does not offer goes back to Misato');assert.match(chat.steps[0]!.error!,/Tabgha does not offer "reminders.cancel"/);
  assert.equal(chat.waiting.length,1,'every kaji.run asks the owner first');
  // B-012: Casper is told the bases by id and name, so "on Tabgha" matches kaji.run for NERV-02.
  assert.ok((JSON.parse(model.casperPrompts.at(-1)!) as {bases:{id:string;name:string}[]}).bases.some(b=>b.id==='NERV-02'&&b.name==='Tabgha'));assert.equal(chat.waiting[0]!.tool,'kaji.run');
  assert.equal((await b.list()).length,0,'nothing on Tabgha before the owner decides');
  a.startOutbox((base,item)=>la.run(base,item,5000),100);
  await a.decide(chat.waiting[0]!.approvalId,'approve','api');
  await until(async()=>(await b.list()).length===1);assert.equal((await b.list())[0]!.title,'Stretch');
  // B-011: in plain words, and recorded on the sortie (trace, dashboard, why).
  await until(()=>follow.some(f=>f.reply==='Tabgha ran reminders.add (“Stretch”).'));
  const recorded=(await a.events(chat.sortieId)).filter(e=>e.kind==='kaji.result');
  assert.deepEqual(recorded.map(e=>e.payload),[{base:'Tabgha',tool:'reminders.add',outcome:'grant',text:'Tabgha ran reminders.add (“Stretch”).'}]);
  assert.match((await a.chat(`why S-${chat.sortieId.slice(0,4).toUpperCase()}?`)).reply!,/Kaji: Tabgha ran reminders\.add \(“Stretch”\)\./);
  // A resend with the same id (a crash before the result was saved) returns the first result and runs nothing again.
  const twice={id:'00000000-0000-4000-8000-000000000000',request:'',tool:'reminders.add',args:{title:'Twice',due:'2031-01-01T09:00:00Z'}};
  const first=await la.run('NERV-02',twice,5000),second=await la.run('NERV-02',twice,5000);
  assert.equal(first.reached,true);assert.deepEqual(second.result,first.result,'the first result comes back');
  assert.equal((await b.list()).filter(r=>r.title==='Twice').length,1,'the same id runs once');
  // Only what is offered, and only from the main base.
  const refused=await la.run('NERV-02',{id:'11111111-1111-4111-8111-111111111111',request:'',tool:'reminders.cancel',args:{id:'x'}},5000);
  assert.match(JSON.stringify(refused.result),/does not offer reminders\.cancel/);
  const body=JSON.stringify({id:'22222222-2222-4222-8222-222222222222',request:'',tool:'reminders.add',args:{title:'x',due:'2031-01-01T09:00:00Z'}});
  assert.equal((await fetch(`http://127.0.0.1:${pa}/kaji/run`,{method:'POST',headers:{'content-type':'application/json',...signedHeaders('NERV-02',B.privateKey,'req','POST','/kaji/run',body)},body})).status,403,'Tabgha cannot run actions on the main base');
 }finally{for(const l of links)await l.stop();await a.close();await b.close();await model.close();rmSync(ha,{recursive:true,force:true});rmSync(hb,{recursive:true,force:true});}
});
