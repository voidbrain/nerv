// F-073: NERV owns native evaluation semantics; Gauntlet owns the evidence contract.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,writeEvidence} from '@voidbrain/gauntlet-protocol';
import {run,readSuite} from './evaluate.mjs';
const adapter=fileURLToPath(import.meta.url);
export function normalize(native,group,suite=readSuite()){
 const entry=suite.groups.find(x=>x.id===group);
 if(!entry||native?.schemaVersion!==1||native.mode!=='scripted-control-flow'||native.suite!==suite.id||!Array.isArray(native.results)||native.results.length!==1||!Array.isArray(native.selection?.groups)||native.selection.groups.length!==1||native.selection.groups[0]!==group||typeof native.sourceStable!=='boolean'||!native.revision?.inputs)throw Error('Native evidence does not match the selected group');
 const result=native.results[0],counts=result.counts;
 if(result.id!==group||result.iteration!==1||!['passed','failed','not-run'].includes(result.status)||!counts||['tests','passed','failed','skipped'].some(k=>!Number.isSafeInteger(counts[k])||counts[k]<0)||counts.passed+counts.failed+counts.skipped>counts.tests)throw Error('Invalid native group result');
 const complete=result.status!=='not-run'&&!result.error&&counts.tests>=entry.minimumTests&&counts.skipped===0;
 const passed=complete&&native.sourceStable&&result.status==='passed'&&result.exitCode===0&&counts.passed>0&&counts.failed===0;
 return {schemaVersion:1,layer:'system',sourceStable:native.sourceStable,complete,fixtureHash:hash({native:hash(native),adapter:hash(readFileSync(adapter,'utf8'))}),results:[{id:group,status:passed?'passed':result.status==='not-run'?'not-run':'failed',checks:counts.tests}]};
}
export async function execute(group,out){
 if(!readSuite().groups.some(x=>x.id===group))throw Error('Unknown NERV evaluation group');
 const before=hash(readFileSync(adapter,'utf8'));
 // Gauntlet supervises this entire process group. Native child runners inherit it,
 // so cancellation also reaches the tests; nested detached groups would escape.
 const result=await run(['--only='+group],{supervised:true});
 const evidence=normalize(JSON.parse(readFileSync(result.path,'utf8')),group);
 evidence.sourceStable&&=before===hash(readFileSync(adapter,'utf8'));
 writeEvidence(out,evidence);
 return {passed:evidence.results.every(x=>x.status==='passed'),native:result.path};
}
if(process.argv[1]&&resolve(process.argv[1])===adapter){
 try{const args=process.argv.slice(2);if(args.length!==2||!/^--group=[a-z-]+$/.test(args[0])||!args[1].startsWith('--out='))throw Error('Use --group=ID --out=new.json');await execute(args[0].slice(8),args[1].slice(6));}
 catch{console.error('NERV Gauntlet adapter failed; inspect private native evaluation evidence.');process.exitCode=1;}
}
