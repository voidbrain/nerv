import type {Server} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import type {StoreApi} from './runtime.ts';
import {handleFrame,authorize,MAX_FRAME_BYTES,RpcFault} from './rpc.ts';
export function attachRpcSocket(server:Server,store:StoreApi,token:string,options:{language?:string;timeZone?:string}) {
 const ws=new WebSocketServer({noServer:true,maxPayload:MAX_FRAME_BYTES,perMessageDeflate:false});
 server.on('upgrade',(request,socket,head)=>{
  const value=Buffer.from(request.headers.authorization ?? ''),expected=Buffer.from('Bearer '+token);
  // Native clients use Authorization headers. Browser ticket pairing is deliberately not implemented yet.
  if(request.url!=='/rpc'||request.headers.origin||value.length!==expected.length||!timingSafeEqual(value,expected)){socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return;}
  ws.handleUpgrade(request,socket,head,client=>ws.emit('connection',client,request));
 });
 ws.on('connection',client=>{
  let active=0;client.on('error',()=>{});
  client.on('message',(data,binary)=>{
   if(binary){client.close(1003,'Text JSON required.');return;}
   if(active>=4){client.close(1013,'Too many pending frames.');return;}
   active++;
   void handleFrame(data.toString(),async(method,params)=>{
    authorize('interface','coordinator',method);
    switch(method){
     case 'runtime.ping':return {role:'coordinator'};
     case 'runtime.doctor':return {...await store.doctor(),language:options.language ?? 'en',timeZone:options.timeZone ?? 'Europe/Rome'};
     case 'reminders.list':{const p=await store.reminderPage(0,50);if(p.next)throw new RpcFault(-32005,'Use reminders.page.');return p.items.sort((a,b)=>a.due.localeCompare(b.due));}
     case 'reminders.page':return store.reminderPage(params.before as number|undefined,params.limit as number|undefined);
     case 'inbox.history':return store.inboxHistory(params.before as number|undefined,params.limit as number|undefined);
     case 'dashboard.history':return store.dashboardHistory(params.since as string);
     case 'reminders.pending':return store.pendingReminders();
     case 'reminders.add':throw new RpcFault(-32003,'Mutations require the REST API; durable RPC idempotency is not implemented yet.');
     case 'reminders.update':throw new RpcFault(-32003,'Mutations require the REST API; durable RPC idempotency is not implemented yet.');
     case 'reminders.cancel':throw new RpcFault(-32003,'Mutations require the REST API; durable RPC idempotency is not implemented yet.');
     case 'inbox.list':{const p=await store.inboxHistory(0,50);if(p.next)throw new RpcFault(-32005,'Use inbox.history.');return p.items;}
     case 'approvals.pending':return store.approvals(params.limit as number|undefined);
     case 'sorties.list':return store.sorties(params.limit as number|undefined,params.before as string|undefined);
     case 'sorties.get':return store.sortie(params.id as string);
     case 'events.page':return store.events(params.sortieId as string,params.after as number|undefined,params.limit as number|undefined);
     case 'inbox.page':return store.inboxPage(params.after as number|undefined,params.limit as number|undefined,params.afterId as string|undefined);
    }
   }).then(reply=>{
    if(reply&&client.readyState===WebSocket.OPEN){const encoded=JSON.stringify(reply);if(Buffer.byteLength(encoded)>MAX_FRAME_BYTES||client.bufferedAmount>MAX_FRAME_BYTES)client.close(1009,'Response too large.');else client.send(encoded);}
   }).catch(()=>client.close(1011,'RPC failed.')).finally(()=>{active--;});
  });
 });
 return ws;
}
