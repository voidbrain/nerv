import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {ProcessClient} from '../src/process-client.ts';
// A stand-in child: waits `delay` ms before it handles requests and says READY (never, if delay<0), records what it got.
const child=(dir:string,delay:number)=>{const f=join(dir,`child${delay}.mjs`);writeFileSync(f,`import {appendFileSync} from 'node:fs';
const start=()=>{process.on('message',m=>{appendFileSync(${JSON.stringify(join(dir,'got'))},JSON.stringify(m)+'\\n');process.send({jsonrpc:'2.0',id:m.id,result:{role:'brain'}});});process.send({nerv:'ready'});};
if(${delay}>=0)setTimeout(start,${delay});process.on('disconnect',()=>process.exit(0));process.on('SIGTERM',()=>process.exit(0));`);return pathToFileURL(f);};
test('a call waits for a slow child to be ready; its own timer starts only then (B-007)',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nerv-pc-'));const c=new ProcessClient(child(dir,800),[],'brain',200);
 try{assert.deepEqual(await c.call('runtime.ping'),{role:'brain'},'answered although start-up took four times the call timeout');}
 finally{await c.close();rmSync(dir,{recursive:true,force:true});}
});
test('a child that never says ready: the call fails as not ready, and nothing was sent',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nerv-pc-'));const c=new ProcessClient(child(dir,-1),[],'brain',200,300);
 try{await assert.rejects(c.call('runtime.ping'),/brain process not ready; nothing was sent/);assert.equal(existsSync(join(dir,'got'))?readFileSync(join(dir,'got'),'utf8'):'','');}
 finally{await c.close();rmSync(dir,{recursive:true,force:true});}
});
test('the real children say ready: the first call to a fresh brain answers within its short timeout',async()=>{
 const c=new ProcessClient(new URL('../src/brain-process.ts',import.meta.url),[],'brain',1500);
 try{const r=await c.call('runtime.ping') as {role:string};assert.equal(r.role,'brain');}finally{await c.close();}
});
