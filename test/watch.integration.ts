import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createServer as createSocket} from 'node:net';
import {readToken} from '../src/config.ts';

test('F-026: serve consumes an explicit heartbeat and preserves its inbox identity across a real process restart',{timeout:25000},async()=>{
 let calls=0;const model=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',()=>{JSON.parse(raw);calls++;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'{"reply":"Service fixture watch ran."}'},finish_reason:'stop'}]}));});});
 await new Promise<void>(done=>model.listen(0,'127.0.0.1',done));const reserve=createSocket();await new Promise<void>(done=>reserve.listen(0,'127.0.0.1',done));const port=(reserve.address() as {port:number}).port;await new Promise<void>(done=>reserve.close(()=>done()));
 const home=mkdtempSync(join(tmpdir(),'nerv-watch-serve-'));const env={...process.env,NERV_HOME:home,NERV_OLLAMA:'http://127.0.0.1:9'} as NodeJS.ProcessEnv;for(const k of ['NERV_TOKEN','NERV_PORT','NODO_HOME','NODO_TOKEN','NODO_PORT'])delete env[k];
 let child:ChildProcess|undefined;
 const launch=async()=>{const next=spawn(process.execPath,['src/cli.ts','serve'],{env,stdio:['ignore','pipe','pipe']});child=next;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('watch serve startup timed out')),5000);next.once('exit',code=>{clearTimeout(timer);reject(Error('watch serve exited: '+code));});next.stdout!.once('data',()=>{clearTimeout(timer);resolve();});});return next;};
 const stop=async()=>{if(!child||child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.kill('SIGTERM');const [code]=await exited;assert.equal(code,0);child=undefined;};
 try{
  const init=spawnSync(process.execPath,['src/cli.ts','init','--no-model-setup'],{env,encoding:'utf8'});assert.equal(init.status,0,init.stderr);
  writeFileSync(join(home,'config.json'),JSON.stringify({port,timeZone:'UTC',models:{local:{baseUrl:`http://127.0.0.1:${(model.address() as {port:number}).port}/v1`,model:'fixture'}},watch:{triggers:[{id:'service-fixture',request:'Read fixture status',schedule:{everyMinutes:1440},maxActions:1,maxSteps:1}]}}));
  const headers={authorization:'Bearer '+readToken(home)},url=`http://127.0.0.1:${port}/api/inbox/page?after=0&limit=5`;
  await launch();let delivered:{id:string;message:string}[]=[];const end=Date.now()+8000;
  while(!delivered.some(i=>i.message==='Service fixture watch ran.')){if(Date.now()>end)throw Error('serve did not publish watch output');delivered=(await(await fetch(url,{headers})).json() as {items:{id:string;message:string}[]}).items;await new Promise(done=>setTimeout(done,25));}
  const identity=delivered.find(i=>i.message==='Service fixture watch ran.')!.id;await stop();await launch();
  const after=(await(await fetch(url,{headers})).json() as {items:{id:string;message:string}[]}).items;assert.deepEqual(after.filter(i=>i.message==='Service fixture watch ran.').map(i=>i.id),[identity]);assert.equal(calls,1,'restart never dispatches the same heartbeat again');await stop();
 }finally{await stop();await new Promise<void>(done=>{model.close(()=>done());model.closeAllConnections();});rmSync(home,{recursive:true,force:true});}
});
