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
