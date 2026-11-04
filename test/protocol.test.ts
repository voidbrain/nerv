import {test} from 'node:test';import assert from 'node:assert/strict';import {once} from 'node:events';
import {WebSocket} from 'ws';import {Store} from '../src/store.ts';import {makeServer} from '../src/server.ts';
import {handleFrame,authorize,validateParams,MAX_FRAME_BYTES} from '../src/rpc.ts';import {validateSurface} from '../shared/surface.ts';
test('JSON-RPC validates frames, preserves IDs, errors, notifications and bounded batches',async()=>{
 const handler=()=>({ok:true});
 assert.deepEqual(await handleFrame('{',handler),{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error.'}});
 assert.equal((await handleFrame('{"jsonrpc":"2.0","id":7,"method":"runtime.ping"}',handler) as {id:number}).id,7);
 assert.equal(await handleFrame('{"jsonrpc":"2.0","method":"runtime.ping"}',handler),undefined);
 assert.equal((await handleFrame('{"jsonrpc":"2.0","id":"x","method":"shell.exec"}',handler) as {error:{code:number}}).error.code,-32601);
 assert.equal((await handleFrame('[]',handler) as {error:{code:number}}).error.code,-32600);
 assert.equal((await handleFrame(' '.repeat(MAX_FRAME_BYTES+1),handler) as {error:{code:number}}).error.code,-32600);
 assert.equal(await handleFrame('[{"jsonrpc":"2.0","method":"runtime.ping"}]',handler),undefined);
 assert.throws(()=>validateParams('reminders.add',{title:'x',due:'x',shell:'bad'}));
 assert.throws(()=>authorize('brain','nervous','reminders.add'));assert.throws(()=>authorize('nervous','brain','runtime.ping'));authorize('coordinator','brain','runtime.ping');
});
test('surface descriptions reject executable structure and renderable names outside the catalog',()=>{
 const good={version:1,component:'nerv-status-card',props:{title:'Nodo',detail:'<script>alert(1)</script>',status:'ok'}};
 assert.equal(validateSurface(good).props.detail,good.props.detail); // text, never interpreted as HTML
 for(const value of [{...good,html:'<img onerror=alert(1)>'},{...good,component:'script'},{...good,props:{...good.props,onclick:'run()'}},{...good,props:{...good.props,detail:'x'.repeat(501)}},{...good,props:{title:'x',detail:'x',status:{toString:()=> 'ok'}}}])assert.throws(()=>validateSurface(value));
});
test('native WebSocket RPC requires bearer auth, denies browser origins, and is read-only',async()=>{
 const store=new Store(':memory:');const token='a'.repeat(32);const server=makeServer(store,token);await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const addr=server.address();assert.ok(addr&&typeof addr==='object');const url=`ws://127.0.0.1:${addr.port}/rpc`;
 const rejected=async(headers:Record<string,string>)=>{const client=new WebSocket(url,{headers});client.on('error',()=>{});await once(client,'unexpected-response').then(([,response])=>{assert.equal(response.statusCode,401);response.resume();client.terminate();});};
 let client:WebSocket|undefined;
 try{await rejected({});await rejected({Authorization:'Bearer '+token,Origin:'http://evil.test'});client=new WebSocket(url,{headers:{Authorization:'Bearer '+token}});client.on('error',()=>{});await once(client,'open');
  const request=async(method:string)=>{const message=once(client!,'message');client!.send(JSON.stringify({jsonrpc:'2.0',id:'job-1',method}));return JSON.parse((await message)[0].toString());};
  assert.equal((await request('runtime.doctor')).result.language,'it');assert.equal((await request('shell.exec')).error.code,-32601);assert.equal((await request('reminders.cancel')).error.code,-32602);
  const message=once(client,'message');client.send(JSON.stringify({jsonrpc:'2.0',id:'write',method:'reminders.cancel',params:{id:'x'}}));assert.equal(JSON.parse((await message)[0].toString()).error.code,-32003);
 }finally{const closed=client?.readyState===WebSocket.OPEN?once(client,'close'):Promise.resolve();await new Promise<void>(done=>server.close(()=>done()));await closed;store.close();}
});
