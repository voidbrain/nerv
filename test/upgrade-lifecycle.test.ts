import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {serviceFixture} from './mac-service-fixture.ts';
import {applyService,macServiceAdapter,planService,serviceReceipt,type ServicePlan,type ServiceReceipt} from '../src/node-lifecycle-execution.ts';
import {lifecycleRecovery} from '../src/node-lifecycle.ts';
import {READER_ENTRY,rehearseUpgrade} from '../src/upgrade-rehearsal.ts';
import {NODE_FLAGS} from '../src/process-client.ts';
import {Store} from '../src/store.ts';

const supported={skip:process.platform==='win32'||process.getuid?.()===0};
const NEXT='b'.repeat(40);
type Fixture=ReturnType<typeof serviceFixture>;
/** An installed, stopped service: the state every update plan starts from. */
async function stopped(f:Fixture):Promise<void> {const install=await planService(f.host,'install');await applyService(f.host,install,install.digest);const stop=await planService(f.host,'stop');await applyService(f.host,stop,stop.digest);}
const titles=(path:string)=>{const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare('SELECT id,title FROM reminders ORDER BY id').all().map(row=>({...row}));}finally{db.close();}};

test('update rehearses the candidate reader on its own backup after fetch and before checkout, and records the result',supported,async()=>{
 const f=serviceFixture();try{await stopped(f);const seen:string[]=[];
  f.setReader(database=>{seen.push(database);const db=new DatabaseSync(database);try{db.exec('CREATE TABLE IF NOT EXISTS neutral_added(id TEXT PRIMARY KEY)');}finally{db.close();}});
  const plan=await planService(f.host,'update',NEXT),receipt=await applyService(f.host,plan,plan.digest);
  assert.equal(receipt.state,'completed');assert.deepEqual(receipt.steps,['backup','fetch','rehearse','checkout','dependencies','build','start','verify'].map(s=>s+':completed'));
  assert.deepEqual(receipt.rehearsal!.blockers,[]);assert.equal(receipt.rehearsal!.source.schema,5);assert.equal(receipt.rehearsal!.result!.forwardOnly,false);
  assert.equal(seen.length,2,'a service restarts: the reader opens the copy twice');assert.ok(seen.every(path=>!path.startsWith(f.directory)),'the reader never receives the backup or the data home');
  assert.deepEqual(serviceReceipt(f.host,plan.digest),receipt,'the journal keeps the rehearsal with the receipt');
  const live=new DatabaseSync(f.data,{readOnly:true});try{assert.equal(live.prepare("SELECT 1 FROM sqlite_master WHERE name='neutral_added'").get(),undefined,'the rehearsal never touches live data');}finally{live.close();}
 }finally{f.close();}
});

test('a reader that loses data ends the update as refused before the checkout changes, without leaving a held operation',supported,async()=>{
 const f=serviceFixture();try{await stopped(f);const before=f.calls.length;
  f.setReader(database=>{const db=new DatabaseSync(database);try{db.exec('DELETE FROM reminders');}finally{db.close();}});
  const plan=await planService(f.host,'update',NEXT),receipt=await applyService(f.host,plan,plan.digest);
  assert.equal(receipt.state,'refused');assert.deepEqual(receipt.steps,['backup:completed','fetch:completed','rehearse:completed']);
  assert.match(receipt.rehearsal!.blockers.join(' '),/reminders lost or renumbered 1/);assert.doesNotMatch(JSON.stringify(receipt),/Neutral existing reminder/,'a receipt never carries row content');
  assert.deepEqual(f.calls.slice(before),['fetch'],'no checkout, dependency, build or start effect ran');assert.equal(readFileSync(f.revision,'utf8'),'a'.repeat(40));
  assert.deepEqual(titles(f.data),[{id:'original',title:'Neutral existing reminder'}]);assert.deepEqual(titles(join(f.directory,'.nerv-lifecycle/backups',plan.digest,'database.sqlite')),titles(f.data),'the backup stays as taken');
  assert.deepEqual(await applyService(f.host,plan,plan.digest),receipt,'replay returns the refusal');assert.deepEqual(f.calls.slice(before),['fetch']);
  assert.equal(lifecycleRecovery(receipt,{}).action,'return-receipt','a refusal needs no release');
  const start=await planService(f.host,'start');assert.deepEqual(start.blockers,[],'the installed revision can be started again');const started=await applyService(f.host,start,start.digest);assert.equal(started.state,'completed');assert.ok(started.fence>receipt.fence);
 }finally{f.close();}
});

