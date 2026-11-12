import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
export async function browser(work){
 const chrome=process.env.CHROME_BIN||['/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
 if(!chrome)throw Error('Chrome/Chromium required');
 const profile=mkdtempSync(join(tmpdir(),'nerv-eval-browser-')),child=spawn(chrome,['--headless','--no-first-run','--no-default-browser-check',...(process.platform==='linux'?['--no-sandbox']:[]),'--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let ws,serial=0;const pending=new Map(),errors=[],network=[];
 try{
  const endpoint=await new Promise((done,fail)=>{let log='';const timer=setTimeout(()=>fail(Error('Chrome startup timeout: '+log)),20000);child.once('error',e=>{clearTimeout(timer);fail(e);});child.once('exit',code=>{clearTimeout(timer);fail(Error('Chrome exited: '+code));});child.stderr.on('data',part=>{log=(log+part).slice(-2000);const match=/DevTools listening on (ws:\/\/\S+)/.exec(log);if(match){clearTimeout(timer);done(match[1]);}});});
  ws=new WebSocket(endpoint);await new Promise((done,fail)=>{ws.once('open',done);ws.once('error',fail);});
  ws.on('message',raw=>{const message=JSON.parse(raw);if(message.id){const call=pending.get(message.id);if(call){pending.delete(message.id);clearTimeout(call.timer);message.error?call.fail(Error(JSON.stringify(message.error))):call.done(message.result);}}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(message.method==='Network.responseReceived')network.push(message.params.response);});
  const call=(method,params={},sessionId)=>new Promise((done,fail)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);fail(Error('Browser call timed out: '+method));},20000);pending.set(id,{done,fail,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'}),{sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  const page=(method,params={})=>call(method,params,sessionId);
  const evaluate=async expression=>{const result=await page('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const until=async expression=>{const end=Date.now()+15000;while(!(await evaluate(expression))){if(Date.now()>end)throw Error('Browser condition timed out: '+expression);await new Promise(done=>setTimeout(done,50));}};
  await page('Page.enable');await page('Runtime.enable');await page('Page.bringToFront');await page('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await work({page,evaluate,until,errors,network});
 }finally{
  for(const p of pending.values()){clearTimeout(p.timer);p.fail(Error('Browser closed'));}pending.clear();ws?.terminate();
  if(child.exitCode===null)await new Promise(done=>{const timer=setTimeout(()=>child.kill('SIGKILL'),2000);child.once('exit',()=>{clearTimeout(timer);done();});child.kill();});
  rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
}
