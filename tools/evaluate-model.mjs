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
   const reply=await complete(ask,models,undefined,{timeoutMs:115000,observe:o=>{usage=o;}}),verdict=role==='casper'?parseCasper(reply.text):parsePlan(reply.text);
   const normalize=args=>Object.fromEntries(Object.entries(args||{}).map(([k,v])=>[k,k==='due'&&typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():v]));
   const matches=role==='casper'?verdict?.vote===c.expected:verdict&&(c.expected.kind in verdict)&&(c.expected.kind!=='action'||(verdict.action.tool===c.expected.tool&&isDeepStrictEqual(normalize(verdict.action.args),normalize(c.expected.args))));
   results.push({id:c.id,split:c.split,family:c.family,expected:c.expected,observed:verdict||null,status:!verdict?'invalid':matches?'passed':'failed',reviewRequired:c.review||[],returnedModel:usage?.returnedModel??null,usage,responseTruncated:reply.text.length>4096,response:reply.text.slice(0,4096)});
  }catch(error){results.push({id:c.id,split:c.split,family:c.family,expected:c.expected,observed:null,status:'error',usage,error:error.message});}
 }
 const sourceStable=JSON.stringify(sourceInputs())===JSON.stringify(revision.inputs);
 const report={schemaVersion:1,sourceStable,suite:suite.id,mode:'real-model-judgment',role,started,finished:new Date().toISOString(),revision,node:process.version,platform:process.platform,model:{requested:model,requestedDigest:digest,route:'local',seed:null,temperature:'provider default; no override supplied'},results,notRun:suite.cases.slice(limit).map(c=>c.id),complete:limit>=suite.cases.length,passed:sourceStable&&results.every(c=>c.status==='passed'),promotion:{automatic:false,eligible:false,reason:'Evaluation is evidence only; existing independent verification and owner promotion gates still apply.'}};
 const path=writeReport(report,output);return {passed:report.passed,complete:report.complete,path,cases:results.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{const result=await run(process.argv.slice(2));console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;}catch(error){console.error(error.message);process.exitCode=1;}
