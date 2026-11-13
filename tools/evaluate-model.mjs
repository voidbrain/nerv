// Real Casper judgment only; synthetic inputs, no tool execution, no cloud route or credentials.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {misatoAsk,parsePlan} from '../src/misato.ts';
import {toolDocs} from '../src/executors.ts';
import {casperAsk,parseCasper} from '../src/casper.ts';
import {complete,validateModels} from '../src/model.ts';
import {writeReport,evidenceRevision,sourceInputs} from './evaluate.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
export function corpus(role='casper'){
 const data=JSON.parse(readFileSync(resolve(root,role==='misato'?'evals/planner-v1.json':'evals/casper-v1.json'),'utf8')),ids=new Set();
 if(data.schemaVersion!==1||typeof data.id!=='string'||!Array.isArray(data.cases)||!data.cases.length)throw Error('Invalid Casper corpus');
 for(const c of data.cases){
  if(!/^[a-z0-9-]+$/.test(c.id)||ids.has(c.id)||!['regression','holdout'].includes(c.split)||(role==='casper'?!['approve','reject','abstain'].includes(c.expected):!['ask','action','reply','newRequest'].includes(c.expected?.kind))||typeof c.input?.request!=='string'||typeof c.family!=='string'||!c.family||c.input.request.length>4000||(role==='casper'&&(typeof c.input?.tool!=='string'||!['read','write-local','write-external','irreversible','physical'].includes(c.input?.effect)||!c.input.args||typeof c.input.args!=='object'||Array.isArray(c.input.args))))throw Error('Invalid Casper case');ids.add(c.id);
  if(role==='misato'&&(!Array.isArray(c.input.history)||typeof c.input.now!=='string'||!Number.isFinite(Date.parse(c.input.now))||typeof c.input.timeZone!=='string'||!['en','it'].includes(c.input.language)))throw Error('Invalid planner input');
 }
 return data;
}
export function gradeRole(role,c,text){
 const verdict=role==='casper'?parseCasper(text):parsePlan(text);
 const normalize=args=>Object.fromEntries(Object.entries(args||{}).map(([k,v])=>[k,k==='due'&&typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():v]));
 const matches=role==='casper'?verdict?.vote===c.expected:verdict&&(c.expected.kind in verdict)&&(c.expected.kind!=='action'||(verdict.action.tool===c.expected.tool&&isDeepStrictEqual(normalize(verdict.action.args),normalize(c.expected.args))));
 return {observed:verdict||null,status:!verdict?'invalid':matches?'passed':'failed'};
}
export function roleCases(role='both',limit){
 if(!['casper','misato','both'].includes(role))throw Error('Use --role=casper|misato|both');
 const count=limit===undefined?(role==='both'?5:8):limit;
 if(!Number.isInteger(count)||count<1||count>8)throw Error('Limit must be 1..8');
 const roles=role==='both'?['casper','misato']:[role];
 const cases=[];
 for(const r of roles){
  const suite=corpus(r);
  for(const c of suite.cases.slice(0,count))cases.push({role:r,suiteId:suite.id,case:c});
 }
 return {role,limit:count,cases};
}
function checkLoopbackEndpoint(endpoint){
 const url=new URL(endpoint);
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)
  throw Error('Evaluation model endpoint must be credential-free loopback');
 return url.origin;
}
export function validateRoleBundleConfig({role='both',limit,profile,limits}){
 if(!profile)throw Error('Role evaluation requires --profile=path');
 if(profile.backend!=='ollama')throw Error('Unsupported role profile backend; only local ollama is supported');
 if(profile.parallel!==1)throw Error('Unsupported role profile parallel setting; only serial (parallel=1) is supported');
 checkLoopbackEndpoint(profile.endpoint);
 if(limits.repeat!==1)throw Error('Unsupported role limits repeat; only repeat=1 is supported');
 const selection=roleCases(role,limit);
 if(selection.cases.length>limits.maxCases)throw Error(`Selected ${selection.cases.length} role cases exceed limits.maxCases (${limits.maxCases})`);
 return selection;
}
export async function runRoleBundle({role='both',limit,profile,limits,environment=null,out,sourceKey=null},{fetch:fetchImpl=fetch,signal}={}){
 const selection=validateRoleBundleConfig({role,limit,profile,limits});
 const baseUrl=checkLoopbackEndpoint(profile.endpoint),started=new Date().toISOString(),revision=evidenceRevision();
 const gaps=new Set();
 const jsonGet=async(path,opts={})=>{
  const res=await fetchImpl(new URL(path,baseUrl),{redirect:'error',signal:AbortSignal.timeout(3000),...opts});
  if(!res.ok)throw Error(`HTTP ${res.status}`);
  return res.json();
 };
 let runtimeVersion=null,modelDigest=null,quantization=null,capabilities=null,residentBefore=null;
 try{runtimeVersion=(await jsonGet('/api/version'))?.version??null;}catch{gaps.add('runtimeVersion');}
 if(!runtimeVersion)gaps.add('runtimeVersion');
 try{
  const tags=await jsonGet('/api/tags');
  modelDigest=tags?.models?.find(m=>m.name===profile.model)?.digest??null;
 }catch{gaps.add('modelDigest');}
 if(!modelDigest)gaps.add('modelDigest');
 try{
  const show=await jsonGet('/api/show',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:profile.model})});
  quantization=show?.details?.quantization_level??null;
  capabilities=Array.isArray(show?.capabilities)?show.capabilities:null;
 }catch{gaps.add('modelShow');}
 if(!quantization)gaps.add('quantization');
 try{
  const ps=await jsonGet('/api/ps');
  residentBefore=Array.isArray(ps?.models)?ps.models.some(m=>m.name===profile.model):null;
 }catch{gaps.add('residentBefore');}
 if(residentBefore===null)gaps.add('residentBefore');

 const controller=new AbortController();
 const onAbort=()=>controller.abort();
 if(signal){if(signal.aborted)controller.abort();else signal.addEventListener('abort',onAbort,{once:true});}
 const onSig=()=>controller.abort();
 process.on('SIGINT',onSig);process.on('SIGTERM',onSig);

 const beginSuite=Date.now(),deadline=beginSuite+limits.suiteMs,results=[];
 let remainingOutputTokens=limits.outputTokens,usedOutputTokens=0,calls=0;
 try{
  for(const item of selection.cases){
   if(controller.signal.aborted){results.push({role:item.role,suiteId:item.suiteId,id:item.case.id,split:item.case.split,family:item.case.family,expected:item.case.expected,observed:null,status:'not-run',error:'Interrupted by signal'});continue;}
   if(Date.now()>=deadline){results.push({role:item.role,suiteId:item.suiteId,id:item.case.id,split:item.case.split,family:item.case.family,expected:item.case.expected,observed:null,status:'not-run',error:'Aggregate suite time budget exceeded'});continue;}
   if(remainingOutputTokens<=0){results.push({role:item.role,suiteId:item.suiteId,id:item.case.id,split:item.case.split,family:item.case.family,expected:item.case.expected,observed:null,status:'not-run',error:'Aggregate output token budget exceeded'});continue;}
   const ask=item.role==='casper'?casperAsk(item.case.input):misatoAsk({...item.case.input,tools:toolDocs},'local');
   const messages=[...(ask.system?[{role:'system',content:ask.system}]:[]),{role:'user',content:ask.prompt}];
   const ollamaOptions={
    num_ctx:profile.context,
    num_predict:Math.min(profile.maxOutputTokens,remainingOutputTokens),
    ...(profile.seed!==null?{seed:profile.seed}:{}),
    ...(profile.temperature!==null?{temperature:profile.temperature}:{}),
    ...(profile.topP!==null?{top_p:profile.topP}:{}),
    ...(profile.topK!==null?{top_k:profile.topK}:{}),
   };
   const caseBegin=performance.now();
   try{
    const res=await fetchImpl(new URL('/api/chat',baseUrl),{
     method:'POST',
     headers:{'content-type':'application/json'},
     body:JSON.stringify({
      model:profile.model,
      messages,
      stream:false,
      keep_alive:profile.residency==='suite'?'5m':0,
      ...(profile.think!==null?{think:profile.think}:{}),
      options:ollamaOptions,
     }),
     redirect:'error',
     signal:AbortSignal.any([controller.signal,AbortSignal.timeout(Math.min(limits.caseMs,Math.max(1,deadline-Date.now())))]),
    });
    if(!res.ok)throw Error(`HTTP ${res.status}`);
    const rawText=await res.text();
    if(Buffer.byteLength(rawText)>limits.maxBytes)throw Error('Response exceeds limits.maxBytes');
    const raw=JSON.parse(rawText),text=typeof raw?.message?.content==='string'?raw.message.content:'';
    const evalCount=Number.isInteger(raw?.eval_count)?raw.eval_count:null;
    const promptEvalCount=Number.isInteger(raw?.prompt_eval_count)?raw.prompt_eval_count:null;
    if(evalCount===null)gaps.add('eval_count');
    else{usedOutputTokens+=evalCount;remainingOutputTokens=Math.max(0,remainingOutputTokens-evalCount);}
    if(promptEvalCount===null)gaps.add('prompt_eval_count');
    calls++;
    const graded=gradeRole(item.role,item.case,text);
    results.push({role:item.role,suiteId:item.suiteId,id:item.case.id,split:item.case.split,family:item.case.family,expected:item.case.expected,observed:graded.observed,status:graded.status,returnedModel:raw?.model??null,doneReason:raw?.done_reason??null,usage:{inputTokens:promptEvalCount,outputTokens:evalCount,durationMs:Math.round(performance.now()-caseBegin)},responseTruncated:text.length>4096,response:text.slice(0,4096)});
   }catch(error){
    const interrupted=controller.signal.aborted;
    results.push({role:item.role,suiteId:item.suiteId,id:item.case.id,split:item.case.split,family:item.case.family,expected:item.case.expected,observed:null,status:interrupted?'not-run':'error',error:interrupted?'Interrupted by signal':error.message,usage:{inputTokens:null,outputTokens:null,durationMs:Math.round(performance.now()-caseBegin)}});
   }
  }
 }finally{
  process.removeListener('SIGINT',onSig);process.removeListener('SIGTERM',onSig);
  if(signal)signal.removeEventListener('abort',onAbort);
 }
 let residentAfter='unknown';
 if(profile.residency==='suite'&&residentBefore===false&&calls>0){
  try{
   await jsonGet('/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:profile.model,keep_alive:0})});
   residentAfter='released';
  }catch{residentAfter='unknown';}
 }
 const sourceStable=JSON.stringify(sourceInputs())===JSON.stringify(revision.inputs);
 const complete=results.every(r=>r.status!=='not-run'&&r.status!=='error');
 const passed=sourceStable&&complete&&results.every(r=>r.status==='passed');
 const report={
  schemaVersion:1,
  kind:'nerv-role-evaluation',
  sourceStable,
  sourceKey,
  started,
  finished:new Date().toISOString(),
  revision,
  node:process.version,
  platform:process.platform,
  requested:{role:selection.role,limit:selection.limit,profile,limits,environment},
  actual:{endpoint:baseUrl,runtimeVersion,modelDigest,quantization,capabilities,residentBefore,residentAfter},
  telemetryGaps:[...gaps].sort(),
  budget:{caseMs:limits.caseMs,suiteMs:limits.suiteMs,maxCases:limits.maxCases,outputTokens:limits.outputTokens,elapsedMs:Date.now()-beginSuite,usedOutputTokens,calls},
  results,
  complete,
  passed,
  reusesCommonSmoke:false,
  promotion:{automatic:false,eligible:false,reason:'Role evaluation is evidence only; common smoke reuse is distinct and no qualification follows.'},
 };
 const path=writeReport(report,out);
 return {kind:report.kind,passed:report.passed,complete:report.complete,out:path,cases:results.length,usedOutputTokens,telemetryGaps:report.telemetryGaps,reusesCommonSmoke:false,modelQualification:false};
}
export async function run(args){
 let model,role='casper',baseUrl='http://127.0.0.1:11434/v1',output,limit=8;const seen=new Set();
 for(const arg of args){const m=/^--(model|role|base-url|out|limit)=(.+)$/.exec(arg);if(!m||seen.has(m[1]))throw Error('Use unique --role=casper|misato, --model=installed-name, --base-url=loopback/v1, --out=new-file, --limit=1..8');seen.add(m[1]);if(m[1]==='model')model=m[2];if(m[1]==='role'){if(!['misato','casper'].includes(m[2]))throw Error('Unknown model role');role=m[2];}if(m[1]==='base-url')baseUrl=m[2];if(m[1]==='out')output=m[2];if(m[1]==='limit'){if(!/^[1-8]$/.test(m[2]))throw Error('Limit must be 1..8');limit=Number(m[2]);}}
 if(!model)throw Error('Explicit installed local model required');
 const url=new URL(baseUrl);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw Error('Evaluation model endpoint must be credential-free loopback');
 const models=validateModels({local:{model,baseUrl:baseUrl.replace(/\/$/,'')}}),suite=corpus(role),started=new Date().toISOString(),results=[],revision=evidenceRevision();
 let digest=null;try{const tags=await (await fetch(new URL('/api/tags',baseUrl),{signal:AbortSignal.timeout(3000),redirect:'error'})).json();digest=tags.models?.find(m=>m.name===model)?.digest||null;}catch{/* Unknown identity metadata stays unknown. */}
 for(const c of suite.cases.slice(0,limit)){
  process.stderr.write(`Evaluating ${role} ${c.id} with ${model}\n`);let usage=null;
  try{const ask=role==='casper'?casperAsk(c.input):misatoAsk({...c.input,tools:toolDocs},'local');
   const reply=await complete(ask,models,undefined,{timeoutMs:115000,observe:o=>{usage=o;}}),graded=gradeRole(role,c,reply.text);
   results.push({id:c.id,split:c.split,family:c.family,expected:c.expected,observed:graded.observed,status:graded.status,reviewRequired:c.review||[],returnedModel:usage?.returnedModel??null,usage,responseTruncated:reply.text.length>4096,response:reply.text.slice(0,4096)});
  }catch(error){results.push({id:c.id,split:c.split,family:c.family,expected:c.expected,observed:null,status:'error',usage,error:error.message});}
 }
 const sourceStable=JSON.stringify(sourceInputs())===JSON.stringify(revision.inputs);
 const report={schemaVersion:1,sourceStable,suite:suite.id,mode:'real-model-judgment',role,started,finished:new Date().toISOString(),revision,node:process.version,platform:process.platform,model:{requested:model,requestedDigest:digest,route:'local',seed:null,temperature:'provider default; no override supplied'},results,notRun:suite.cases.slice(limit).map(c=>c.id),complete:limit>=suite.cases.length,passed:sourceStable&&results.every(c=>c.status==='passed'),promotion:{automatic:false,eligible:false,reason:'Evaluation is evidence only; existing independent verification and owner promotion gates still apply.'}};
 const path=writeReport(report,output);return {passed:report.passed,complete:report.complete,path,cases:results.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{const result=await run(process.argv.slice(2));console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;}catch(error){console.error(error.message);process.exitCode=1;}
