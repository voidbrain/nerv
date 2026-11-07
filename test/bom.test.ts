import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createServer} from 'node:http';import {spawn,spawnSync} from 'node:child_process';
import {Ajv} from 'ajv';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const addFormats=require('ajv-formats') as (ajv:Ajv)=>void;
import {runtimeBom} from '../src/bom.ts';import {detectOllama} from '../src/model-setup.ts';import type {Config} from '../src/config.ts';

const schema=(name:string)=>JSON.parse(readFileSync(new URL('./fixtures/cyclonedx/'+name,import.meta.url),'utf8')) as object;
const addInternationalFormats=require('ajv-formats-draft2019') as (ajv:Ajv)=>void;
const ajv=new Ajv({strict:false,allErrors:true});addFormats(ajv);addInternationalFormats(ajv);ajv.addSchema(schema('spdx.schema.json'));ajv.addSchema(schema('jsf-0.82.schema.json'));
const validateRuntime=ajv.compile(schema('bom-1.6.schema.json')),validateDependencies=ajv.compile(schema('bom-1.5.schema.json'));
const fixture:Config={port:4317,language:'en',timeZone:'Europe/Rome',base:{id:'NERV-01',name:'PRIVATE_BASE_LABEL'},telegram:{chatId:99123},models:{local:{baseUrl:'http://127.0.0.1:11434/v1',model:'fixture-model'},cloud:{provider:'anthropic',model:'fixture-cloud',enabled:false},roles:{consultant:{model:'fixture-advice'}}},
 pilots:[{id:'privatepilot',name:'PRIVATE_PILOT_LABEL',domain:'PRIVATE_DOMAIN',keywords:['PRIVATE_KEYWORD'],model:'fixture-specialist',stage:'prototype'}],
 tools:{mcp:[{id:'files',command:'/PRIVATE_HOME/server',args:['--token','PRIVATE_ARG_SECRET']}],grants:[{server:'files',tool:'read_text',effect:'read',eva:'02',fingerprint:'a'.repeat(16)}]}};

test('F-067: runtime configuration validates against official CycloneDX schema and allowlists inventory fields',async()=>{
 const found=await detectOllama('http://127.0.0.1:11434',async()=>new Response(JSON.stringify({models:[{name:'fixture-model:latest',digest:'sha256:'+'b'.repeat(64)},{name:'fixture-advice',digest:'not-a-hash'},{name:'unselected',digest:'c'.repeat(64)}]})));
 const bom=runtimeBom(fixture,found,'0.1.0',new Date('2026-11-07T00:00:00Z'));assert.ok(validateRuntime(bom),JSON.stringify(validateRuntime.errors));
 assert.ok(bom.components.some(c=>c.properties.some(p=>p.name==='nerv:role'&&p.value==='misato')&&c.hashes?.[0]?.content==='b'.repeat(64)));
 assert.equal(bom.components.find(c=>c.name==='fixture-advice')?.hashes,undefined);assert.ok(!bom.components.some(c=>c.name==='unselected'));
 assert.ok(bom.components.some(c=>c.properties.some(p=>p.value==='pilot-1')));assert.equal(bom.services[0]!.name,'files.read_text');
 const encoded=JSON.stringify(bom);for(const secret of ['PRIVATE_BASE_LABEL','PRIVATE_PILOT_LABEL','PRIVATE_DOMAIN','PRIVATE_KEYWORD','PRIVATE_HOME','PRIVATE_ARG_SECRET','99123','127.0.0.1'])assert.ok(!encoded.includes(secret),secret);
 assert.ok(encoded.includes('tool-description'),'fingerprint never claims to hash executable server code');
 const unavailable=runtimeBom(fixture,{reachable:false,models:found.models},'0.1.0');assert.ok(validateRuntime(unavailable),JSON.stringify(validateRuntime.errors));assert.ok(unavailable.components.every(c=>c.hashes===undefined),'unreachable discovery never reports cached hashes as observed');
 const disabled=runtimeBom({...fixture,models:{...fixture.models,roles:{misato:{route:'cloud'}}}},found,'0.1.0');assert.equal(disabled.components.find(c=>c['bom-ref']==='model:misato')!.properties.find(p=>p.name==='nerv:enabled')!.value,'false');
 const empty=runtimeBom({models:{}},{reachable:false,models:[]},'0.1.0');assert.ok(validateRuntime(empty),JSON.stringify(validateRuntime.errors));assert.deepEqual(empty.components,[]);assert.deepEqual(empty.services,[]);
});

