import {randomUUID,type KeyObject} from 'node:crypto';
import type {Server,IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import {WebSocket,WebSocketServer} from 'ws';
import {signedHeaders,verifySigned,Nonces} from './kaji-auth.ts';
import type {RegistryPort} from './kaji-link.ts';
import {validateParams,MAX_FRAME_BYTES} from './rpc.ts';
import {WORKER_LEASE_MS,WORKER_RESULT_BYTES,type WorkerItem,type WorkerContext} from './worker-jobs.ts';
export const WORKER_PROTOCOL_VERSION=1;
const PATH='/kaji/worker',MAX_CONNECTIONS=16,MAX_PENDING=4;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
export interface WorkerAdapter {
 open(owner:string,session:string):Promise<{epoch:number;cursor:number}>;
 close(owner:string,session:string):Promise<void>;
 run(owner:string,item:WorkerItem,context:WorkerContext):Promise<unknown>;
}
interface Settings {id:string;key:KeyObject;registry:RegistryPort;adapter:WorkerAdapter;address:(value:string)=>string;log?:(text:string)=>void;heartbeatMs?:number;requestMs?:number;reconnectMs?:number}
interface Pending {resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}
/** Every frame is signed for its fresh session and monotonically increasing direction counter. */
class Peer {
 readonly ws:WebSocket;readonly link:WorkerLink;readonly remote:string;readonly role:'coordinator'|'worker';session:string;
 ready=false;epoch=0;cursor=0;private sent=0;private received=0;private active=0;private incoming:Promise<void>=Promise.resolve();private ended=false;private pending=new Map<string,Pending>();private heartbeat?:NodeJS.Timeout;private helloTimer:NodeJS.Timeout;
 constructor(link:WorkerLink,ws:WebSocket,remote:string,role:'coordinator'|'worker',session=''){
  this.link=link;this.ws=ws;this.remote=remote;this.role=role;this.session=session;
  this.helloTimer=setTimeout(()=>this.end(),5000);ws.on('error',()=>this.end());ws.once('close',()=>this.end());
  ws.on('message',(data,binary)=>{
   const bytes=Buffer.isBuffer(data)?data:Array.isArray(data)?Buffer.concat(data):Buffer.from(data);
   if(binary||this.active>=MAX_PENDING||bytes.length>MAX_FRAME_BYTES){this.end();return;}this.active++;
   this.incoming=this.incoming.then(()=>this.receive(bytes.toString())).catch(()=>this.end());
  });
 }
 private async receive(raw:string):Promise<void>{
  let handling=false;
  try{
   const envelope:unknown=JSON.parse(raw);if(!object(envelope)||!keys(envelope,['session','body','headers'])||typeof envelope.session!=='string'||!uuid.test(envelope.session)||typeof envelope.body!=='string'||Buffer.byteLength(envelope.body)>WORKER_RESULT_BYTES+4096||!object(envelope.headers))throw Error('Invalid worker envelope.');
   if(this.session&&this.session!==envelope.session)throw Error('Worker session differs.');
   const payload:unknown=JSON.parse(envelope.body);if(!object(payload)||!keys(payload,['sequence','rpc'])||payload.sequence!==this.received+1||!object(payload.rpc))throw Error('Worker frame sequence differs.');
   const rpc=payload.rpc;if(rpc.jsonrpc!=='2.0'||typeof rpc.id!=='string'||!uuid.test(rpc.id))throw Error('Invalid worker RPC.');
   const request=typeof rpc.method==='string';
   const bases=await this.link.settings.registry.bases(),main=await this.link.settings.registry.main?.();
   if(main!==(this.role==='worker'?this.remote:this.link.settings.id)||!bases.some(b=>b.baseId===this.link.settings.id&&b.status==='enrolled'))throw Error('Worker authority changed.');
   // Counter/session binding rejects replay; the fresh nonce helper here performs signature/time verification only.
   const from=verifySigned(envelope.headers as Record<string,string>,request?'req':'res','FRAME',PATH+'/'+envelope.session,envelope.body,bases,new Nonces());if(from!==this.remote)throw Error('Unexpected worker identity.');
   this.session=envelope.session;this.received++;
   if(!request){
    if(!keys(rpc,['jsonrpc','id','result','error'])||('result' in rpc)===('error' in rpc))throw Error('Invalid worker response.');const pending=this.pending.get(rpc.id);if(!pending)throw Error('Unknown worker response.');this.pending.delete(rpc.id);clearTimeout(pending.timer);
    if('error' in rpc)pending.reject(Error('Worker RPC refused.'));else pending.resolve(rpc.result);return;
   }
   if(!keys(rpc,['jsonrpc','id','method','params'])||!object(rpc.params))throw Error('Invalid worker request.');
   handling=true;void this.handle(rpc.method as string,rpc.params).then(result=>this.reply(rpc.id as string,result),()=>this.reply(rpc.id as string,undefined,true)).finally(()=>{this.active--;}).catch(()=>this.end());
  }finally{if(!handling)this.active--;}
 }
 private async handle(method:string,params:Record<string,unknown>):Promise<unknown>{
  if(method==='worker.hello'&&this.role==='coordinator'&&!this.ready){
   if(!keys(params,['version','epoch','cursor'])||params.version!==WORKER_PROTOCOL_VERSION||!Number.isSafeInteger(params.epoch)||Number(params.epoch)<1||!Number.isSafeInteger(params.cursor)||Number(params.cursor)<0)throw Error('Unsupported worker protocol.');
   this.epoch=Number(params.epoch);this.cursor=Number(params.cursor);this.ready=true;clearTimeout(this.helloTimer);this.link.accept(this);this.startHeartbeat();
   return {version:WORKER_PROTOCOL_VERSION,session:this.session,epoch:this.epoch,cursor:this.cursor};
  }
  if(!this.ready)throw Error('Worker negotiation required.');
  if(method==='worker.ping'&&keys(params,[])&&Object.keys(params).length===0)return {version:WORKER_PROTOCOL_VERSION};
  if(method==='worker.run'&&this.role==='worker'){
   if(!keys(params,['item','epoch','expires'])||params.epoch!==this.epoch||!object(params.item)||!Number.isSafeInteger(params.item.sequence)||Number(params.item.sequence)<1)throw Error('Invalid worker delivery.');
   const context={session:this.session,epoch:this.epoch,expires:params.expires as number};validateParams('worker.claim',{owner:this.remote,item:params.item,context});
   const result=await this.link.settings.adapter.run(this.remote,params.item as unknown as WorkerItem,context);
   if(!object(result)||Buffer.byteLength(JSON.stringify(result))>WORKER_RESULT_BYTES)throw Error('Invalid worker result.');return result;
  }
  throw Error('Worker communication edge denied.');
 }
 private write(rpc:Record<string,unknown>,request:boolean):void {
  if(this.ended||this.ws.readyState!==WebSocket.OPEN)throw Error('Worker connection closed.');
  const body=JSON.stringify({sequence:this.sent+1,rpc});if(Buffer.byteLength(body)>WORKER_RESULT_BYTES+4096)throw Error('Worker message exceeds its bound.');
  const encoded=JSON.stringify({session:this.session,body,headers:signedHeaders(this.link.settings.id,this.link.settings.key,request?'req':'res','FRAME',PATH+'/'+this.session,body)});
  if(Buffer.byteLength(encoded)>MAX_FRAME_BYTES||this.ws.bufferedAmount+Buffer.byteLength(encoded)>MAX_FRAME_BYTES){this.end();throw Error('Worker transport saturated.');}
  this.sent++;this.ws.send(encoded,e=>{if(e)this.end();});
 }
 private reply(id:string,result?:unknown,failed=false){if(this.ended)return;this.write({jsonrpc:'2.0',id,...(failed?{error:{code:-32003,message:'Worker request refused.'}}:{result:result ?? null})},false);}
 request(method:string,params:Record<string,unknown>,timeoutMs=this.link.requestMs):Promise<unknown>{
  if(this.pending.size>=MAX_PENDING)return Promise.reject(Error('Worker pending request bound reached.'));
  return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>reject(Error('Worker result unknown after timeout.')),timeoutMs);this.pending.set(id,{resolve,reject,timer});
   // Timed-out requests retain admission until a late result or disconnect; timeout does not prove cancellation.
   try{this.write({jsonrpc:'2.0',id,method,params},true);}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
  });
 }
 async negotiate(epoch:number,cursor:number):Promise<void>{
  this.epoch=epoch;this.cursor=cursor;const reply=await this.request('worker.hello',{version:WORKER_PROTOCOL_VERSION,epoch,cursor},5000);
  if(!object(reply)||reply.version!==WORKER_PROTOCOL_VERSION||reply.session!==this.session||reply.epoch!==epoch||reply.cursor!==cursor)throw Error('Worker negotiation failed.');this.ready=true;clearTimeout(this.helloTimer);this.startHeartbeat();
 }
 private startHeartbeat(){this.heartbeat=setInterval(()=>{void this.request('worker.ping',{},Math.min(this.link.heartbeatMs,this.link.requestMs)).catch(()=>this.end());},this.link.heartbeatMs);}
 end(){if(this.ended)return;this.ended=true;this.ready=false;clearTimeout(this.helloTimer);if(this.heartbeat)clearInterval(this.heartbeat);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Worker connection lost; result may be unknown.'));}this.pending.clear();this.ws.terminate();this.link.closed(this);}
}
/** Outbound workers authenticate with their enrolled base keys, never the owner's root/API credential. */
export class WorkerLink {
 readonly settings:Settings;readonly heartbeatMs:number;readonly requestMs:number;private reconnectMs:number;
 private server=new WebSocketServer({noServer:true,maxPayload:MAX_FRAME_BYTES,perMessageDeflate:false});private peers=new Map<string,Peer>();private client?:Peer;private connecting?:Promise<void>;private timer?:NodeJS.Timeout;private stopped=true;private upgrades=0;private nextAttempt=0;private failures=0;private cleanup=new Set<Promise<void>>();
 constructor(settings:Settings){this.settings=settings;this.heartbeatMs=settings.heartbeatMs ?? 30000;this.requestMs=settings.requestMs ?? 10000;this.reconnectMs=settings.reconnectMs ?? 1000;}
 attach(server:Server){server.on('upgrade',(request,socket,head)=>{void this.upgrade(request,socket,head);});}
 private async upgrade(request:IncomingMessage,socket:Duplex,head:Buffer){
  const refuse=(status:number)=>{socket.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\n\r\n`,()=>socket.destroy());};
  if(this.stopped||this.server.clients.size+this.upgrades>=MAX_CONNECTIONS){refuse(503);return;}
  if(request.method!=='GET'||request.url!==PATH||'origin' in request.headers||request.headers.authorization){refuse(401);return;}
  this.upgrades++;const deadline=setTimeout(()=>socket.destroy(),5000);
  try{
   if(await this.settings.registry.main?.()!==this.settings.id)throw Error('Not coordinator.');
   const from=verifySigned(request.headers as Record<string,string>,'req','GET',PATH,'',await this.settings.registry.bases(),this.upgradeNonces);if(from===this.settings.id)throw Error('Self connection.');
   if(this.stopped||socket.destroyed)throw Error('Stopped.');clearTimeout(deadline);this.server.handleUpgrade(request,socket,head,ws=>{new Peer(this,ws,from,'coordinator');});
  }catch{refuse(401);}finally{clearTimeout(deadline);this.upgrades--;}
 }
 private upgradeNonces=new Nonces();
 accept(peer:Peer){const old=this.peers.get(peer.remote);this.peers.set(peer.remote,peer);if(old&&old!==peer)old.end();}
 closed(peer:Peer){
  if(this.peers.get(peer.remote)===peer)this.peers.delete(peer.remote);
  if(this.client===peer){this.client=undefined;this.defer();}
  if(peer.role==='worker'){
   const cleanup=this.settings.adapter.close(peer.remote,peer.session).catch(()=>{this.settings.log?.('Worker session cleanup unavailable.');});this.cleanup.add(cleanup);void cleanup.finally(()=>this.cleanup.delete(cleanup));
  }
 }
 connected(base:string):boolean {return this.peers.get(base)?.ready ?? false;}
 async run(base:string,item:WorkerItem,timeoutMs:number):Promise<unknown>{
  const peer=this.peers.get(base);if(!peer?.ready)throw Error('No outbound worker session.');if(!item.sequence)throw Error('Durable worker stream sequence required.');
  return peer.request('worker.run',{item,epoch:peer.epoch,expires:Date.now()+WORKER_LEASE_MS},timeoutMs);
 }
 start(){if(!this.stopped)return;this.stopped=false;this.timer=setInterval(()=>{void this.connect();},this.reconnectMs);void this.connect();}
 private defer(){this.failures=Math.min(this.failures+1,5);this.nextAttempt=Date.now()+this.reconnectMs*2**this.failures;}
 private connect():Promise<void>{
  if(this.stopped||this.client||Date.now()<this.nextAttempt)return Promise.resolve();if(this.connecting)return this.connecting;
  this.connecting=this.connectOnce().catch(()=>this.defer()).finally(()=>{this.connecting=undefined;});return this.connecting;
 }
 private async connectOnce(){
  const owner=await this.settings.registry.main?.();if(!owner||owner===this.settings.id)return;
  const bases=await this.settings.registry.bases(),target=bases.find(b=>b.baseId===owner&&b.status==='enrolled');if(!target||!bases.some(b=>b.baseId===this.settings.id&&b.status==='enrolled'))return;
  const session=randomUUID(),state=await this.settings.adapter.open(owner,session);let peer:Peer|undefined;
  try{
   if(this.stopped)throw Error('Stopped.');const socket=new WebSocket(this.settings.address(target.address)+PATH,{headers:signedHeaders(this.settings.id,this.settings.key,'req','GET',PATH,''),maxPayload:MAX_FRAME_BYTES,perMessageDeflate:false,handshakeTimeout:5000});
   await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.once('open',()=>{peer=new Peer(this,socket,owner,'worker',session);peer.epoch=state.epoch;this.client=peer;resolve();});});
   if(this.stopped){peer!.end();return;}await peer!.negotiate(state.epoch,state.cursor);this.failures=0;this.nextAttempt=0;
  }catch(e){if(peer)peer.end();else await this.settings.adapter.close(owner,session);throw e;}
 }
 dropIncoming(){for(const ws of this.server.clients)ws.terminate();for(const peer of this.peers.values())peer.end();this.peers.clear();}
 async stop(){this.stopped=true;if(this.timer)clearInterval(this.timer);this.client?.end();this.dropIncoming();await this.connecting;await Promise.allSettled([...this.cleanup]);}
}
