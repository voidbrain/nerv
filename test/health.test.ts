import {test} from 'node:test';import assert from 'node:assert/strict';import {Store} from '../src/store.ts';import {makeServer} from '../src/server.ts';
test('authenticated lightweight status does not invoke database integrity checks',async()=>{
 const store=new Store(':memory:');let diagnostics=0;const diagnostic=store.doctor.bind(store);store.doctor=()=>{diagnostics++;return diagnostic();};
 const server=makeServer(store,'s'.repeat(32));await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const addr=server.address();assert.ok(addr&&typeof addr==='object');const base=`http://127.0.0.1:${addr.port}`;const headers={Authorization:'Bearer '+'s'.repeat(32)};
 try{assert.equal((await fetch(base+'/api/status')).status,401);for(let i=0;i<3;i++){const status=await(await fetch(base+'/api/status',{headers})).json();assert.equal(status.integrityCheck,'not-run');}assert.equal(diagnostics,0);assert.equal((await fetch(base+'/api/doctor',{headers})).status,200);assert.equal(diagnostics,1);}finally{await new Promise<void>(done=>server.close(()=>done()));store.close();}
});
