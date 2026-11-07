import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const moduleUrl=new URL('../src/build.ts',import.meta.url).href;
const info=(root:string)=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {buildInfo} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(buildInfo(process.argv[1])));`,root],{encoding:'utf8'})) as {version:string;commit:string|null;shortCommit:string|null};
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
 try{writeFileSync(join(root,'package.json'),'{"version":"0.1.0"}');assert.deepEqual(info(root),{version:'0.1.0',commit:null,shortCommit:null});}
 finally{rmSync(root,{recursive:true,force:true});}
});

test('F-057: the running commit uses Git’s unique abbreviation, including real object-prefix collisions',()=>{
 const root=mkdtempSync(join(tmpdir(),'nerv-build-short-'));
 try{
  git(root,'init','-b','main');writeFileSync(join(root,'package.json'),'{"version":"0.1.0"}');git(root,'add','package.json');commit(root);
  const full=git(root,'rev-parse','HEAD');git(root,'config','core.abbrev','12');
  assert.equal(info(root).shortCommit,git(root,'rev-parse','--short',full),'honor Git’s abbreviation instead of slicing seven characters');
  git(root,'config','core.abbrev','4');let collision:string|undefined;
  for(let n=0;n<2000000;n++){const text='Neutral collision fixture '+n;const hash=createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0'+text).digest('hex');if(hash.startsWith(full.slice(0,4))){collision=text;break;}}
  assert.ok(collision,'find a four-character collision in the neutral fixture');
  const blob=execFileSync('git',['hash-object','-w','--stdin'],{cwd:root,input:collision,encoding:'utf8'}).trim();assert.notEqual(blob,full);
  const result=info(root);assert.ok(result.shortCommit&&result.shortCommit.length>4,'Git lengthens the ambiguous prefix');
  assert.equal(result.shortCommit,git(root,'rev-parse','--short',full));
  assert.equal(git(root,'rev-parse','--verify',result.shortCommit),full,'copied identifier resolves to the actual running commit');
 }finally{rmSync(root,{recursive:true,force:true});}
});
