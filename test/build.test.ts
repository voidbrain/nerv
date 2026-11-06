import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const moduleUrl=new URL('../src/build.ts',import.meta.url).href;
const info=(root:string)=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {buildInfo} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(buildInfo(process.argv[1])));`,root],{encoding:'utf8'})) as {version:string;commit:string|null};
const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=(cwd:string)=>git(cwd,'-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','Fixture revision');

test('F-057: build versions advance per first-parent revision, match across bases and stay cached at service start',()=>{
 const root=mkdtempSync(join(tmpdir(),'nerv-build-'));const base=join(root,'base');
 try{
  git(root,'init','-b','main');writeFileSync(join(root,'package.json'),'{"version":"0.1.0"}');git(root,'add','package.json');commit(root);
  assert.equal(info(root).version,'1.1');commit(root);
  const second=info(root);assert.equal(second.version,'1.2');
  git(root,'clone',root,base);assert.deepEqual(info(base),second,'same revision, independent base');
  const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {buildInfo} from ${JSON.stringify(moduleUrl)}; import {execFileSync} from 'node:child_process'; const root=process.argv[1];const before=buildInfo(root);execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','Later fixture'],{cwd:root});console.log(JSON.stringify([before,buildInfo(root)]));`,root],{encoding:'utf8'})) as unknown[];
  assert.deepEqual(result,[second,second],'checkout advancing does not relabel a running service');
  assert.equal(info(root).version,'1.3','a new process sees the updated code');
  const shallow=join(root,'shallow');git(root,'clone','--depth','1',pathToFileURL(root).href,shallow);
  const limited=info(shallow);assert.equal(limited.version,'0.1.0','partial history must not invent a build count');assert.equal(limited.commit,info(root).commit);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('F-057: a source copy without git metadata retains its package version',()=>{
 const root=mkdtempSync(join(tmpdir(),'nerv-source-'));
 try{writeFileSync(join(root,'package.json'),'{"version":"0.1.0"}');assert.deepEqual(info(root),{version:'0.1.0',commit:null});}
 finally{rmSync(root,{recursive:true,force:true});}
});
