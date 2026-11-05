import {test} from 'node:test';
import assert from 'node:assert/strict';
import {POSIX} from './fixtures/posix.ts';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {mkdtempSync,rmSync,writeFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {complete,describe,forRole,selectRoute,validateModels,MAX_REPLY_BYTES,ModelError,type Models} from '../src/model.ts';
import {authorize} from '../src/rpc.ts';
import {makeServer} from '../src/server.ts';
const KEY='sk-test-'+'k'.repeat(32);
interface Seen {path:string;headers:IncomingMessage['headers'];body:Record<string,unknown>}
/** Invented loopback stand-in for a provider; records what it received. */
async function fake(handler:(seen:Seen,res:ServerResponse)=>void) {
 const seen:Seen[]=[];
 const server=createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const s={path:req.url ?? '',headers:req.headers,body:text?JSON.parse(text):{}};seen.push(s);handler(s,res);});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const addr=server.address();assert.ok(addr&&typeof addr==='object');
 return {url:`http://127.0.0.1:${addr.port}`,seen,close:()=>new Promise<void>(done=>{server.closeAllConnections();server.close(()=>done());})};
}
const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const openai=(text:string)=>({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]});
const claude=(text:string,stop='end_turn')=>({id:'msg_test',type:'message',role:'assistant',model:'claude-opus-5-5',content:[{type:'text',text}],stop_reason:stop,stop_sequence:null,usage:{input_tokens:3,output_tokens:2}});

test('model config: S² must be on this machine, Umbilical is off unless enabled and defaults to Opus 5.5',()=>{
 assert.deepEqual(validateModels(undefined),{});
 assert.deepEqual(validateModels({local:{baseUrl:'http://127.0.0.1:11434/v1/',model:'gemma'}}).local,{baseUrl:'http://127.0.0.1:11434/v1',model:'gemma'});
 for(const baseUrl of ['http://192.168.1.5:11434/v1','https://api.example.com/v1','http://user:pw@127.0.0.1:1/v1','file:///tmp/x'])assert.throws(()=>validateModels({local:{baseUrl,model:'gemma'}}),/loopback|Invalid/);
 assert.equal(validateModels({cloud:{provider:'anthropic',enabled:false}}).cloud?.model,'claude-opus-5-5');
 assert.throws(()=>validateModels({cloud:{provider:'anthropic'}}),/enabled/);
 assert.throws(()=>validateModels({cloud:{provider:'other',enabled:true}}));
 assert.throws(()=>validateModels({local:{baseUrl:'http://127.0.0.1:1',model:'m',apiKey:'x'}}));
 assert.throws(()=>validateModels({remote:{}}));
});

test('routing never substitutes one route for another and local-only never reaches the cloud',()=>{
 const both:Models={local:{baseUrl:'http://127.0.0.1:1',model:'m'},cloud:{provider:'anthropic',model:'claude-opus-5-5',enabled:true}};
 assert.equal(selectRoute({prompt:'x',privacy:'any'},both,true),'local');
 assert.equal(selectRoute({prompt:'x',privacy:'any',route:'cloud'},both,true),'cloud');
 assert.throws(()=>selectRoute({prompt:'x',privacy:'local-only',route:'cloud'},both,true),/never goes to the cloud/);
 assert.throws(()=>selectRoute({prompt:'x',privacy:'local-only'},{cloud:both.cloud},true),/\(S²\) is not configured/);
 assert.throws(()=>selectRoute({prompt:'x',privacy:'any',route:'cloud'},{cloud:{...both.cloud!,enabled:false}},true),/disabled/);
 assert.throws(()=>selectRoute({prompt:'x',privacy:'any',route:'cloud'},both,false),/no API key/);
});