test('F-067: real CLI emits only JSON, observes local model digests, starts no MCP command and opens no database',async()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-bom-'));const marker=join(home,'mcp-started');let calls=0;
 const server=createServer((req,res)=>{calls++;assert.equal(req.url,'/api/tags');res.setHeader('content-type','application/json');res.end(JSON.stringify({models:[{name:'fixture-model',digest:'d'.repeat(64)}]}));});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const config={...fixture,models:{...fixture.models,local:{model:'fixture-model',baseUrl:'http://127.0.0.1:'+(server.address() as {port:number}).port+'/v1'}},tools:{...fixture.tools,mcp:[{id:'files',command:process.execPath,args:['-e',`require('fs').writeFileSync(${JSON.stringify(marker)},'started')`]}]}};
 writeFileSync(join(home,'config.json'),JSON.stringify(config),{mode:0o600});for(const file of ['token','cloud-key','telegram-token'])writeFileSync(join(home,file),'PRIVATE_FILE_SECRET',{mode:0o600});
 const run=()=>new Promise<{code:number|null;out:string;error:string}>((done,fail)=>{const child=spawn(process.execPath,['src/cli.ts','bom'],{env:{...process.env,NERV_HOME:home},stdio:['ignore','pipe','pipe']});let out='',error='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>error+=d);child.once('error',fail);child.once('exit',code=>done({code,out,error}));});
 try{
  const result=await run();assert.equal(result.code,0,result.error);const bom=JSON.parse(result.out) as ReturnType<typeof runtimeBom>;assert.ok(validateRuntime(bom),JSON.stringify(validateRuntime.errors));assert.ok(bom.components.some(c=>c.hashes?.[0]?.content==='d'.repeat(64)));assert.equal(calls,1);assert.ok(!existsSync(marker));assert.ok(!existsSync(join(home,'nerv.sqlite')));assert.doesNotMatch(result.out,/PRIVATE_|127\.0\.0\.1|telegram-token|cloud-key/);
  await new Promise<void>(done=>server.close(()=>done()));const unavailable=await run();assert.equal(unavailable.code,0,unavailable.error);assert.ok(validateRuntime(JSON.parse(unavailable.out)));assert.ok((JSON.parse(unavailable.out) as ReturnType<typeof runtimeBom>).components.every(c=>!c.hashes));
 }finally{await new Promise<void>(done=>server.close(()=>done()));rmSync(home,{recursive:true,force:true});}
});

test('F-067: npm lock-only dependency SBOM validates and includes exact direct dependency versions',()=>{
 const npm=process.platform==='win32'?'npm.cmd':'npm';const result=spawnSync(npm,['sbom','--package-lock-only','--sbom-format','cyclonedx'],{encoding:'utf8',shell:process.platform==='win32',timeout:30000,maxBuffer:10*1024*1024});assert.equal(result.status,0,result.stderr);
 const bom=JSON.parse(result.stdout) as {components:{group?:string;name:string;version:string}[]};assert.ok(validateDependencies(bom),JSON.stringify(validateDependencies.errors));
 const lock=JSON.parse(readFileSync('package-lock.json','utf8')) as {packages:Record<string,{dependencies?:Record<string,string>;devDependencies?:Record<string,string>;version?:string}>};
 for(const name of Object.keys({...lock.packages['']!.dependencies,...lock.packages['']!.devDependencies}))assert.ok(bom.components.some(c=>(c.group?c.group+'/':'')+c.name===name&&c.version===lock.packages['node_modules/'+name]!.version),name);
});
