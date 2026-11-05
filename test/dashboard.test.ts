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
test('the dashboard API (admin, through the scheduler process): search sorties by title, a why per sortie, edit and cancel a reminder',async()=>{
 const {Runtime}=await import('../src/runtime.ts');
 const dir=mkdtempSync(join(tmpdir(),'nerv-practical-'));writeFileSync(join(dir,'scrolls.json'),JSON.stringify({blue:['reminders.cancel']}),{mode:0o600});
 const runtime=new Runtime(join(dir,'nerv.sqlite'),undefined,dir);const token='h'.repeat(32);const server=makeServer(runtime,token);
 try{
  await runtime.ready();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  const call=(path:string,method='GET',body?:object,auth=true)=>fetch(base+path,{method,headers:{...(auth?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const added=await runtime.act({request:'Remind me to call Ada',tool:'reminders.add',args:{title:'Call Ada',due:'2031-01-01T09:00:00Z'}});
  const waiting=await runtime.act({request:'Cancel 100%_ of it',tool:'reminders.cancel',args:{id:'x'}});assert.equal(waiting.outcome,'approval');
  const all=await (await call('/sorties')).json() as {id:string;why:string}[];
  assert.match(all.find(s=>s.id===waiting.sortieId)!.why,/^Waits for you to approve reminders\.cancel: /);
  assert.match(all.find(s=>s.id===added.sortieId)!.why,/reminders\.add/);
  const found=async(q:string)=>((await (await call('/sorties?q='+encodeURIComponent(q))).json()) as {id:string}[]).map(s=>s.id);
  assert.deepEqual(await found('ADA'),[added.sortieId],'case-insensitive');assert.deepEqual(await found('100%_'),[waiting.sortieId]);assert.deepEqual(await found('%'),[waiting.sortieId],'% and _ are literal');
  assert.deepEqual(await found('nothing like it'),[]);assert.equal((await found('')).length,2,'an empty search is no filter');assert.equal((await call('/sorties?q='+'x'.repeat(201))).status,400);
  const reminder=(await runtime.list())[0]!;
  const edited=await (await call('/reminders/'+reminder.id,'PATCH',{title:'Call Ada back',due:'2031-01-02T10:30:00+01:00'})).json() as {title:string;due:string};
  assert.deepEqual([edited.title,edited.due],['Call Ada back','2031-01-02T09:30:00.000Z']);
  assert.equal((await runtime.list())[0]!.title,'Call Ada back','the scheduler stored the edit');
  assert.equal((await call('/reminders/'+reminder.id,'PATCH',{due:'2001-01-01T00:00:00Z'})).status,400,'a past time is refused');
  assert.equal((await call('/reminders/'+reminder.id,'PATCH',{})).status,400);assert.equal((await call('/reminders/'+reminder.id,'PATCH',{title:'x',id:'y'})).status,400);
  assert.equal((await call('/reminders/'+reminder.id,'PATCH',{title:'x'},false)).status,401);
  assert.equal((await call('/reminders/'+reminder.id,'DELETE')).status,200);
  assert.equal((await call('/reminders/'+reminder.id,'PATCH',{title:'too late'})).status,404,'a cancelled reminder cannot be edited');
 }finally{await new Promise<void>(done=>server.close(()=>done()));await runtime.close();rmSync(dir,{recursive:true,force:true});}
});
test('sortie times carry their day when not today, in browser local time; live mode suggests only what a live base answers (B-002, B-005)',async()=>{
 const {readFileSync}=await import('node:fs');const src=readFileSync('web/public/dashboard/dashboard.js','utf8');
 const fn=(name:string)=>new RegExp(`^function ${name}\\(.*\\}$`,'m').exec(src)![0];
 const dayTime=new Function(`${fn('hhmm')}\n${fn('dayTime')}\nreturn dayTime;`)() as (t:number,now:number)=>string;
 const now=new Date(2026,10,5,15,30).getTime(),at=(y:number,m:number,d:number,h:number,mi:number)=>new Date(y,m,d,h,mi).getTime();
 assert.equal(dayTime(at(2026,10,5,9,7),now),'09:07');
 assert.equal(dayTime(at(2026,10,4,23,50),now),'yesterday 23:50');
 assert.equal(dayTime(at(2026,10,3,14,5),now),'3 Nov 14:05');
 assert.equal(dayTime(at(2025,11,31,8,0),now),'31 Dec 2025 08:00');
 assert.equal(dayTime(at(2026,0,1,0,10),at(2026,0,1,8,0)),'00:10','midnight is still today');
 assert.equal(dayTime(at(2025,11,31,22,0),at(2026,0,1,8,0)),'yesterday 22:00','yesterday across a year');
 const live=readFileSync('web/public/dashboard/live.js','utf8');const hint=/const LIVE_HINT = "([^"]+)"/.exec(live)![1]!;
 assert.match(hint,/why S-1A2B\?/);assert.doesNotMatch(hint,/\bstatus\b|AP-|spear/i,'no demo-only command in live mode');
 assert.match(live,/document\.getElementById\("chat-in"\)\.placeholder = LIVE_HINT/);
});
test('every theme, mode and colour reaches WCAG AA where text sits; Eva · Dark · Orange is the original EVA Full and the stylesheet default; old choices map to the nearest (F-047)',async()=>{
 const {readFileSync}=await import('node:fs');const src=readFileSync('web/public/dashboard/dashboard.js','utf8');const html=readFileSync('web/public/dashboard/index.html','utf8');
 const block=/\/\* palette:start[\s\S]*?\*\/([\s\S]*?)\/\* palette:end \*\//.exec(src)![1]!;
 const {palette,migrateTheme,ACCENTS}=new Function(`${block}\nreturn {palette,migrateTheme,ACCENTS};`)() as {palette:(t:string,m:string,a:string)=>Record<string,string>;migrateTheme:(n:string)=>string[]|undefined;ACCENTS:Record<string,unknown>};
 const lum=(hex:string)=>{const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*c[0]!+0.7152*c[1]!+0.0722*c[2]!;};
 const ratio=(a:string,b:string)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x!+0.05)/(y!+0.05);};
 const fails:string[]=[];
 for(const theme of ['eva','simple'])for(const mode of ['dark','light'])for(const accent of Object.keys(ACCENTS)){
  const p=palette(theme,mode,accent);const at=`${theme}·${mode}·${accent}`;
  const need=(fg:string,bg:string,min=4.5)=>{const r=ratio(p[fg]!,p[bg]!);if(r<min)fails.push(`${at}: ${fg} on ${bg} ${r.toFixed(2)}`);};
  for(const fg of ['text','muted','accent','ok','warn','danger','info','green','orange','blue','kanji','title'])for(const bg of ['bg','panel','panel2'])need(fg,bg);
  if(p['hdr-bg']==='transparent')need('hdr-fg','panel');else need('hdr-fg','hdr-bg');
  need('brand-fg','brand-bg');need('brand-fg','accent');need('on-danger','danger');
  for(const c of ['eva00','eva01','eva02','eva03'])need(c,'panel2');
 }
 assert.deepEqual(fails,[],'every pair a text or the focus ring sits on');
 const root=Object.fromEntries([.../:root \{([\s\S]*?)\n\}/.exec(html)![1]!.matchAll(/--([a-z0-9-]+):([^;]+);/g)].map(m=>[m[1],m[2]!.trim()]));
 for(const [k,v] of Object.entries(palette('eva','dark','orange')))assert.equal(root[k]?.replace(/\s/g,''),v.replace(/\s/g,''),`:root --${k} is Eva · Dark · Orange`);
 assert.deepEqual(palette('eva','dark','orange').text,'#ffaa66','the original EVA Full text colour');
 assert.deepEqual(migrateTheme('eva-full'),['eva','dark','orange']);assert.deepEqual(migrateTheme('terminal'),['simple','dark','green']);assert.deepEqual(migrateTheme('light'),['simple','light','blue']);assert.equal(migrateTheme('eva'),undefined);
 for(const id of ['theme','mode','accent'])assert.match(html,new RegExp(`<label class="small muted" for="${id}">[A-Z]+</label>\\s*<select id="${id}">`),`${id} has its label`);
 assert.doesNotMatch(html,/body\.theme-(eva-full|eva-basic|light|terminal)\b/,'no old theme classes left');
 assert.doesNotMatch(html.slice(html.indexOf('* { box-sizing')),/rgba\(255,102,0/,'no fixed orange outside the default: glows follow the colour');
});
test('on wide screens the page itself has nothing to scroll: the body is pinned to the window, only the columns scroll (B-014)',async()=>{
 const {readFileSync}=await import('node:fs');const html=readFileSync('web/public/dashboard/index.html','utf8');
 const wide=/@media \(min-width:1201px\) \{([\s\S]*?)\n\}/.exec(html)![1]!;
 assert.match(wide,/html \{ height:100%; overflow:hidden; \} body \{ position:fixed; inset:0; overflow:clip; \}/);
 assert.doesNotMatch(wide,/html,body \{ height:100%; \} body \{ overflow:hidden; \}/,'overflow hidden alone let the page stay scrolled, header cut off');
});
test('the CRT effect: the original static scanlines, darker borders, a slight page flicker, two thin dark lines passing now and then; motion off when reduced (F-053)',async()=>{
 const {readFileSync}=await import('node:fs');const html=readFileSync('web/public/dashboard/index.html','utf8');
 const after=/body\.theme-eva\.crt-on::after \{([^\n]*)\}/.exec(html)![1]!;
 assert.match(after,/background:linear-gradient\(rgba\(0,0,0,0\) 50%,rgba\(0,0,0,\.22\) 50%\); background-size:100% 4px;/,'the owner\'s scanlines, unchanged');
 assert.doesNotMatch(after,/animation|radial-gradient/,'static');const edge=/box-shadow:inset 0 0 (\d+)px (\d+)px rgba\(0,0,0,([.0-9]+)\)/.exec(after)!;assert.ok(Number(edge[1])>=60&&Number(edge[3])>=0.8,'edges strong enough to see on dark');
 const a=/@keyframes crt-line-a \{[^\n]*\}/.exec(html)![0],b=/@keyframes crt-line-b \{[^\n]*\}/.exec(html)![0];assert.ok(a&&b,'two lines');
 assert.match(html,/animation:crt-line-a 17s linear infinite/);assert.match(html,/animation:crt-line-b 29s linear -11s infinite/,'different cycles, offset: irregular together');
 for(const o of /@keyframes crt-flicker \{([^\n]*)\}/.exec(html)![1]!.matchAll(/opacity:([.0-9]+)/g))assert.ok(Number(o[1])>=0.9,'a slight flicker, never a flash');
 assert.match(html,/@media \(prefers-reduced-motion:reduce\) \{ body\.theme-eva\.crt-on \.wrap, body\.theme-eva\.crt-on::before, body\.theme-eva\.crt-on \.wrap::after \{ animation:none; \}/);
 // Two boxes (owner, 2026-11-05): pilots are the Marduk Institute, skills are Kaji's watermelons.
 assert.match(html,/<span data-l="melons">Marduk Institute · Pilots<\/span><span class="sub">proto → test → prod<\/span>/);
 assert.match(html,/<span data-l="skills">Kaji's watermelons · skills<\/span>/);assert.match(html,/id="skills"><div class="muted small">Planned · not connected yet\./);
 const js=readFileSync('web/public/dashboard/dashboard.js','utf8');assert.match(js,/skills:"Kaji's watermelons · skills"/);assert.match(js,/skills:"Skills"/);
});
test('the dashboard API lists the pilot roster for the Marduk Institute panel (F-051)',async()=>{
 const {makeServer}=await import('../src/server.ts');
 const roster=[{id:'printer',name:'Print Master',domain:'3D printing',keywords:['filament'],model:'gemma4:12b',stage:'test' as const}];
 const token='p'.repeat(32);const server=makeServer({pilotRoster:()=>roster} as never,token);
 await new Promise<void>(d=>server.listen(0,'127.0.0.1',d));
 try{const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  assert.equal((await fetch(base+'/pilots')).status,401,'admin only');
  assert.deepEqual(await (await fetch(base+'/pilots',{headers:{authorization:'Bearer '+token}})).json(),{pilots:roster});}
 finally{await new Promise<void>(d=>server.close(()=>d()));}
});
test('on start the dashboard shows the real state: only a running sortie is selected by itself, and let go when it ends; a click keeps it (owner, 2026-11-05)',async()=>{
 const {readFileSync}=await import('node:fs');const live=readFileSync('web/public/dashboard/live.js','utf8');const js=readFileSync('web/public/dashboard/dashboard.js','utf8');
 assert.doesNotMatch(live,/state\.selected = state\.sorties\[0\]\.id/,'never the newest sortie by default');
 assert.match(live,/const running = state\.sorties\.find\(x => x\.status === "active"\);/);
 assert.match(live,/state\.selected = running\.id; state\.autoSelected = true;/);assert.match(live,/state\.selected = null; state\.autoSelected = false;/);
 assert.match(js,/state\.selected = t\.dataset\.s; state\.deselected = false; state\.autoSelected = false;/,'a click is the owner\'s choice');
});
test('the route colours: advice that was given is a passed step (green); Misato\'s apartment passed through the owner\'s decision takes the decision colour (owner, 2026-11-05)',async()=>{
 const {readFileSync}=await import('node:fs');const live=readFileSync('web/public/dashboard/live.js','utf8');const js=readFileSync('web/public/dashboard/dashboard.js','utf8');const html=readFileSync('web/public/dashboard/index.html','utf8');
 assert.match(live,/const done = \{ detect:true, intake:true, route:true, consult:consulted\.has\(s\.id\),/,'ADVISE is passed when the consultant advised');
 assert.match(js,/if \(st === "done" && el\.dataset\.n === "apt"\) el\.classList\.add\("owner"\);/);assert.match(js,/el\.classList\.remove\("on", "done", "wait", "skip", "owner"\)/);
 assert.match(html,/\.snode\.done\.owner \{ border-color:var\(--warn\); \}/);assert.match(html,/\.tstep\.done\.owner \{ border-color:var\(--warn\); color:var\(--warn\); \}/,'the Simple theme timeline too');
});
