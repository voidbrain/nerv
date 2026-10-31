import {test} from 'node:test';import assert from 'node:assert/strict';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';import {once} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:net';
import {readToken} from '../src/config.ts';
test('one headless process serves UI and reminders, exits cleanly, and recovers after restart',{timeout:15000},async()=>{
 const home=mkdtempSync(join(tmpdir(),'nodo-process-'));let child:ChildProcess|undefined;
 const env:NodeJS.ProcessEnv={...process.env,NODO_HOME:home};delete env.NODO_TOKEN;delete env.NODO_PORT;
 const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));const address=reservation.address();assert.ok(address&&typeof address==='object');const port=address.port;await new Promise<void>(done=>reservation.close(()=>done()));
 const launch=async()=>{const processChild=spawn(process.execPath,['src/cli.ts','serve'],{env,stdio:['ignore','pipe','pipe']});child=processChild;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Nodo startup timed out')),5000);processChild.once('exit',code=>{clearTimeout(timer);reject(new Error('Nodo exited during startup: '+code));});processChild.stdout!.once('data',()=>{clearTimeout(timer);resolve();});});return processChild;};
 const stop=async(c:ChildProcess)=>{const exited=once(c,'exit');c.kill('SIGTERM');const [code]=await exited;assert.equal(code,0);};
 try{
  const initialized=spawnSync(process.execPath,['src/cli.ts','init'],{env,encoding:'utf8'});assert.equal(initialized.status,0,initialized.stderr);
  writeFileSync(join(home,'config.json'),JSON.stringify({port,language:'it',timeZone:'Europe/Rome'}));
  const headers={Authorization:'Bearer '+readToken(home),'Content-Type':'application/json'};const base=`http://127.0.0.1:${port}`;
  const first=await launch();assert.match(await(await fetch(base)).text(),/nodo-app/);
  const due=new Date(Date.now()+1500).toISOString();assert.equal((await fetch(base+'/api/reminders',{method:'POST',headers,body:JSON.stringify({title:'Promemoria di prova',due})})).status,201);
  await stop(first);child=undefined;
  await new Promise(done=>setTimeout(done,1600));const second=await launch();
  assert.equal((await(await fetch(base+'/api/inbox',{headers})).json()).length,1);await stop(second);child=undefined;
  const third=await launch();assert.equal((await(await fetch(base+'/api/inbox',{headers})).json()).length,1);await stop(third);child=undefined;
 }finally{if(child){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}rmSync(home,{recursive:true,force:true});}
});
