import {connect} from 'node:net';
import {dispatchRpc,MAX_FRAME_BYTES,READY,RpcFault} from './rpc.ts';
import {readConfig,readModelKey} from './config.ts';
import {complete,describe,forRole,ModelError,MODEL_TIMEOUT_MS,selectRoute,type Ask,type Models,type Reply} from './model.ts';
import {RouteWatch,describeChange,type RouteChange} from './route-health.ts';
import {casperAsk,parseCasper,type CasperInput} from './casper.ts';
import {consultantAsk,parseConsult,misatoAsk,parseAdvice,parsePlan,remoteToolDoc,type RemoteOffer,type Recalled,type Step,type Turn} from './misato.ts';
import {toolDocs} from './executors.ts';
import {digestAsk,factLimit,parseDigest,type Exchange} from './instrumentality.ts';
// Execution boundary: model routes, the Casper seat and Misato's planning step. It plans and reviews; it never executes a tool.
// The data home arrives as argv; the cloud key is read here from its private file, never passed in env or argv.
const home=process.argv[2];
let models:Models={};let key:string|undefined;let timeZone='Europe/Rome';let language:'it'|'en'='en';let configError:string|undefined;let loaded=false;
/** Reads the model settings and the cloud key. A failed reload keeps the settings that last worked, so a typo never takes the brain down. */
function load():{error?:string;kept?:boolean} {
 if(!home)return {};
 try{const config=readConfig(home);const nextKey=readModelKey(home);models=config.models;timeZone=config.timeZone;language=config.language;key=nextKey;configError=undefined;loaded=true;return {};}
 catch(e){const error=e instanceof Error?e.message:'Invalid model configuration.';if(!loaded)configError=error;return {error,kept:loaded};}
}
// Dummy Plug (F-030): each route's state from real calls and a probe of the local route; changes go to the service log.
const watch=new RouteWatch();
const note=(c:RouteChange|undefined)=>{const line=c&&describeChange(c);if(line)console.error(line);};
const configured=()=>watch.configure({local:!!models.local,cloud:!!models.cloud?.enabled&&!!key}).forEach(note);
/** complete() with the outcome recorded against the route it used; a configuration error (no route) is not an outage. */
async function run(ask:Ask,m:Models):Promise<Reply> {
 let route;try{route=selectRoute(ask,m,!!key);}catch{return complete(ask,m,key,{timeoutMs:MODEL_TIMEOUT_MS-5000});}
 try{const reply=await complete(ask,m,key,{timeoutMs:MODEL_TIMEOUT_MS-5000});note(watch.record(route,true));return reply;}
 catch(e){if(e instanceof ModelError)note(watch.record(route,false,e.message));throw e;}
}
/** A cheap reachability check of the local route: a TCP connection opened and closed, no request and no model call.
 A reachable server that answers badly is caught by the next real call. */
