import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {choosePilot,describePilots,hits,validatePilots,words,type Pilot} from '../src/pilots.ts';
const pilot=(over:Partial<Pilot>&{id:string}):Pilot=>({name:over.id,domain:'things',keywords:['thing'],model:'m',stage:'prototype',...over});
test('a pilot is data: the roster is checked, the generic pilot is implicit and reserved, a parent must exist',()=>{
 const ok=validatePilots([{id:'printer',name:'Print Master',domain:'3D printing',keywords:['3D print','Filament'],model:'gemma4:12b'}]);
 assert.deepEqual(ok,[{id:'printer',name:'Print Master',domain:'3D printing',keywords:['3d print','filament'],model:'gemma4:12b',stage:'prototype'}]);
 for(const [bad,why] of [[[{id:'generic',name:'G',domain:'d',keywords:['x'],model:'m'}],/not "generic"/],[[{id:'a1',name:'A',domain:'d',keywords:[],model:'m'}],/1 to 30 keywords/],
  [[{id:'a1',name:'A',domain:'d',keywords:['x'],model:'m',stage:'live'}],/stage/],[[{id:'a1',name:'A',domain:'d',keywords:['x'],model:'m',parent:'nobody'}],/parent nobody/],
  [[{id:'a1',name:'A',domain:'d',keywords:['x'],model:'m'},{id:'a1',name:'B',domain:'d',keywords:['y'],model:'m'}],/twice/],[[{id:'a1',name:'A',domain:'d',keywords:['x'],model:'m',tools:['x']}],/Invalid pilot:/]] as const)
  assert.throws(()=>validatePilots(bad),why);
 assert.equal(words('Perché la STAMPA 3D?'),'perche la stampa 3d');
});
test('choosing the pilot: keywords as whole words or phrases; a pinned pilot first, then the most matches, then the later stage; retired never',()=>{
 const print=pilot({id:'printer',name:'Print Master',keywords:['3d print','filament','slicer'],stage:'test'});
 const art=pilot({id:'artist',keywords:['image','photo','print'],stage:'production'});
 assert.equal(hits('Which filament for a 3D print?',print),2);assert.equal(hits('a filamentous fungus',print),0,'whole words only');
 assert.equal(choosePilot('Which filament for a 3D print?',[art,print])!.id,'printer','more matches win over a later stage');
 assert.equal(choosePilot('print this photo',[art,print])!.id,'artist');
 assert.equal(choosePilot('print the filament spool label',[{...art,keywords:['print','label']},print])!.id,'artist','two each: the later stage wins');
 assert.deepEqual(choosePilot('print the filament',[{...art,pinned:true},print]),{id:'artist',name:'artist',domain:'things',model:'m',why:'pinned'},'pinned beats more matches');
 assert.equal(choosePilot('Which filament?',[{...print,retired:true}]),undefined,'retired is never chosen');
 assert.equal(choosePilot('Remind me to call Ada',[art,print]),undefined,'nothing fits: the generic pilot advises');
 assert.match(describePilots([print],null),/^generic · Generic pilot · anything no specialist covers · off \(models set consultant MODEL\)\nprinter · Print Master/);
});
/** A fake local model: a pilot or the generic consultant advises (each recorded with the model asked), Misato replies. */
async function fake(){
 const asked:{who:string;model:string;system:string}[]=[];const misato:string[]=[];
 const s=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c).on('end',()=>{const r=JSON.parse(raw) as {model:string;messages:{content:string}[]};const sys=r.messages[0]!.content;let out='{"reply":"ok"}';
  const named=/^You are (.+?), the owner's pilot for/.exec(sys);
  if(named){asked.push({who:named[1]!,model:r.model,system:sys});out=`Advice from ${named[1]}.`;}
  else if(sys.startsWith('You are a consultant')){asked.push({who:'generic',model:r.model,system:sys});out='Generic advice.';}
  else if(sys.startsWith('You are Casper'))out='{"vote":"approve","reason":"Matches.","confidence":0.9}';
  else misato.push(r.messages.at(-1)!.content);
  res.setHeader('content-type','application/json');res.end(JSON.stringify({model:r.model,choices:[{message:{content:out},finish_reason:'stop'}]}));});});
 await new Promise<void>(d=>s.listen(0,'127.0.0.1',d));return {url:`http://127.0.0.1:${(s.address() as {port:number}).port}/v1`,asked,misato,close:()=>new Promise<void>(d=>{s.close(()=>d());s.closeAllConnections();})};
}
test('through every process: the pilot whose keywords fit advises on its own model, named in Misato\'s prompt and the trace; otherwise the generic pilot; a roster change applies at once',{timeout:30000},async()=>{
 const {Runtime}=await import('../src/runtime.ts');const {readConfig,savePilots}=await import('../src/config.ts');
 const f=await fake();const home=mkdtempSync(join(tmpdir(),'nerv-pilots-'));
 writeFileSync(join(home,'config.json'),JSON.stringify({models:{local:{baseUrl:f.url,model:'m'},roles:{misato:{route:'local'},consultant:{model:'advisor'}}}}));
 savePilots(home,[{id:'printer',name:'Print Master',domain:'3D printing',keywords:['filament','3d print'],model:'printer-model',stage:'test'}]);
 assert.equal(readConfig(home).pilots![0]!.name,'Print Master','saved and read back through config.json');
 const r=new Runtime(join(home,'nerv.sqlite'),undefined,home);r.setPilots(()=>readConfig(home).pilots ?? []);
 try{
  await r.ready();
  const one=await r.chat('Which filament for a 3D print of a vase?');
  assert.deepEqual(f.asked.map(a=>[a.who,a.model]),[['Print Master','printer-model']]);assert.match(f.asked[0]!.system,/pilot for 3D printing/);
  assert.equal(JSON.parse(f.misato[0]!).advice,'Advice from Print Master.');
  const consult=(await r.events(one.sortieId)).find(e=>e.kind==='misato.consult')!;
  assert.deepEqual(consult.payload,{advice:'Advice from Print Master.',model:'printer-model',pilot:{id:'printer',name:'Print Master',why:'keywords'}});
  await r.chat('Remind me to call Ada');assert.deepEqual(f.asked.at(-1)!.who,'generic');assert.equal(f.asked.at(-1)!.model,'advisor','no specialist fits: the generic pilot on roles.consultant');
  savePilots(home,[{...readConfig(home).pilots![0]!,retired:true}]);
  await r.chat('Which filament now?');assert.equal(f.asked.at(-1)!.who,'generic','retired by the CLI: the next request already goes to the generic pilot');
  assert.match(readFileSync(join(home,'config.json'),'utf8'),/"retired": true/);
 }finally{await r.close();await f.close();rmSync(home,{recursive:true,force:true});}
});
