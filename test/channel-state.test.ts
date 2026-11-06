import {test} from 'node:test';
import assert from 'node:assert/strict';
import {channelIsFresh,sanitizeChannel} from '../src/channel-state.ts';
const at='2030-01-01T00:00:00.000Z';
test('channel telemetry is bounded first-hand route data, without private bot/chat/message fields',()=>{
 const report={mode:'via-main',destination:'NERV-01',checkedAt:at,lastDelivery:{route:'main',result:'accepted',at,chatId:42},token:'private',chatId:42,text:'private'};
 assert.deepEqual(sanitizeChannel(report),{mode:'via-main',destination:'NERV-01',checkedAt:at,lastDelivery:{route:'main',result:'accepted',at}});
 for(const bad of [null,[],{}, {mode:'green',checkedAt:at},{mode:'local',checkedAt:'now'},{mode:'local',checkedAt:at,destination:'https://private'}, {mode:'local',checkedAt:at,lastDelivery:{route:'main',result:'delivered-to-phone',at}},{mode:'local',checkedAt:at,lastDelivery:{route:'main',result:'accepted',at:'tomorrow'}}])assert.equal(sanitizeChannel(bad),undefined);
});

test('failed relay and failed own-bot sends report failure without private error data; a retry records acceptance',async()=>{
 const {TelegramApi,TelegramChannel}=await import('../src/telegram.ts');const {Store}=await import('../src/store.ts');
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const home=mkdtempSync(join(tmpdir(),'nerv-channel-'));const store=new Store(':memory:');let fail=true;
 class Bot extends TelegramApi {override async send(){if(fail)throw new Error('private provider details');return {message_id:1};}}
 const channel=new TelegramChannel({api:new Bot('test-token'),store,chatId:123,statePath:join(home,'state.json'),log:()=>{},oneChannel:{destination:async()=> 'NERV-01',quiet:async()=>true,relay:async()=>false}});
 try{
  await channel.deliver();store.add('Neutral reminder',new Date(Date.now()+1000).toISOString());store.tick(new Date(Date.now()+2000));
  await channel.deliver();assert.equal(channel.channelState().mode,'local-fallback');assert.equal(channel.channelState().lastDelivery?.result,'failed');
  assert.doesNotMatch(JSON.stringify(channel.channelState()),/test-token|123|Neutral reminder|private provider/);
  fail=false;await channel.deliver();assert.equal(channel.channelState().lastDelivery?.result,'accepted');
  const snapshot=channel.channelState();snapshot.mode='unknown';assert.equal(channel.channelState().mode,'local-fallback','caller cannot mutate cached mode');
 }finally{await channel.stop();store.close();rmSync(home,{recursive:true,force:true});}
});

test('route check freshness has a bounded age and future-clock tolerance',()=>{
 const now=Date.parse(at);const c={mode:'local',checkedAt:at} as const;
 assert.equal(channelIsFresh(c,now+89_999,90_000),true);assert.equal(channelIsFresh(c,now+90_000,90_000),false);
 assert.equal(channelIsFresh(c,now-120_000,90_000),true);assert.equal(channelIsFresh(c,now-120_001,90_000),false);
});
