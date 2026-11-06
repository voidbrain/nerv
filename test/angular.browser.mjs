import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import WebSocket from 'ws';
import {Store} from '../src/store.ts';
import {makeServer} from '../src/server.ts';
const require=createRequire(import.meta.url);
const chrome=process.env.CHROME_BIN || ['/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);

test('F-010: styled bilingual workspace, local dates and responsive accessible controls',{timeout:120000},async t=>{
 assert.equal(JSON.parse(readFileSync('angular.json','utf8')).projects.nerv.architect.serve.options.port,4318,'dedicated development port');
 assert.ok(chrome,'Install Chrome/Chromium or set CHROME_BIN. Run npm run build first.');
 const profile=mkdtempSync(join(tmpdir(),'nerv-browser-'));
 const artifacts=process.env.NERV_BROWSER_ARTIFACTS; if(artifacts)mkdirSync(artifacts,{recursive:true});
 const store=new Store(':memory:');const token='e'.repeat(32);
 const server=makeServer(store,token,{webRoot:resolve('dist/web/browser'),language:'en',timeZone:'Europe/Rome'});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
 const child=spawn(chrome,['--headless','--no-first-run','--no-default-browser-check',...(process.platform==='linux'?['--no-sandbox']:[]),'--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let ws;const pending=new Map();let serial=0;const errors=[];
 try{
  const endpoint=await new Promise((done,fail)=>{
   let output='';const timer=setTimeout(()=>fail(new Error('Chrome startup timed out: '+output)),20000);
   child.once('error',e=>{clearTimeout(timer);fail(e);});child.once('exit',code=>{clearTimeout(timer);fail(new Error('Chrome exited: '+code));});
   child.stderr.on('data',chunk=>{output=(output+chunk).slice(-4000);const match=/DevTools listening on (ws:\/\/\S+)/.exec(output);if(match){clearTimeout(timer);done(match[1]);}});
  });
  ws=new WebSocket(endpoint);await new Promise((done,fail)=>{ws.once('open',done);ws.once('error',fail);});
  ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.fail(new Error(JSON.stringify(m.error))):p.done(m.result);}}
   if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
   if(m.method==='Log.entryAdded'&&m.params.entry.source==='security')errors.push(m.params.entry.text);
  });
  const call=(method,params={},sessionId)=>new Promise((done,fail)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);fail(new Error('CDP timed out: '+method));},20000);pending.set(id,{done,fail,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  const page=(method,params={})=>call(method,params,sessionId);
  const evaluate=async expression=>{const r=await page('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{const end=Date.now()+10000;while(!(await evaluate(expression))){assert.ok(Date.now()<end,'Browser condition timed out: '+expression);await new Promise(d=>setTimeout(d,50));}};
  const viewport=async(width,height)=>{await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});};
  const language=async lang=>{await evaluate(`{const s=document.querySelector('select');s.value=${JSON.stringify(lang)};s.dispatchEvent(new Event('change',{bubbles:true}));}`);await until(`document.documentElement.lang===${JSON.stringify(lang)}`);};
  const screenshot=async name=>{if(!artifacts)return;const {data}=await page('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(artifacts,name+'.png'),Buffer.from(data,'base64'));};
  await page('Page.enable');await page('Page.bringToFront');await page('Runtime.enable');await page('Log.enable');await page('Emulation.setTimezoneOverride',{timezoneId:'Europe/Rome'});await viewport(1440,1000);await page('Page.navigate',{url:origin});
  await until(`document.querySelector('h1')?.textContent.includes('Your world.')`);
  await evaluate(readFileSync(require.resolve('axe-core/axe.min.js'),'utf8'));
  const audit=async name=>{const result=await evaluate(`axe.run().then(r=>({violations:r.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})),incomplete:r.incomplete.map(v=>v.id)}))`);await screenshot(name);assert.deepEqual(result.violations,[],name);assert.ok(result.incomplete.every(id=>id==='label-content-name-mismatch'),name+': unexpected manual review required');t.diagnostic(name+': axe passed; manual-review categories '+result.incomplete.join(', '));};
  assert.equal(await evaluate('document.documentElement.lang'),'en');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.shell')).display`),'grid','full stylesheet must load under the service CSP');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.shell')).gridTemplateColumns.split(' ').length`),2);
  await audit('english-disconnected-desktop');
  // Verify keyboard focus separately from the platform-specific native select popup.
  await evaluate(`document.querySelectorAll('nav button')[2].focus()`);
  await page('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await evaluate('document.activeElement.tagName'),'SELECT','language selector is reachable by keyboard');
  await language('it');await audit('italian-disconnected-desktop');assert.ok(await evaluate(`document.querySelector('h1').textContent.includes('Il tuo mondo.')`));
  await language('en');
  await evaluate(`document.querySelector('input[type=password]').value='${token}';[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Connect').click()`);
  await until(`document.querySelector('input[type="datetime-local"]')!==null`);
  await evaluate(`document.querySelector('input[maxlength]').value='Practice sketching / Disegno';document.querySelector('input[type="datetime-local"]').value='2031-04-12T09:30';[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save reminder').click()`);
  await until(`document.querySelector('article.reminder strong')?.textContent==='Practice sketching / Disegno'`);
  const reminder=store.list()[0];assert.equal(reminder.title,'Practice sketching / Disegno');assert.equal(reminder.due,'2031-04-12T07:30:00.000Z','browser-local input converted to UTC');
  for(const lang of ['en','it']){
   await language(lang);
   assert.equal(await evaluate(`document.querySelector('article.reminder strong').textContent`),reminder.title);
   assert.equal(await evaluate(`document.querySelector('article.reminder button').getAttribute('aria-label')`),(lang==='it'?'Annulla':'Cancel')+' '+reminder.title,'graphical cancel control has its localized action and reminder name');
   assert.equal(await evaluate(`document.querySelector('article.reminder p').textContent`),await evaluate(`new Date('${reminder.due}').toLocaleString('${lang==='it'?'it-IT':'en-GB'}')`));
   assert.equal(await evaluate(`document.querySelector('label:has(input[type="datetime-local"]) small').textContent`),lang==='it'?'Ora locale del browser':'Browser local time');
   for(const [width,height] of [[1440,1000],[390,844],[320,740]]){
    await viewport(width,height);await screenshot(lang+'-layout-'+width);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,lang+' layout at '+width+': '+JSON.stringify(await evaluate(`[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))`)));
    await audit(lang+'-reminders-'+width);
   }
   await evaluate(`document.querySelectorAll('nav button')[2].click()`);await until(`document.querySelector('main pre')!==null`);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,lang+' doctor layout');await evaluate(`document.querySelector('pre').focus()`);assert.equal(await evaluate('document.activeElement.tagName'),'PRE');await audit(lang+'-doctor-mobile');
   await evaluate(`document.querySelectorAll('nav button')[0].click()`);await until(`document.querySelector('article.reminder')!==null`);
  }
  assert.equal(store.list()[0].due,reminder.due,'language changes do not reinterpret stored time');
  assert.deepEqual(errors,[],'no runtime exceptions or CSP violations');
 }finally{
  for(const p of pending.values()){clearTimeout(p.timer);p.fail(new Error('Browser closed'));}pending.clear();ws?.terminate();
  if(child.exitCode===null){await new Promise(done=>{const timer=setTimeout(()=>child.kill('SIGKILL'),2000);child.once('exit',()=>{clearTimeout(timer);done();});child.kill();});}
  await new Promise(done=>{server.close(done);server.closeAllConnections();});store.close();rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
