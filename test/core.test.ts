import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store} from '../src/store.ts';import {makeServer} from '../src/server.ts';
const start=new Date('2030-01-01T00:00:00Z');const later=new Date('2030-01-02T00:00:00Z');
test('overdue reminder survives restart; delivery is atomic and not duplicated',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nodo-'));const path=join(dir,'db');
 try{let s=new Store(path);s.add('Insurance','2030-01-01T01:00:00Z',start);s.close();s=new Store(path);assert.equal(s.tick(later),1);assert.equal(s.tick(later),0);assert.equal(s.inbox().length,1);s.close();s=new Store(path);assert.equal(s.inbox().length,1);assert.equal(s.tick(later),0);s.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('invalid dates, missing zones, past dates and blank titles are rejected',()=>{const s=new Store(':memory:');try{for(const date of ['nonsense','2030-01-01T10:00','2020-01-01T00:00:00Z','2030-02-30T10:00:00Z','2030-01-01T24:00:00Z','2030-01-01T10:00:00+14:30']) assert.throws(()=>s.add('x',date,start));assert.throws(()=>s.add(' ','2030-01-02T00:00:00Z',start));}finally{s.close();}});
test('cancellation prevents delivery',()=>{const s=new Store(':memory:');const r=s.add('x','2030-01-01T01:00:00Z',start);assert.equal(s.cancel(r.id),true);assert.equal(s.cancel(r.id),false);assert.equal(s.tick(later),0);s.close();});
test('two connections cannot duplicate a delivery',()=>{const dir=mkdtempSync(join(tmpdir(),'nodo-'));const a=new Store(join(dir,'db'));const b=new Store(join(dir,'db'));try{a.add('x','2030-01-01T01:00:00Z',start);a.tick(later);b.tick(later);assert.equal(b.inbox().length,1);}finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}});
test('HTTP requires authentication and validates writes',async()=>{const s=new Store(':memory:');const token='a'.repeat(32);const server=makeServer(s,token);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;try{assert.equal((await fetch(base+'/api/doctor')).status,401);const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};assert.equal((await fetch(base+'/api/reminders',{method:'POST',headers,body:JSON.stringify({title:'x',due:'invalid'})})).status,400);assert.equal((await fetch(base+'/api/reminders',{method:'POST',headers,body:JSON.stringify({title:'x',due:'2099-01-01T00:00:00Z'})})).status,201);assert.equal((await (await fetch(base+'/api/reminders',{headers})).json()).length,1);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));s.close();}});