test('S² sends an OpenAI-compatible request and bounds, times out and reports failures',async()=>{
 let mode='ok';
 const p=await fake((s,res)=>{if(mode==='slow')return;if(mode==='fail')return json(res,500,{error:'x'});json(res,200,openai(mode==='big'?'é'.repeat(MAX_REPLY_BYTES):'Ciao'));});
 const models:Models={local:{baseUrl:p.url+'/v1',model:'gemma'}};
 try{
  const reply=await complete({prompt:'Saluta',system:'Breve.',privacy:'local-only'},models,undefined,{timeoutMs:2000});
  assert.deepEqual(reply,{text:'Ciao',truncated:false,route:'local',model:'gemma',stop:'stop'});
  assert.equal(p.seen[0]!.path,'/v1/chat/completions');
  assert.deepEqual(p.seen[0]!.body.messages,[{role:'system',content:'Breve.'},{role:'user',content:'Saluta'}]);
  assert.equal(p.seen[0]!.body.model,'gemma');assert.equal(p.seen[0]!.body.stream,false);
  mode='big';const big=await complete({prompt:'x',privacy:'local-only'},models,undefined,{timeoutMs:2000});
  assert.equal(big.truncated,true);assert.ok(Buffer.byteLength(big.text)<=MAX_REPLY_BYTES);assert.ok(!big.text.includes('�'));
  mode='fail';await assert.rejects(complete({prompt:'x',privacy:'local-only'},models,undefined,{timeoutMs:2000}),/HTTP 500/);
  mode='slow';await assert.rejects(complete({prompt:'x',privacy:'local-only'},models,undefined,{timeoutMs:200}),/timed out/);
 }finally{await p.close();}
});

test('Umbilical calls the Messages API with the key, fallback and model, and maps refusals and auth errors',async()=>{
 let mode='ok';
 const c=await fake((s,res)=>{if(mode==='auth')return json(res,401,{type:'error',error:{type:'authentication_error',message:'invalid x-api-key'}});json(res,200,claude(mode==='refuse'?'':'Hello',mode==='refuse'?'refusal':'end_turn'));});
 const models:Models={cloud:{provider:'anthropic',model:'claude-opus-5-5',enabled:true}};
 try{
  const reply=await complete({prompt:'Hi',system:'Short.',privacy:'any',route:'cloud'},models,KEY,{timeoutMs:5000,cloudBaseUrl:c.url});
  assert.deepEqual(reply,{text:'Hello',truncated:false,route:'cloud',model:'claude-opus-5-5',stop:'end_turn'});
  const s=c.seen[0]!;assert.equal(s.path,'/v1/messages?beta=true');assert.ok(s.headers['x-api-key']===KEY||s.headers.authorization===`Bearer ${KEY}`,'key sent to the provider only');
  assert.match(String(s.headers['anthropic-beta']),/server-side-fallback-2026-07-01/);
  assert.equal(s.body.model,'claude-opus-5-5');assert.equal(s.body.fallbacks,'default');assert.equal(s.body.system,'Short.');
  assert.deepEqual(s.body.messages,[{role:'user',content:'Hi'}]);
  mode='refuse';await assert.rejects(complete({prompt:'x',privacy:'any',route:'cloud'},models,KEY,{timeoutMs:5000,cloudBaseUrl:c.url}),/declined/);
  mode='auth';const error=await complete({prompt:'x',privacy:'any',route:'cloud'},models,KEY,{timeoutMs:5000,cloudBaseUrl:c.url}).catch(e=>e);
  assert.ok(error instanceof ModelError);assert.match(error.message,/rejected the API key/);assert.ok(!error.message.includes(KEY));
 }finally{await c.close();}
});

test('a failing S² does not fall back to Umbilical',async()=>{
 const cloud=await fake((s,res)=>json(res,200,claude('should not happen')));
 const local=await fake((s,res)=>json(res,503,{}));
 try{
  const models:Models={local:{baseUrl:local.url,model:'m'},cloud:{provider:'anthropic',model:'claude-opus-5-5',enabled:true}};
  await assert.rejects(complete({prompt:'x',privacy:'any'},models,KEY,{timeoutMs:2000,cloudBaseUrl:cloud.url}),/\(S²\) failed with HTTP 503/);
  assert.equal(cloud.seen.length,0);
 }finally{await Promise.all([cloud.close(),local.close()]);}
});

