import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Runtime} from '../src/runtime.ts';
test('brain CPU stall does not stall nervous reminder delivery; failed brain does not kill scheduler',{timeout:12000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nodo-isolation-'));const runtime=new Runtime(join(dir,'db'),new URL('./fixtures/busy-brain.ts',import.meta.url));
 try{await runtime.ready();const brain=runtime.brain.call('runtime.ping').catch(e=>e);await runtime.add('Indipendente',new Date(Date.now()+400).toISOString());await new Promise(done=>setTimeout(done,1100));assert.equal((await runtime.inbox() as unknown[]).length,1);assert.notEqual(runtime.nervous.child.pid,runtime.brain.child.pid);const error=await brain;assert.ok(error instanceof Error);assert.match(error.message,/timed out/);runtime.brain.child.kill('SIGKILL');assert.equal((await runtime.inbox() as unknown[]).length,1);}finally{await runtime.close();rmSync(dir,{recursive:true,force:true});}
});
