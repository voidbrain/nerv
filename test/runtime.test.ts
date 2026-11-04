import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,statSync,mkdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {initialize,readConfig,readToken} from '../src/config.ts';
import {renderService} from '../src/service.ts';
import {makeServer} from '../src/server.ts';import {Store} from '../src/store.ts';
import {messages} from '../web/src/i18n.ts';
test('init preserves credentials and configuration; Italian/Rome defaults and private files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nodo-config-'));
 try{initialize(dir);const token=readToken(dir);assert.equal(token.length,64);assert.deepEqual(readConfig(dir),{port:4317,language:'it',timeZone:'Europe/Rome',models:{}});writeFileSync(join(dir,'config.json'),JSON.stringify({port:4900,language:'en',timeZone:'UTC'}));initialize(dir);assert.equal(readToken(dir),token);assert.equal(readConfig(dir).port,4900);assert.equal(statSync(join(dir,'token')).mode&0o777,0o600);writeFileSync(join(dir,'config.json'),'{"language":"xx"}');assert.throws(()=>readConfig(dir));writeFileSync(join(dir,'config.json'),'{"timeZone":"Not/AZone"}');assert.throws(()=>readConfig(dir));}finally{rmSync(dir,{recursive:true,force:true});}
});
test('service definitions use absolute paths, encode special characters, and contain no credentials',()=>{
 const plist=renderService('darwin','/Users/name/Nodo & data','/Users/name/Code/Nodo','/opt/node');assert.match(plist,/Nodo &amp; data/);assert.match(plist,/<key>RunAtLoad<\/key><true\/>/);assert.doesNotMatch(plist,/NODO_TOKEN/);
 const unit=renderService('linux','/home/user/data','/home/user/Code with % and $','/usr/bin/node');assert.match(unit,/Code with %% and \$\$/);assert.match(unit,/WantedBy=default.target/);assert.doesNotMatch(unit,/NODO_TOKEN/);assert.throws(()=>renderService('win32','a','b','c'));assert.throws(()=>renderService('linux','bad\npath','b','c'));
});
test('built UI is public, APIs authenticated, traversal and symlinks cannot expose private files',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nodo-static-'));const web=join(dir,'web');mkdirSync(web);writeFileSync(join(web,'index.html'),'<h1>Nodo</h1>');writeFileSync(join(dir,'secret.txt'),'secret');symlinkSync(join(dir,'secret.txt'),join(web,'linked.txt'));
 const store=new Store(':memory:');const server=makeServer(store,'a'.repeat(32),{webRoot:web,language:'it',timeZone:'Europe/Rome'});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const addr=server.address();assert.ok(addr&&typeof addr==='object');const base=`http://127.0.0.1:${addr.port}`;
 try{const page=await fetch(base);assert.equal(page.status,200);assert.match(page.headers.get('content-type')!,/text\/html/);assert.match(page.headers.get('content-security-policy')!,/frame-ancestors 'none'/);assert.equal(await page.text(),'<h1>Nodo</h1>');assert.equal((await fetch(base+'/api/doctor')).status,401);for(const p of ['/linked.txt','/%2e%2e%2fsecret.txt','/.git/config','/missing.js'])assert.equal((await fetch(base+p)).status,404);const doctor=await(await fetch(base+'/api/doctor',{headers:{Authorization:'Bearer '+'a'.repeat(32)}})).json();assert.equal(doctor.language,'it');assert.equal(doctor.timeZone,'Europe/Rome');}finally{await new Promise<void>(done=>server.close(()=>done()));store.close();rmSync(dir,{recursive:true,force:true});}
});
test('Italian and English cover the same UI messages',()=>{assert.deepEqual(Object.keys(messages.it).sort(),Object.keys(messages.en).sort());assert.equal(messages.it.reminders,'Promemoria');});

test('systemd accepts the generated unit syntax when its validator is available',(t)=>{
 const dir=mkdtempSync(join(tmpdir(),'nodo-unit-'));const path=join(dir,'nodo.service');
 try{writeFileSync(path,renderService('linux',dir,process.cwd(),process.execPath));const result=spawnSync('systemd-analyze',['verify',path],{encoding:'utf8'});if(result.error && 'code' in result.error && result.error.code==='ENOENT'){t.skip('systemd-analyze unavailable on this platform');return;}assert.equal(result.status,0,result.stderr);}finally{rmSync(dir,{recursive:true,force:true});}
});
