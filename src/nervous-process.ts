import { MISATO_SOURCE, OWNER_SOURCE, Store } from './store.ts';
import type { Verdict } from './policy.ts';
import { dispatchRpc,MAX_FRAME_BYTES } from './rpc.ts';
import { readConfig, readScrolls } from './config.ts';
import { Registry, type SignedRecord } from './kaji.ts';
import { factKey } from './memory.ts';
// argv: database path, then the data home whose scrolls.json sets the gate rules (defaults when absent).
const store=new Store(process.argv[2]!,process.argv[3]?readScrolls(process.argv[3]):undefined,process.argv[3]?{home:process.argv[3]}:{});
store.tick();store.ledger.expire();
const timer=setInterval(()=>{try{store.tick();store.ledger.expire();}catch{console.error('Nervous scheduler tick failed.');}},250);
const registry=()=>new Registry(store.db,process.argv[3]?(()=>{try{return readConfig(process.argv[3]!).kaji?.root;}catch{return undefined;}})():undefined);
process.on('message',(value:unknown)=>{
 if(Buffer.byteLength(JSON.stringify(value))>MAX_FRAME_BYTES){process.exitCode=1;stop();return;}
 void dispatchRpc(value,(method,params)=>{
  switch(method){
   case 'runtime.ping':return {role:'nervous',pid:process.pid};
   case 'runtime.doctor':return store.doctor();
   case 'reminders.list':return store.list();
   case 'reminders.pending':return store.pendingReminders();
   case 'reminders.add':try{return store.add(params.title as string,params.due as string);}catch{throw new Error('Invalid reminder.');}
   case 'reminders.update':{let r;try{r=store.update(params.id as string,{...(params.title!==undefined?{title:params.title as string}:{}),...(params.due!==undefined?{due:params.due as string}:{})});}catch{throw new Error('Invalid reminder.');}return r ?? null;}
   case 'reminders.cancel':return store.cancel(params.id as string);
   case 'inbox.list':return store.inbox();
   case 'approvals.pending':return store.approvals(params.limit as number|undefined);
   case 'approvals.decide':return store.decide(params.id as string,params.decision as 'approve'|'reject'|'edit',params.source as string);
   case 'events.page':return store.events(params.sortieId as string,params.after as number|undefined,params.limit as number|undefined);
   case 'sorties.list':return store.sorties(params.limit as number|undefined,params.before as string|undefined,params.q as string|undefined);
   case 'sorties.get':return store.sortie(params.id as string);
   case 'sorties.spear':return store.ledger.spear(params.id as string,params.reason as string);
   case 'sorties.open':return store.ledger.openSortie(params.source==='misato'?MISATO_SOURCE:params.source==='instrumentality'?'instrumentality':OWNER_SOURCE,params.title as string,'trusted');
   case 'sorties.finish':{const id=params.sortieId as string;if(params.reply)store.ledger.reply(id,params.reply as string);return params.status?store.ledger.close(id,params.status as 'done'|'failed'):false;}
   case 'misato.note':return store.ledger.note(params.sortieId as string,params.kind as 'misato.step',params.payload as never);
   case 'misato.resumable':return store.ledger.resumable();
   // The owner's own changes (dashboard): source owner, every change in the fact's history.
   case 'memory.list':return store.memory.list(params.limit as number|undefined);
   case 'memory.add':return store.memory.add(params.text,'owner');
   case 'memory.edit':return store.memory.edit(params.id as string,params.text,'owner') ?? null;
   case 'memory.forget':return store.memory.forget(params.id as string,'owner');
   case 'memory.share':return store.memory.share(params.id as string,params.shareable as boolean,'owner') ?? null;
   case 'memory.history':return store.memory.historyOf(params.id as string);
   // Kaji registry for the coordinator's link: the root is re-read from config so an import while running applies.
   case 'kaji.bases':return registry().bases();
   case 'kaji.records':return registry().records();
   case 'kaji.lastSeen':return registry().lastSeen();
   case 'kaji.add':{const r=registry();let added=0;for(const rec of params.records as SignedRecord[]){try{if(r.add(rec)==='added')added++;}catch{/* a record not signed by our root is dropped */}}return added;}
   case 'kaji.seen':return registry().seen(params.updates as Record<string,string>);
   case 'memory.lastRequest':return store.ledger.lastRequestAt();
   case 'memory.episodes':return store.memory.episodes(params.limit as number|undefined);
   case 'memory.exchanges':return store.ledger.exchangesBetween(params.since as string,params.until as string);
   case 'memory.known':{
    // Known = already a fact, or already waiting on a memory.remember card: either way no second card.
    const waiting=store.approvals(5).filter(a=>a.card.tool==='memory.remember').map(a=>String(a.card.args.text ?? ''));
    const known=new Set([...store.memory.list(200).map(f=>f.text),...waiting].map(factKey));
    return (params.texts as string[]).filter(t=>known.has(factKey(t)));
   }
   case 'memory.saveEpisode':return store.memory.saveEpisode(params as never);
   case 'memory.recall':return store.memory.recall(params.text as string).map(f=>({id:f.id,text:f.text,shareable:f.shareable,tainted:f.tainted}));
   case 'misato.context':return store.ledger.conversation(params.conversation as string);
   case 'misato.claim':return store.ledger.claimResume(params.sortieId as string);
   case 'actions.preview':return store.ledger.preview(params.sortieId as string,params.tool as string);
   case 'actions.act':return store.runAction(params.sortieId as string,{tool:params.tool as string,args:params.args as Record<string,unknown>,stage:params.stage as 'production',...(params.casper?{casper:params.casper as Verdict}:{})});
   case 'inbox.page':return store.inboxPage(params.after as number|undefined,params.limit as number|undefined,params.afterId as string|undefined);
  }
 }).then(reply=>{if(reply&&process.connected){if(Buffer.byteLength(JSON.stringify(reply))>MAX_FRAME_BYTES)process.send?.({jsonrpc:'2.0',id:reply.id,error:{code:-32005,message:'Response exceeds IPC bound; pagination required.'}});else process.send?.(reply);}}).catch(()=>{console.error('Nervous IPC failed.');});
});
let stopped=false;function stop(){if(stopped)return;stopped=true;clearInterval(timer);store.close();if(process.connected)process.disconnect();}
process.on('disconnect',stop);process.once('SIGTERM',stop);process.once('SIGINT',stop);
