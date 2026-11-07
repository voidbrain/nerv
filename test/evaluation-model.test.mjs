import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {run} from '../tools/evaluate-model.mjs';
test('F-029: model evidence distinguishes real returned identity, wrong judgment, partial scope and promotion',{timeout:15000},async()=>{
 let response={model:'fixture-returned',usage:{prompt_tokens:10,completion_tokens:5},choices:[{message:{content:'{"vote":"approve","reason":"Matches.","confidence":1}'}}]};const requests=[];
 const server=createServer((req,res)=>{let body='';req.on('data',d=>body+=d).on('end',()=>{res.setHeader('content-type','application/json');if(req.method==='GET'){res.end(JSON.stringify({models:[{name:'fixture',digest:'f'.repeat(64)}]}));return;}requests.push(JSON.parse(body));res.end(JSON.stringify(response));});});await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const temp=mkdtempSync(join(realpathSync(tmpdir()),'nerv-eval-model-')),endpoint=`http://127.0.0.1:${server.address().port}/v1`;
 try{
  const out=join(temp,'first.json'),summary=await run(['--model=fixture','--base-url='+endpoint,'--limit=1','--out='+out]);assert.equal(summary.passed,true);assert.equal(summary.complete,false);
  const report=JSON.parse(readFileSync(out,'utf8'));assert.equal(report.results[0].returnedModel,'fixture-returned');assert.equal(report.model.requestedDigest,'f'.repeat(64));assert.equal(report.results[0].usage.inputTokens,10);assert.equal(report.notRun.length,7);assert.equal(report.promotion.eligible,false);
  assert.equal(JSON.parse(requests[0].messages.at(-1).content).expected,undefined,'expected answers never enter the model prompt');
  response={choices:[{message:{content:'{"action":{"tool":"reminders.cancel","args":{"id":"fixture"}}}'}}]};
  const wrong=join(temp,'wrong.json');assert.equal((await run(['--role=misato','--model=fixture','--base-url='+endpoint,'--limit=1','--out='+wrong])).passed,false);
  const failed=JSON.parse(readFileSync(wrong,'utf8'));assert.equal(failed.results[0].status,'failed');assert.equal(failed.results[0].returnedModel,null,'missing provider identity is not relabelled as requested model');
  await assert.rejects(()=>run(['--model=fixture','--base-url=https://provider.example/v1','--limit=1']),/loopback/);
 }finally{await new Promise(done=>{server.close(done);server.closeAllConnections();});rmSync(temp,{recursive:true,force:true});}
});
