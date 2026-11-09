import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {readJSON,readEvidence,validatePack,validateProfile,validateRegistry,validateLimits,plan,executeWithEvidence,defaultEvidenceDirectory,compare,exportProfile,writeEvidence,catalog,catalogMarkdown,hash} from '@voidbrain/gauntlet-protocol';
import {sourceInputs} from './evaluate.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const here=path=>resolve(root,path);
const common=here('node_modules/@voidbrain/gauntlet-protocol/examples/smoke-v1.json');
export function systemSourceKey(pack){return hash({inputs:sourceInputs(root,pack.cases.some(c=>c.id==='browser')),adapter:hash(readFileSync(here('tools/gauntlet-adapter.mjs'),'utf8')),wrapper:hash(readFileSync(here('tools/gauntlet.mjs'),'utf8')),dependency:hash(readFileSync(here('vendor/gauntlet-protocol.json'),'utf8'))});}
export function testIndex(reports=[]){
 const packs=[validatePack(readJSON(common)),validatePack(readJSON(here('evals/gauntlet/system-v1.json')))];
 return catalogMarkdown(catalog(packs,reports),{[packs[0].id]:'https://github.com/voidbrain/gauntlet-protocol/blob/v0.2.0/examples/smoke-v1.json',[packs[1].id]:'../evals/gauntlet/system-v1.json'});
}
export async function main(args=process.argv.slice(2),services={execute:executeWithEvidence}){
 const [command='plan',...rest]=args,options={};
 const allowed={index:['check','reports'],plan:['only','profile','allow-expensive'],run:['only','out','execute','allow-expensive','fresh','cache-dir','max-age-hours'], 'model-plan':['profile','limits'], 'model-run':['profile','limits','out','execute','allow-models','fresh','cache-dir','max-age-hours','sample-ms'],compare:['reports'],qualify:['report','review','requirements','out']};
 if(!Object.hasOwn(allowed,command))throw Error('Use index, plan, run, model-plan, model-run, compare or qualify');
 for(const arg of rest){const m=/^--([a-z-]+)(?:=(.+))?$/.exec(arg);if(!m||!allowed[command].includes(m[1])||Object.hasOwn(options,m[1]))throw Error('Unknown or duplicate option');const boolean=['execute','allow-expensive','allow-models','check','fresh'].includes(m[1]);if(boolean===!!m[2])throw Error('Invalid option value');options[m[1]]=boolean?true:m[2];}
 const load=key=>{if(typeof options[key]!=='string')throw Error('Missing --'+key);return readJSON(resolve(options[key]));};
 if(command==='index'){
  const rendered=testIndex(options.reports?options.reports.split(',').map(p=>readEvidence(resolve(p))):[]);
  if(options.reports)return {index:rendered,privateEvidence:true};
  const out=here('docs/test-capability-index.md');if(options.check){if(!existsSync(out)||readFileSync(out,'utf8')!==rendered)throw Error('Generated test index is stale');return {indexCurrent:true};}
  if(existsSync(out)&&!readFileSync(out,'utf8').startsWith('<!-- Generated from executable packs;'))throw Error('Index output is not generated');writeFileSync(out,rendered);return {index:'docs/test-capability-index.md',cases:[common,here('evals/gauntlet/system-v1.json')].reduce((n,path)=>n+validatePack(readJSON(path)).cases.length,0)};
 }
 if(command==='compare'){if(typeof options.reports!=='string')throw Error('Missing --reports');return compare(options.reports.split(',').map(p=>readEvidence(resolve(p))));}
 if(command==='qualify'){if(!options.out)throw Error('Missing --out');const evidence=exportProfile(readEvidence(options.report),load('review'),load('requirements'));writeEvidence(options.out,evidence);return {exported:options.out,productionPermissionsChanged:false};}
 const model=command.startsWith('model-');let pack=validatePack(readJSON(model?common:here('evals/gauntlet/system-v1.json')));
 if(options.only){const selected=pack.cases.filter(c=>c.id===options.only);if(!selected.length)throw Error('Unknown selected case');pack={...pack,id:pack.id+':'+options.only,cases:selected};}
 const profile=options.profile?validateProfile(load('profile')):null;if(model&&!profile)throw Error('Model plan/run needs --profile=path');
 const registry=model?undefined:validateRegistry(readJSON(here('evals/gauntlet/runners.json')),here('evals/gauntlet'));
 const limits=validateLimits(options.limits?load('limits'):readJSON(model?here('node_modules/@voidbrain/gauntlet-protocol/examples/limits-day.json'):here('evals/gauntlet/limits.json')));
 const flags={allowModels:options['allow-models']===true,allowExpensive:options['allow-expensive']===true};
 if(command.endsWith('plan'))return plan(pack,profile,limits,flags);
 if(!options.execute||!options.out)throw Error('Execution requires --execute --out=new.json');
 const result=await services.execute(pack,profile,limits,{execute:true,...flags,registry,output:options.out,cacheDirectory:options['cache-dir']??defaultEvidenceDirectory(),maxAgeMs:options['max-age-hours']?Number(options['max-age-hours'])*3600000:undefined,forceFresh:options.fresh===true,sourceKey:model?undefined:systemSourceKey(pack),telemetry:model,sampleMs:options['sample-ms']?Number(options['sample-ms']):undefined});
 return {kind:result.kind,passed:result.report.passed,complete:result.report.complete,out:options.out,reportId:result.report.id,originalFinished:result.report.finished,performanceMeasuredNow:result.performanceMeasuredNow,reason:result.reason,modelQualification:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=await main();console.log(JSON.stringify(result,null,2));if(result.passed===false)process.exitCode=1;}catch(e){console.error(e instanceof Error?e.message:'Gauntlet failed');process.exitCode=1;}
}
