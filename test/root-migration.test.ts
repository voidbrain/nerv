import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.ts';
import {initialize,pinKajiRoot,readConfig} from '../src/config.ts';
import {Registry,baseKey,createRootKey,unlockRootKey,signRecord,ROOT_KEY_FILE,type SignedRecord} from '../src/kaji.ts';
import {planRootMigration,applyRootMigration,rootMigrationStatus,assertRootMigrationReady,rootMigrationCommand} from '../src/root-migration.ts';
const pub=()=>generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64');
const pass='neutral-invented-passphrase';
async function fixture(){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'nerv-root-'))),home=join(root,'data');mkdirSync(home,{mode:0o700});initialize(home,{id:'BASE-01',name:'Harbor'});
 const server=createServer();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const port=(server.address() as {port:number}).port;await new Promise<void>(done=>server.close(()=>done()));
 const config=JSON.parse(readFileSync(join(home,'config.json'),'utf8'));writeFileSync(join(home,'config.json'),JSON.stringify({...config,port}),{mode:0o600});
 const old=createRootKey(pass),next=createRootKey(pass),oldPrivate=unlockRootKey(old.file,pass).privateKey,nextPrivate=unlockRootKey(next.file,pass).privateKey;pinKajiRoot(home,old.publicKey);writeFileSync(join(home,ROOT_KEY_FILE),old.file,{mode:0o600});const key=baseKey(home).publicKey;
 const entries=[{baseId:'BASE-01',name:'Harbor',publicKey:key,address:'127.0.0.1:14520'},{baseId:'BASE-02',name:'Garden',publicKey:pub(),address:'127.0.0.1:14521'}];const issued='2026-11-10T09:00:00Z';
 const store=new Store(join(home,'nerv.sqlite'));const registry=new Registry(store.db,old.publicKey);let serial=0;for(const e of entries)registry.add(signRecord(oldPrivate,{kind:'enrol',serial:++serial,...e,issued}));registry.add(signRecord(oldPrivate,{kind:'main',serial:++serial,baseId:'BASE-01',issued}));registry.seen({'BASE-02':issued});store.db.exec("INSERT INTO reminders VALUES('retained','Neutral reminder','2030-01-01T00:00:00Z','2020-01-01T00:00:00Z',NULL,NULL)");const before=registry.records();store.close();
 const records:SignedRecord[]=entries.map((e,i)=>signRecord(nextPrivate,{kind:'enrol',serial:i+1,...e,issued}));records.push(signRecord(nextPrivate,{kind:'main',serial:3,baseId:'BASE-01',issued}));const bundle={root:next.publicKey,records};const keyPath=join(root,'replacement.enc');writeFileSync(keyPath,next.file,{mode:0o600});
 const plan=planRootMigration(home,bundle,keyPath);return {root,home,port,old,next,oldPrivate,nextPrivate,bundle,before,plan,keyPath};
}
const options=(confirm:string)=>({confirm,confirmedStopped:true,backupConfirmed:true});

