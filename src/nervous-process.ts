import { MISATO_SOURCE, OWNER_SOURCE, Store } from './store.ts';
import type { Verdict } from './policy.ts';
import { dispatchRpc,MAX_FRAME_BYTES } from './rpc.ts';
import { readScrolls } from './config.ts';
// argv: database path, then the data home whose scrolls.json sets the gate rules (defaults when absent).
const store=new Store(process.argv[2]!,process.argv[3]?readScrolls(process.argv[3]):undefined);
store.tick();store.ledger.expire();
const timer=setInterval(()=>{try{store.tick();store.ledger.expire();}catch{console.error('Nervous scheduler tick failed.');}},250);
process.on('message',(value:unknown)=>{
 if(Buffer.byteLength(JSON.stringify(value))>MAX_FRAME_BYTES){process.exitCode=1;stop();return;}
 void dispatchRpc(value,(method,params)=>{
  switch(method){
   case 'runtime.ping':return {role:'nervous',pid:process.pid};
   case 'runtime.doctor':return store.doctor();
   case 'reminders.list':return store.list();
   case 'reminders.pending':return store.pendingReminders();
   case 'reminders.add':try{return store.add(params.title as string,params.due as string);}catch{throw new Error('Invalid reminder.');}
   case 'reminders.cancel':return store.cancel(params.id as string);
   case 'inbox.list':return store.inbox();
   case 'approvals.pending':return store.approvals(params.limit as number|undefined);
   case 'approvals.decide':return store.decide(params.id as string,params.decision as 'approve'|'reject'|'edit',params.source as string);
   case 'events.page':return store.events(params.sortieId as string,params.after as number|undefined,params.limit as number|undefined);
   case 'sorties.open':return store.ledger.openSortie(params.source==='misato'?MISATO_SOURCE:OWNER_SOURCE,params.title as string,'trusted');
   case 'sorties.finish':{const id=params.sortieId as string;if(params.reply)store.ledger.reply(id,params.reply as string);return store.ledger.close(id,params.status as 'done'|'failed');}
   case 'actions.preview':return store.ledger.preview(params.sortieId as string,params.tool as string);
   case 'actions.act':return store.runAction(params.sortieId as string,{tool:params.tool as string,args:params.args as Record<string,unknown>,stage:params.stage as 'production',...(params.casper?{casper:params.casper as Verdict}:{})});
   case 'inbox.page':return store.inboxPage(params.after as number|undefined,params.limit as number|undefined,params.afterId as string|undefined);
  }
 }).then(reply=>{if(reply&&process.connected){if(Buffer.byteLength(JSON.stringify(reply))>MAX_FRAME_BYTES)process.send?.({jsonrpc:'2.0',id:reply.id,error:{code:-32005,message:'Response exceeds IPC bound; pagination required.'}});else process.send?.(reply);}}).catch(()=>{console.error('Nervous IPC failed.');});
});
let stopped=false;function stop(){if(stopped)return;stopped=true;clearInterval(timer);store.close();if(process.connected)process.disconnect();}
process.on('disconnect',stop);process.once('SIGTERM',stop);process.once('SIGINT',stop);