test('an unreported rehearsal outcome or a source change during it stays uncertain and never reaches checkout',supported,async()=>{
 for(const fault of ['export','drift'] as const){
  const f=serviceFixture();try{await stopped(f);const before=f.calls.length;
   if(fault==='export')f.host.rehearse=async()=>{throw Error('Neutral export failure');};else f.setReader(()=>{f.controls.clean=false;});
   const plan=await planService(f.host,'update',NEXT);await assert.rejects(applyService(f.host,plan,plan.digest),fault==='export'?/export failure/:/source changed/);
   const receipt=serviceReceipt(f.host,plan.digest) as ServiceReceipt;assert.equal(receipt.state,'uncertain');assert.equal(receipt.steps.at(-1),'rehearse:started');assert.equal(receipt.rehearsal,undefined);
   assert.deepEqual(f.calls.slice(before),['fetch']);assert.equal(readFileSync(f.revision,'utf8'),'a'.repeat(40));f.controls.clean=true;assert.ok((await planService(f.host,'start')).blockers.some(s=>s.includes('owns')));
  }finally{f.close();}
 }
});

/** Runs the commands the rehearsal needs for real; anything else would be a service effect and fails the test. */
const real=(node:string)=>async(program:string,args:string[],cwd?:string,_timeout?:number,extra:Record<string,string>={})=>{
 assert.ok(program==='git'&&args[2]==='archive'||program==='tar'||program===node,'unexpected command '+program+' '+args.join(' '));
 const r=spawnSync(program,args,{cwd,env:{PATH:process.env.PATH??'',...extra},encoding:'utf8'});return {status:r.status,out:r.stdout,err:r.stderr};
};
const READER=(sql:string)=>"import {DatabaseSync} from 'node:sqlite';\nconst db=new DatabaseSync(process.argv[2]);db.exec("+JSON.stringify(sql)+");db.close();\n";

test('production adapter joins the pinned Git tree, a private staging export, the candidate reader process and the installed comparison',supported,async()=>{
 const f=serviceFixture();try{
  const source=f.host.context.source,git=(args:string[])=>execFileSync('git',['-C',source,'-c','user.name=Neutral Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const commit=(reader:string|undefined,label:string)=>{mkdirSync(join(source,'src'),{recursive:true});if(reader===undefined)rmSync(join(source,READER_ENTRY),{force:true});else writeFileSync(join(source,READER_ENTRY),reader);writeFileSync(join(source,'LABEL'),label);git(['add','-A']);git(['commit','-m',label]);return git(['rev-parse','HEAD']);};
  git(['init']);const installed=commit(READER('SELECT 1'),'Neutral installed'),adds=commit(READER('CREATE TABLE IF NOT EXISTS neutral_added(id TEXT PRIMARY KEY)'),'Neutral additive reader'),loses=commit(READER('DELETE FROM reminders'),'Neutral lossy reader'),absent=commit(undefined,'Neutral tree without a reader entry');git(['checkout','--detach',installed]);
  const host=macServiceAdapter(f.host.context,real(f.host.context.node)),area=join(f.directory,'.nerv-lifecycle');mkdirSync(join(area,'backups'),{recursive:true,mode:0o700});
  const run=async(nextRevision:string)=>{const digest=nextRevision.padEnd(64,'0'),dest=join(area,'backups',digest);mkdirSync(dest,{mode:0o700});await host.backup(dest);return host.rehearse({digest,nextRevision} as ServicePlan,dest);};
  const clean=await run(adds);assert.deepEqual(clean.blockers,[]);assert.equal(clean.result!.tables,1);
  assert.match((await run(loses)).blockers.join(' '),/reminders lost or renumbered 1/);
  assert.match((await run(absent)).blockers.join(' '),/reader refused or failed on the first open: The candidate reader exited with a failure/);
  await assert.rejects(run('c'.repeat(40)),/could not be exported/);
  assert.deepEqual(readdirSync(join(area,'staging')),[],'no exported tree or archive is left behind');assert.equal(git(['rev-parse','HEAD']),installed);assert.equal(git(['status','--porcelain']),'','the installed checkout is untouched');
  assert.deepEqual(titles(f.data),[{id:'original',title:'Neutral existing reminder'}]);
 }finally{f.close();}
});

test('the reader entry this revision ships opens a backup of its own data without loss when run as a separate process',supported,async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'nerv-reader-entry-'))),entry=fileURLToPath(new URL('../'+READER_ENTRY,import.meta.url));
 try{const backup=join(root,'backup');mkdirSync(backup,{mode:0o700});const store=new Store(join(root,'live.sqlite'));store.db.exec("INSERT INTO reminders(id,title,due,created) VALUES('first','Neutral first','2030-01-01T00:00:00.000Z','2029-01-01T00:00:00.000Z')");store.db.prepare('VACUUM INTO ?').run(join(backup,'database.sqlite'));store.db.close();chmodSync(join(backup,'database.sqlite'),0o600);
  const child=(args:string[])=>spawnSync(process.execPath,[...NODE_FLAGS,entry,...args],{encoding:'utf8',env:{PATH:process.env.PATH??''}});
  const report=await rehearseUpgrade(backup,(database,home)=>{const r=child([database,home]);if(r.status!==0)throw Error('Neutral child failure');assert.equal(r.stdout,'');});
  assert.deepEqual(report.blockers,[]);assert.ok(report.result!.rows>=1);
  assert.equal(child([]).status,64,'without both arguments the entry opens nothing');assert.equal(existsSync(join(root,'nerv.sqlite')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
