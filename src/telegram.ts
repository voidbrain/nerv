import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { StoreApi } from './runtime.ts';
import type { Approval } from './ledger.ts';
/**
 * Aoba, the Telegram channel (F-003), with Pen Pen's deliveries (F-023). Outbound HTTPS only (long polling): no open
 * port, no mesh. It answers exactly one private chat, the owner's; everything else is ignored. Messages go to Misato,
 * approval cards come with buttons that use the same decision path as `approve`, and due reminders are delivered here
 * as well as to the local inbox. Telegram bot chats are not end-to-end encrypted: Telegram's servers see this text.
 */
export const TELEGRAM_API='https://api.telegram.org';
/** The Bot API base: Telegram's, or a loopback stand-in for tests (NERV_TELEGRAM_API). Nothing else, because requests carry the token. */
export function telegramBase():string {
 const value=process.env.NERV_TELEGRAM_API;if(!value)return TELEGRAM_API;
 const url=new URL(value);if(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))return value.replace(/\/$/,'');
 throw new Error('NERV_TELEGRAM_API must be a loopback address.');
}
const POLL_SECONDS=25;
const MAX_TEXT=4000;
const STALE_SECONDS=600;
interface Update {update_id:number;message?:{date:number;text?:string;chat:{id:number;type:string};from?:{id:number}};callback_query?:{id:string;data?:string;from:{id:number};message?:{message_id:number;chat:{id:number}}}}
interface Button {text:string;callback_data:string}
export class TelegramApi {
 readonly token:string;readonly base:string;
 constructor(token:string,base=TELEGRAM_API){this.token=token;this.base=base;}
 async call<T>(method:string,body:object,signal?:AbortSignal):Promise<T> {
  const response=await fetch(`${this.base}/bot${this.token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:signal ?? AbortSignal.timeout(15000),redirect:'error'});
  const value=await response.json().catch(()=>({})) as {ok?:boolean;result?:T;description?:string};
  // Never echo the URL: it contains the token.
  if(!response.ok||!value.ok)throw new Error(`Telegram ${method} failed: ${value.description ?? 'HTTP '+response.status}`);
  return value.result as T;
 }
 updates(offset:number|undefined,timeout:number,signal?:AbortSignal){return this.call<Update[]>('getUpdates',{...(offset!==undefined?{offset}:{}),timeout,allowed_updates:['message','callback_query']},signal ?? AbortSignal.timeout((timeout+10)*1000));}
 send(chatId:number,text:string,buttons?:Button[][]){return this.call<{message_id:number}>('sendMessage',{chat_id:chatId,text:text.slice(0,MAX_TEXT),...(buttons?{reply_markup:{inline_keyboard:buttons}}:{})});}
}
/** Private chats that sent /start, for `telegram link`: does not confirm updates, so the channel still sees them. */
export async function startChats(api:TelegramApi):Promise<{chatId:number;name:string}[]> {
 const seen=new Map<number,string>();
 for(const u of await api.updates(undefined,0)){const m=u.message;if(m&&m.chat.type==='private'&&m.text?.trim().startsWith('/start'))seen.set(m.chat.id,(m.chat as {username?:string;first_name?:string}).username ?? (m.chat as {first_name?:string}).first_name ?? String(m.chat.id));}
 return [...seen].map(([chatId,name])=>({chatId,name}));
}
interface State {offset?:number;inbox?:{sequence:number;id?:string};cards:string[]}
export function card(a:Approval):{text:string;buttons:Button[][]} {
 const c=a.card;const args=JSON.stringify(c.args);
 const text=[`Needs you · Pattern ${c.pattern.toUpperCase()}`,`${c.tool} ${args.length>600?args.slice(0,600)+'…':args}`,`Effect: ${c.effect}. Sync ${c.sync.value}%.`,`Why it stopped: ${c.reason}`,`Expires: ${new Date(c.expires).toUTCString()} (expiry never approves)`].join('\n');
 return {text,buttons:[[{text:'✅ Approve once',callback_data:'a:'+a.id},{text:'❌ Reject',callback_data:'r:'+a.id}]]};
}
export class TelegramChannel {
 readonly api:TelegramApi;readonly store:StoreApi;readonly chatId:number;readonly statePath:string;readonly log:(line:string)=>void;
 private state:State={cards:[]};private stopping=new AbortController();private queue:Promise<void>=Promise.resolve();private timer?:NodeJS.Timeout;private delivery?:Promise<void>;
 constructor(options:{api:TelegramApi;store:StoreApi;chatId:number;statePath:string;log?:(line:string)=>void}) {
  this.api=options.api;this.store=options.store;this.chatId=options.chatId;this.statePath=options.statePath;this.log=options.log ?? (line=>console.error(line));
  if(existsSync(this.statePath)){try{const saved=JSON.parse(readFileSync(this.statePath,'utf8')) as Partial<State>;this.state={...saved,cards:Array.isArray(saved.cards)?saved.cards:[]};}catch{this.log('Telegram: unreadable state file; starting fresh.');}}
 }
 private save(){const tmp=this.statePath+'.tmp';writeFileSync(tmp,JSON.stringify(this.state),{mode:0o600});renameSync(tmp,this.statePath);}
 async start(deliverEveryMs=2000):Promise<void> {
  // First run: reminders already in the inbox are not replayed to the phone.
  if(!this.state.inbox){const page=await this.store.inboxPage(0,1);this.state.inbox=page.head;this.save();}
  void this.poll();
  this.timer=setInterval(()=>{void this.deliver();},deliverEveryMs);
  await this.deliver();
 }
 /** Waits for a delivery in progress, so a restart never sends the same reminder twice. */
 async stop(){this.stopping.abort();if(this.timer)clearInterval(this.timer);await Promise.allSettled([this.queue,this.delivery]);}
 private owner(id:number|undefined){return id===this.chatId;}
 private async poll():Promise<void> {
  while(!this.stopping.signal.aborted){
   try{
    const updates=await this.api.updates(this.state.offset,POLL_SECONDS,AbortSignal.any([this.stopping.signal,AbortSignal.timeout((POLL_SECONDS+10)*1000)]));
    for(const u of updates){this.state.offset=u.update_id+1;this.save();this.queue=this.queue.then(()=>this.handle(u)).catch(e=>this.log(`Telegram: ${e instanceof Error?e.message:'handling failed'}.`));}
   }catch(e){if(this.stopping.signal.aborted)return;this.log(`Telegram: ${e instanceof Error?e.message:'poll failed'}; retrying in 5 s.`);await new Promise(done=>setTimeout(done,5000));}
  }
 }
 private async handle(u:Update):Promise<void> {
  if(u.callback_query){
   const q=u.callback_query;
   if(!this.owner(q.from.id)||!this.owner(q.message?.chat.id)){this.log('Telegram: ignored a button press from another account.');return;}
   const match=/^([ar]):([a-f0-9-]{36})$/.exec(q.data ?? '');
   if(!match){await this.api.call('answerCallbackQuery',{callback_query_id:q.id,text:'Unknown button.'});return;}
   const decision=match[1]==='a'?'approve':'reject';
   const result=await Promise.resolve().then(()=>this.store.decide(match[2]!,decision,'telegram')).catch((e:unknown)=>({decision:'error',error:e instanceof Error?e.message:'Decision failed.'}));
   await this.api.call('answerCallbackQuery',{callback_query_id:q.id,text:result.decision==='error'?'Could not apply it.':`Decision: ${result.decision}`});
   const outcome=result.decision==='approve'?('error' in result&&result.error?`Approved, but it failed: ${result.error}`:'result' in result&&result.result!==undefined?`Approved and done: ${JSON.stringify(result.result).slice(0,500)}`:'Approved.'):result.decision==='reject'?'Rejected: nothing ran.':result.decision==='expired'?'Expired before you decided: nothing ran.':`Not applied: ${'error' in result?result.error:result.decision}`;
   if(q.message)await this.api.call('editMessageReplyMarkup',{chat_id:this.chatId,message_id:q.message.message_id,reply_markup:{inline_keyboard:[]}}).catch(()=>{});
   await this.api.send(this.chatId,outcome);
   return;
  }
  const m=u.message;if(!m?.text)return;
  if(m.chat.type!=='private'||!this.owner(m.chat.id)||(m.from&&!this.owner(m.from.id))){this.log('Telegram: ignored a message from another chat.');return;}
  // Messages queued while the service was down for long are not replayed as fresh requests.
  if(Date.now()/1000-m.date>STALE_SECONDS){await this.api.send(this.chatId,'I was offline when you sent that; send it again if it still matters.');return;}
  const text=m.text.trim();
  if(text==='/start'){await this.api.send(this.chatId,'Aoba here. Write what you need; actions that need you arrive with buttons.');return;}
  if(!this.store.chat){await this.api.send(this.chatId,'The agent loop is not available.');return;}
  const typing=setInterval(()=>{void this.api.call('sendChatAction',{chat_id:this.chatId,action:'typing'}).catch(()=>{});},4000);
  void this.api.call('sendChatAction',{chat_id:this.chatId,action:'typing'}).catch(()=>{});
  try{
   const reply=await this.store.chat(text.slice(0,4000));
   await this.api.send(this.chatId,reply.reply ?? `I could not finish: ${reply.error ?? 'no reply'}`);
   await this.deliver();
  }finally{clearInterval(typing);}
 }
 /** Pen Pen: new approval cards and newly delivered reminders, each sent once (remembered across restarts). */
 deliver():Promise<void> {
  if(this.delivery||this.stopping.signal.aborted)return this.delivery ?? Promise.resolve();
  this.delivery=this.deliverOnce().finally(()=>{this.delivery=undefined;});return this.delivery;
 }
 private async deliverOnce():Promise<void> {
  try{
   const pending=await this.store.approvals(5);
   for(const a of pending){if(this.state.cards.includes(a.id))continue;const c=card(a);await this.api.send(this.chatId,c.text,c.buttons);this.state.cards=[...this.state.cards,a.id].slice(-200);this.save();}
   for(;;){
    const at=this.state.inbox ?? {sequence:0};const page=await this.store.inboxPage(at.sequence,5,at.id);
    // Checkpoint after every message: a stop or crash resends at most the one in flight.
    for(const item of page.items){await this.api.send(this.chatId,`⏰ ${item.message}`);this.state.inbox={sequence:item.sequence,id:item.id};this.save();}
    // A reset means the checkpoint no longer matches the inbox (restored database): continue from its head, replay nothing.
    if(page.reset){this.state.inbox=page.next;this.save();break;}
    if(!page.items.length)break;this.state.inbox=page.next;this.save();
   }
  }catch(e){this.log(`Telegram delivery: ${e instanceof Error?e.message:'failed'}.`);}
 }
}
