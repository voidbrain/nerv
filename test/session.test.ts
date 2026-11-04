import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.ts';
import {makeServer} from '../src/server.ts';
test('login codes for open: admin mints, one exchange returns a dashboard session, then the code is gone; expired, wrong and excess codes fail',async()=>{
 const store=new Store(':memory:');const token='d'.repeat(32);const server=makeServer(store,token,{loginCodeTtlMs:300});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const mint=(auth=true)=>fetch(base+'/api/session/codes',{method:'POST',headers:auth?{authorization:'Bearer '+token}:{}});
 const exchange=(code:unknown)=>fetch(base+'/api/session/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});
 try{
  assert.equal((await mint(false)).status,401);
  const {code,expiresInMs}=await (await mint()).json() as {code:string;expiresInMs:number};assert.match(code,/^[a-f0-9]{32}$/);assert.equal(expiresInMs,300);
  const first=await (await exchange(code)).json() as {token:string;expiresInMs:number};assert.match(first.token,/^[a-f0-9]{64}$/);assert.notEqual(first.token,token,'the admin token never reaches the browser (F-039)');
  assert.equal((await exchange(code)).status,401,'single use');
  assert.equal((await exchange('0'.repeat(32))).status,401);assert.equal((await exchange(42)).status,401);
  const late=(await (await mint()).json() as {code:string}).code;await new Promise(done=>setTimeout(done,350));assert.equal((await exchange(late)).status,401,'expired');
  for(let i=0;i<5;i++)assert.equal((await mint()).status,201);assert.equal((await mint()).status,429);
 }finally{await new Promise<void>(done=>server.close(()=>done()));store.close();}
});
test('a dashboard session acts as the admin for the dashboard, cannot mint codes or revoke, ends after its time or on revoke',async()=>{
 const store=new Store(':memory:');const token='d'.repeat(32);const server=makeServer(store,token,{sessionTtlMs:400});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const as=(bearer:string,path:string,method='GET',body?:object)=>fetch(base+path,{method,headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const session=async()=>{const {code}=await (await as(token,'/api/session/codes','POST')).json() as {code:string};return ((await (await fetch(base+'/api/session/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})})).json()) as {token:string}).token;};
 try{
  const s=await session();
  assert.equal((await as(s,'/api/approvals')).status,200);assert.equal((await as(s,'/api/reminders','POST',{title:'Call Ada',due:'2031-01-01T09:00:00Z'})).status,201,'it can act as the owner in the dashboard');
  assert.equal((await as(s,'/api/session/codes','POST')).status,403,'a session cannot mint a code, so it can never renew itself');
  assert.equal((await as(s,'/api/session/revoke','POST')).status,403);
  assert.equal((await as('f'.repeat(64),'/api/approvals')).status,401,'an unknown session is refused');
  await new Promise(done=>setTimeout(done,450));assert.equal((await as(s,'/api/approvals')).status,401,'expired');
  const a=await session(),b=await session();
  assert.deepEqual(await (await as(token,'/api/session/revoke','POST')).json(),{revoked:2});
  for(const x of [a,b])assert.equal((await as(x,'/api/approvals')).status,401,'revoked');
  assert.equal((await as(token,'/api/approvals')).status,200,'the admin token is unchanged');
 }finally{await new Promise<void>(done=>server.close(()=>done()));store.close();}
});
test('POST /api/stop stops the service as Ctrl+C would: admin token only, never a session or a stranger',async()=>{
 const store=new Store(':memory:');const token='d'.repeat(32);let stops=0;const server=makeServer(store,token,{onStop:()=>{stops++;}});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const stop=(bearer?:string)=>fetch(base+'/api/stop',{method:'POST',headers:bearer?{authorization:'Bearer '+bearer}:{}});
 try{
  assert.equal((await stop()).status,401);
  const {code}=await (await fetch(base+'/api/session/codes',{method:'POST',headers:{authorization:'Bearer '+token}})).json() as {code:string};
  const session=((await (await fetch(base+'/api/session/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})})).json()) as {token:string}).token;
  assert.equal((await stop(session)).status,403,'a dashboard session cannot stop the service');
  assert.equal(stops,0);assert.equal((await stop(token)).status,202);await new Promise(done=>setImmediate(done));assert.equal(stops,1);
 }finally{await new Promise<void>(done=>server.close(()=>done()));store.close();}
 const bare=makeServer(new Store(':memory:'),'d'.repeat(32));await new Promise<void>(done=>bare.listen(0,'127.0.0.1',done));
 try{assert.equal((await fetch(`http://127.0.0.1:${(bare.address() as {port:number}).port}/api/stop`,{method:'POST',headers:{authorization:'Bearer '+'d'.repeat(32)}})).status,503);}finally{await new Promise<void>(done=>bare.close(()=>done()));}
});
