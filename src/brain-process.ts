import {dispatchRpc,MAX_FRAME_BYTES,RpcFault} from './rpc.ts';
import {readConfig,readModelKey} from './config.ts';
import {complete,describe,ModelError,MODEL_TIMEOUT_MS,type Ask,type Models} from './model.ts';
// Execution boundary. Model routes only: no agent loop, browser, shell or tool execution yet.
// The data home arrives as argv; the cloud key is read here from its private file, never passed in env or argv.
const home=process.argv[2];
let models:Models={};let key:string|undefined;let configError:string|undefined;
if(home){try{models=readConfig(home).models;key=readModelKey(home);}catch(e){configError=e instanceof Error?e.message:'Invalid model configuration.';}}
process.on('message',(value:unknown)=>{
 if(Buffer.byteLength(JSON.stringify(value))>MAX_FRAME_BYTES)return;
 void dispatchRpc(value,async(method,params)=>{
  if(method==='runtime.ping')return {role:'brain',pid:process.pid,models:configError?{error:configError}:describe(models,!!key),agentLoop:'not implemented'};
  if(method==='model.complete'){
   if(configError)throw new RpcFault(-32010,configError);
   try{return await complete(params as unknown as Ask,models,key,{timeoutMs:MODEL_TIMEOUT_MS-5000});}
   catch(e){throw new RpcFault(-32010,e instanceof ModelError?e.message:'Model route failed.');}
  }
  throw new RpcFault(-32601,'Method not found.');
 }).then(reply=>{if(reply&&process.connected)process.send?.(reply);});
});
function stop(){if(process.connected)process.disconnect();}
process.on('disconnect',()=>{process.exitCode=0;});process.once('SIGTERM',stop);process.once('SIGINT',stop);
