import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {parseHTML} from 'linkedom';
const src=readFileSync('web/public/dashboard/dashboard.js','utf8'),html=readFileSync('web/public/dashboard/index.html','utf8');
test('Models and Battery share accessible tabs, preserve content, and support keyboard navigation',()=>{
 const {document,window}=parseHTML(html);const start=src.indexOf('function selectResourceTab('),end=src.indexOf('const telegramObserved',start);
 const select=new Function('document',src.slice(start,end)+';return selectResourceTab;')(document);
 const model=document.getElementById('models-tabpanel'),battery=document.getElementById('p-budget');
 document.getElementById('models').innerHTML='<input id="draft" value="unsaved">';
 select('battery');assert.equal(model.hidden,true);assert.equal(battery.hidden,false);assert.equal(document.getElementById('tab-battery').getAttribute('aria-selected'),'true');assert.equal(document.querySelectorAll('section#p-budget').length,0);
 select('models');assert.equal(document.getElementById('draft').value,'unsaved');assert.equal(model.hidden,false);assert.equal(battery.hidden,true);
 const key=new window.Event('keydown',{bubbles:true,cancelable:true});Object.defineProperty(key,'key',{value:'ArrowRight'});document.getElementById('tab-models').dispatchEvent(key);
 assert.equal(battery.hidden,false);assert.equal(document.getElementById('tab-models').tabIndex,-1);
 const home=new window.Event('keydown',{bubbles:true,cancelable:true});Object.defineProperty(home,'key',{value:'Home'});document.getElementById('tab-battery').dispatchEvent(home);assert.equal(model.hidden,false);
});
test('Telegram map activity follows changed accepted send reports, without replay on initial load or simulated live sync',()=>{
 const {document}=parseHTML(html);const start=src.indexOf('const telegramObserved'),end=src.indexOf('function drawTelegram',start);
 const api=new Function('document',src.slice(start,end)+';return {observeTelegram,telegramRoutes,telegramPulses};')(document);
 const at=new Date().toISOString();const base={baseId:'NERV-02',status:'enrolled',online:true,channelFresh:true,channel:{mode:'via-main',destination:'NERV-01',checkedAt:at,lastDelivery:{route:'main',result:'accepted',at}}};
 api.observeTelegram([base],0);assert.equal(api.telegramPulses.length,0,'initial state is a baseline');
 const next={...base,channel:{...base.channel,lastDelivery:{...base.channel.lastDelivery,at:new Date(Date.now()+1).toISOString()}}};
 api.observeTelegram([next],10);assert.deepEqual(api.telegramPulses,[{baseId:'NERV-01',direction:'outbound',t0:10}]);api.observeTelegram([next],20);assert.equal(api.telegramPulses.length,1,'polling never repeats the pulse');
 const failed={...next,channel:{...next.channel,lastDelivery:{...next.channel.lastDelivery,result:'failed'}}};api.observeTelegram([failed],30);assert.equal(api.telegramPulses.length,1,'failure never looks like a successful send');
 const incoming={...next,channel:{...next.channel,lastReceived:new Date().toISOString()}};api.observeTelegram([incoming],40);assert.equal(api.telegramPulses.at(-1).direction,'inbound');
 assert.equal(api.telegramRoutes([{...base,channelFresh:false}]).length,0);assert.equal(api.telegramRoutes([{...base,online:false}]).length,0);
 assert.match(document.getElementById('topo').getAttribute('aria-label'),/Phone receipt unknown/);
 const traffic=src.slice(src.indexOf('// Mesh traffic:'),src.indexOf('setInterval(() => { if (LIVE) return; BASES'));
 assert.match(traffic,/if \(LIVE\) return;/,'live sync pulses come only from received heartbeats');
});

test('channel live state requires a recent API response, with routed bots on standby and phone receipt never inferred',()=>{
 const start=src.indexOf('function telegramApiState('),end=src.indexOf('function drawTelegram',start);
 const check=new Function(src.slice(start,end)+';return telegramApiState;')();const now=Date.now();
 const base={online:true,channelFresh:true,channel:{mode:'local',polling:true}};
 assert.equal(check(base,now),'unknown','configured and listener started is not API reachability');
 const responding={...base,channel:{...base.channel,api:{state:'responding',at:new Date(now).toISOString()}}};
 assert.equal(check(responding,now),'responding');assert.equal(check(responding,now+90000),'unknown');
 assert.equal(check({...responding,channel:{...responding.channel,mode:'via-main',polling:false}},now),'standby');
 assert.equal(check({...responding,channel:{...responding.channel,api:{state:'failed',at:new Date(now).toISOString()}}},now),'failed');
});
