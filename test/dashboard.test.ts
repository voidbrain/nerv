import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store,OWNER_SOURCE} from '../src/store.ts';
import {makeServer} from '../src/server.ts';
import {defaultPolicy} from '../src/policy.ts';
async function serve(store:Store,webRoot:string,work:(base:string,headers:Record<string,string>)=>Promise<void>) {
 const token='e'.repeat(32);const server=makeServer(store,token,{webRoot});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 try{await work(`http://127.0.0.1:${(server.address() as {port:number}).port}`,{authorization:'Bearer '+token});}finally{await new Promise<void>(done=>server.close(()=>done()));}
}
test('the dashboard reads: sorties newest first with counts and Patterns, one sortie with each action\'s outcome, no grant IDs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nerv-dash-'));const store=new Store(':memory:',{policy:{...defaultPolicy,blue:['reminders.cancel']},source:'test'});
 try{
  const done=store.ledger.openSortie(OWNER_SOURCE,'Remind me','trusted',new Date('2030-01-01T00:00:00Z'));
  store.runAction(done,{tool:'reminders.add',args:{title:'Call Ada',due:'2031-01-01T09:00:00Z'},stage:'production'});
  const waiting=store.ledger.openSortie(OWNER_SOURCE,'Cancel it','trusted',new Date('2030-01-02T00:00:00Z'));
  store.runAction(waiting,{tool:'reminders.cancel',args:{id:'x'},stage:'production'});
  await serve(store,dir,async(base,headers)=>{
   const list=await (await fetch(base+'/api/sorties?limit=10',{headers})).json() as {id:string;status:string;waiting:number;patterns:string[];actions:number}[];
   assert.deepEqual(list.map(s=>[s.id,s.status,s.waiting,s.patterns]),[[waiting,'open',1,['blue']],[done,'done',0,['green']]]);
   const older=await (await fetch(base+'/api/sorties?before=2030-01-02T00:00:00.000Z',{headers})).json() as {id:string}[];assert.deepEqual(older.map(s=>s.id),[done]);
   const one=await (await fetch(base+'/api/sorties/'+waiting,{headers})).json() as {detail:{tool:string;status:string;ballot:{pattern:string}}[]};
   assert.deepEqual(one.detail.map(a=>[a.tool,a.status,a.ballot.pattern]),[['reminders.cancel','waiting','blue']]);
   assert.deepEqual((await (await fetch(base+'/api/sorties/'+done,{headers})).json() as {detail:{status:string}[]}).detail.map(a=>a.status),['done']);
   const everything=JSON.stringify([list,one]);assert.ok(!everything.includes('grantId'));
   assert.equal((await fetch(base+'/api/sorties/0000',{headers})).status,404);
   assert.equal((await fetch(base+'/api/sorties?limit=99',{headers})).status,400);assert.equal((await fetch(base+'/api/sorties?x=1',{headers})).status,400);
   assert.equal((await fetch(base+'/api/sorties')).status,401);
  });
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('the service serves /dashboard from its own index.html, and every other route from the app',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nerv-web-'));mkdirSync(join(dir,'dashboard'));
 writeFileSync(join(dir,'index.html'),'<nerv-app></nerv-app>');writeFileSync(join(dir,'dashboard','index.html'),'<title>dash</title>');writeFileSync(join(dir,'dashboard','live.js'),'//');
 const store=new Store(':memory:');
 try{await serve(store,dir,async base=>{
  for(const p of ['/dashboard','/dashboard/'])assert.match(await (await fetch(base+p)).text(),/<title>dash/);
  assert.match((await fetch(base+'/dashboard/live.js')).headers.get('content-type')!,/javascript/);
  assert.match(await (await fetch(base+'/reminders')).text(),/nerv-app/);
 });}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('the shipped dashboard loads no remote script or font and has no inline script, so it runs under the service CSP',()=>{
 const html=readFileSync('web/public/dashboard/index.html','utf8');
 assert.doesNotMatch(html,/<script>(?!<\/script>)/);assert.doesNotMatch(html,/https?:\/\/(?!127\.0\.0\.1)[^"' ]+\.(js|css)|fonts\.googleapis|cdn\./);
 assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]),['dashboard.js','live.js']);
 assert.doesNotMatch(readFileSync('web/public/dashboard/dashboard.js','utf8'),/\bd3\./);
});
test('the dashboard Spear (admin, through the scheduler process) stands down a waiting card, closes the sortie and stops a resume',async()=>{
 const {Runtime}=await import('../src/runtime.ts');
 const dir=mkdtempSync(join(tmpdir(),'nerv-spear-'));const path=join(dir,'nerv.sqlite');
 writeFileSync(join(dir,'scrolls.json'),JSON.stringify({blue:['reminders.cancel']}),{mode:0o600});
 const runtime=new Runtime(path,undefined,dir);const token='f'.repeat(32);const server=makeServer(runtime,token);
 try{
  await runtime.ready();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const act=await runtime.act({request:'Cancel it',tool:'reminders.cancel',args:{id:'x'}});assert.equal(act.outcome,'approval');
  const spear=(id:string,headers:Record<string,string>={authorization:'Bearer '+token})=>fetch(base+`/api/sorties/${id}/spear`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({reason:'stop'})});
  assert.equal((await spear(act.sortieId,{})).status,401);
  const r=await (await spear(act.sortieId)).json() as {revoked:number;stoodDown:number;happened:unknown[]};
  assert.deepEqual(r,{revoked:0,stoodDown:1,happened:[]});
  assert.equal((await runtime.approvals()).length,0);assert.equal((await runtime.sortie(act.sortieId))!.status,'revoked');
  assert.equal((await runtime.decide(act.approvalId!,'approve','api')).decision,'revoked','a stood-down card can no longer be approved');
  assert.equal((await spear('00000000-0000-0000-0000-000000000000')).status,404);
 }finally{await new Promise<void>(done=>server.close(()=>done()));await runtime.close();rmSync(dir,{recursive:true,force:true});}
});
test('the Lilith API (admin, through the scheduler process): add, edit, share, history and forget as the owner',async()=>{
 const {Runtime}=await import('../src/runtime.ts');
 const dir=mkdtempSync(join(tmpdir(),'nerv-lilith-api-'));const runtime=new Runtime(join(dir,'nerv.sqlite'),undefined,dir);const token='g'.repeat(32);const server=makeServer(runtime,token);
 try{
  await runtime.ready();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/memory`;
  const call=(path:string,method='GET',body?:object,auth=true)=>fetch(base+path,{method,headers:{...(auth?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await call('',undefined,undefined,false)).status,401);
  const added=await (await call('','POST',{text:'I drink coffee at 8'})).json() as {id:string;source:string;shareable:boolean};assert.equal(added.source,'owner');assert.equal(added.shareable,false,'every fact starts local-only');
  assert.equal((await call('','POST',{text:''})).status,400);assert.equal((await call('','POST',{text:'x',extra:1})).status,400);
  assert.equal(((await (await call('/'+added.id,'PUT',{text:'I drink tea at 8'})).json()) as {text:string}).text,'I drink tea at 8');
  assert.equal(((await (await call('/'+added.id+'/share','POST',{shareable:true})).json()) as {shareable:boolean}).shareable,true);
  assert.equal((await call('/'+added.id+'/share','POST',{shareable:'yes'})).status,400);
  assert.deepEqual(((await (await call('/'+added.id+'/history')).json()) as {kind:string;source:string}[]).map(h=>[h.kind,h.source]),[['created','owner'],['edited','owner'],['shared','owner']]);
  assert.equal((await call('/'+added.id+'/forget','POST',{})).status,200);assert.deepEqual(await (await call('')).json(),[]);
  assert.equal((await call('/'+added.id+'/forget','POST',{})).status,404);assert.equal((await call('/'+added.id,'PUT',{text:'again'})).status,404);
  assert.deepEqual(await (await call('/episodes')).json(),[]);
 }finally{await new Promise<void>(done=>server.close(()=>done()));await runtime.close();rmSync(dir,{recursive:true,force:true});}
});