function probe():Promise<void> {
 const local=models.local;if(!local)return Promise.resolve();
 const url=new URL(local.baseUrl);const port=Number(url.port || (url.protocol==='https:'?443:80));
 return new Promise(done=>{
  const socket=connect({host:url.hostname.replace(/^\[|\]$/g,''),port});let settled=false;const end=(ok:boolean,error?:string)=>{if(settled)return;settled=true;socket.destroy();note(watch.record('local',ok,error));done();};
  socket.setTimeout(3000,()=>end(false,'Local route (S²) timed out.'));socket.once('connect',()=>end(true));socket.once('error',()=>end(false,'Local route (S²) unreachable.'));
 });
}
load();configured();void probe();setInterval(()=>{void probe();},60_000).unref();
process.on('message',(value:unknown)=>{
 if(Buffer.byteLength(JSON.stringify(value))>MAX_FRAME_BYTES)return;
 void dispatchRpc(value,async(method,params)=>{
  if(method==='runtime.ping')return {role:'brain',pid:process.pid,models:configError?{error:configError}:describe(models,!!key),routes:watch.snapshot(),agentLoop:'not implemented'};
  if(method==='models.reload'){const result=load();configured();void probe();return {...result,models:configError?{error:configError}:describe(models,!!key)};}
  if(method==='model.complete'){
   if(configError)throw new RpcFault(-32010,configError);
   try{return await run(params as unknown as Ask,models);}
   catch(e){throw new RpcFault(-32010,e instanceof ModelError?e.message:'Model route failed.');}
  }
  if(method==='misato.step'){
   // One planning turn. The route is the owner's choice for Misato; without one, local when configured.
   if(configError)return {error:configError};
   const route=models.roles?.misato?.route ?? (models.local?'local':models.cloud?.enabled?'cloud':undefined);
   if(!route)return {error:'No model route for Misato: add models.local (or enable models.cloud) in config.json, then run nerv reload. See docs/INSTALL.md, section \"Model routes\".'};
   const remote=Array.isArray(params.remote)?params.remote as RemoteOffer[]:[];
   const ask=misatoAsk({request:params.request as string,history:params.history as Step[],tools:remote.length?[...toolDocs,remoteToolDoc(remote)]:toolDocs,now:new Date().toISOString(),timeZone,...(params.context?{context:params.context as Turn[]}:{}),...(params.memory?{memory:params.memory as Recalled[]}:{}),...(typeof params.advice==='string'?{advice:params.advice}:{}),...(params.language==='it'||params.language==='en'?{language:params.language}:{})},route);
   try{const reply=await run(ask,forRole(models,'misato'));const plan=parsePlan(reply.text);return plan?{plan,model:reply.model}:{invalid:true,model:reply.model};}
   catch(e){return {error:e instanceof ModelError?e.message:'Model route failed.'};}
  }
  if(method==='consultant.advise'){
   // F-025: advice before Misato plans, on the consultant's local model; none when no consultant is set.
   // F-045: a specialist pilot chosen by the coordinator advises on its own local model; otherwise the generic pilot.
   const pilot=params.pilot as {name:string;domain:string;model:string}|undefined;
   const pick=models.roles?.consultant;if(configError||!models.local||(!pilot&&!pick))return {advice:null};
   const on=pilot?{...models,local:{...models.local,model:pilot.model}}:forRole(models,'consultant');
   try{const reply=await run(consultantAsk(params.request as string,(params.context as Turn[]|undefined) ?? [],pilot,(params.bases as {id:string;name:string}[]|undefined) ?? []),on);if(pilot){const advice=parseAdvice(reply.text);return advice?{advice,model:reply.model}:{advice:null};}
    const c=parseConsult(reply.text);return {advice:c.advice ?? null,...(c.advice?{model:reply.model}:{}),...(c.domain?{domain:c.domain}:{})};}
   catch(e){return {advice:null,error:e instanceof ModelError?e.message:'Consultant failed.'};}
  }
  if(method==='instrumentality.digest'){
   // Same route and model as Misato: the digest reads the owner's own conversations.
   if(configError)return {error:configError};
   const route=models.roles?.misato?.route ?? (models.local?'local':models.cloud?.enabled?'cloud':undefined);if(!route)return {error:'No model route for Instrumentality (it uses Misato\'s).'};
   try{const reply=await run(digestAsk(params.exchanges as Exchange[],language,route),forRole(models,'misato'));const digest=parseDigest(reply.text,factLimit((params.exchanges as Exchange[]).length));return digest?{digest}:{error:'The digest reply was not readable.'};}
   catch(e){return {error:e instanceof ModelError?e.message:'Model route failed.'};}
  }
  if(method==='casper.verdict'){
   // No verdict is a valid answer: the gate then asks the owner. The reason says why, for the approval card.
   if(configError)return {verdict:null,error:configError};
   try{const reply=await run(casperAsk(params as unknown as CasperInput),forRole(models,'casper'));const verdict=parseCasper(reply.text);return verdict?{verdict}:{verdict:null,error:'Casper reply was not a readable verdict.'};}
   catch(e){return {verdict:null,error:e instanceof ModelError?e.message:'Model route failed.'};}
  }
  throw new RpcFault(-32601,'Method not found.');
 }).then(reply=>{if(reply&&process.connected)process.send?.(reply);});
});
function stop(){if(process.connected)process.disconnect();}
process.on('disconnect',()=>{process.exitCode=0;});process.once('SIGTERM',stop);process.once('SIGINT',stop);
process.send?.(READY);
