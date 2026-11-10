import {createHash,randomBytes,createPrivateKey,createPublicKey} from 'node:crypto';
import {chmodSync,closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {databasePath,readConfig,readToken} from './config.ts';
import {canonical,keyIdentity,ROOT_KEY_FILE} from './kaji.ts';
import {renderService} from './service.ts';
import {NODE_FLAGS} from './process-client.ts';
import {assertRootMigrationReady} from './root-migration.ts';
import {lifecycleRecovery} from './node-lifecycle.ts';
import {transaction} from './sqlite-transaction.ts';

export const SERVICE_LIFECYCLE_PROTOCOL = 1;
export const SERVICE_READER_SCHEMA = 6;
type Action='install'|'start'|'stop'|'update'|'uninstall';
type State='running'|'completed'|'uncertain'|'released';
export interface ServiceContext {userHome:string;home:string;source:string;node:string;uid:number}
export interface ServiceObservation {revision:string;schema:number;profile:string;definition:'absent'|'owned'|'foreign';registration:'absent'|'owned'|'foreign';runtime:'stopped'|'owned'|'unknown';pids:number[];session:boolean;clean:boolean;legacy:boolean;pending:boolean;built:boolean}
export interface ServicePlan {version:1;kind:'mac-service';action:Action;context:ServiceContext;before:ServiceObservation;nextRevision?:string;handler:string;nonce:string;created:string;blockers:string[];digest:string}
export interface ServiceReceipt {digest:string;resource:string;fence:number;nonce:string;pid:number;identity:string;state:State;steps:string[]}
/** Trusted adapter injection is for tests; no manifest or CLI input can select an adapter or command text. */
export interface ServiceHost {context:ServiceContext;inspect():Promise<ServiceObservation>;command(step:'register'|'unregister'|'fetch'|'checkout'|'dependencies'|'build',plan:ServicePlan):Promise<void>;compatible(revision:string):Promise<boolean>;backup(path:string):Promise<void>;authorizedStart?(plan:ServicePlan):Promise<boolean>}
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const handler=()=>hash(readFileSync(fileURLToPath(import.meta.url)));
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const definition=(c:ServiceContext)=>join(c.userHome,'Library/LaunchAgents/io.nerv.agent.plist');
const area=(c:ServiceContext)=>join(c.userHome,'.nerv-lifecycle');
const resource=(c:ServiceContext)=>'user-service:'+c.uid+':darwin';
function safe(path:string,uid:number,privateMode=false):void {
 const stat=lstatSync(path);if(stat.isSymbolicLink()||stat.uid!==uid&&stat.uid!==0||stat.mode&0o022||privateMode&&(stat.uid!==uid||!!(stat.mode&0o077)))throw Error('Service path ownership, permissions or symlink requires review.');
 const actual=realpathSync(path);if(actual!==resolve(path))throw Error('Service paths must be canonical and symlink-free.');
}
function present(path:string):boolean {try{lstatSync(path);return true;}catch(e){if(e instanceof Error&&'code' in e&&e.code==='ENOENT')return false;throw e;}}
function syncDirectory(path:string):void {const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function fileHash(path:string):string {const fd=openSync(path,'r'),digest=createHash('sha256'),bytes=Buffer.alloc(65536);try{let n:number;while((n=readSync(fd,bytes,0,bytes.length,null))>0)digest.update(bytes.subarray(0,n));return digest.digest('hex');}finally{closeSync(fd);}}
function exclusive(path:string,bytes:string|Buffer):void {const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}syncDirectory(dirname(path));}
function journal(c:ServiceContext,write=false):DatabaseSync|undefined {
 const root=area(c),marker=join(root,'owner.json'),file=join(root,'journal.sqlite'),created=!present(root);
 if(created){if(!write)return;mkdirSync(root,{mode:0o700});const db=new DatabaseSync(file);chmodSync(file,0o600);db.close();exclusive(marker,JSON.stringify({version:1,kind:'nerv-lifecycle'}));}
 safe(root,c.uid,true);safe(marker,c.uid,true);safe(file,c.uid,true);if(readFileSync(marker,'utf8')!==JSON.stringify({version:1,kind:'nerv-lifecycle'}))throw Error('Unknown lifecycle journal; do not reset ownership.');
 const db=new DatabaseSync(file,{readOnly:!write});db.exec('PRAGMA busy_timeout=5000');
 if(write)db.exec('PRAGMA synchronous=FULL');
 if(created)db.exec("CREATE TABLE IF NOT EXISTS operations(digest TEXT PRIMARY KEY,plan TEXT NOT NULL,receipt TEXT NOT NULL);CREATE TABLE IF NOT EXISTS resource(id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL,fence INTEGER NOT NULL,nonce TEXT NOT NULL,pid INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS clock(id INTEGER PRIMARY KEY CHECK(id=1),value INTEGER NOT NULL);INSERT OR IGNORE INTO clock VALUES(1,0);CREATE TABLE IF NOT EXISTS releases(id INTEGER PRIMARY KEY,digest TEXT NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL);CREATE TRIGGER IF NOT EXISTS operations_no_delete BEFORE DELETE ON operations BEGIN SELECT RAISE(ABORT,'lifecycle history is retained');END;");
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);if(!['operations','resource','clock','releases'].every(name=>tables.includes(name))){db.close();throw Error('Lifecycle journal is incomplete; never reset its clock.');}
 const clock=db.prepare('SELECT value FROM clock WHERE id=1').get(),max=db.prepare("SELECT max(json_extract(receipt,'$.fence')) AS value FROM operations").get();if(!clock||!Number.isSafeInteger(clock.value)||Number(clock.value)<Number(max?.value??0)){db.close();throw Error('Lifecycle fencing history is missing or rolled back.');}
 return db;
}
function stored(db:DatabaseSync|undefined,digest:string):ServiceReceipt|undefined {if(!db||!db.prepare("SELECT 1 FROM sqlite_master WHERE name='operations'").get())return;const row=db.prepare('SELECT receipt FROM operations WHERE digest=?').get(digest) as {receipt:string}|undefined;return row?JSON.parse(row.receipt) as ServiceReceipt:undefined;}
function held(db:DatabaseSync|undefined):boolean {return !!db?.prepare("SELECT 1 FROM sqlite_master WHERE name='resource'").get()&&!!db.prepare('SELECT 1 FROM resource').get();}
function blockers(action:Action,o:ServiceObservation,next?:string):string[] {
 const out:string[]=[];if(o.schema<5||o.schema>SERVICE_READER_SCHEMA)out.push('The selected database schema is unsupported.');if(!o.session)out.push('The selected GUI user session is unavailable.');if(!o.clean)out.push('The source checkout must be clean.');if(o.legacy)out.push('Legacy service ownership requires a separate review.');if(o.pending)out.push('Reconcile pending or uncertain work first.');if(!o.built&&action!=='uninstall')out.push('Build the selected source first.');
 if(o.definition==='foreign'||o.registration==='foreign'||o.runtime==='unknown')out.push('Service or runtime ownership is unknown or belongs elsewhere.');
 if(action==='install'&&(o.definition!=='absent'||o.registration!=='absent'||o.runtime!=='stopped'))out.push('Install requires absent definition/registration and stopped runtime.');
 if(action!=='install'&&o.definition!=='owned')out.push('The definition must exactly match this profile, source and Node.');
 if(['start','update','uninstall'].includes(action)&&(o.registration!=='absent'||o.runtime!=='stopped'))out.push('Stop the selected service and descendants first.');
 if(action==='stop'&&o.registration==='absent'&&o.runtime!=='stopped')out.push('A foreground runtime must be stopped separately.');
 if(action==='update'&&(!next||next===o.revision))out.push('Select a distinct reviewed compatible revision.');return out;
}
export async function planService(host:ServiceHost,action:Action,nextRevision?:string):Promise<ServicePlan> {
 if(!['install','start','stop','update','uninstall'].includes(action)||nextRevision!==undefined&&!/^[a-f0-9]{40}$/.test(nextRevision)||action!=='update'&&nextRevision!==undefined)throw Error('Invalid service action or pinned revision.');
 const before=await host.inspect(),db=journal(host.context);let pending=false;try{pending=held(db);}finally{db?.close();}
 const issues=blockers(action,before,nextRevision);if(pending)issues.push('A lifecycle operation owns this user service.');if(action==='update'&&nextRevision&&!await host.compatible(nextRevision))issues.push('This update path requires identical executable/dependency trees and supported actual schema; application upgrades need a separate compatibility review.');
 const body={version:SERVICE_LIFECYCLE_PROTOCOL as 1,kind:'mac-service' as const,action,context:host.context,before,...(nextRevision?{nextRevision}:{}),handler:handler(),nonce:randomBytes(16).toString('hex'),created:new Date().toISOString(),blockers:issues};return {...body,digest:hash(canonical(body))};
}
function planOf(raw:unknown,host:ServiceHost):ServicePlan {
 if(!object(raw)||raw.version!==SERVICE_LIFECYCLE_PROTOCOL||raw.kind!=='mac-service'||typeof raw.digest!=='string'||!['install','start','stop','update','uninstall'].includes(String(raw.action))||canonical(raw.context)!==canonical(host.context)||!object(raw.before)||typeof raw.handler!=='string'||!Array.isArray(raw.blockers))throw Error('Invalid local service plan.');
 const {digest,...body}=raw;if(hash(canonical(body))!==digest)throw Error('Service plan digest differs.');return structuredClone(raw) as unknown as ServicePlan;
}
export function serviceReceipt(host:ServiceHost,digest:string):ServiceReceipt|{state:'absent'} {const db=journal(host.context);try{return stored(db,digest)??{state:'absent'};}finally{db?.close();}}
async function processIdentity(pid:number):Promise<string|undefined> {const r=await command('ps',['-p',String(pid),'-o','lstart=','-o','args=']);return r.status===0&&r.out.trim()?hash(r.out.trim()):undefined;}
/** A retained resource fences ordinary startup. Only the exact manager-owned start already recorded by its live handler can pass. */
export async function assertServiceStartup(host:ServiceHost,managedStart=false):Promise<void> {
 const db=journal(host.context);if(!db)return;let snapshot:ServiceReceipt|undefined,plan:ServicePlan|undefined;
 try{if(!held(db))return;const owner=db.prepare('SELECT * FROM resource WHERE id=1').get()!;snapshot=stored(db,String(owner.digest));if(!snapshot||snapshot.fence!==owner.fence||snapshot.nonce!==owner.nonce||snapshot.pid!==owner.pid)throw Error('Lifecycle ownership requires reconciliation.');if(!managedStart||snapshot.state!=='running'||snapshot.steps.at(-1)!=='start:started'||!host.authorizedStart)throw Error('Lifecycle operation is unresolved; inspect its receipt before startup.');const row=db.prepare('SELECT plan FROM operations WHERE digest=?').get(snapshot.digest) as {plan:string};plan=planOf(JSON.parse(row.plan),host);}finally{db.close();}
 if(!snapshot||!plan||plan.handler!==handler()||await processIdentity(snapshot.pid)!==snapshot.identity||!await host.authorizedStart!(plan))throw Error('Lifecycle startup is not authorized by the live selected operation.');
 const check=journal(host.context)!;try{const owner=check.prepare('SELECT * FROM resource WHERE id=1').get();if(!owner)return;const current=stored(check,snapshot.digest);if(!current||canonical(current)!==canonical(snapshot)||owner.digest!==snapshot.digest||owner.fence!==snapshot.fence||owner.nonce!==snapshot.nonce||owner.pid!==snapshot.pid)throw Error('Lifecycle startup ownership changed.');}finally{check.close();}
}
export async function guardLocalService(home:string,managedStart=false):Promise<void> {if(process.platform!=='darwin'||!present(join(homedir(),'.nerv-lifecycle')))return;const host=macServiceHost(join(homedir(),'.nerv'));await assertServiceStartup(host,managedStart&&resolve(home)===host.context.home);}
export async function applyService(host:ServiceHost,raw:unknown,confirm:string,onStep?:(step:string)=>void):Promise<ServiceReceipt> {
 const p=planOf(raw,host);if(confirm!==p.digest)throw Error('Confirm the exact service plan digest.');let db=journal(host.context);try{const old=stored(db,p.digest);if(old)return old;}finally{db?.close();}
 if(p.handler!==handler()||!Number.isFinite(Date.parse(p.created))||Math.abs(Date.now()-Date.parse(p.created))>86400000||p.blockers.length)throw Error('Service plan is blocked, stale or uses another handler.');
 const observed=await host.inspect();if(canonical(observed)!==canonical(p.before)||blockers(p.action,observed,p.nextRevision).length||p.action==='update'&&!await host.compatible(p.nextRevision!))throw Error('Service evidence changed; make a fresh plan.');
 const identity=await processIdentity(process.pid);if(!identity)throw Error('Lifecycle handler identity could not be recorded.');db=journal(host.context,true)!;let receipt:ServiceReceipt|undefined;
 const owns=()=>{const r=db!.prepare('SELECT * FROM resource WHERE id=1').get();if(!receipt||r?.digest!==receipt.digest||r.fence!==receipt.fence||r.nonce!==receipt.nonce||r.pid!==receipt.pid)throw Error('Lifecycle ownership changed.');};
 const save=()=>db!.prepare('UPDATE operations SET receipt=? WHERE digest=?').run(JSON.stringify(receipt),p.digest);
 const step=async(name:string,effect:()=>Promise<void>|void)=>{transaction(db!,()=>{owns();receipt!.steps.push(name+':started');save();});onStep?.(name+':started');await effect();transaction(db!,()=>{owns();receipt!.steps[receipt!.steps.length-1]=name+':completed';save();});onStep?.(name+':completed');};
 const inspectOwned=async(registered:boolean)=>{owns();const current=await host.inspect();if(current.definition!=='owned'||current.profile!==p.before.profile||current.schema!==p.before.schema||current.legacy||!current.session||current.registration!==(registered?'owned':'absent'))throw Error('Selected service ownership changed.');return current;};
 try{
  const cached=transaction(db,()=>{const previous=stored(db,p.digest);if(previous)return previous;if(held(db))throw Error('Another lifecycle operation holds the user service.');db!.prepare('UPDATE clock SET value=value+1 WHERE id=1').run();const fence=Number(db!.prepare('SELECT value FROM clock').get()!.value);receipt={digest:p.digest,resource:resource(host.context),fence,nonce:randomBytes(16).toString('hex'),pid:process.pid,identity,state:'running',steps:[]};db!.prepare('INSERT INTO resource VALUES(1,?,?,?,?)').run(p.digest,fence,receipt.nonce,process.pid);db!.prepare('INSERT INTO operations VALUES(?,?,?)').run(p.digest,canonical(p),JSON.stringify(receipt));return undefined;});if(cached)return cached;
  onStep?.('accepted');
  if(p.action==='install')await step('definition',async()=>{const fresh=await host.inspect();if(canonical(fresh)!==canonical(p.before))throw Error('Installation evidence changed.');const dir=dirname(definition(host.context));if(!existsSync(dir))mkdirSync(dir,{mode:0o700});safe(dir,host.context.uid);exclusive(definition(host.context),renderService('darwin',host.context.home,host.context.source,host.context.node));});
  if(p.action==='stop')await step('stop',async()=>{const current=await inspectOwned(p.before.registration==='owned');if(current.registration==='owned')await host.command('unregister',p);await waitFor(async()=>{const next=await host.inspect();return next.registration==='absent'&&next.runtime==='stopped'&&!next.pids.length;});for(const pid of p.before.pids){try{process.kill(pid,0);throw Error('A selected descendant remains alive.');}catch(e){if(!(e instanceof Error)||!('code' in e)||e.code!=='ESRCH')throw e;}}});
  if(p.action==='uninstall')await step('remove-definition',async()=>{const current=await inspectOwned(false);if(current.runtime!=='stopped'||current.pids.length)throw Error('Runtime descendants remain.');safe(definition(host.context),host.context.uid,true);if(hash(readFileSync(definition(host.context)))!==hash(renderService('darwin',host.context.home,host.context.source,host.context.node)))throw Error('Definition changed before removal.');unlinkSync(definition(host.context));syncDirectory(dirname(definition(host.context)));});
  if(p.action==='update'){
   await step('backup',async()=>{await inspectOwned(false);const root=join(area(host.context),'backups');if(!existsSync(root))mkdirSync(root,{mode:0o700});safe(root,host.context.uid,true);const dest=join(root,p.digest);mkdirSync(dest,{mode:0o700});await host.backup(dest);});
   for(const command of ['fetch','checkout','dependencies','build'] as const)await step(command,async()=>{const current=await inspectOwned(false);if(current.runtime!=='stopped'||current.pids.length||!current.clean||current.revision!==(['dependencies','build'].includes(command)?p.nextRevision:p.before.revision))throw Error('Runtime or source changed during update.');await host.command(command,p);});
  }
  if(['install','start','update'].includes(p.action))await step('start',async()=>{const current=await inspectOwned(false);if(current.runtime!=='stopped'||current.pids.length||!current.clean||current.revision!==(p.nextRevision??p.before.revision))throw Error('Selected runtime/source changed before start.');await host.command('register',p);await waitFor(async()=>{const next=await host.inspect();return next.registration==='owned'&&next.runtime==='owned'&&next.profile===p.before.profile&&next.revision===(p.nextRevision??p.before.revision);});});
  await step('verify',async()=>{const current=await host.inspect();if(p.action==='uninstall'?(current.definition!=='absent'||current.registration!=='absent'||current.runtime!=='stopped'):p.action==='stop'?(current.definition!=='owned'||current.registration!=='absent'||current.runtime!=='stopped'):(current.definition!=='owned'||current.registration!=='owned'||current.runtime!=='owned'))throw Error('Final service state did not match the operation.');});
  transaction(db,()=>{owns();receipt!.state='completed';save();db!.prepare('DELETE FROM resource WHERE id=1 AND fence=? AND nonce=?').run(receipt!.fence,receipt!.nonce);});return receipt!;
 }catch(error){if(receipt)try{transaction(db,()=>{owns();receipt!.state='uncertain';save();});}catch{}throw error;}finally{db.close();}
}
export function releaseService(host:ServiceHost,snapshot:unknown,evidence:unknown):ServiceReceipt {
 const decision=lifecycleRecovery(snapshot,evidence);if(decision.action==='retain')throw Error('Explicit stopped-handler/descendant evidence is required.');const db=journal(host.context);if(!db)throw Error('No lifecycle receipt.');db.close();const writable=journal(host.context,true)!;
 try{return transaction(writable,()=>{const old=stored(writable,decision.snapshot.digest);if(!old)throw Error('No lifecycle receipt.');if(decision.action==='return-receipt')return old;if(canonical({digest:old.digest,resource:old.resource,fence:old.fence,nonce:old.nonce,state:old.state})!==canonical(decision.snapshot))throw Error('Lifecycle receipt changed.');try{process.kill(old.pid,0);throw Error('Lifecycle handler remains live.');}catch(e){if(!(e instanceof Error)||!('code' in e)||e.code!=='ESRCH')throw Error('Lifecycle handler must be confirmed stopped.');}const r=writable.prepare('SELECT * FROM resource WHERE id=1').get();if(r?.digest!==old.digest||r.fence!==old.fence||r.nonce!==old.nonce||r.pid!==old.pid)throw Error('Lifecycle resource changed.');const released={...old,state:'released' as const};writable.prepare('UPDATE operations SET receipt=? WHERE digest=?').run(JSON.stringify(released),old.digest);writable.prepare('INSERT INTO releases(digest,reason,created) VALUES(?,?,?)').run(old.digest,decision.reason!,new Date().toISOString());writable.prepare('DELETE FROM resource WHERE id=1 AND fence=? AND nonce=?').run(old.fence,old.nonce);return released;});}finally{writable.close();}
}
async function waitFor(check:()=>Promise<boolean>):Promise<void> {for(let i=0;i<80;i++){if(await check())return;await new Promise(done=>setTimeout(done,250));}throw Error('Service outcome is unconfirmed; inspect the retained receipt.');}

