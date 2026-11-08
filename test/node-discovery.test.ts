import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {inventoryCandidates,sshCandidates,tailscaleCandidates,registryCandidates,nodeTarget,parseNodeInput,mergeCandidates} from '../src/node-discovery.ts';
import {inspectNode,validateInspection,NODE_PROBE,runNodeCommand,sshInspectionRequest} from '../src/node-inspection.ts';
import {bootstrapPlan} from '../src/node-bootstrap.ts';
import {nodesCommand} from '../src/nodes-cli.ts';
import {signRecord} from '../src/kaji.ts';
const now=new Date('2026-11-08T12:00:00Z'),target=nodeTarget({host:'aster.invalid',user:'fixture'});
const info={version:1,platform:'linux',arch:'arm64',node:'24.12.0',hostname:'aster',userId:1000,userHome:'/home/fixture',git:'git version 2.47.0',npm:'11.1.0',base:null,configured:false,runtime:'not-checked'};
const inspect=(extra:Record<string,unknown>={})=>inspectNode(target,async()=>JSON.stringify({...info,...extra}),now);
const options={revision:'a'.repeat(40),checkout:'/home/fixture/nerv-source',home:'/home/fixture/nerv-data',base:{id:'BASE-02',name:'Harbor'},installService:false};

test('F-005: inventory and literal SSH aliases remain untrusted and reject command/options injection',()=>{
 const inventory={version:1,targets:[{name:'Harbor',ssh:{host:'aster.invalid',user:'fixture',port:2222},secret:'NEUTRAL_SECRET'}]};
 const found=inventoryCandidates(inventory);assert.equal(found[0]!.trust,'candidate');assert.equal(found[0]!.target.port,2222);assert.equal(JSON.stringify(found).includes('NEUTRAL_SECRET'),false);assert.deepEqual(found,inventoryCandidates(inventory));
 assert.deepEqual(sshCandidates('Host aster harbor\nHost *.invalid !hidden\nMatch exec "touch should-not-run"\nInclude private-config\n').map(row=>row.target.host),['aster','harbor']);assert.deepEqual(sshCandidates('Host = aster\nHost=harbor').map(row=>row.target.host),['aster','harbor']);
 for(const host of ['-oProxyCommand=anything','host;touch marker','user@host','host\nnext','ssh://host'])assert.throws(()=>nodeTarget({host}));
 for(const port of [0,65536,'22'])assert.throws(()=>nodeTarget({host:'aster',port}));assert.throws(()=>parseNodeInput('x'.repeat(262145)),/exceeds/);assert.throws(()=>mergeCandidates(Array.from({length:65},(_,i)=>inventoryCandidates({version:1,targets:[{name:'N'+i,ssh:{host:'n'+i}}]})[0]!)),/64/);
});
test('F-005: Tailscale metadata does not confer identity or reachability and private fields are removed',()=>{
 const value=tailscaleCandidates({Peer:{one:{HostName:'Harbor',TailscaleIPs:['not-ip','100.64.0.10'],Online:false,UserID:'PRIVATE_OWNER',Token:'NEUTRAL_SECRET'}}});
 assert.deepEqual(tailscaleCandidates({BackendState:'Running',Peer:null}),[]);assert.throws(()=>tailscaleCandidates({BackendState:'NeedsLogin',Peer:{}}),/running/);
 assert.equal(value[0]!.reportedOnline,false);assert.equal(value[0]!.trust,'candidate');assert.equal(value[0]!.target.host,'100.64.0.10');assert.doesNotMatch(JSON.stringify(value),/PRIVATE_OWNER|NEUTRAL_SECRET/);assert.throws(()=>tailscaleCandidates({Peer:{a:{HostName:'Bad',TailscaleIPs:['bad']}}}),/no IP/);
});
test('F-005: registry discovery verifies the pinned root, signatures and revocations without enrolling candidates',()=>{
 const root=generateKeyPairSync('ed25519'),base=generateKeyPairSync('ed25519'),pub=root.publicKey.export({format:'der',type:'spki'}).toString('base64'),key=base.publicKey.export({format:'der',type:'spki'}).toString('base64');
 const enrol=signRecord(root.privateKey,{kind:'enrol',serial:1,baseId:'BASE-02',name:'Harbor',publicKey:key,address:'100.64.0.10:4320',issued:now.toISOString()});
 const bundle={root:pub,records:[enrol]};assert.equal(registryCandidates(bundle,pub)[0]!.trust,'candidate');assert.equal(registryCandidates(bundle,pub)[0]!.target.host,'100.64.0.10');assert.throws(()=>registryCandidates(bundle,'wrong'),/pinned root/);assert.throws(()=>registryCandidates({...bundle,records:[{...enrol,signature:'bad'}]},pub));
 const revoke=signRecord(root.privateKey,{kind:'revoke',serial:2,baseId:'BASE-02',issued:now.toISOString()});assert.deepEqual(registryCandidates({...bundle,records:[enrol,revoke]},pub),[]);
});
test('F-005: SSH probe has fixed read-only code, strict host trust and bounded reports, with no secret export',async()=>{
 let called=false;const result=await inspectNode(target,async request=>{called=true;assert.equal(request.program,'ssh');assert.ok(request.args.includes('StrictHostKeyChecking=yes'));assert.ok(request.args.includes('BatchMode=yes'));assert.ok(request.args.includes('-a'));assert.equal(request.args.at(-1),'node --input-type=commonjs -');assert.equal(request.input,NODE_PROBE);assert.equal(request.maxBytes,32768);return JSON.stringify({...info,token:'NEUTRAL_SECRET'});},now);
 assert.equal(called,true);assert.equal(result.runtime,'not-checked');assert.equal(JSON.stringify(result).includes('NEUTRAL_SECRET'),false);assert.equal(result.digest.length,64);assert.deepEqual(validateInspection(result,now),result);
 assert.throws(()=>validateInspection({...result,target:{...result.target,host:'other.invalid'}},now),/digest/);assert.throws(()=>validateInspection(result,new Date(now.getTime()+86400001)),/expire/);assert.throws(()=>validateInspection(result,new Date(now.getTime()-1)),/expire/);
 await assert.rejects(inspect({platform:'freebsd'}),/Unsupported/);await assert.rejects(inspect({userHome:'relative'}),/absolute/);await assert.rejects(inspectNode(target,async()=>'{bad',now),/valid report/);assert.throws(()=>sshInspectionRequest({host:'-anything',port:22}));
});
test('F-005: real bounded child runner/probe reads only selected public configuration and filters environment',async()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-node-probe-'));mkdirSync(join(home,'.nerv'));writeFileSync(join(home,'.nerv','config.json'),JSON.stringify({base:{id:'BASE-02',name:'Harbor'},secret:'NEUTRAL_SECRET'}));writeFileSync(join(home,'.nerv','token'),'NEUTRAL_SECRET');const files=readdirSync(join(home,'.nerv'));
 const old=process.env.NERV_INSPECTION_TEST_SECRET;process.env.NERV_INSPECTION_TEST_SECRET='NEUTRAL_SECRET';
 try{
  const prefix=`require('node:os').homedir=()=>${JSON.stringify(home)};require('node:os').hostname=()=>"fixture";require('node:child_process').spawnSync=(command)=>({status:0,stdout:command.startsWith('git')?'git version 2.47.0':'11.1.0'});`;
  const raw=await runNodeCommand({program:process.execPath,args:['--input-type=commonjs','-'],input:prefix+NODE_PROBE,timeoutMs:5000,maxBytes:16384});const value=JSON.parse(raw);assert.equal(value.configured,true);assert.deepEqual(value.base,{id:'BASE-02',name:'Harbor'});assert.equal(value.git,'git version 2.47.0');assert.equal(value.npm,'11.1.0');assert.doesNotMatch(raw,/NEUTRAL_SECRET/);assert.deepEqual(readdirSync(join(home,'.nerv')),files);
  assert.equal(await runNodeCommand({program:process.execPath,args:['-e','process.stdout.write(process.env.NERV_INSPECTION_TEST_SECRET??"absent")'],timeoutMs:5000,maxBytes:64}),'absent');
  await assert.rejects(runNodeCommand({program:process.execPath,args:['-e','process.stdout.write("x".repeat(10000))'],timeoutMs:5000,maxBytes:64}),/bound/);
  await assert.rejects(runNodeCommand({program:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:30,maxBytes:64}),/timed out/);
 }finally{if(old===undefined)delete process.env.NERV_INSPECTION_TEST_SECRET;else process.env.NERV_INSPECTION_TEST_SECRET=old;rmSync(home,{recursive:true,force:true});}
});
test('F-005: bootstrap preview pins source and identity, exposes permissions/recovery, and never executes',async()=>{
 const observed=await inspect(),plan=bootstrapPlan(observed,{...options,installService:true},now);assert.equal(plan.kind,'review-only');assert.equal(plan.execution,'not-implemented');assert.equal(plan.source.revision,options.revision);assert.equal(plan.observed.hostname,'aster');assert.ok(plan.steps.find(step=>step.id==='locked-dependencies')!.args.includes('--engine-strict'));assert.equal(plan.target.host,target.host);assert.ok(plan.steps.some(step=>step.id==='per-user-service'));assert.equal(plan.digest.length,64);assert.ok(plan.blockers.some(row=>row.includes('Service ownership')));assert.deepEqual(bootstrapPlan(observed,options,now).blockers,[]);assert.ok(plan.preconditions.some(row=>row.includes('symlinks')));assert.ok(plan.rollback.some(row=>row.includes('reconcile')));assert.ok(plan.pairing.some(row=>row.includes('private')));assert.ok(plan.steps.every(step=>step.where==='target'));assert.equal(plan.steps.find(step=>step.id==='initialize')!.env!.NERV_HOME,options.home);
 assert.throws(()=>bootstrapPlan(observed,{...options,revision:'main'},now),/full/);assert.throws(()=>bootstrapPlan(observed,{...options,checkout:'/etc/nerv'},now),/inside/);assert.throws(()=>bootstrapPlan(observed,{...options,home:options.checkout+'/data'},now),/separate/);
 const missing=bootstrapPlan(await inspect({node:'22.1.0',git:null,npm:null,configured:true}),options,now);assert.equal(missing.blockers.length,4);assert.ok(bootstrapPlan(await inspect({userId:0}),options,now).blockers.some(row=>row.includes('root')));
 const windows=await inspect({platform:'win32',userHome:'C:\\Users\\Fixture'});assert.equal(bootstrapPlan(windows,{...options,checkout:'C:\\Users\\Fixture\\source',home:'C:\\Users\\Fixture\\data'},now).steps.find(step=>step.id==='public-identity')!.args[1],'C:\\Users\\Fixture\\source\\src\\cli.ts');assert.throws(()=>bootstrapPlan(windows,{...options,checkout:'D:\\source',home:'C:\\Users\\Fixture\\data'},now),/inside/);
});
test('F-005: command boundaries refuse implicit scans, unknown options and overwrites; selected discovery never probes hosts',async()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-node-cli-'));const source=join(home,'inventory.json');writeFileSync(source,JSON.stringify({version:1,targets:[{name:'Harbor',ssh:{host:'aster.invalid'}}]}));let calls=0;
 try{
  const value=await nodesCommand(['discover','--inventory',source],async()=>{calls++;throw Error('must not run');}) as {candidates:unknown[]};assert.equal(value.candidates.length,1);assert.equal(calls,0);await assert.rejects(nodesCommand(['discover']),/Select/);await assert.rejects(nodesCommand(['discover','--inventory',source,'--inventory',source]),/duplicate/);await assert.rejects(nodesCommand(['inspect','--local','--ssh','aster']),/Choose/);
  const output=join(home,'inspection.json');await nodesCommand(['inspect','--ssh','aster','--out',output],async()=>JSON.stringify(info));assert.ok(readFileSync(output,'utf8').includes('not-checked'));if(process.platform!=='win32')assert.equal(statSync(output).mode&0o777,0o600);await assert.rejects(nodesCommand(['inspect','--ssh','aster','--out',output],async()=>JSON.stringify(info)),/EEXIST/);
 }finally{rmSync(home,{recursive:true,force:true});}
});
test('F-005: real CLI discovery emits JSON without opening a database, starting a model or reading credentials',async()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-node-process-')),source=join(home,'inventory.json');writeFileSync(source,JSON.stringify({version:1,targets:[{name:'Harbor',ssh:{host:'aster.invalid'}}]}));writeFileSync(join(home,'config.json'),JSON.stringify({private:'NEUTRAL_SECRET'}));writeFileSync(join(home,'token'),'NEUTRAL_SECRET');const files=readdirSync(home);
 try{const result=await new Promise<{code:number|null;out:string;error:string}>((done,fail)=>{const child=spawn(process.execPath,['src/cli.ts','nodes','discover','--inventory',source],{env:{...process.env,NERV_HOME:home},stdio:['ignore','pipe','pipe']});let out='',error='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>error+=chunk);child.once('error',fail);child.once('close',code=>done({code,out,error}));});assert.equal(result.code,0,result.error);assert.equal(JSON.parse(result.out).candidates.length,1);assert.doesNotMatch(result.out+result.error,/NEUTRAL_SECRET/);assert.deepEqual(readdirSync(home),files);}
 finally{rmSync(home,{recursive:true,force:true});}
});

test('F-005: worker bootstrap initialization explicitly skips automatic model discovery and role changes',async()=>{
 const plan=bootstrapPlan(await inspect(),options,now);assert.ok(plan.steps.find(step=>step.id==='initialize')!.args.includes('--no-model-setup'),'worker bootstrap must not discover or configure models implicitly');
});
test('F-005: init --no-model-setup never queries the configured Ollama endpoint',async()=>{
 const {createServer}=await import('node:http');const home=mkdtempSync(join(tmpdir(),'nerv-node-no-model-'));let requests=0;
 const server=createServer((_req,res)=>{requests++;res.setHeader('content-type','application/json');res.end(JSON.stringify({models:[{name:'fixture-model'}]}));});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 try{const result=await new Promise<{code:number|null;out:string;error:string}>((done,fail)=>{const child=spawn(process.execPath,['src/cli.ts','init','--base','BASE-02','--name','Harbor','--no-model-setup'],{env:{...process.env,NERV_HOME:home,NERV_OLLAMA:'http://127.0.0.1:'+(server.address() as {port:number}).port},stdio:['ignore','pipe','pipe']});let out='',error='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>error+=d);child.once('error',fail);child.once('close',code=>done({code,out,error}));});assert.equal(result.code,0,result.error);assert.equal(requests,0,'worker initialization must not request even model inventory');const config=JSON.parse(readFileSync(join(home,'config.json'),'utf8'));assert.ok(!config.models?.local&&!config.models?.cloud);}
 finally{await new Promise<void>(done=>{server.close(()=>done());server.closeAllConnections();});rmSync(home,{recursive:true,force:true});}
});
