// Enforces fresh, input-bound review evidence. Semantic judgments remain reviewed agent work.
import {existsSync,readFileSync,writeFileSync,mkdirSync,realpathSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {friction} from './friction.mjs';
export function maintenance(root,args) {
 root=realpathSync(root);const [command,...flags]=args;
 if (!['check','review'].includes(command)) throw Error('Use check or review');
 let outcomes;
 for(const flag of flags) {if(command!=='review'||outcomes!==undefined||!flag.startsWith('--outcomes='))throw Error('Invalid or duplicate option');outcomes=flag.slice(11);}
 const stamp=JSON.parse(readFileSync(resolve(root,'.harness.json'),'utf8')),cfg=stamp.maintenance;
 if(!cfg?.enabled){if(Number(String(stamp.version??'0').split('.')[0])>=3)throw Error('Harness 3.0 requires enabled maintenance policy');return {enabled:false,note:'Maintenance enforcement not adopted'};}
 const safe=path=>{
  if(typeof path!=='string'||!path||isAbsolute(path)||path.split(/[\\/]/).some(p=>p==='..'||p==='.git'))throw Error('Invalid maintenance path');
  const full=resolve(root,path);
  let ancestor=full;while(!existsSync(ancestor)&&ancestor!==root)ancestor=dirname(ancestor);
  const parentRel=relative(root,realpathSync(ancestor));if(parentRel.startsWith('..')||isAbsolute(parentRel))throw Error('Maintenance path escapes checkout');
  if(existsSync(full)){const rel=relative(root,realpathSync(full));if(rel.startsWith('..')||isAbsolute(rel))throw Error('Maintenance path escapes checkout');}
  return full;
 };
 if(!Array.isArray(cfg.inputs)||!cfg.inputs.length||!Number.isInteger(cfg.reviewDays)||cfg.reviewDays<1)throw Error('Configure inputs and positive reviewDays');
 const inputs=Object.fromEntries([...new Set(cfg.inputs)].sort().map(path=>[path,createHash('sha256').update(readFileSync(safe(path))).digest('hex')]));
 const policy=createHash('sha256').update(JSON.stringify(cfg)).digest('hex');
 const receipt=resolve(root,'docs/agents/maintenance-review.json');
 for(const path of [dirname(receipt),receipt]){try{if(lstatSync(path).isSymbolicLink())throw Error('Refusing symlink review destination');}catch(e){if(e.code!=='ENOENT')throw e;}}
 safe('docs/agents/maintenance-review.json');
 const validate=rows=>{
  if(!Array.isArray(rows)||!rows.length)throw Error('Review outcomes required');
  for(const row of rows){
   if(!['rule','tool','skill','none'].includes(row.kind)||!['implemented','backlog','no-change'].includes(row.disposition)||typeof row.evidence!=='string'||!row.evidence.trim())throw Error('Invalid review outcome');
   if(row.disposition==='backlog'){
    if(!/^[BF]-\d{3}$/.test(row.target??'')||!readFileSync(resolve(root,'docs/BACKLOG.md'),'utf8').includes(`### ${row.target}\n`))throw Error('Outcome must link an owning active backlog record');
   }else if(row.disposition==='implemented') {if(!existsSync(safe(row.target)))throw Error('Implemented target missing');}
   else if(row.kind!=='none')throw Error('No-change outcome must use kind none');
  }
 };
 if(command==='review'){
  if(!outcomes)throw Error('Provide reviewed --outcomes=PATH; the tool never invents policy');
  const rows=JSON.parse(readFileSync(safe(outcomes),'utf8'));validate(rows);
  const result={schemaVersion:1,reviewed:new Date().toISOString(),policy,inputs,measurements:friction(root,['report']),outcomes:rows};
  if(cfg.requireMeasurement&&(!result.measurements.samples||!result.measurements.latestAt||(Date.now()-Date.parse(result.measurements.latestAt))/86400000>cfg.reviewDays))throw Error('Finish a timed workflow before recording review');
  if(existsSync(receipt)&&JSON.parse(readFileSync(receipt,'utf8')).schemaVersion!==1)throw Error('Refusing to replace an unrelated review file');
  mkdirSync(dirname(receipt),{recursive:true});writeFileSync(receipt,JSON.stringify(result,null,2)+'\n');return result;
 }
 const row=JSON.parse(readFileSync(receipt,'utf8'));validate(row.outcomes);
 const age=(Date.now()-Date.parse(row.reviewed))/86400000;
 if(row.schemaVersion!==1||!Number.isFinite(age)||age<-.01||age>cfg.reviewDays||row.policy!==policy||JSON.stringify(row.inputs)!==JSON.stringify(inputs))throw Error('Maintenance review missing, stale or inputs changed: review evidence, implement/propose owned improvements, then record review');
 if(cfg.requireMeasurement&&!(row.measurements?.samples>0))throw Error('Timed measurement evidence missing');
 const candidates=[];
 for(const [operation,summary] of Object.entries(row.measurements.operations??{})) {
  if((summary.conflicts?.median??0)>0)candidates.push({operation,kind:'tool',reason:'Observed manual conflicts: inspect reconciliation tooling before adding rules.'});
  if((summary.unnecessaryPrompts?.median??0)>0)candidates.push({operation,kind:'rule',reason:'Observed avoidable prompts: review authorization wording and conflicting instructions.'});
  if((summary.repeatedContextLoads?.median??0)>0)candidates.push({operation,kind:'skill',reason:'Observed repeated loads: assess indexing/workflow helpers without omitting applicable rules.'});
 }
 return {enabled:true,candidates,reviewed:row.reviewed,outcomes:row.outcomes,measurementSamples:row.measurements.samples,note:'Evidence structure/freshness verified; semantic correctness requires review'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(maintenance(fileURLToPath(new URL('..',import.meta.url)),process.argv.slice(2)),null,2));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
