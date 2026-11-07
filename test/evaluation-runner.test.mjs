import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {options,readSuite,writeReport,sourceInputs,runProcess} from '../tools/evaluate.mjs';
import {corpus} from '../tools/evaluate-model.mjs';
test('F-029: suite references owned scenarios and records unsupported branches explicitly',()=>{
 const suite=readSuite();assert.equal(suite.schemaVersion,1);assert.ok(suite.groups.some(g=>g.id==='stress'));assert.ok(suite.groups.some(g=>g.id==='browser'));assert.ok(suite.notCovered.every(g=>g.owner&&g.reason));
 const model=corpus();assert.equal(model.cases.length,8);assert.equal(model.cases.filter(c=>c.split==='holdout').length,2);assert.equal(corpus('misato').cases.length,5);
});
test('F-029: bounded runner options reject unknown, repeated and unbounded controls',()=>{
 assert.deepEqual(options(['--only=policy','--repeat=2','--seed=7']),{only:'policy',repeat:2,seed:7,output:null,check:false});
 for(const args of [['--repeat=11'],['--repeat=0'],['--seed=-1'],['--seed=4294967296'],['--seed=1','--seed=2'],['--execute=anything']])assert.throws(()=>options(args));
});
test('F-029: actual runner writes replay evidence and refuses to overwrite evidence',{skip:process.platform==='win32'},()=>{
 const temp=mkdtempSync(join(realpathSync(tmpdir()),'nerv-eval-report-')),output=join(temp,'run.json');
 try{
  const summary=JSON.parse(execFileSync(process.execPath,['tools/evaluate.mjs','--only=policy','--seed=7','--out='+output],{encoding:'utf8'}));assert.equal(summary.passed,true);assert.equal(summary.complete,false);assert.equal(summary.tests,90);
  const report=JSON.parse(readFileSync(output,'utf8'));assert.equal(report.seed,7);assert.equal(report.results[0].counts.passed,90);assert.ok(report.notCovered.length);assert.ok(report.revision.commit);assert.equal(report.mode,'scripted-control-flow');assert.equal(report.selection.notRunGroups.length,6);assert.ok(report.revision.inputs['evals/suite.json']);
  assert.throws(()=>writeReport(report,output),/exist/);assert.throws(()=>writeReport(report,'.git/evidence.json'),/metadata/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});

test('F-029: source identity includes dirty implementations, browser assets and fixture helpers',()=>{
 const temp=mkdtempSync(join(realpathSync(tmpdir()),'nerv-eval-inputs-'));
 try{
  for(const file of ['src/server.ts','web/public/dashboard/live.js','test/fixtures/browser.mjs']){mkdirSync(join(temp,file,'..'),{recursive:true});writeFileSync(join(temp,file),'initial');}
  const first=sourceInputs(temp);assert.equal(Object.keys(first).length,3);
  writeFileSync(join(temp,'web/public/dashboard/live.js'),'changed');const second=sourceInputs(temp);assert.notEqual(first['web/public/dashboard/live.js'],second['web/public/dashboard/live.js']);
  writeFileSync(join(temp,'src/untracked.ts'),'new candidate');assert.ok(sourceInputs(temp)['src/untracked.ts']);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('F-029: a timed-out scenario terminates its owned descendant process',{timeout:15000,skip:process.platform==='win32'},async()=>{
 const temp=mkdtempSync(join(realpathSync(tmpdir()),'nerv-eval-process-')),pids=join(temp,'pids.json');let owned=[];
 const script=`const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pids)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`;
 const alive=pid=>{try{process.kill(pid,0);if(process.platform==='linux'&&readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1].startsWith('Z'))return false;return true;}catch(error){if(error.code==='ESRCH'||error.code==='ENOENT')return false;throw error;}};
 try{
  const result=await runProcess(['-e',script],{timeoutMs:5000});assert.match(result.error,/time budget/);owned=JSON.parse(readFileSync(pids,'utf8'));
  const until=Date.now()+5000;while(owned.some(alive)&&Date.now()<until)await new Promise(done=>setTimeout(done,25));assert.deepEqual(owned.filter(alive),[],'no executing child survives the group timeout');
 }finally{
  if(owned.some(alive)){if(process.platform==='win32')try{execFileSync('taskkill',['/PID',String(owned[0]),'/T','/F']);}catch{}else try{process.kill(-owned[0],'SIGKILL');}catch{}}
  rmSync(temp,{recursive:true,force:true});
 }
});

test('F-029: Windows execution fails closed without process-tree ownership',{skip:process.platform!=='win32'},async()=>{
 await assert.rejects(runProcess(['-e','process.exit(0)'],{timeoutMs:1000}),/Windows Job Object/);
});
