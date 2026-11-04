import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {defaultModel,detectOllama,effectiveRoles,modelsReport,planModels,setupAtInit} from '../src/model-setup.ts';
import {makeServer} from '../src/server.ts';
/** A fake Ollama: its model list, and an OpenAI-compatible chat endpoint for the brain. */
async function fakeOllama(models:{name:string;size:number}[]):Promise<{url:string;close:()=>Promise<void>}> {
 const server:Server=createServer((req,res)=>{res.setHeader('content-type','application/json');
  if(req.url==='/api/tags'){res.end(JSON.stringify({models:models.map(m=>({...m,details:{parameter_size:'12B'}}))}));return;}
  let raw='';req.on('data',c=>raw+=c).on('end',()=>res.end(JSON.stringify({choices:[{message:{content:'{"reply":"ok"}'},finish_reason:'stop'}]})));});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 return {url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,close:()=>new Promise<void>(done=>server.close(()=>done()))};
}
const dead='http://127.0.0.1:9';
const MODELS=[{name:'gemma4:12b',size:8_000_000_000},{name:'qwen2.5-coder:14b',size:9_000_000_000},{name:'tiny:1b',size:1_000_000_000}];
test('Ollama is found with its models; missing Ollama says how to get it; the largest model is the first choice',async()=>{
 const o=await fakeOllama(MODELS);
 try{
  const found=await detectOllama(o.url);assert.equal(found.reachable,true);assert.deepEqual(found.models.map(m=>m.name),['gemma4:12b','qwen2.5-coder:14b','tiny:1b']);assert.equal(found.models[0]!.parameters,'12B');
  assert.equal(defaultModel(found.models),'qwen2.5-coder:14b');
  const none=await detectOllama(dead);assert.equal(none.reachable,false);assert.match(none.error!,/Install it from https:\/\/ollama\.com, start it, and pull a model/);
 }finally{await o.close();}
});
test('a change is planned and validated before anything is written: unknown models, cloud without the route, and turning the cloud off under Misato are refused',()=>{
 const installed=MODELS.map(m=>m.name);
 const fresh=planModels({},{misato:{route:'local',model:'qwen2.5-coder:14b'},casper:{model:'gemma4:12b'}},installed);
 assert.deepEqual(fresh,{local:{baseUrl:'http://127.0.0.1:11434/v1',model:'qwen2.5-coder:14b'},roles:{misato:{route:'local',model:'qwen2.5-coder:14b'},casper:{model:'gemma4:12b'}}});
 assert.deepEqual(effectiveRoles(fresh),{misato:{route:'local',model:'qwen2.5-coder:14b'},casper:{model:'gemma4:12b'}});
 assert.throws(()=>planModels(fresh,{casper:{model:'llama9'}},installed),/Ollama has no model "llama9"/);
 assert.throws(()=>planModels(fresh,{misato:{route:'cloud'}},installed),/Turn the cloud route on first/);
 const cloud=planModels(fresh,{cloud:{enabled:true},misato:{route:'cloud'}},installed);
 assert.deepEqual([cloud.cloud,effectiveRoles(cloud).misato],[{provider:'anthropic',model:'claude-opus-5-5',enabled:true},{route:'cloud',model:'claude-opus-5-5'}]);
 assert.throws(()=>planModels(cloud,{cloud:{enabled:false}},installed),/move Misato to a local model before turning the cloud route off/);
 assert.equal(effectiveRoles({}).misato,null);assert.match(modelsReport({},false,{reachable:false,url:dead,models:[],error:'No Ollama.'}),/Misato \(planner\): not set[\s\S]*key missing \(models key\)[\s\S]*Ollama: No Ollama\./);
});
test('init sets both roles on Ollama\'s largest model when nothing is set; a set route is left alone',async()=>{
 const o=await fakeOllama(MODELS);const home=mkdtempSync(join(tmpdir(),'nerv-setup-'));
 try{
  writeFileSync(join(home,'config.json'),JSON.stringify({port:4999}));
  assert.match(await setupAtInit(home,{},o.url),/with 3 model\(s\); Misato and Casper use qwen2\.5-coder:14b/);
  assert.equal(JSON.parse(readFileSync(join(home,'config.json'),'utf8')).port,4999,'other settings are kept');
  assert.match(await setupAtInit(home,{local:{baseUrl:'http://127.0.0.1:11434/v1',model:'x'}},o.url),/already set/);
  assert.match(await setupAtInit(home,{},dead),/^Model routes: none yet\. No Ollama/);
 }finally{await o.close();rmSync(home,{recursive:true,force:true});}
});
test('the CLI: init finds Ollama, models shows the roles, models set changes one, an unknown model is refused and nothing is written',async()=>{
 const o=await fakeOllama(MODELS);const home=mkdtempSync(join(tmpdir(),'nerv-models-cli-'));
 // Not spawnSync: the fake Ollama lives in this process and must keep answering while the CLI runs.
 const run=(...a:string[])=>new Promise<{status:number|null;stdout:string;stderr:string}>(done=>{const c=spawn(process.execPath,['src/cli.ts',...a],{env:{...process.env,NERV_HOME:home,NERV_OLLAMA:o.url,NERV_PORT:'9'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';c.stdout.on('data',d=>stdout+=d);c.stderr.on('data',d=>stderr+=d);c.on('close',status=>done({status,stdout,stderr}));});
 try{
  const init=await run('init');assert.equal(init.status,0,init.stderr);assert.match(init.stdout,/Misato and Casper use qwen2\.5-coder:14b/);
  const set=await run('models','set','casper','gemma4:12b');assert.equal(set.status,0,set.stderr);assert.match(set.stdout,/^Saved\. The service is not running: the change applies when it starts\./);
  assert.match((await run('models')).stdout,/Misato \(planner\): local · qwen2\.5-coder:14b\nCasper \(intent seat, always local\): gemma4:12b/);
  const before=readFileSync(join(home,'config.json'),'utf8');
  assert.match((await run('models','set','misato','llama9')).stderr,/Ollama has no model "llama9"/);assert.equal(readFileSync(join(home,'config.json'),'utf8'),before,'a refused change writes nothing');
  assert.match((await run('models','set','misato','cloud')).stderr,/Turn the cloud route on first/);
  assert.match((await run('models','key')).stderr,/run this in a terminal/,'the key is only ever typed at a terminal prompt');
 }finally{await o.close();rmSync(home,{recursive:true,force:true});}
});
test('the dashboard API (admin, through the brain process): GET shows the roles and Ollama\'s models without the key; PUT switches Misato and Casper in place',{timeout:20000},async()=>{
 const {Runtime}=await import('../src/runtime.ts');
 const o=await fakeOllama(MODELS);const home=mkdtempSync(join(tmpdir(),'nerv-models-api-'));
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:o.url+'/v1',model:'gemma4:12b'}}}));writeFileSync(join(home,'anthropic-key'),'sk-ant-'+'x'.repeat(40)+'\n',{mode:0o600});
 const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);const token='m'.repeat(32);const server=makeServer(runtime,token);
 try{
  await runtime.ready();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/models`;
  const call=(method='GET',body?:object,auth=true)=>fetch(base,{method,headers:{...(auth?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await call('GET',undefined,false)).status,401);
  const got=await (await call()).json() as {models:object;cloudKey:boolean;ollama:{reachable:boolean;models:{name:string}[]}};
  assert.equal(got.cloudKey,true);assert.ok(!JSON.stringify(got).includes('sk-ant-'),'the key never leaves its file');assert.deepEqual(got.ollama.models.map(m=>m.name),MODELS.map(m=>m.name));
  const put=await (await call('PUT',{misato:{route:'local',model:'qwen2.5-coder:14b'},casper:{model:'tiny:1b'}})).json() as {models:{roles:{misato:string;casper:string}}};
  assert.deepEqual(put.models.roles,{misato:'local (qwen2.5-coder:14b)',casper:'local (tiny:1b)'},'the brain uses the new models without a restart');
  assert.match(JSON.stringify((await runtime.doctor() as {models:unknown}).models),/qwen2\.5-coder:14b/);
  assert.equal((await call('PUT',{casper:{model:'llama9'}})).status,400);assert.equal((await call('PUT',{misato:{route:'cloud'}})).status,400);
  assert.equal((await call('PUT',{casper:{model:'tiny:1b'},key:'sk'})).status,400,'a key is never accepted here');
  const on=await (await call('PUT',{cloud:{enabled:true}})).json() as {models:{cloud:string}};assert.match(on.models.cloud,/enabled/);
 }finally{await new Promise<void>(done=>server.close(()=>done()));await runtime.close();await o.close();rmSync(home,{recursive:true,force:true});}
});
