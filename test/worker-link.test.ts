import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {WebSocket} from 'ws';
import {WorkerLink,type WorkerAdapter} from '../src/worker-link.ts';
import {signedHeaders} from '../src/kaji-auth.ts';
import {signRecord,type RegistryBody} from '../src/kaji.ts';
import {Runtime} from '../src/runtime.ts';
const wait=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function until(check:()=>boolean|Promise<boolean>){const end=Date.now()+15000;while(!(await check())){if(Date.now()>end)throw Error('Worker condition timed out');await wait(20);}}
const keys=()=>{const k=generateKeyPairSync('ed25519');return {privateKey:k.privateKey,publicKey:k.publicKey.export({type:'spki',format:'der'}).toString('base64')};};
const item=(n:number)=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sequence:n,request:'Add a neutral reminder',tool:'reminders.add',args:{title:'Neutral '+n,due:'2031-01-01T09:00:00Z'}});
async function fixture(){
 const root=keys(),a=keys(),b=keys(),homeA=mkdtempSync(join(tmpdir(),'nerv-worker-a-')),homeB=mkdtempSync(join(tmpdir(),'nerv-worker-b-'));
 for(const [home,id] of [[homeA,'NERV-01'],[homeB,'NERV-02']])writeFileSync(join(home,'config.json'),JSON.stringify({base:{id,name:'Neutral fixture'},kaji:{root:root.publicKey,offers:['reminders.add']},models:{local:{baseUrl:'http://127.0.0.1:9/v1',model:'unused-fixture'}}}));
 const ra=new Runtime(join(homeA,'nerv.sqlite'),undefined,homeA);let rb=new Runtime(join(homeB,'nerv.sqlite'),undefined,homeB);await Promise.all([ra.ready(),rb.ready()]);
 const server=createServer((_req,res)=>{res.writeHead(404);res.end();});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=`127.0.0.1:${(server.address() as {port:number}).port}`;let serial=0;
 const record=(body:Omit<RegistryBody,'serial'|'issued'>)=>signRecord(root.privateKey,{...body,serial:++serial,issued:new Date().toISOString()} as RegistryBody);
 const records=[record({kind:'enrol',baseId:'NERV-01',name:'Aster',publicKey:a.publicKey,address}),record({kind:'enrol',baseId:'NERV-02',name:'Harbor',publicKey:b.publicKey,address:'127.0.0.1:1'}),record({kind:'main',baseId:'NERV-01'})];await Promise.all([ra.kaji.add(records),rb.kaji.add(records)]);
 const main=new WorkerLink({id:'NERV-01',key:a.privateKey,registry:ra.kaji,adapter:ra.worker,address:s=>'ws://'+s,heartbeatMs:150,requestMs:1000,reconnectMs:30});main.attach(server);
 let adapter:WorkerAdapter={open:(o,s,k,ok)=>rb.worker.open(o,s,k,ok),close:(o,s)=>rb.worker.close(o,s),run:(o,i,c)=>rb.worker.run(o,i,c)};
 const worker=()=>new WorkerLink({id:'NERV-02',key:b.privateKey,registry:rb.kaji,adapter:{open:(o,s,k,ok)=>adapter.open(o,s,k,ok),close:(o,s)=>adapter.close(o,s),run:(o,i,c)=>adapter.run(o,i,c)},address:s=>'ws://'+s,heartbeatMs:150,requestMs:1000,reconnectMs:30});let link=worker();const sockets:WebSocket[]=[];
 return {main,get rb(){return rb;},ra,homeB,address,b,record,server,setAdapter:(next:WorkerAdapter)=>{adapter=next;},get adapter(){return adapter;},start:async()=>{main.start();link.start();await until(()=>main.connected('NERV-02'));},
  restartWorker:async()=>{await link.stop();await rb.close();rb=new Runtime(join(homeB,'nerv.sqlite'),undefined,homeB);await rb.ready();link=worker();link.start();await until(()=>main.connected('NERV-02'));},
  raw:async(headers:Record<string,string>,path='/kaji/worker')=>{const socket=new WebSocket('ws://'+address+path,{headers});sockets.push(socket);return socket;},
  close:async()=>{for(const socket of sockets)socket.terminate();await link.stop();await main.stop();await new Promise<void>(done=>server.close(()=>done()));await Promise.all([ra.close(),rb.close()]);rmSync(homeA,{recursive:true,force:true});rmSync(homeB,{recursive:true,force:true});}};
}
test('F-014: actual outbound WebSocket, signed identities, destination gate, lost result and reconnect replay one effect',{timeout:30000},async()=>{
 const f=await fixture();let release!:()=>void;const gate=new Promise<void>(done=>release=done);let committed=false;const original=f.adapter;
 try{f.setAdapter({...original,run:async(o,i,c)=>{const result=await original.run(o,i,c);if(i.id===item(1).id&&!committed){committed=true;await gate;}return result;}});await f.start();
  const lost=f.main.run('NERV-02',item(1),5000);const lostOutcome=lost.catch(e=>e);await until(()=>committed);f.main.dropIncoming();assert.ok(await lostOutcome instanceof Error);release();await until(()=>f.main.connected('NERV-02'));
  const replay=await f.main.run('NERV-02',item(1),5000) as {outcome:string};assert.equal(replay.outcome,'grant');assert.equal((await f.rb.list()).length,1);
  await assert.rejects(f.main.run('NERV-02',{...item(1),args:{title:'Changed',due:'2031-01-01T09:00:00Z'}},5000));assert.equal((await f.rb.list()).length,1);
  const second=await f.main.run('NERV-02',item(2),5000) as {outcome:string};assert.equal(second.outcome,'grant');assert.equal((await f.rb.list()).length,2);
 }finally{release();await f.close();}
});
test('F-014: restart during unfinished work preserves uncertainty and resource lock until explicit owner reconciliation',{timeout:30000},async()=>{
 const f=await fixture();let release!:()=>void;const gate=new Promise<void>(done=>release=done);let paused=false;const call=f.rb.nervous.call.bind(f.rb.nervous);
 f.rb.nervous.call=async(method,params={},timeout)=>{if(method==='actions.preview'){paused=true;await gate;}return call(method,params,timeout);};
 try{await f.start();const request=f.main.run('NERV-02',item(3),5000).catch(e=>e);await until(()=>paused);await f.restartWorker();release();await request;
  const retry=await f.main.run('NERV-02',item(3),5000) as {outcome:string};assert.equal(retry.outcome,'uncertain');assert.equal((await f.rb.list()).length,0);
  assert.equal((await f.main.run('NERV-02',item(4),5000) as {retry:boolean}).retry,true);
  assert.throws(()=>execFileSync(process.execPath,['src/cli.ts','workers','release',item(3).id,'--reason','Fixture stopped'],{env:{...process.env,NERV_HOME:f.homeB},stdio:'pipe'}));
  execFileSync(process.execPath,['src/cli.ts','workers','release',item(3).id,'--confirmed-stopped','--reason','Fixture process stopped before execution'],{env:{...process.env,NERV_HOME:f.homeB},stdio:'pipe'});
  assert.equal((await f.main.run('NERV-02',item(4),5000) as {outcome:string}).outcome,'grant');assert.equal((await f.rb.list()).length,1);
 }finally{release();await f.close();}
});
test('F-014: upgrade rejects missing/bad identity, Origin and token-bearing URLs; live revocation stops work',{timeout:30000},async()=>{
 const f=await fixture();
 try{f.main.start();for(const [headers,path] of [[{},'/kaji/worker'],[{...signedHeaders('NERV-02',f.b.privateKey,'req','GET','/kaji/worker',''),Origin:'http://example.test'},'/kaji/worker'],[signedHeaders('NERV-02',f.b.privateKey,'req','GET','/kaji/worker',''),'/kaji/worker?token=neutral']] as [Record<string,string>,string][]){
   const socket=await f.raw(headers,path);await new Promise<void>((done,fail)=>{socket.once('open',()=>fail(Error('Unexpected upgrade')));socket.once('error',()=>{});socket.once('unexpected-response',(_req,res)=>{assert.equal(res.statusCode,401);res.resume();socket.terminate();done();});});
  }
  await f.start();const revoke=f.record({kind:'revoke',baseId:'NERV-02',publicKey:f.b.publicKey});await Promise.all([f.ra.kaji.add([revoke]),f.rb.kaji.add([revoke])]);await assert.rejects(f.main.run('NERV-02',item(5),2000));await until(()=>!f.main.connected('NERV-02'));assert.equal((await f.rb.list()).length,0);
 }finally{await f.close();}
});
test('F-014 review: deferred owner approval retains the worker resource',{timeout:30000},async()=>{
 const f=await fixture(),original=f.adapter;f.setAdapter({...original,run:(o,i,c)=>f.rb.runFromPeer(o,i,['memory.remember','reminders.add'],c)});
 try{await f.start();const request={...item(10),tool:'memory.remember',args:{text:'Neutral fact'}};const result=await f.main.run('NERV-02',request,5000) as {outcome:string};assert.equal(result.outcome,'approval');
  assert.equal((await f.main.run('NERV-02',item(11),5000) as {retry?:boolean}).retry,true,'waiting for the owner still owns the worker resource');
 }finally{await f.close();}
});
test('F-014 review: approval after disconnect cannot execute with an invalidated worker lease',{timeout:30000},async()=>{
 const f=await fixture(),original=f.adapter;let closed=false;f.setAdapter({...original,close:async(o,s)=>{await original.close(o,s);closed=true;},run:(o,i,c)=>f.rb.runFromPeer(o,i,['memory.remember'],c)});
 try{await f.start();const result=await f.main.run('NERV-02',{...item(12),tool:'memory.remember',args:{text:'Neutral fact'}},5000) as {approvalId:string};f.main.dropIncoming();await until(()=>closed);
  const decision=await f.rb.decide(result.approvalId,'approve','api');assert.notEqual(decision.decision,'approve','stale worker authority cannot create a grant');assert.equal((await f.rb.lilith.list()).length,0);
 }finally{await f.close();}
});
test('F-014 review: destination revocation is rechecked inside the scheduler immediately before execution',{timeout:30000},async()=>{
 const f=await fixture(),original=f.adapter;f.setAdapter({...original,close:async()=>{}});let entered=false,finished=false;let release!:()=>void;const gate=new Promise<void>(done=>release=done);const call=f.rb.nervous.call.bind(f.rb.nervous);
 f.rb.nervous.call=async(method,params={},timeout)=>{if(method==='actions.preview'){entered=true;await gate;}try{return await call(method,params,timeout);}finally{if(method==='actions.act')finished=true;}};
 try{await f.start();const result=f.main.run('NERV-02',item(13),5000).catch(e=>e);await until(()=>entered);await f.rb.kaji.add([f.record({kind:'revoke',baseId:'NERV-02',publicKey:f.b.publicKey})]);release();await until(()=>finished);await result;assert.equal((await f.rb.list()).length,0,'revoked destination cannot execute even when transport cleanup is delayed');
 }finally{release();await f.close();}
});
