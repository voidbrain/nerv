import {dispatchRpc,MAX_FRAME_BYTES,RpcFault} from './rpc.ts';
import {readConfig,readModelKey} from './config.ts';
import {complete,describe,forRole,ModelError,MODEL_TIMEOUT_MS,type Ask,type Models} from './model.ts';
import {casperAsk,parseCasper,type CasperInput} from './casper.ts';
import {misatoAsk,parsePlan,type Step} from './misato.ts';
import {toolDocs} from './executors.ts';
// Execution boundary: model routes, the Casper seat and Misato's planning step. It plans and reviews; it never executes a tool.
// The data home arrives as argv; the cloud key is read here from its private file, never passed in env or argv.
const home=process.argv[2];
let models:Models={};let key:string|undefined;let timeZone='Europe/Rome';let configError:string|undefined;let loaded=false;
/** Reads the model settings and the cloud key. A failed reload keeps the settings that last worked, so a typo never takes the brain down. */
function load():{error?:string;kept?:boolean} {
 if(!home)return {};
 try{const config=readConfig(home);const nextKey=readModelKey(home);models=config.models;timeZone=config.timeZone;key=nextKey;configError=undefined;loaded=true;return {};}
 catch(e){const error=e instanceof Error?e.message:'Invalid model configuration.';if(!loaded)configError=error;return {error,kept:loaded};}
}
load();
process.on('message',(value:unknown)=>{
 if(Buffer.byteLength(JSON.stringify(value))>MAX_FRAME_BYTES)return;
 void dispatchRpc(value,async(method,params)=>{
  if(method==='runtime.ping')return {role:'brain',pid:process.pid,models:configError?{error:configError}:describe(models,!!key),agentLoop:'not implemented'};
  if(method==='models.reload'){const result=load();return {...result,models:configError?{error:configError}:describe(models,!!key)};}
  if(method==='model.complete'){
   if(configError)throw new RpcFault(-32010,configError);
   try{return await complete(params as unknown as Ask,models,key,{timeoutMs:MODEL_TIMEOUT_MS-5000});}
   catch(e){throw new RpcFault(-32010,e instanceof ModelError?e.message:'Model route failed.');}
  }
  if(method==='misato.step'){
   // One planning turn. The route is the owner's choice for Misato; without one, local when configured.
   if(configError)return {error:configError};
   const route=models.roles?.misato?.route ?? (models.local?'local':'cloud');
   const ask=misatoAsk({request:params.request as string,history:params.history as Step[],tools:toolDocs,now:new Date().toISOString(),timeZone},route);
   try{const reply=await complete(ask,forRole(models,'misato'),key,{timeoutMs:MODEL_TIMEOUT_MS-5000});const plan=parsePlan(reply.text);return plan?{plan,model:reply.model}:{invalid:true,model:reply.model};}
   catch(e){return {error:e instanceof ModelError?e.message:'Model route failed.'};}
  }
  if(method==='casper.verdict'){
   // No verdict is a valid answer: the gate then asks the owner. The reason says why, for the approval card.
   if(configError)return {verdict:null,error:configError};
   try{const reply=await complete(casperAsk(params as unknown as CasperInput),forRole(models,'casper'),key,{timeoutMs:MODEL_TIMEOUT_MS-5000});const verdict=parseCasper(reply.text);return verdict?{verdict}:{verdict:null,error:'Casper reply was not a readable verdict.'};}
   catch(e){return {verdict:null,error:e instanceof ModelError?e.message:'Model route failed.'};}
  }
  throw new RpcFault(-32601,'Method not found.');
 }).then(reply=>{if(reply&&process.connected)process.send?.(reply);});
});
function stop(){if(process.connected)process.disconnect();}
process.on('disconnect',()=>{process.exitCode=0;});process.once('SIGTERM',stop);process.once('SIGINT',stop);