test('ask travels coordinator → brain process → S²; the socket cannot ask and a public key file is refused',{timeout:15000},async()=>{
 const p=await fake((s,res)=>json(res,200,openai('Pronto')));
 const home=mkdtempSync(join(tmpdir(),'nerv-model-'));
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:p.url+'/v1',model:'gemma'},cloud:{provider:'anthropic',enabled:true}}}));
 writeFileSync(join(home,'anthropic-key'),KEY);chmodSync(join(home,'anthropic-key'),0o600);
 const {Runtime}=await import('../src/runtime.ts');let runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);
 const token='t'.repeat(32);const server=makeServer(runtime,token);
 try{
  await runtime.ready();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const addr=server.address();assert.ok(addr&&typeof addr==='object');
  const base=`http://127.0.0.1:${addr.port}`;const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
  const ok=await fetch(base+'/api/ask',{method:'POST',headers,body:JSON.stringify({prompt:'Sei pronto?'})});
  assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{text:'Pronto',truncated:false,route:'local',model:'gemma',stop:'stop'});
  const local=await fetch(base+'/api/ask',{method:'POST',headers,body:JSON.stringify({prompt:'x',route:'cloud'})});
  assert.equal(local.status,502);assert.match((await local.json()).error,/never goes to the cloud/);
  assert.equal((await fetch(base+'/api/ask',{method:'POST',body:JSON.stringify({prompt:'x'})})).status,401);
  assert.equal((await fetch(base+'/api/ask',{method:'POST',headers,body:JSON.stringify({prompt:'x',privacy:'public'})})).status,400);
  const doctor=JSON.stringify(await (await fetch(base+'/api/doctor',{headers})).json());
  assert.match(doctor,/configured \(gemma\)/);assert.match(doctor,/enabled \(claude-opus-5-5\)/);assert.ok(!doctor.includes(KEY));
  assert.throws(()=>authorize('interface','coordinator','model.complete'));
  // One model call; doctor's read of the model list (F-037, GET /api/tags) is not a model call.
  assert.equal(p.seen.filter(x=>x.path==='/v1/chat/completions').length,1);assert.ok(p.seen.every(x=>x.path==='/v1/chat/completions'||x.path==='/api/tags'));
  await runtime.close();chmodSync(join(home,'anthropic-key'),0o644);
  runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);await runtime.ready();
  if(POSIX)await assert.rejects(runtime.ask({prompt:'x',privacy:'local-only'}),/must be private/,'Unix modes only; on Windows the profile ACL protects it');
 }finally{await new Promise<void>(done=>server.close(()=>done()));await runtime.close();await p.close();rmSync(home,{recursive:true,force:true});}
});

test('roles pick a route and model per role; Casper stays on the local route',()=>{
 const models=validateModels({local:{baseUrl:'http://127.0.0.1:11434/v1',model:'gemma4:12b'},cloud:{provider:'anthropic',enabled:true},roles:{misato:{route:'cloud'},casper:{model:'gemma4:e2b-it-q4_K_M'}}});
 assert.deepEqual(models.roles,{misato:{route:'cloud'},casper:{model:'gemma4:e2b-it-q4_K_M'}});
 assert.equal(forRole(models,'casper').local?.model,'gemma4:e2b-it-q4_K_M');assert.equal(forRole(models,'casper').cloud?.model,'claude-opus-5-5');
 assert.equal(forRole(validateModels({cloud:{provider:'anthropic',enabled:true},roles:{misato:{route:'cloud',model:'claude-sonnet-5-5'}}}),'misato').cloud?.model,'claude-sonnet-5-5');
 assert.deepEqual(describe(models,true).roles,{misato:'cloud (claude-opus-5-5)',casper:'local (gemma4:e2b-it-q4_K_M)'});
 assert.match(describe({},false).roles.casper,/owner decides/);
 for(const roles of [{casper:{route:'cloud'}},{misato:{route:'moon'}},{misato:{}},{gendo:{}},{casper:{model:''}}])assert.throws(()=>validateModels({roles}),/roles/,JSON.stringify(roles));
});
