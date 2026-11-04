import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.ts';
import {makeServer} from '../src/server.ts';
test('login codes for open: admin mints, one exchange returns the token, then the code is gone; expired, wrong and excess codes fail',async()=>{
 const store=new Store(':memory:');const token='d'.repeat(32);const server=makeServer(store,token,{loginCodeTtlMs:300});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const mint=(auth=true)=>fetch(base+'/api/session/codes',{method:'POST',headers:auth?{authorization:'Bearer '+token}:{}});
 const exchange=(code:unknown)=>fetch(base+'/api/session/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});
 try{
  assert.equal((await mint(false)).status,401);
  const {code,expiresInMs}=await (await mint()).json() as {code:string;expiresInMs:number};assert.match(code,/^[a-f0-9]{32}$/);assert.equal(expiresInMs,300);
  assert.deepEqual(await (await exchange(code)).json(),{token});
  assert.equal((await exchange(code)).status,401,'single use');
  assert.equal((await exchange('0'.repeat(32))).status,401);assert.equal((await exchange(42)).status,401);
  const late=(await (await mint()).json() as {code:string}).code;await new Promise(done=>setTimeout(done,350));assert.equal((await exchange(late)).status,401,'expired');
  for(let i=0;i<5;i++)assert.equal((await mint()).status,201);assert.equal((await mint()).status,429);
 }finally{await new Promise<void>(done=>server.close(()=>done()));store.close();}
});
