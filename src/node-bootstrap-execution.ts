import {canonical,publicKeyFrom} from './kaji.ts';
import {bootstrapPlan,type BootstrapPlan} from './node-bootstrap.ts';
import {runNodeCommand,sshInspectionRequest,type CommandRunner} from './node-inspection.ts';
export type BootstrapState='completed'|'uncertain'|'refused'|'busy'|'absent'|'released';
export interface BootstrapReceipt {version:1;digest:string;state:BootstrapState;steps:string[];reason?:string;publicKey?:string;service:'not-installed';pairing:'required'}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Reconstruct every command from validated fields; a saved command list is never executable authority. */
export function validateBootstrapPlan(value:unknown,now=new Date(),recovery=false):BootstrapPlan {
 if(!object(value)||!object(value.source)||!Array.isArray(value.steps)||!object(value.inspection))throw Error('Invalid bootstrap manifest.');
 const plan=bootstrapPlan(value.inspection,{sourceProtocol:value.source.bootstrapProtocol as 1,revision:value.source.revision as string,checkout:value.checkout as string,home:value.home as string,base:value.base as BootstrapPlan['base'],installService:value.steps.some(step=>object(step)&&step.id==='per-user-service')},recovery?new Date(String(value.inspection.observedAt)):now);
 if(canonical(plan)!==canonical(value))throw Error('Bootstrap manifest differs from its validated plan.');return plan;
}
/** Fixed target-side program. Never run saved shell text or return command output/credentials. */
const TARGET_BOOTSTRAP=String.raw`
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const {plan:p,mode,reason,confirmedStopped}=input, digest=p.digest, steps=[];
const result=(state,why,extra={})=>({version:1,digest,state,steps:[...steps],...(why?{reason:why}:{}),service:'not-installed',pairing:'required',...extra});
let root,receiptFile,activeFile,owned=false,nonce,active;
const read=file=>{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw Error('unsafe-journal');return JSON.parse(fs.readFileSync(file,'utf8'));};
const persist=(file,value)=>{const temp=file+'.'+crypto.randomUUID()+'.tmp',fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);try{const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}catch{if(process.platform!=='win32')throw Error('journal-sync');}};
const safeDir=dir=>{const relative=path.relative(os.homedir(),dir);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('unsafe-path');let current=os.homedir();for(const part of relative.split(path.sep)){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('symlink-path');}};
const owns=()=>{const value=read(activeFile);if(value.digest!==digest||value.nonce!==nonce||value.pid!==process.pid)throw Error('lost-resource');};
const execute=(id,program,args,cwd,env,capture=false)=>{owns();steps.push(id+':started');persist(receiptFile,result('uncertain','step-running'));const out=cp.spawnSync(program,args,{cwd,env,stdio:capture?['ignore','pipe','ignore']:'ignore',encoding:'utf8',timeout:240000,maxBuffer:16384,windowsHide:true});if(out.status!==0||out.error)throw Error('step-failed:'+id);steps[steps.length-1]=id+':completed';persist(receiptFile,result('uncertain','between-steps'));return (out.stdout||'').trim();};
try{
 const {digest:ignored,...body}=p;if(crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')!==digest||!/^[a-f0-9]{64}$/.test(digest))throw Error('manifest-integrity');
 if(p.observed.hostname!==os.hostname()||p.inspection.userHome!==os.homedir()||p.observed.platform!==process.platform||p.observed.arch!==process.arch||p.observed.userId!==(process.getuid?process.getuid():null))throw Error('target-identity-changed');
 root=path.join(os.homedir(),'.nerv-bootstrap');receiptFile=path.join(root,digest+'.json');activeFile=path.join(root,'active.json');
 if(fs.existsSync(root)){const stat=fs.lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('unsafe-journal-root');}
 const previous=fs.existsSync(receiptFile)?read(receiptFile):null;
 if(mode==='status')return previous||result('absent','no-target-receipt');
 if(mode==='release'){
  if(!confirmedStopped||typeof reason!=='string'||reason.trim().length<8||reason.length>500)throw Error('release-confirmation-required');
  if(!fs.existsSync(activeFile))return previous||result('absent','no-target-receipt');active=read(activeFile);if(active.version!==1||active.digest!==digest||!Number.isSafeInteger(active.pid)||!active.nonce)throw Error('resource-owned-by-another-plan');
  try{process.kill(active.pid,0);throw Error('handler-still-running');}catch(error){if(error.code!=='ESRCH')throw Error('handler-not-confirmed-stopped');}
  const released={...(previous||result('released')),state:previous&&previous.state==='completed'?'completed':'released',reconciled:{reason,at:new Date().toISOString(),effects:'not-assumed-undone'}};persist(receiptFile,released);fs.unlinkSync(activeFile);return released;
 }
 if(previous)return previous;
 if(p.blockers.length||p.steps.some(step=>step.id==='per-user-service'))throw Error('review-blockers');
 if(process.getuid&&process.getuid()===0)throw Error('privileged-user');
 if(p.observed.node!==process.versions.node||Number(process.versions.node.split('.')[0])<24)throw Error('runtime-changed');
 safeDir(p.checkout);safeDir(p.home);if(fs.existsSync(p.checkout)||fs.existsSync(p.home)||fs.existsSync(path.join(os.homedir(),'.nerv','config.json')))throw Error('existing-installation');
 for(const dir of [p.checkout,p.home])if(!fs.statSync(path.dirname(dir)).isDirectory())throw Error('parent-directory-missing');
 if(!fs.existsSync(root))fs.mkdirSync(root,{mode:0o700});nonce=crypto.randomUUID();
 try{const fd=fs.openSync(activeFile,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({version:1,digest,pid:process.pid,nonce}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}owned=true;}catch{return result('busy','bootstrap-resource-held');}
 persist(receiptFile,result('uncertain','accepted-before-effects'));
 const allowed=['PATH','HOME','USER','USERPROFILE','HOMEDRIVE','HOMEPATH','SYSTEMROOT','WINDIR','TEMP','TMP','LANG','LC_ALL'];const env=Object.fromEntries(allowed.filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));const runtimeEnv={...env,NERV_HOME:p.home};
 execute('clone','git',['clone','--no-checkout','--','https://github.com/voidbrain/nerv.git',p.checkout],undefined,env);
 execute('fetch-pinned-commit','git',['-C',p.checkout,'fetch','--depth=1','origin',p.source.revision],undefined,env);
 execute('checkout-pinned-commit','git',['-C',p.checkout,'checkout','--detach',p.source.revision],undefined,env);
 if(execute('verify-source','git',['-C',p.checkout,'rev-parse','HEAD'],undefined,env,true)!==p.source.revision)throw Error('source-revision-differs');
 const declared=JSON.parse(fs.readFileSync(path.join(p.checkout,'shared','node-bootstrap.json'),'utf8'));if(declared.version!==1||declared.initNoModelSetup!==true)throw Error('source-protocol-differs');
 // npm.cmd is a fixed executable on Windows; no user data enters its command line.
 if(process.platform==='win32')execute('locked-dependencies',process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm ci --engine-strict'],p.checkout,env);else execute('locked-dependencies','npm',['ci','--engine-strict'],p.checkout,env);
 if(process.platform==='win32')execute('build',process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm run build'],p.checkout,env);else execute('build','npm',['run','build'],p.checkout,env);
 safeDir(p.home);if(fs.existsSync(p.home))throw Error('data-home-created-during-build');
 const cli=path.join(p.checkout,'src','cli.ts');execute('initialize',process.execPath,['--use-system-ca',cli,'init','--no-model-setup','--base',p.base.id,'--name',p.base.name],p.checkout,runtimeEnv);
 safeDir(p.home);const identity=execute('public-identity',process.execPath,['--use-system-ca',cli,'base','pubkey'],p.checkout,runtimeEnv,true).split(/\r?\n/)[0];const publicKey=crypto.createPublicKey({key:Buffer.from(identity,'base64'),format:'der',type:'spki'});if(publicKey.asymmetricKeyType!=='ed25519')throw Error('invalid-public-identity');
 owns();const complete=result('completed',undefined,{publicKey:identity});persist(receiptFile,complete);fs.unlinkSync(activeFile);owned=false;return complete;
}catch(error){const code=String(error.message);const known=['manifest-integrity','target-identity-changed','unsafe-journal-root','release-confirmation-required','resource-owned-by-another-plan','handler-not-confirmed-stopped','review-blockers','privileged-user','runtime-changed','unsafe-path','symlink-path','existing-installation','parent-directory-missing','source-revision-differs','source-protocol-differs','data-home-created-during-build','invalid-public-identity','lost-resource','journal-sync'];const why=code.startsWith('step-failed:')?code:known.includes(code)?code:'target-operation-failed';const value=result(owned?'uncertain':'refused',why);if(owned)try{persist(receiptFile,value);}catch{}return value;}
`;
/** Generate fixed code plus a data literal; saved commands and report text never become JavaScript. */
export function bootstrapRequest(plan:BootstrapPlan,mode:'apply'|'status'|'release',reason?:string,confirmedStopped=false){
 if(!['apply','status','release'].includes(mode))throw Error('Invalid bootstrap operation.');
 const input=JSON.stringify({plan,mode,reason,confirmedStopped});const script=`const input=${input};const receipt=(()=>{${TARGET_BOOTSTRAP}})();process.stdout.write(JSON.stringify(receipt));`;
 const request=plan.inspection.transport==='local'?{program:process.execPath,args:['--input-type=commonjs','-'],timeoutMs:900000,maxBytes:32768}:sshInspectionRequest(plan.target);
 return {...request,input:script,timeoutMs:mode==='apply'?900000:15000,mayWrite:mode!=='status'};
}
export async function bootstrapOperation(raw:unknown,mode:'apply'|'status'|'release',options:{confirm?:string;reason?:string;confirmedStopped?:boolean}={},runner:CommandRunner=runNodeCommand,now=new Date()):Promise<BootstrapReceipt>{
 if(!['apply','status','release'].includes(mode))throw Error('Invalid bootstrap operation.');
 const plan=validateBootstrapPlan(raw,now,mode!=='apply');if(mode!=='status'&&options.confirm!==plan.digest)throw Error('Confirm the exact reviewed plan digest.');
 if(mode==='apply'&&plan.blockers.length)throw Error('Bootstrap is blocked: '+plan.blockers.join(' '));
 if(mode==='release'&&(!options.confirmedStopped||!options.reason||options.reason.trim().length<8||options.reason.length>500))throw Error('Release needs explicit stopped confirmation and an evidence reason.');
 let value:unknown;try{const output=await runner(bootstrapRequest(plan,mode,options.reason,options.confirmedStopped));if(Buffer.byteLength(output)>32768)throw Error('oversize');value=JSON.parse(output);}catch{return {version:1,digest:plan.digest,state:'uncertain',steps:[],reason:'Transport/process outcome unknown; inspect the target receipt before retrying.',service:'not-installed',pairing:'required'};}
 if(!object(value)||value.version!==1||value.digest!==plan.digest||!['completed','uncertain','refused','busy','absent','released'].includes(String(value.state))||!Array.isArray(value.steps)||value.steps.length>20||value.steps.some(step=>typeof step!=='string'||!/^[-a-z]+:(?:started|completed)$/.test(step)))throw Error('Invalid target bootstrap receipt; outcome remains unknown.');
 if(value.state==='completed'&&(typeof value.publicKey!=='string'||value.steps.length!==plan.steps.length||value.steps.some((step,i)=>step!==plan.steps[i]!.id+':completed')))throw Error('Incomplete success receipt; outcome remains unknown.');
 const receipt:BootstrapReceipt={version:1,digest:plan.digest,state:value.state as BootstrapState,steps:value.steps as string[],service:'not-installed',pairing:'required'};
 if(typeof value.reason==='string'&&/^[a-z0-9:-]{1,100}$/.test(value.reason))receipt.reason=value.reason;
 if(value.publicKey!==undefined){if(typeof value.publicKey!=='string'||value.publicKey.length>128||!/^[A-Za-z0-9+/=]+$/.test(value.publicKey))throw Error('Invalid bootstrap public identity; pairing is not established.');publicKeyFrom(value.publicKey);receipt.publicKey=value.publicKey;}
 return receipt;
}
