import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPairSync} from 'node:crypto';
import {inspectNode,runNodeCommand,type CommandRequest} from '../../src/node-inspection.ts';
import {bootstrapPlan} from '../../src/node-bootstrap.ts';
export const now=new Date('2026-11-08T12:00:00Z');
export const publicKey=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64');
export async function fixture(){
 const home=mkdtempSync(join(tmpdir(),'nerv-bootstrap-effects-'));const snapshot=await inspectNode({host:'fixture.invalid',port:22},async()=>JSON.stringify({version:1,platform:process.platform,arch:process.arch,node:process.versions.node,hostname:'fixture-target',userId:process.getuid?.()??null,userHome:home,git:'git version 2.47.0',npm:'11.1.0',base:null,configured:false,runtime:'not-checked'}),now);
 const plan=bootstrapPlan(snapshot,{sourceProtocol:1,revision:'a'.repeat(40),checkout:join(home,'checkout'),home:join(home,'data'),base:{id:'BASE-02',name:'Harbor'},installService:false},now);const calls=join(home,'calls.jsonl');
 const runner=(failure='')=>async(request:CommandRequest)=>{
  assert.equal(request.program,'ssh');assert.equal(request.args.at(-1),'node --input-type=commonjs -');
  let prefix=`const os=require('node:os'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');os.homedir=()=>${JSON.stringify(home)};os.hostname=()=>"fixture-target";cp.spawnSync=(program,args,options)=>{fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({program,args,cwd:options.cwd})+"\\n");if(${JSON.stringify(failure)}==='crash-build'&&(args.includes('build')||args.includes('npm run build')))process.exit(55);if(${JSON.stringify(failure)}&&args.some(value=>value===${JSON.stringify(failure)}||value.startsWith('npm '+${JSON.stringify(failure)}+' ')))return {status:1};if(args[0]==='clone'){fs.mkdirSync(input.plan.checkout);fs.mkdirSync(path.join(input.plan.checkout,'shared'));fs.writeFileSync(path.join(input.plan.checkout,'shared/node-bootstrap.json'),JSON.stringify({version:1,initNoModelSetup:true}));}if(args.includes('rev-parse'))return {status:0,stdout:input.plan.source.revision};if(args.includes('init')){fs.mkdirSync(input.plan.home);fs.writeFileSync(path.join(input.plan.home,'config.json'),'{}');}if(args.includes('pubkey'))return {status:0,stdout:${JSON.stringify(publicKey)}};return {status:0,stdout:""};};`;
  const waitCode=(marker:string,go:string)=>`fs.writeFileSync(${JSON.stringify(join(home,marker))},"ready");while(!fs.existsSync(${JSON.stringify(join(home,go))}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);`;
  if(failure==='pause-acquire')prefix+=`const originalStat=fs.statSync;let paused=false;fs.statSync=(name,...rest)=>{if(!paused&&name===${JSON.stringify(home)}){paused=true;${waitCode('acquire-paused','acquire-go')}}return originalStat(name,...rest);};`;
  if(failure==='pause-release')prefix+=`const originalKill=process.kill.bind(process);process.kill=(pid,signal)=>{if(signal===0){${waitCode('release-paused','release-go')}}return originalKill(pid,signal);};`;
  if(failure==='hold-build')prefix=prefix.replace('if(args[0]',`if(args.includes('build')||args.includes('npm run build')){${waitCode('build-held','build-go')}}if(args[0]`);
  return runNodeCommand({program:process.execPath,args:['--input-type=commonjs','-'],input:prefix+request.input,timeoutMs:30000,maxBytes:32768,mayWrite:request.mayWrite});
 };
 return {home,plan,calls,runner,close:()=>rmSync(home,{recursive:true,force:true})};
}
