// F-029: versioned, repository-owned scenarios; no model calls in deterministic mode.
import {readFileSync,writeFileSync,mkdirSync,realpathSync,lstatSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {buildInfo} from '../src/build.ts';
const root=fileURLToPath(new URL('..',import.meta.url));
export function readSuite(at=root){
 const suite=JSON.parse(readFileSync(resolve(at,'evals/suite.json'),'utf8'));
 if(suite.schemaVersion!==1||typeof suite.id!=='string'||!Array.isArray(suite.groups)||!suite.groups.length||!Array.isArray(suite.notCovered))throw Error('Invalid evaluation suite');
 const ids=new Set();
 for(const group of suite.groups){
  if(!/^[a-z][a-z0-9-]{0,50}$/.test(group.id)||ids.has(group.id)||!Array.isArray(group.files)||!group.files.length||!Array.isArray(group.families)||!group.families.length||!Number.isInteger(group.minimumTests)||group.minimumTests<1)throw Error('Invalid/duplicate evaluation group');ids.add(group.id);
  for(const file of group.files){
   if(typeof file!=='string'||!/^test\/[a-z0-9.-]+\.(?:test\.ts|test\.mjs|browser\.mjs)$/.test(file))throw Error('Invalid scenario file');
   const path=resolve(at,file),rel=relative(realpathSync(at),realpathSync(path));
   if(lstatSync(path).isSymbolicLink()||rel.startsWith('..')||isAbsolute(rel))throw Error('Scenario file escapes repository');
  }
  if(group.families.some(f=>typeof f!=='string'||!f.trim()))throw Error('Invalid scenario family');
 }
 for(const gap of suite.notCovered)if(!gap.branch||!gap.owner||!gap.reason)throw Error('Coverage gaps must name their owner and reason');
 return suite;
}
export function options(args){
 const out={only:null,repeat:1,seed:1,output:null,check:false};const seen=new Set();
 for(const arg of args){
  const m=/^--(only|repeat|seed|out)=(.+)$/.exec(arg);const key=arg==='--check'?'check':m?.[1];
  if(!key||seen.has(key))throw Error('Use unique --check, --only=group, --repeat=1..10, --seed=uint32, --out=path');seen.add(key);
  if(key==='check')out.check=true;else if(key==='only')out.only=m[2];else if(key==='out')out.output=m[2];else{if(!/^\d+$/.test(m[2]))throw Error('Invalid numeric option');out[key]=Number(m[2]);}
 }
 if(!Number.isSafeInteger(out.repeat)||out.repeat<1||out.repeat>10||!Number.isSafeInteger(out.seed)||out.seed<0||out.seed>4294967295)throw Error('Repeat or seed outside bounds');
 return out;
}
const clean=text=>String(text).split(root).join('<repo>').split(root.replaceAll('\\','/')).join('<repo>').split(tmpdir()).join('<tmp>').slice(-24000);
export function sourceInputs(at=root,includeBuild=false){
 const files=new Set(),walk=file=>{
  const path=resolve(at,file);if(!existsSync(path))return;
  const stat=lstatSync(path);if(stat.isSymbolicLink())throw Error('Symlink source cannot be frozen: '+file);
  if(stat.isDirectory())for(const name of readdirSync(path).sort())walk(file+'/'+name);else if(stat.isFile())files.add(file);
 };
 for(const dir of ['src','test','shared','web','evals'])walk(dir);
 if(includeBuild)walk('dist/web/browser');
 for(const file of ['package.json','package-lock.json','angular.json','tsconfig.json','.harness.json'])walk(file);
 if(existsSync(resolve(at,'tools')))for(const name of readdirSync(resolve(at,'tools')))if(/^evaluate.*\.mjs$/.test(name))walk('tools/'+name);
 return Object.fromEntries([...files].sort().map(file=>[file,createHash('sha256').update(readFileSync(resolve(at,file))).digest('hex')]));
}
export function evidenceRevision(includeBuild=false){
 const state=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',timeout:3000});
 return {...buildInfo(),dirty:state.status===0?!!state.stdout.trim():null,includesBuild:includeBuild,inputs:sourceInputs(root,includeBuild)};
}
export function runProcess(args,{timeoutMs,env=process.env,maxBytes=2*1024*1024}={}){
 // Until a Job Object supervisor is implemented, refuse execution on Windows:
 // taskkill cannot guarantee cleanup after the original parent has exited.
 if(process.platform==='win32')return Promise.reject(Error('Evaluation execution requires POSIX process groups; Windows Job Object supervision is not implemented'));
 return new Promise(resolveRun=>{
  const child=spawn(process.execPath,args,{cwd:root,env,detached:process.platform!=='win32',windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',bytes=0,error=null,stopping=false,force;
  const groupKill=signal=>{try{process.kill(-child.pid,signal);}catch(e){if(e.code!=='ESRCH')error=(error||'')+' Cleanup failed: '+e.message;}};
  const stop=message=>{
   if(stopping)return;stopping=true;error=message;
   groupKill('SIGTERM');force=setTimeout(()=>groupKill('SIGKILL'),500);
  };
  const timer=setTimeout(()=>stop('Group time budget exceeded'),timeoutMs);
  const capture=stream=>part=>{bytes+=Buffer.byteLength(part);if(bytes>maxBytes){stop('Group output budget exceeded');return;}if(stream==='stdout')stdout+=part;else stderr+=part;};
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',capture('stdout'));child.stderr.on('data',capture('stderr'));
  child.once('error',e=>{error=e.message;});
  child.once('close',async(status,signal)=>{
   clearTimeout(timer);clearTimeout(force);
   if(process.platform!=='win32'&&child.pid)groupKill('SIGKILL');
   resolveRun({status,signal,stdout,stderr,error});
  });
 });
}
export function writeReport(report,output){
 const path=resolve(root,output||`artifacts/evaluations/${report.started.replaceAll(':','-')}-${randomUUID()}.json`);
 if(!path.endsWith('.json')||path.split(/[\\/]/).includes('.git'))throw Error('Evidence must be a new JSON file outside git metadata');
 // Evidence is append-only: never replace a previous report, fixture, source file or symlink.
 let parent=dirname(path);while(parent!==dirname(parent)){try{if(lstatSync(parent).isSymbolicLink())throw Error('Refusing symlink evidence parent');}catch(e){if(e.code!=='ENOENT')throw e;}parent=dirname(parent);}
 mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});return path;
}
export async function run(args=[]){
 const config=options(args),suite=readSuite();
 if(config.check)return {checked:true,id:suite.id,groups:suite.groups.length};
 const selected=config.only?suite.groups.filter(g=>g.id===config.only):suite.groups;
 if(!selected.length)throw Error('Unknown evaluation group');
 const started=new Date().toISOString(),results=[],deadline=Date.now()+900000,revision=evidenceRevision(selected.some(g=>g.id==='browser'));
 for(let iteration=0;iteration<config.repeat;iteration++){
  // The seed controls group ordering; native integration clocks and real model sampling are not deterministic.
  let value=(config.seed+iteration)>>>0;const ordered=selected.map(g=>({group:g,key:(value=(Math.imul(value,1664525)+1013904223)>>>0)})).sort((a,b)=>a.key-b.key);
  for(const {group} of ordered){
   if(Date.now()>=deadline){results.push({id:group.id,iteration:iteration+1,status:'not-run',counts:{tests:0,passed:0,failed:0,skipped:0},error:'Suite time budget exhausted'});continue;}
   process.stderr.write(`Evaluating ${group.id} (${iteration+1}/${config.repeat})\n`);
   const childEnv={...process.env,NERV_EVAL_SEED:String((config.seed+iteration)>>>0)};delete childEnv.NODE_TEST_CONTEXT;
   const begin=performance.now();const child=await runProcess(['--test','--test-reporter=tap','--test-concurrency=1',...group.files],{timeoutMs:Math.min(180000,deadline-Date.now()),env:childEnv});
   const output=(child.stdout||'')+'\n'+(child.stderr||'');const count=key=>Number(new RegExp('^# '+key+' (\\d+)','m').exec(output)?.[1]||0);
   if(child.status!==0)process.stderr.write(clean(output)+'\n');
   results.push({id:group.id,iteration:iteration+1,families:group.families,files:group.files,status:!child.error&&child.status===0&&count('tests')>=group.minimumTests&&count('pass')>0&&count('fail')===0?'passed':'failed',counts:{tests:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped')},durationMs:Math.round(performance.now()-begin),exitCode:child.status,error:child.error?clean(child.error):null,evidenceTruncated:output.length>24000,evidenceBytes:Buffer.byteLength(output),evidence:clean(output)});
  }
 }
 const sourceStable=JSON.stringify(sourceInputs(root,revision.includesBuild))===JSON.stringify(revision.inputs);
 const report={schemaVersion:1,sourceStable,suite:suite.id,mode:'scripted-control-flow',started,finished:new Date().toISOString(),revision,node:process.version,platform:process.platform,seed:config.seed,repeat:config.repeat,limits:{suiteTimeoutMs:900000,groupTimeoutMs:180000,maxRepeat:10,groupConcurrency:1},results,selection:{groups:selected.map(g=>g.id),notRunGroups:suite.groups.filter(g=>!selected.some(s=>s.id===g.id)).map(g=>g.id)},complete:selected.length===suite.groups.length&&results.every(r=>r.status!=='not-run'&&!r.error),notCovered:suite.notCovered,passed:sourceStable&&results.every(r=>r.status==='passed'),note:'Scripted provider and fixture evidence does not establish real-model judgment, phone receipt or production promotion.'};
 const path=writeReport(report,config.output);return {passed:report.passed,complete:report.complete,path,groups:results.length,tests:results.reduce((n,r)=>n+r.counts.tests,0)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=await run(process.argv.slice(2));console.log(JSON.stringify(result,null,2));if(result.passed===false)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}
}
