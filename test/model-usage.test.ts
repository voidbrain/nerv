import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {complete} from '../src/model.ts';
import {parsePrices,UsageStore,usageCost,type UsageObservation} from '../src/model-usage.ts';
import {Runtime} from '../src/runtime.ts';
import {makeServer} from '../src/server.ts';
import {authorize,validateParams} from '../src/rpc.ts';
const observation:UsageObservation={route:'local',requestedModel:'requested',returnedModel:'actual',inputTokens:100,outputTokens:20,cacheReadTokens:0,cacheWriteTokens:0,durationMs:15,outcome:'success'};
const rates=parsePrices([{route:'local',model:'actual',currency:'USD',source:'https://provider.example/prices',asOf:'2026-11-07',input:2,output:10,cacheRead:1,cacheWrite:3}]);
test('provider usage distinguishes actual model, missing counts, zero, errors and malformed counters',async()=>{
 for(const usage of [{prompt_tokens:100,completion_tokens:20},{prompt_tokens:0,completion_tokens:0},{prompt_tokens:-1,completion_tokens:1.5},undefined]){
  let got:UsageObservation|undefined;
  await complete({prompt:'private sentinel',privacy:'local-only'},{local:{baseUrl:'http://127.0.0.1/v1',model:'requested'}},undefined,{timeoutMs:1000,observe:o=>{got=o;},fetch:async()=>new Response(JSON.stringify({model:'actual',usage,choices:[{message:{content:'ok'}}]}))});
  assert.equal(got?.returnedModel,'actual');assert.equal(got?.requestedModel,'requested');
  assert.equal(got?.inputTokens,usage?.prompt_tokens!==undefined&&usage.prompt_tokens>=0?usage.prompt_tokens:null);
  assert.equal(got?.outputTokens,usage?.completion_tokens!==undefined&&Number.isInteger(usage.completion_tokens)?usage.completion_tokens:null);
  assert.ok(!JSON.stringify(got).includes('sentinel'));
 }
 let failed:UsageObservation|undefined;
 await assert.rejects(complete({prompt:'x',privacy:'local-only'},{local:{baseUrl:'http://127.0.0.1',model:'requested'}},undefined,{timeoutMs:1,observe:o=>{failed=o;},fetch:async()=>{throw new DOMException('secret error','TimeoutError');}}),/timed out/);
 assert.equal(failed?.outcome,'error');assert.equal(failed?.inputTokens,null);assert.equal(failed?.returnedModel,null);
});
test('price snapshots use returned model and exact route; unknown is never zero; local cached tokens are not billed twice',()=>{
 assert.equal(usageCost(observation,rates).status,'estimated');
 assert.deepEqual(usageCost(observation,rates),{status:'estimated',amount:0.0004,price:rates[0]});
 assert.deepEqual(usageCost({...observation,cacheReadTokens:50},rates),{status:'estimated',amount:0.00035,price:rates[0]});
 for(const o of [null,{...observation,inputTokens:null},{...observation,outcome:'error' as const},{...observation,returnedModel:'requested'},{...observation,route:'cloud' as const}])assert.deepEqual(usageCost(o,rates),{status:'unavailable'});
 for(const v of [[{...rates[0],asOf:'2026-99-99'}],[{...rates[0],asOf:'2026-02-30'}],[{...rates[0],input:-1}],[{...rates[0],source:'https://user:secret@provider.example/'}],[{...rates[0],source:'https://provider.example/?token=x'}],[rates[0],rates[0]]])assert.throws(()=>parsePrices(v));
});
test('durable pending calls survive reopen and paginated reads preserve unknowns',()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-usage-'));let db=new DatabaseSync(join(home,'usage.sqlite'));
 try{
  let store=new UsageStore(db);const pending=store.begin('misato.step');const done=store.begin('casper.verdict');store.finish(done,observation,rates);db.close();
  db=new DatabaseSync(join(home,'usage.sqlite'));store=new UsageStore(db);
  const first=store.page(undefined,1);assert.equal(first.items[0]?.id,done);assert.ok(first.next);
  const second=store.page(first.next,1);assert.equal(second.items[0]?.id,pending);assert.equal(second.items[0]?.observation,null);assert.equal(second.items[0]?.cost.status,'unavailable');assert.equal(second.next,null);
  assert.throws(()=>store.page(0,21));assert.throws(()=>store.begin('private text'));
 }finally{db.close();rmSync(home,{recursive:true,force:true});}
});
test('usage RPC is coordinator-only and validates provider counters before persistence',()=>{
 for(const m of ['usage.begin','usage.finish','usage.page'])assert.throws(()=>authorize('interface','coordinator',m));
 assert.doesNotThrow(()=>authorize('coordinator','nervous','usage.finish'));
 assert.throws(()=>validateParams('usage.finish',{id:'a'.repeat(36),observation:{...observation,inputTokens:-1},prices:[]}));
 assert.throws(()=>validateParams('usage.finish',{id:'a'.repeat(36),observation:{...observation,prompt:'secret'},prices:[]}));
});
test('real provider → brain → coordinator → SQLite → authenticated HTTP reconciles known usage and crash unknowns',{timeout:15000},async()=>{
 const provider=createServer(async(req,res)=>{for await(const _ of req){}res.setHeader('content-type','application/json');res.end(JSON.stringify({model:'actual',usage:{prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:0}},choices:[{message:{content:'{"reply":"Hello"}'},finish_reason:'stop'}]}));});
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));const address=provider.address();assert.ok(address&&typeof address==='object');
 const home=mkdtempSync(join(tmpdir(),'nerv-usage-'));
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:`http://127.0.0.1:${address.port}/v1`,model:'requested'},roles:{consultant:{model:'requested'}}}}));
 writeFileSync(join(home,'model-prices.json'),JSON.stringify(rates));
 const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);const token='neutral-token-'.repeat(3);const api=makeServer(runtime,token);
 try{
  await runtime.ready();await runtime.ask({prompt:'PRIVATE-PROMPT-SENTINEL',privacy:'local-only'});await runtime.chat('Say hello');await runtime.peerVerdict({request:'Read the item',tool:'reminders.list',args:{},effect:'read'});await runtime.consolidate();
  const records=(await runtime.modelUsage()).items;assert.ok(records.some(r=>r.operation==='misato.step'&&r.observation?.returnedModel==='actual'));
  for(const operation of ['misato.step','casper.verdict','consultant.advise','instrumentality.digest'])assert.ok(records.some(r=>r.operation===operation&&r.observation?.inputTokens===100),operation);
  const ask=records.find(r=>r.operation==='model.complete');assert.equal(ask?.observation?.inputTokens,100);assert.equal(ask?.cost.status,'estimated');
  assert.ok(!JSON.stringify(records).includes('PRIVATE-PROMPT-SENTINEL'));
  await new Promise<void>(r=>api.listen(0,'127.0.0.1',r));const a=api.address();assert.ok(a&&typeof a==='object');const url=`http://127.0.0.1:${a.port}/api/model-usage`;
  assert.equal((await fetch(url)).status,401);const headers={authorization:`Bearer ${token}`};
  const page=await fetch(url+'?limit=1',{headers});assert.equal(page.status,200);assert.equal((await page.json()).items.length,1);
  assert.equal((await fetch(url+'?limit=21',{headers})).status,400);
  runtime.brain.child.kill('SIGKILL');await new Promise<void>(r=>runtime.brain.child.once('exit',()=>r()));
  await assert.rejects(runtime.ask({prompt:'x',privacy:'local-only'}));assert.equal((await runtime.modelUsage()).items[0]?.observation,null);
 }finally{await new Promise<void>(r=>api.close(()=>r()));await runtime.close();await new Promise<void>(r=>provider.close(()=>r()));rmSync(home,{recursive:true,force:true});}
});
test('cloud accounting preserves fallback attribution, cache buckets and refusal usage; HTTP errors are not retried',{timeout:10000},async()=>{
 let mode='ok',requests=0;
 const provider=createServer(async(req,res)=>{requests++;for await(const _ of req){}res.setHeader('content-type','application/json');if(mode==='fail'){res.statusCode=500;res.end(JSON.stringify({type:'error',error:{type:'api_error',message:'provider secret'}}));return;}
 res.end(JSON.stringify({id:'msg_neutral',type:'message',role:'assistant',model:'actual-cloud',content:[{type:'text',text:'hello'}],stop_reason:mode==='refusal'?'refusal':'end_turn',stop_sequence:null,usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:50,cache_creation_input_tokens:10}}));});
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));const addr=provider.address();assert.ok(addr&&typeof addr==='object');
 const observations:UsageObservation[]=[];const ask=()=>complete({prompt:'private',privacy:'any',route:'cloud'},{cloud:{provider:'anthropic',enabled:true,model:'requested-cloud'}},'neutral-test-key',{timeoutMs:1000,cloudBaseUrl:`http://127.0.0.1:${addr.port}`,observe:o=>observations.push(o)});
 try{
  await ask();assert.equal(observations[0]?.requestedModel,'requested-cloud');assert.equal(observations[0]?.returnedModel,'actual-cloud');assert.equal(observations[0]?.cacheReadTokens,50);assert.equal(observations[0]?.cacheWriteTokens,10);
  mode='refusal';await assert.rejects(ask(),/declined/);assert.equal(observations[1]?.outcome,'refused');assert.equal(observations[1]?.inputTokens,100);
  mode='fail';await assert.rejects(ask(),/HTTP 500/);assert.equal(requests,3);assert.equal(observations[2]?.inputTokens,null);assert.equal(observations[2]?.outcome,'error');
 }finally{await new Promise<void>(r=>provider.close(()=>r()));}
});
