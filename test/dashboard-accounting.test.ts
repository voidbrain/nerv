import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.ts';
import {Runtime} from '../src/runtime.ts';
import {makeServer} from '../src/server.ts';
import {authorize} from '../src/rpc.ts';
const source=readFileSync('web/public/dashboard/live.js','utf8');
const viewSource=source.slice(source.indexOf('  function usageView('),source.indexOf('  window.renderBudget'));
const usageView=new Function('esc',viewSource+'\nreturn usageView;')((s:unknown)=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')) as (page:unknown)=>{summary:string;html:string;heading:string};
test('Battery uses measured page data, keeps currencies separate and escapes returned models and provenance',()=>{
 const record={operation:'misato.step',started:'2026-11-07T10:00:00Z',state:'finished',observation:{route:'cloud',requestedModel:'requested',returnedModel:'<img src=x>',inputTokens:0,outputTokens:20,cacheReadTokens:null,cacheWriteTokens:0,durationMs:40,outcome:'success'},cost:{status:'estimated',amount:1,price:{currency:'USD',source:'https://provider.example/<script>',asOf:'2026-11-07'}}};
 const v=usageView({items:[record,{...record,cost:{...record.cost,amount:2,price:{...record.cost.price,currency:'EUR'}}},{...record,observation:null,state:'unknown',cost:{status:'unavailable'}}]});
 assert.match(v.summary,/USD 1\.000000 · EUR 2\.000000/);assert.match(v.heading,/1 call\(s\) with unavailable cost/);
 assert.match(v.html,/Input: 0/);assert.match(v.html,/cache read: unavailable/);assert.match(v.html,/&lt;img/);assert.match(v.html,/&lt;script/);assert.doesNotMatch(v.html,/<img|<script/);
 assert.match(v.html,/Requested: requested/);assert.match(v.html,/price as of 2026-11-07/);assert.match(v.html,/not an invoice/);assert.match(v.html,/limits and forecasts unavailable/);
 assert.match(usageView(null).heading,/unavailable/);assert.match(usageView({items:[]}).heading,/No recorded model calls/);
});
test('dashboard revisions notice writes on the scheduler connection and external CLI connection',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nerv-revision-'));const first=new Store(join(dir,'nerv.sqlite')),second=new Store(join(dir,'nerv.sqlite'));
 try{const before=first.dashboardRevision();first.add('Neutral task','2032-01-01T12:00:00Z');const local=first.dashboardRevision();assert.notEqual(local,before);second.add('Another task','2032-01-02T12:00:00Z');assert.notEqual(first.dashboardRevision(),local);}
 finally{first.close();second.close();rmSync(dir,{recursive:true,force:true});}
});
async function nextEvent(reader:ReadableStreamDefaultReader<Uint8Array>):Promise<string> {
 let text='';const timer= setTimeout(()=>{void reader.cancel();},3000);
 try{while(!text.includes('event: refresh')){const next=await reader.read();assert.equal(next.done,false,'stream ended before change');text+=new TextDecoder().decode(next.value);}return text;}finally{clearTimeout(timer);}
}
test('scheduler → authenticated dashboard stream pushes refresh after an external write and reconnect snapshots',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nerv-feed-'));const runtime=new Runtime(join(dir,'nerv.sqlite'));const token='n'.repeat(32);const server=makeServer(runtime,token);
 await runtime.ready();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;const headers={authorization:'Bearer '+token};const controller=new AbortController();
 try{
  assert.equal((await fetch(base+'/api/dashboard/stream')).status,401);assert.equal((await fetch(base+'/api/dashboard/stream?token=x',{headers})).status,400);
  assert.throws(()=>authorize('interface','coordinator','dashboard.revision'));
  const response=await fetch(base+'/api/dashboard/stream',{headers,signal:controller.signal});assert.match(response.headers.get('content-type')!,/text\/event-stream/);const reader=response.body!.getReader();
  await nextEvent(reader);
  const external=new Store(join(dir,'nerv.sqlite'));try{external.add('Private event payload','2032-01-01T12:00:00Z');}finally{external.close();}
  const event=await nextEvent(reader);assert.doesNotMatch(event,/Private|token|grant|n{32}/);
  assert.equal((await (await fetch(base+'/api/reminders',{headers})).json()).length,1);await reader.cancel();
  const reconnect=await fetch(base+'/api/dashboard/stream',{headers});const next=reconnect.body!.getReader();await nextEvent(next);await next.cancel();
 }finally{controller.abort();await new Promise<void>(r=>server.close(()=>r()));await runtime.close();rmSync(dir,{recursive:true,force:true});}
});
test('dashboard stream sessions are closed after expiry and stream count is bounded',{timeout:10000},async()=>{
 const store=new Store(':memory:');const token='m'.repeat(32);const server=makeServer(store,token,{sessionTtlMs:100});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();assert.ok(a&&typeof a==='object');const base=`http://127.0.0.1:${a.port}`;const headers={authorization:'Bearer '+token};const readers:ReadableStreamDefaultReader<Uint8Array>[]=[];
 try{
  const login=await (await fetch(base+'/api/session/codes',{method:'POST',headers})).json() as {code:string};
  const exchange=await (await fetch(base+'/api/session/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:login.code})})).json() as {token:string};
  const session=await fetch(base+'/api/dashboard/stream',{headers:{authorization:'Bearer '+exchange.token}});assert.equal(session.status,200);const reader=session.body!.getReader();await reader.read();
  // Expired session loses its open stream without waiting for the browser's recovery poll.
  await assert.rejects(async()=>{for(;;){const chunk=await reader.read();if(chunk.done)throw new Error('ended');}});
  for(let i=0;i<8;i++){const r=await fetch(base+'/api/dashboard/stream',{headers});assert.equal(r.status,200);readers.push(r.body!.getReader());}
  assert.equal((await fetch(base+'/api/dashboard/stream',{headers})).status,503);
 }finally{await Promise.all(readers.map(r=>r.cancel().catch(()=>{})));await new Promise<void>(r=>server.close(()=>r()));store.close();}
});
test('distant reminder labels use calendar years/months and clamp month ends',()=>{
 const part=source.slice(source.indexOf('  const until ='),source.indexOf('  window.renderNext'));
 const clock=new Proxy(Date,{construct(target,args){return Reflect.construct(target,args.length?args:['2026-01-31T12:00:00']);}});
 const until=new Function('Date',part+';return until;')(clock) as (time:number)=>string;
 assert.equal(until(new Date('2029-03-31T12:00:00').getTime()),'in 3 years 2 months');
 assert.equal(until(new Date('2026-02-28T12:00:00').getTime()),'in 1 month');
 assert.equal(until(new Date('2026-03-12T12:00:00').getTime()),'in 1 month 12 days');
});
test('Older/Newer failures preserve the loaded page and cursor history; successful recovery commits them together',async()=>{
 const block=source.slice(source.indexOf('  async function loadUsage'),source.indexOf('  document.addEventListener("click", async e =>'));
 let fail=false;
 const api=async(path:string)=>{if(fail)throw new Error('temporary failure');return path.includes('before=10')?{items:['older'],next:5}:{items:['newest'],next:10};};
 const h=new Function('api',`let usageBefore=null,usageBack=[],usageBusy=false,usageNext=null,usagePage=null,usageError=false;${block};return {loadUsage,moveUsage,state:()=>({before:usageBefore,back:usageBack,next:usageNext,page:usagePage})};`)(api) as {loadUsage:()=>Promise<boolean>;moveUsage:(direction:string)=>Promise<boolean>;state:()=>unknown};
 await h.loadUsage();const newest=h.state();fail=true;assert.equal(await h.moveUsage('older'),false);assert.deepEqual(h.state(),newest);assert.equal(await h.moveUsage('older'),false);assert.deepEqual(h.state(),newest);
 fail=false;await h.moveUsage('older');const older=h.state();fail=true;assert.equal(await h.moveUsage('newer'),false);assert.deepEqual(h.state(),older);
 fail=false;await h.moveUsage('newer');assert.deepEqual(h.state(),newest);
});
test('back/forward cache suspends streams and resumes refresh without discarding authentication',()=>{
 const block=source.slice(source.indexOf('  window.addEventListener("pagehide"'),source.indexOf('  let started = false;'));
 const handlers=new Map<string,(event?:{persisted:boolean})=>void>();let watches=0,refreshes=0,aborts=0;
 const h=new Function('window','watchChanges','queueRefresh','clearTimeout','abort',`let token='kept-in-tab',streamPaused=false,streamTimer=null,streamController={abort};${block};return ()=>({token,streamPaused});`)({addEventListener:(type:string,f:(event?:{persisted:boolean})=>void)=>handlers.set(type,f)},()=>watches++,()=>refreshes++,()=>{},()=>aborts++) as ()=>{token:string;streamPaused:boolean};
 handlers.get('pagehide')!({persisted:true});assert.equal(h().token,'kept-in-tab');assert.equal(h().streamPaused,true);assert.equal(aborts,1);
 handlers.get('pageshow')!({persisted:true});assert.equal(h().streamPaused,false);assert.equal(watches,1);assert.equal(refreshes,1);
});
