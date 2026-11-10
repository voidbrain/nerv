import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.ts';
import {initialize,pinKajiRoot,readToken} from '../src/config.ts';
import {Registry,createRootKey,unlockRootKey,baseKey,signRecord,ROOT_KEY_FILE,type RegistryBody} from '../src/kaji.ts';
import {planRootMigration,applyRootMigration} from '../src/root-migration.ts';
const delay=(ms:number)=>new Promise(done=>setTimeout(done,ms));
async function port(){const s=createServer();await new Promise<void>(done=>s.listen(0,'127.0.0.1',done));const p=(s.address() as {port:number}).port;await new Promise<void>(done=>s.close(()=>done()));return p;}
test('real CLI rejects mixed-root peers then exchanges root-bound heartbeats after both activations',{timeout:30000},async()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'nerv-root-cli-'))),homes=[join(directory,'a'),join(directory,'b')],ports=[await port(),await port()],kajiPorts=[await port(),await port()],children:ChildProcess[]=[];
 const pass='neutral-root-cli-passphrase',old=createRootKey(pass),next=createRootKey(pass),oldKey=unlockRootKey(old.file,pass).privateKey,newKey=unlockRootKey(next.file,pass).privateKey;
 const ids=['BASE-01','BASE-02'],keys:string[]=[];let log='';
 const start=(i:number)=>{const env:NodeJS.ProcessEnv={...process.env,NERV_HOME:homes[i]!,NERV_PORT:String(ports[i])};delete env.NERV_TOKEN;delete env.NODO_TOKEN;const child=spawn(process.execPath,['--use-system-ca','src/cli.ts','serve'],{env,stdio:['ignore','pipe','pipe']});child.stdout?.on('data',b=>{log=(log+b).slice(-8000);});child.stderr?.on('data',b=>{log=(log+b).slice(-8000);});children.push(child);return child;};
 const ready=async(i:number)=>{for(let n=0;n<100;n++){try{const r=await fetch('http://127.0.0.1:'+ports[i]+'/api/status',{headers:{authorization:'Bearer '+readToken(homes[i]!)},signal:AbortSignal.timeout(200)});if(r.ok)return;}catch{}await delay(30);}throw Error('Neutral CLI did not become ready: '+log);};
 const stop=async(i:number,child:ChildProcess)=>{if(child.exitCode!==null||child.signalCode!==null)return;try{await fetch('http://127.0.0.1:'+ports[i]+'/api/stop',{method:'POST',headers:{authorization:'Bearer '+readToken(homes[i]!)},signal:AbortSignal.timeout(1000)});}catch{child.kill();}for(let n=0;n<100&&child.exitCode===null&&child.signalCode===null;n++)await delay(30);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');};
 const seen=(i:number,base:string)=>{const db=new DatabaseSync(join(homes[i]!,'nerv.sqlite'),{readOnly:true});try{return !!db.prepare('SELECT 1 FROM registry_seen WHERE root=? AND base_id=?').get(next.publicKey,base);}finally{db.close();}};
 try{
  for(let i=0;i<2;i++){mkdirSync(homes[i]!,{mode:0o700});initialize(homes[i]!,{id:ids[i]!,name:'Neutral '+i});const config=JSON.parse(readFileSync(join(homes[i]!,'config.json'),'utf8'));writeFileSync(join(homes[i]!,'config.json'),JSON.stringify({...config,port:ports[i]}),{mode:0o600});pinKajiRoot(homes[i]!,old.publicKey);keys.push(baseKey(homes[i]!).publicKey);}
  writeFileSync(join(homes[0]!,ROOT_KEY_FILE),old.file,{mode:0o600});const replacement=join(directory,'replacement.enc');writeFileSync(replacement,next.file,{mode:0o600});
  const bodies:RegistryBody[]=ids.map((id,i)=>({kind:'enrol',serial:i+1,baseId:id,name:'Neutral '+i,publicKey:keys[i]!,address:'127.0.0.1:'+kajiPorts[i],issued:new Date().toISOString()}));bodies.push({kind:'main',serial:3,baseId:ids[0]!,issued:new Date().toISOString()});
  for(const home of homes){const store=new Store(join(home,'nerv.sqlite'));const registry=new Registry(store.db,old.publicKey);for(const body of bodies)registry.add(signRecord(oldKey,body));store.close();}
  const bundle={root:next.publicKey,records:bodies.map(body=>signRecord(newKey,body))};const aPlan=planRootMigration(homes[0]!,bundle,replacement);await applyRootMigration(aPlan,{confirm:aPlan.digest,confirmedStopped:true,backupConfirmed:true});
  const a=start(0),bOld=start(1);await Promise.all([ready(0),ready(1)]);await delay(500);assert.equal(seen(0,ids[1]!),false,'CLI must wire persisted rootBinding into its Kaji/worker links');
  await stop(1,bOld);const bPlan=planRootMigration(homes[1]!,bundle);await applyRootMigration(bPlan,{confirm:bPlan.digest,confirmedStopped:true,backupConfirmed:true});const bNew=start(1);await ready(1);for(let n=0;n<100&&(!seen(0,ids[1]!)||!seen(1,ids[0]!));n++)await delay(30);assert.equal(seen(0,ids[1]!),true,log);assert.equal(seen(1,ids[0]!),true,log);await stop(1,bNew);await stop(0,a);
 }finally{for(let n=0;n<children.length;n++){const child=children[n]!;if(child.exitCode===null&&child.signalCode===null){try{await stop(n===0?0:1,child);}catch{child.kill('SIGKILL');}}}rmSync(directory,{recursive:true,force:true});}
});
