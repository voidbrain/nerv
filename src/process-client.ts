import { fork,type ChildProcess } from 'node:child_process';
/**
 * Node flags for every NERV process: trust the operating system's certificates as well as Node's own, so HTTPS works
 * behind TLS-inspecting networks (company laptops). Kept equal to package.json "start" and the service units by test.
 */
export const NODE_FLAGS=['--use-system-ca'] as const;
import { randomUUID } from 'node:crypto';
import { MAX_FRAME_BYTES,validateParams,authorize,type Method,type Principal,RpcFault } from './rpc.ts';
export class ProcessClient {
 readonly child:ChildProcess;
 readonly role:'nervous'|'brain';
 private timeoutMs:number;
 private pending=new Map<string,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
 private closed=false;
 constructor(entry:URL,args:string[],role:'nervous'|'brain',timeoutMs=5000) {
  this.role=role;this.timeoutMs=timeoutMs;
  // Explicit small environment: no provider/API/root token passed to children. Same-user process isolation is NOT a sandbox.
  this.child=fork(entry,args,{stdio:['ignore','ignore','inherit','ipc'],env:{PATH:process.env.PATH ?? '',LANG:process.env.LANG ?? 'C.UTF-8'},execArgv:[...NODE_FLAGS]});
  this.child.on('message',(value:unknown)=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return;
   const reply=value as Record<string,unknown>;if(reply.jsonrpc!=='2.0'||typeof reply.id!=='string')return;
   const pending=this.pending.get(reply.id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(reply.id);
   if('error'in reply){const e=reply.error as {code?:number;message?:string};pending.reject(new RpcFault(e?.code ?? -32603,e?.message ?? 'Child error.'));}else if('result'in reply)pending.resolve(reply.result);else pending.reject(new Error('Invalid child response.'));
  });
  const fail=()=>{this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(`${role} process unavailable.`));}this.pending.clear();};
  this.child.once('exit',fail);this.child.once('error',fail);
 }
 async call(method:Method,params:Record<string,unknown>={},timeoutMs=this.timeoutMs):Promise<unknown> {
  authorize('coordinator',this.role,method);validateParams(method,params);
  if(this.closed||!this.child.connected)throw new Error(`${this.role} process unavailable.`);
  if(this.pending.size>=32)throw new RpcFault(-32004,'Process queue is full.');
  const id=randomUUID(),request={jsonrpc:'2.0',id,method,params};
  if(Buffer.byteLength(JSON.stringify(request))>MAX_FRAME_BYTES)throw new RpcFault(-32600,'Frame too large.');
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new RpcFault(-32001,'Request timed out; outcome may be unknown.'));},timeoutMs);
   this.pending.set(id,{resolve,reject,timer});
   this.child.send(request,error=>{if(error){const p=this.pending.get(id);if(p){clearTimeout(p.timer);this.pending.delete(id);p.reject(error);}}});
  });
 }
 async close():Promise<void> {
  if(this.child.exitCode!==null||this.child.signalCode!==null)return;
  await new Promise<void>(resolve=>{const timer=setTimeout(()=>this.child.kill('SIGKILL'),2000);this.child.once('exit',()=>{clearTimeout(timer);resolve();});this.child.kill('SIGTERM');});
 }
}