interface Result {status:number|null;out:string;err:string}
async function command(program:string,args:string[],cwd?:string,timeout=15000):Promise<Result> {
 const env=Object.fromEntries(['PATH','HOME','USER','TMPDIR','LANG','LC_ALL'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));env.PATH=dirname(process.execPath)+':'+(env.PATH??'');
 return new Promise((done,fail)=>{const child=spawn(program,args,{cwd,env,stdio:['ignore','pipe','pipe']});let out='',err='',bytes=0;const timer=setTimeout(()=>{child.kill();fail(Error('Lifecycle command timed out; effects remain uncertain.'));},timeout);const add=(target:'out'|'err',b:Buffer)=>{bytes+=b.length;if(bytes>1048576){child.kill();clearTimeout(timer);fail(Error('Lifecycle command output exceeded its bound.'));}else if(target==='out')out+=b;else err+=b;};child.stdout.on('data',(b:Buffer)=>add('out',b));child.stderr.on('data',(b:Buffer)=>add('err',b));child.once('error',()=>{clearTimeout(timer);fail(Error('Lifecycle command could not start.'));});child.once('close',status=>{clearTimeout(timer);done({status,out,err});});});
}
/** Public keys follow baseKey's mode644 convention; private credentials and matching key identity remain mandatory. */
export function serviceProfileIdentity(c:ServiceContext):string {
 for(const name of ['config.json','token','base-key'])safe(join(c.home,name),c.uid,true);safe(join(c.home,'base.pub'),c.uid);
 const token=readFileSync(join(c.home,'token'),'utf8').trim();if(readToken(c.home)!==token||process.env.NERV_PORT!==undefined||process.env.NODO_PORT!==undefined)throw Error('Service lifecycle requires persistent configuration and token, without runtime overrides.');
 const pub=readFileSync(join(c.home,'base.pub'),'utf8').trim(),key=createPrivateKey(readFileSync(join(c.home,'base-key'),'utf8'));if(createPublicKey(key).export({type:'spki',format:'der'}).toString('base64')!==keyIdentity(pub))throw Error('Base private/public identity mismatch.');readConfig(c.home);
 return hash(canonical({config:hash(readFileSync(join(c.home,'config.json'))),token:hash(token),privateKey:hash(readFileSync(join(c.home,'base-key'))),publicKey:hash(readFileSync(join(c.home,'base.pub')))}));
}
/** Until a migration contract is reviewed, executable, dependency and configuration changes cannot enter this update path. */
export async function compatibleServiceRevision(c:ServiceContext,revision:string,run:typeof command=command):Promise<boolean> {
 if(!/^[a-f0-9]{40}$/.test(revision))return false;const db=new DatabaseSync(databasePath(c.home),{readOnly:true});let schema:number;try{schema=Number(db.prepare('PRAGMA user_version').get()!.user_version);}finally{db.close();}if(schema<5||schema>SERVICE_READER_SCHEMA)return false;
 const diff=await run('git',['-C',c.source,'diff','--name-only','-z','HEAD',revision,'--']);return diff.status===0&&diff.out.split('\0').filter(Boolean).every(path=>path.startsWith('docs/')||path==='README.md');
}
export function macRegistrationMatches(output:string,c:ServiceContext):boolean {
 const field=(name:string)=>output.match(new RegExp('^\\s*'+name+' = (.+)$','m'))?.[1]?.trim();
 const args=output.match(/arguments = \{([\s\S]*?)\n\s*\}/)?.[1]?.split('\n').map(s=>s.trim().replace(/^\d+\s*=\s*/, '')).filter(Boolean);
 const homes=[...output.matchAll(/^\s*NERV_HOME => (.+)$/gm)].map(m=>m[1]!.trim());
 return field('path')===definition(c)&&field('program')===c.node&&field('working directory')===c.source&&canonical(args)===canonical([c.node,...NODE_FLAGS,join(c.source,'src/cli.ts'),'serve'])&&homes.length===1&&homes[0]===c.home;
}
/** The only production adapter: current unprivileged GUI user, current checkout and existing default data home. */
export function macServiceHost(home:string):ServiceHost {
 if(process.platform!=='darwin'||!process.getuid?.())throw Error('Durable local lifecycle currently requires an unprivileged macOS GUI user.');
 const context:ServiceContext={userHome:homedir(),home:resolve(home),source:realpathSync(fileURLToPath(new URL('..',import.meta.url))),node:realpathSync(process.execPath),uid:process.getuid()};
 if(context.home!==join(context.userHome,'.nerv'))throw Error('An additional or legacy profile cannot manage this OS service.');
 return macServiceAdapter(context);
}
export function macServiceAdapter(context:ServiceContext,run:typeof command=command):ServiceHost {
 const gui='gui/'+context.uid,target=gui+'/io.nerv.agent',expected=renderService('darwin',context.home,context.source,context.node);
 const git=async(args:string[])=>{const r=await run('git',['-C',context.source,...args]);if(r.status!==0)throw Error('Selected source could not be verified.');return r.out.trim();};
 const registration=async(label:string):Promise<Result|undefined>=>{const r=await run('launchctl',['print',gui+'/'+label]);if(r.status===0)return r;if(/Could not find service|service could not be found/i.test(r.err))return;throw Error('The service manager result is unknown.');};
 const host:ServiceHost={context,
  inspect:async()=>{
   safe(context.userHome,context.uid);safe(context.home,context.uid,true);safe(context.source,context.uid);safe(context.node,context.uid);assertRootMigrationReady(context.home);const config=readConfig(context.home),token=readToken(context.home);
   const profile=serviceProfileIdentity(context);
   const revision=await git(['rev-parse','HEAD']);if(!/^[a-f0-9]{40}$/.test(revision)||await git(['remote','get-url','origin'])!=='https://github.com/voidbrain/nerv.git')throw Error('Use the canonical reviewed NERV checkout.');
   const session=(await run('launchctl',['print',gui])).status===0;if(!session)throw Error('The current GUI user session is unavailable.');
   const current=definition(context),currentKind=!present(current)?'absent':(()=>{try{safe(current,context.uid,true);return hash(readFileSync(current))===hash(expected)?'owned':'foreign';}catch{return 'foreign';}})();
   const manager=await registration('io.nerv.agent'),legacyManager=await registration('io.nodo.agent');let registered:'absent'|'owned'|'foreign'='absent';let managerPid=0;
   if(manager){registered=macRegistrationMatches(manager.out,context)?'owned':'foreign';managerPid=Number(manager.out.match(/^\s*pid = (\d+)$/m)?.[1])||0;}
   const ps=await run('ps',['-axo','pid=,ppid=,comm=,args=']);if(ps.status!==0)throw Error('Process ownership could not be inspected.');const rows=ps.out.split('\n').flatMap(line=>{const m=/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);return m?[{pid:Number(m[1]),parent:Number(m[2]),comm:m[3]!,args:m[4]!}]:[];});const roots=rows.filter(r=>(r.comm==='node'||r.comm.endsWith('/node'))&&/src\/cli\.ts\s+(serve|launch)(\s|$)/.test(r.args));const ids=new Set(roots.map(r=>r.pid));if(managerPid)ids.add(managerPid);let changed=true;while(changed){changed=false;for(const r of rows)if(ids.has(r.parent)&&!ids.has(r.pid)){ids.add(r.pid);changed=true;}}const pids=[...ids].sort((a,b)=>a-b);
   let runtime:ServiceObservation['runtime']=pids.length?'unknown':'stopped';try{const r=await fetch('http://127.0.0.1:'+config.port+'/api/doctor',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(1500)});if(r.ok){const body=await r.json() as {base?:{id:string};build?:{commit:string}};runtime=body.base?.id===config.base.id&&body.build?.commit===revision&&registered==='owned'&&pids.includes(managerPid)?'owned':'unknown';}else runtime='unknown';}catch{}
   safe(databasePath(context.home),context.uid);const db=new DatabaseSync(databasePath(context.home),{readOnly:true});let pending:boolean,schema:number;try{schema=Number(db.prepare('PRAGMA user_version').get()!.user_version);pending=!!db.prepare("SELECT 1 FROM worker_jobs WHERE state NOT IN ('completed','cancelled','released') LIMIT 1").get()||!!db.prepare('SELECT 1 FROM kaji_outbox WHERE done IS NULL LIMIT 1').get()||!!db.prepare("SELECT 1 FROM worker_legacy_outbox WHERE state='pending' LIMIT 1").get();}finally{db.close();}
   return {revision,schema,profile,definition:currentKind,registration:registered,runtime,pids,session,clean:(await git(['status','--porcelain']))==='',legacy:present(join(dirname(current),'io.nodo.agent.plist'))||!!legacyManager,pending,built:existsSync(join(context.source,'dist/web/browser/index.html'))};
  },
  compatible:revision=>compatibleServiceRevision(context,revision,run),
  authorizedStart:async p=>{if(process.ppid!==1||await git(['status','--porcelain'])!==''||serviceProfileIdentity(context)!==p.before.profile||await git(['rev-parse','HEAD'])!==(p.nextRevision??p.before.revision))return false;const manager=await registration('io.nerv.agent');return !!manager&&macRegistrationMatches(manager.out,context)&&Number(manager.out.match(/^\s*pid = (\d+)$/m)?.[1])===process.pid&&hash(readFileSync(definition(context)))===hash(expected)&&manager.out.includes('NERV_HOME => '+context.home)&&manager.out.includes('program = '+context.node);},
  command:async(step,p)=>{let r:Result;if(step==='register')r=await run('launchctl',['bootstrap',gui,definition(context)]);else if(step==='unregister')r=await run('launchctl',['bootout',target]);else if(step==='fetch')r=await run('git',['-C',context.source,'fetch','--no-tags','origin',p.nextRevision!],undefined,120000);else if(step==='checkout')r=await run('git',['-C',context.source,'checkout','--detach',p.nextRevision!]);else r=await run('npm',step==='dependencies'?['ci','--engine-strict']:['run','build'],context.source,600000);if(r.status!==0)throw Error('Service '+step+' did not confirm completion; retain uncertainty.');},
  backup:async path=>{safe(databasePath(context.home),context.uid);const file=join(path,'database.sqlite'),db=new DatabaseSync(databasePath(context.home));try{db.prepare('VACUUM INTO ?').run(file);}finally{db.close();}chmodSync(file,0o600);const fd=openSync(file,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}const check=new DatabaseSync(file,{readOnly:true});try{if(check.prepare('PRAGMA quick_check').get()!.quick_check!=='ok')throw Error('Consistent update backup failed integrity check.');}finally{check.close();}const sums:Record<string,string>={};for(const name of ['config.json','token','base-key','base.pub',ROOT_KEY_FILE,'anthropic-key','telegram-token']){const src=join(context.home,name);if(existsSync(src)){safe(src,context.uid,name!=='base.pub');const bytes=readFileSync(src);exclusive(join(path,name),bytes);sums[name]=hash(bytes);}}exclusive(join(path,'manifest.json'),JSON.stringify({files:sums,database:fileHash(file),restore:'separately reviewed; never automatic'}));}
 };return host;
}
