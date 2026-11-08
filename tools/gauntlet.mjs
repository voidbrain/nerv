import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJSON,validatePack,validateProfile,validateRegistry,validateLimits,plan,run,compare,exportProfile,writeEvidence} from '@voidbrain/gauntlet-protocol';
const root=fileURLToPath(new URL('..',import.meta.url));
const here=path=>resolve(root,path);
export async function main(args=process.argv.slice(2)){
 const [command='plan',...rest]=args,options={};
 const allowed={plan:['only','profile','allow-expensive'],run:['only','out','execute','allow-expensive'], 'model-plan':['profile','limits'], 'model-run':['profile','limits','out','execute','allow-models'],compare:['reports'],qualify:['report','review','requirements','out']};
 if(!Object.hasOwn(allowed,command))throw Error('Use plan, run, model-plan, model-run, compare or qualify');
 for(const arg of rest){const m=/^--([a-z-]+)(?:=(.+))?$/.exec(arg);if(!m||!allowed[command].includes(m[1])||Object.hasOwn(options,m[1]))throw Error('Unknown or duplicate option');const boolean=['execute','allow-expensive','allow-models'].includes(m[1]);if(boolean===!!m[2])throw Error('Invalid option value');options[m[1]]=boolean?true:m[2];}
 const load=key=>{if(typeof options[key]!=='string')throw Error('Missing --'+key);return readJSON(resolve(options[key]));};
 if(command==='compare'){
  if(typeof options.reports!=='string')throw Error('Missing --reports');return compare(options.reports.split(',').map(p=>readJSON(resolve(p))));
 }
 if(command==='qualify'){
  if(!options.out)throw Error('Missing --out');const evidence=exportProfile(load('report'),load('review'),load('requirements'));writeEvidence(options.out,evidence);return {exported:options.out,productionPermissionsChanged:false};
 }
 const model=command.startsWith('model-');
 let pack=validatePack(readJSON(model?here('node_modules/@voidbrain/gauntlet-protocol/examples/smoke-v1.json'):here('evals/gauntlet/system-v1.json')));
 if(options.only){const selected=pack.cases.filter(c=>c.id===options.only);if(!selected.length)throw Error('Unknown selected case');pack={...pack,id:pack.id+':'+options.only,cases:selected};}
 const profile=options.profile?validateProfile(load('profile')):null;if(model&&!profile)throw Error('Model plan/run needs --profile=path');
 const registry=model?undefined:validateRegistry(readJSON(here('evals/gauntlet/runners.json')),here('evals/gauntlet'));
 const limits=validateLimits(options.limits?load('limits'):readJSON(model?here('node_modules/@voidbrain/gauntlet-protocol/examples/limits-day.json'):here('evals/gauntlet/limits.json')));
 const flags={allowModels:options['allow-models']===true,allowExpensive:options['allow-expensive']===true};
 if(command.endsWith('plan'))return plan(pack,profile,limits,flags);
 if(!options.execute||!options.out)throw Error('Execution requires --execute --out=new.json');
 const report=await run(pack,profile,limits,{execute:true,...flags,registry});writeEvidence(options.out,report);
 return {passed:report.passed,complete:report.complete,out:options.out,modelQualification: false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=await main();console.log(JSON.stringify(result,null,2));if(result.passed===false)process.exitCode=1;}catch(e){console.error(e instanceof Error?e.message:'Gauntlet failed');process.exitCode=1;}
}