test('root activation scopes trusted records/last-seen by root and preserves immutable old history, business data and keys',async()=>{
 const f=await fixture();try{
  const beforeBase=readFileSync(join(f.home,'base-key'));const result=await applyRootMigration(f.plan,options(f.plan.digest));assert.equal(result.state,'completed');assert.equal(readConfig(f.home).kaji?.root,f.next.publicKey);assert.equal(readFileSync(join(f.home,ROOT_KEY_FILE),'utf8'),f.next.file);assert.deepEqual(readFileSync(join(f.home,'base-key')),beforeBase);assert.equal(unlockRootKey(readFileSync(join(f.home,ROOT_KEY_FILE),'utf8'),pass).publicKey,f.next.publicKey);
  const store=new Store(join(f.home,'nerv.sqlite')),current=new Registry(store.db,f.next.publicKey),old=new Registry(store.db,f.old.publicKey);
  assert.deepEqual(current.records(),f.bundle.records);assert.deepEqual(old.records(),f.before);assert.equal(current.main(),'BASE-01');assert.deepEqual(current.lastSeen(),{});assert.equal(old.lastSeen()['BASE-02'],'2026-11-10T09:00:00.000Z');assert.equal(store.db.prepare('SELECT title FROM reminders WHERE id=?').get('retained')!.title,'Neutral reminder');assert.equal(store.doctor().schema!.user_version,6);
  const revoke=signRecord(f.oldPrivate,{kind:'revoke',serial:100,baseId:'BASE-01',publicKey:f.plan.identity,issued:new Date().toISOString()});old.add(revoke);assert.equal(current.bases().find(b=>b.baseId==='BASE-01')!.status,'enrolled');assert.throws(()=>current.add(revoke),/not signed/);
  assert.throws(()=>store.db.exec('DELETE FROM registry'),/append-only/);assert.throws(()=>store.db.exec('UPDATE registry_roots SET root=root'),/immutable/);assert.throws(()=>store.db.exec('DELETE FROM registry_roots'),/immutable/);
  store.close();const backup=join(f.home,'.root-migrations',f.plan.digest);assert.equal(readFileSync(join(backup,ROOT_KEY_FILE),'utf8'),f.old.file);const db=new DatabaseSync(join(backup,'database.sqlite'),{readOnly:true});assert.deepEqual(new Registry(db,f.old.publicKey).records(),f.before);db.close();
  const replay=await applyRootMigration(f.plan,options(f.plan.digest));assert.deepEqual(replay,result);assertRootMigrationReady(f.home);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('activation requires exact digest, independent backup/stopped attestations and an unused runtime port',async()=>{
 const f=await fixture();try{
  for(const o of [{...options(f.plan.digest),confirm:'wrong'},{...options(f.plan.digest),confirmedStopped:false},{...options(f.plan.digest),backupConfirmed:false}])await assert.rejects(applyRootMigration(f.plan,o),/Confirm/);
  assert.deepEqual(rootMigrationStatus(f.home,f.plan.digest),{state:'absent'});
  const server=createServer();await new Promise<void>(done=>server.listen(f.port,'127.0.0.1',done));try{await assert.rejects(applyRootMigration(f.plan,options(f.plan.digest)),/port is in use/);}finally{await new Promise<void>(done=>server.close(()=>done()));}
  assert.equal(readConfig(f.home).kaji?.root,f.old.publicKey);assert.equal(existsSync(join(f.home,'.root-migrations')),false);
  await assert.rejects(applyRootMigration({...f.plan,port:f.port+1},options(f.plan.digest)),/differs/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('plans refuse foreign membership/main changes, wrong key envelopes, revoked key resurrection and pending effects',async()=>{
 const f=await fixture();try{
  assert.throws(()=>planRootMigration(f.home,f.bundle),/root-holder/);
  assert.throws(()=>planRootMigration(f.home,{root:f.old.publicKey,records:f.before},f.keyPath),/different/);
  const issued=new Date().toISOString();const bad={root:f.next.publicKey,records:[signRecord(f.nextPrivate,{kind:'enrol',serial:1,baseId:'BASE-01',name:'Other',publicKey:f.plan.identity,address:'127.0.0.1:14520',issued})]};assert.throws(()=>planRootMigration(f.home,bad,f.keyPath),/retain/);
  writeFileSync(f.keyPath,f.old.file,{mode:0o600});assert.throws(()=>planRootMigration(f.home,f.bundle,f.keyPath),/does not match/);writeFileSync(f.keyPath,f.next.file,{mode:0o600});
  const store=new Store(join(f.home,'nerv.sqlite'));store.db.exec("INSERT INTO kaji_outbox(id,sortie_id,base,tool,args,request,created) VALUES('pending','s','BASE-02','reminders.list','{}','neutral','2020-01-01')");store.close();assert.throws(()=>planRootMigration(f.home,f.bundle,f.keyPath),/pending\/uncertain/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

for(const phase of ['accepted','backup','registry','key','config'])test('real process interruption at '+phase+' retains ownership; explicit stopped resume is fenced and completes once',async()=>{
 const f=await fixture();try{
  const planFile=join(f.root,'plan.json');writeFileSync(planFile,JSON.stringify(f.plan),{mode:0o600});
  const script=`import {readFileSync} from 'node:fs';import {applyRootMigration} from ${JSON.stringify(pathToFileURL(resolve('src/root-migration.ts')).href)};const plan=JSON.parse(readFileSync(process.argv[1],'utf8'));await applyRootMigration(plan,{confirm:plan.digest,confirmedStopped:true,backupConfirmed:true,onPhase:p=>{if(p===process.argv[2])process.exit(19);}});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,planFile,phase],{encoding:'utf8',timeout:15000});assert.equal(child.status,19,child.stderr);
  const interrupted=rootMigrationStatus(f.home,f.plan.digest);assert.equal(interrupted.state,'applying');assert.throws(()=>assertRootMigrationReady(f.home),/unresolved/);assert.throws(()=>new Store(join(f.home,'nerv.sqlite')),/unresolved/);
  const cached=await applyRootMigration(f.plan,options(f.plan.digest));assert.equal(cached.state,'applying');
  await assert.rejects(applyRootMigration(f.plan,{...options(f.plan.digest),resume:true,reason:'x'}),/reason/);
  const result=await applyRootMigration(f.plan,{...options(f.plan.digest),resume:true,reason:'Verified old handler and descendants stopped; inspected partial state.'});assert.equal(result.state,'completed');if('fence' in interrupted)assert.ok(result.fence>interrupted.fence);
  const db=new DatabaseSync(join(f.home,'nerv.sqlite'),{readOnly:true});assert.equal((db.prepare('SELECT count(*) AS n FROM registry').get() as {n:number}).n,6);assert.deepEqual(new Registry(db,f.old.publicKey).records(),f.before);db.close();assert.equal(readConfig(f.home).kaji?.root,f.next.publicKey);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('recovery refuses a still-live handler and changed replacement/config snapshots without replaying effects',async()=>{
 const f=await fixture();try{
  await assert.rejects(applyRootMigration(f.plan,{...options(f.plan.digest),onPhase:p=>{if(p==='registry')throw Error('neutral-fault');}}),/neutral-fault/);
  assert.equal(rootMigrationStatus(f.home,f.plan.digest).state,'uncertain');await assert.rejects(applyRootMigration(f.plan,{...options(f.plan.digest),resume:true,reason:'Neutral stopped evidence for negative test.'}),/confirmed stopped/);assert.equal(readConfig(f.home).kaji?.root,f.old.publicKey);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('CLI wrapper keeps private plan files exclusive, rejects unknown flags and binds selected data home',async()=>{
 const f=await fixture();try{
  const bundle=join(f.root,'bundle.json'),output=join(f.root,'review.json');writeFileSync(bundle,JSON.stringify(f.bundle));await rootMigrationCommand(f.home,['plan','--bundle',bundle,'--new-key',f.keyPath,'--out',output]);assert.equal(JSON.parse(readFileSync(output,'utf8')).digest,f.plan.digest);
  await assert.rejects(rootMigrationCommand(f.home,['plan','--bundle',bundle,'--new-key',f.keyPath,'--out',output]),/EEXIST/);
  await assert.rejects(rootMigrationCommand(f.home,['apply','--plan',output,'--confirm',f.plan.digest,'--force']),/Invalid/);
  const other=join(f.root,'other');mkdirSync(other);await assert.rejects(rootMigrationCommand(other,['apply','--plan',output,'--confirm',f.plan.digest,'--confirmed-stopped','--backup-confirmed']),/different data home/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('a new root cannot resurrect a previously revoked public key or change the main-base choice',async()=>{
 const f=await fixture();try{
  const changed={...f.bundle,records:[...f.bundle.records.slice(0,2),signRecord(f.nextPrivate,{kind:'main',serial:3,baseId:'BASE-02',issued:new Date().toISOString()})]};assert.throws(()=>planRootMigration(f.home,changed,f.keyPath),/selected main/);
  const store=new Store(join(f.home,'nerv.sqlite'));const registry=new Registry(store.db,f.old.publicKey),peer=registry.bases().find(b=>b.baseId==='BASE-02')!;registry.add(signRecord(f.oldPrivate,{kind:'revoke',serial:4,baseId:peer.baseId,publicKey:peer.publicKey,issued:new Date().toISOString()}));store.close();assert.throws(()=>planRootMigration(f.home,f.bundle,f.keyPath),/resurrect/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('peer activation transfers no encrypted root key, and a changed config is never overwritten',async()=>{
 const f=await fixture();try{
  const {unlinkSync}=await import('node:fs');unlinkSync(join(f.home,ROOT_KEY_FILE));const peerPlan=planRootMigration(f.home,f.bundle);
  const configFile=join(f.home,'config.json'),before=JSON.parse(readFileSync(configFile,'utf8'));writeFileSync(configFile,JSON.stringify({...before,language:'it'}),{mode:0o600});await assert.rejects(applyRootMigration(peerPlan,options(peerPlan.digest)),/changed/);assert.equal(readConfig(f.home).language,'it');assert.equal(readConfig(f.home).kaji?.root,f.old.publicKey);
  const fresh=planRootMigration(f.home,f.bundle);await applyRootMigration(fresh,options(fresh.digest));assert.equal(existsSync(join(f.home,ROOT_KEY_FILE)),false);assert.equal(readConfig(f.home).language,'it');assert.equal(readConfig(f.home).kaji?.root,f.next.publicKey);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('legacy unscoped signed rows are bound without rewriting history during activation',async()=>{
 const f=await fixture();try{
  const {canonical}=await import('../src/kaji.ts');const db=new DatabaseSync(join(f.home,'nerv.sqlite'));
  const record=signRecord(f.oldPrivate,{kind:'main',serial:12,baseId:'BASE-01',issued:new Date().toISOString()}),id=createHash('sha256').update(canonical(record)).digest('hex');db.prepare('INSERT INTO registry VALUES(?,?,?,?,?,?,?)').run(id,12,'main','BASE-01',canonical(record.body),record.signature,new Date().toISOString());
  assert.equal(db.prepare('SELECT 1 FROM registry_roots WHERE id=?').get(id),undefined);const before=new Registry(db,f.old.publicKey).records();db.close();
  const plan=planRootMigration(f.home,f.bundle,f.keyPath);await applyRootMigration(plan,options(plan.digest));const after=new DatabaseSync(join(f.home,'nerv.sqlite'),{readOnly:true});assert.deepEqual(new Registry(after,f.old.publicKey).records(),before);assert.equal(after.prepare('SELECT root FROM registry_roots WHERE id=?').get(id)!.root,f.old.publicKey);assert.equal(new Registry(after,f.next.publicKey).records().length,3);after.close();
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('concurrent root activation processes cannot acquire two resources or append duplicate effects',async()=>{
 const f=await fixture();try{
  const {spawn}=await import('node:child_process');const path=join(f.root,'plan.json');writeFileSync(path,JSON.stringify(f.plan),{mode:0o600});
  const script=`import {readFileSync} from 'node:fs';import {applyRootMigration} from ${JSON.stringify(pathToFileURL(resolve('src/root-migration.ts')).href)};const p=JSON.parse(readFileSync(process.argv[1],'utf8'));try{console.log(JSON.stringify(await applyRootMigration(p,{confirm:p.digest,confirmedStopped:true,backupConfirmed:true})));}catch{process.exitCode=2;}`;
  const run=()=>new Promise<{status:number|null;out:string}>((done,fail)=>{const child=spawn(process.execPath,['--input-type=module','-e',script,path],{stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',chunk=>out+=chunk);child.once('error',fail);child.once('close',status=>done({status,out}));});
  const results=await Promise.all([run(),run()]);assert.ok(results.some(r=>r.status===0&&JSON.parse(r.out).state==='completed'));assert.ok(results.every(r=>r.status===0||r.status===2));
  const db=new DatabaseSync(join(f.home,'nerv.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT count(*) AS n FROM registry').get()!.n,6);assert.equal(db.prepare('SELECT count(*) AS n FROM root_migration_resource').get()!.n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM root_migrations').get()!.n,1);db.close();
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
