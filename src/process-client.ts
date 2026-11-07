import { fork,type ChildProcess } from 'node:child_process';
/**
 * Node flags for every NERV process: trust the operating system's certificates as well as Node's own, so HTTPS works
 * behind TLS-inspecting networks (company laptops). Kept equal to package.json "start" and the service units by test.
 */
export const NODE_FLAGS=['--use-system-ca'] as const;
/** How long a caller waits for a child's READY before giving up (nothing is sent before it). */
export const STARTUP_MS=30_000;
export const MAX_CHILD_REQUESTS=32;
import { randomUUID } from 'node:crypto';
import { MAX_FRAME_BYTES,READY,validateParams,authorize,type Method,type Principal,RpcFault } from './rpc.ts';
export class ProcessClient {
 readonly child:ChildProcess;
 readonly role:'nervous'|'brain'|'tools';
 private timeoutMs:number;
 private pending=new Map<string,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
 private closed=false;
 private waiting=0;
 /** Settles once the child says it is ready (READY), or when it exits or fails to start. A call's own timer starts only
     after this, so a slow start-up (a busy machine, the first run after boot) never counts against the call (B-007). */
 private readonly ready:Promise<boolean>;private isReady=false;private readonly startupMs:number;
 constructor(entry:URL,args:string[],role:'nervous'|'brain'|'tools',timeoutMs=5000,startupMs=STARTUP_MS) {
  this.role=role;this.timeoutMs=timeoutMs;this.startupMs=startupMs;
  let settle:(ok:boolean)=>void=()=>{};this.ready=new Promise<boolean>(done=>{settle=done;});
  // Explicit small environment: no provider/API/root token passed to children. Same-user process isolation is NOT a sandbox.
  this.child=fork(entry,args,{stdio:['ignore','ignore','inherit','ipc'],env:{PATH:process.env.PATH ?? '',LANG:process.env.LANG ?? 'C.UTF-8'},execArgv:[...NODE_FLAGS]});
  this.child.on('message',(value:unknown)=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return;
   if((value as {nerv?:unknown}).nerv===READY.nerv){this.isReady=true;settle(true);return;}
   const reply=value as Record<string,unknown>;if(reply.jsonrpc!=='2.0'||typeof reply.id!=='string')return;
   const pending=this.pending.get(reply.id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(reply.id);
   if(Buffer.byteLength(JSON.stringify(reply))>MAX_FRAME_BYTES){pending.reject(new RpcFault(-32005,'Child response exceeds IPC bound.'));return;}
   if('error'in reply){const e=reply.error as {code?:number;message?:string};pending.reject(new RpcFault(e?.code ?? -32603,e?.message ?? 'Child error.'));}else if('result'in reply)pending.resolve(reply.result);else pending.reject(new Error('Invalid child response.'));
  });
  const fail=()=>{this.closed=true;settle(false);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(`${role} process unavailable.`));}this.pending.clear();};
  this.child.once('exit',fail);this.child.once('error',fail);this.child.once('disconnect',fail);
 }
 async call(method:Method,params:Record<string,unknown>={},timeoutMs=this.timeoutMs):Promise<unknown> {
  authorize('coordinator',this.role,method);validateParams(method,params);
  if(this.closed||!this.child.connected)throw new Error(`${this.role} process unavailable.`);
  if(this.waiting+this.pending.size>=MAX_CHILD_REQUESTS)throw new RpcFault(-32004,'Process queue is full.');
  this.waiting++;let sent=false;
  try {
  if(!this.isReady){
   let timer:NodeJS.Timeout|undefined;
   const ok=await Promise.race([this.ready,new Promise<false>(done=>{timer=setTimeout(()=>done(false),this.startupMs);})]);clearTimeout(timer);
   if(!ok)throw new RpcFault(-32006,`${this.role} process not ready; nothing was sent.`);
   if(this.closed||!this.child.connected)throw new Error(`${this.role} process unavailable.`);
  }
  const id=randomUUID(),request={jsonrpc:'2.0',id,method,params};
  if(Buffer.byteLength(JSON.stringify(request))>MAX_FRAME_BYTES)throw new RpcFault(-32600,'Frame too large.');
  return await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{reject(new RpcFault(-32001,`${this.role} ${method} timed out after ${timeoutMs} ms; outcome may be unknown.`));},timeoutMs);
   this.pending.set(id,{resolve,reject,timer});sent=true;this.waiting--;
   this.child.send(request,error=>{if(error){const p=this.pending.get(id);if(p){clearTimeout(p.timer);this.pending.delete(id);p.reject(error);}}});
  });
  }finally{if(!sent)this.waiting--;}
 }
 async close():Promise<void> {
  if(this.child.exitCode!==null||this.child.signalCode!==null)return;
  await new Promise<void>(resolve=>{const timer=setTimeout(()=>this.child.kill('SIGKILL'),2000);this.child.once('exit',()=>{clearTimeout(timer);resolve();});this.child.kill('SIGTERM');});
 }
}
