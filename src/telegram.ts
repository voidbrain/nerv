import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { StoreApi } from './runtime.ts';
import { ONLINE_MS } from './kaji-link.ts';
import type { ChannelState } from './channel-state.ts';
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
interface Update {update_id:number;message?:{date:number;text?:string;chat:{id:number;type:string};from?:{id:number}};callback_query?:{id:string;data?:string;from:{id:number};message?:{message_id:number;chat:{id:number};reply_markup?:{inline_keyboard?:Button[][]}}}}
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
/**
 * Why `telegram link` found no /start, in words the owner can act on (found on the owner's Windows base, 2026-11-04):
 * the token's bot, a webhook that diverts messages, nothing waiting (another reader, or /start sent to another bot), or
 * updates of other kinds (the Start button without a /start message, a group).
 */
export async function diagnoseNoStart(api:TelegramApi):Promise<string> {
 const me=await api.call<{username?:string}>('getMe',{}).catch(()=>({} as {username?:string}));const bot=me.username?`@${me.username}`:'this bot';
 const hook=await api.call<{url?:string}>('getWebhookInfo',{}).catch(()=>({} as {url?:string}));
 if(hook.url){let host='a web address';try{host=new URL(hook.url).host;}catch{/* keep generic */}return `${bot} has a webhook (${host}), so Telegram sends its messages there instead. If nothing else uses this bot, remove it with the deleteWebhook call (docs/INSTALL.md, Telegram), then send /start again.`;}
 const waiting=await api.call<Update[]>('getUpdates',{timeout:0}).catch(()=>[] as Update[]);
 if(!waiting.length)return `Nothing is waiting for ${bot}. Either /start went to a different bot (open the chat with exactly ${bot}), or another program reads this bot (another NERV or a script using the same token: give each base its own bot).`;
 const kinds=[...new Set(waiting.map(u=>u.message?`a message in a ${u.message.chat.type} chat`:Object.keys(u).filter(k=>k!=='update_id').join(', ')))];
 return `${bot} has ${waiting.length} update(s) waiting, but no /start in a private chat (${kinds.join('; ')}). Type /start yourself in the private chat with ${bot}, then run this again.`;
}
interface State {offset?:number;inbox?:{sequence:number;id?:string};cards:string[];/** Before F-028 the brief was sent from here: kept only to read the last one once. */brief?:{date:string;at:string}}
/** The other bases' votes on a card (F-036 phase 2): veto-only seats; shadow votes are shown, never counted. */
function peerLine(verdicts:{seat:string;vote:string;shadow?:boolean}[]|undefined):string[] {
 const peers=(verdicts ?? []).filter(v=>v.seat.startsWith('extra:'));if(!peers.length)return [];
 return [`Other bases: ${peers.map(v=>`${v.seat.slice(6)} ${v.vote==='approve'?'✓':v.vote==='reject'?'✗':'·'}${v.shadow?' (shadow)':''}`).join(', ')}`];
}
export function card(a:Approval):{text:string;buttons:Button[][]} {
 const c=a.card;const args=JSON.stringify(c.args);
 const text=[`Needs you · Pattern ${c.pattern.toUpperCase()}`,`${c.tool} ${args.length>600?args.slice(0,600)+'…':args}`,`Effect: ${c.effect}. Sync ${c.sync.value}%.`,`Why it stopped: ${c.reason}`,...peerLine(c.verdicts),`Expires: ${new Date(c.expires).toUTCString()} (expiry never approves)`].join('\n');
 return {text,buttons:[[{text:'✅ Approve once',callback_data:'a:'+a.id},{text:'❌ Reject',callback_data:'r:'+a.id}]]};
}
/** Several facts proposed together (one Instrumentality night, F-022) as one message: each fact keeps its own approval,
    with a ✅/❌ row; a tap decides that fact only. */
export function bundle(cards:Approval[]):{text:string;buttons:Button[][]} {
 const fact=(a:Approval)=>{const t=(a.card.args as {text?:unknown}).text;return typeof t==='string'?t:JSON.stringify(a.card.args);};
 const text=[`Needs you · ${cards.length} facts to remember (memory.remember, Pattern ${cards[0]!.card.pattern.toUpperCase()})`,'Each one is stored only if you approve it:',
  ...cards.map((a,i)=>`${i+1}. ${fact(a).slice(0,300)}`),`Expires: ${new Date(Math.min(...cards.map(a=>Date.parse(a.card.expires)))).toUTCString()} (expiry never approves)`].join('\n');
 return {text,buttons:cards.map((a,i)=>[{text:`✅ ${i+1}`,callback_data:'a:'+a.id},{text:`❌ ${i+1}`,callback_data:'r:'+a.id}])};
}
/** Fact cards wait this long after they first appear, so the rest of the same night joins them in one message. */
export const BUNDLE_WAIT_MS=3000;
/** What the owner reads after a decision, the same for a tap here and one relayed from the main base. */
export function decisionText(result:{decision:string;result?:unknown;error?:string}):string {
 return result.decision==='approve'?('error' in result&&result.error?`Approved, but it failed: ${result.error}`:'result' in result&&result.result!==undefined?`Approved and done: ${JSON.stringify(result.result).slice(0,500)}`:'Approved.'):result.decision==='reject'?'Rejected: nothing ran.':result.decision==='expired'?'Expired before you decided: nothing ran.':`Not applied: ${'error' in result?result.error:result.decision}`;
}
/** F-036 phase 2. On a base that is not the main one: while the main base is online, this base's bot is quiet and what
    it would send goes to the main base's Aoba instead (cards keep their own approvals). */
export interface OneChannel {destination?():Promise<string|undefined>;quiet():Promise<boolean>;relay(text:string,cards:{id:string;label:string}[]):Promise<boolean>}
/** On the main base: a tap on a card relayed from another base is decided there. */
export interface RemoteDecide {decide(baseId:string,approvalId:string,decision:'approve'|'reject'):Promise<string>}
export class TelegramChannel {
 readonly api:TelegramApi;readonly store:StoreApi;readonly chatId:number;readonly statePath:string;readonly log:(line:string)=>void;
 private held=new Map<string,{key:string;since:number}>();private readonly one:OneChannel|undefined;private readonly remote:RemoteDecide|undefined;
 private routeState:ChannelState={mode:'unknown',checkedAt:new Date().toISOString()};
 /** Cached actual route checks and send outcomes; reading telemetry never sends or probes Telegram. */
 channelState():ChannelState{return {...this.routeState,...(this.routeState.lastDelivery?{lastDelivery:{...this.routeState.lastDelivery}}:{})};}
 private async quiet():Promise<boolean>{
  let quiet=false;let mode:ChannelState['mode']='local';
  const destination=await this.one?.destination?.().catch(()=>undefined);
  try{quiet=!!this.one&&await this.one.quiet();mode=quiet?'via-main':destination?'local-fallback':'local';}catch{mode='unknown';}
  // A failed relay's local fallback stays visible until a new send or a different route check, at most 90 seconds.
  const last=this.routeState.lastDelivery;
  if(quiet&&this.routeState.mode==='local-fallback'&&this.routeState.destination===destination&&last&&Date.now()-Date.parse(last.at)<ONLINE_MS)mode='local-fallback';
  this.routeState={mode,checkedAt:new Date().toISOString(),...(destination?{destination}:{}),...(last?{lastDelivery:last}:{})};
  return quiet;
 }
 private delivered(route:'main'|'local',result:'accepted'|'failed',fallback=false){
  this.routeState={...this.routeState,mode:route==='main'?'via-main':fallback?'local-fallback':'local',lastDelivery:{route,result,at:new Date().toISOString()}};
 }
 /** Everything this base sends on its own (cards, reminders, brief, follow-ups): relayed while quiet, else its own bot; a failed relay falls back to its own bot, so nothing is lost. */
 private async out(text:string,buttons?:Button[][]):Promise<void>{
  const quiet=await this.quiet();
  if(quiet){
   const cards=(buttons ?? []).flatMap((row,i,all)=>{const a=row.find(b=>/^a:[a-f0-9-]{36}$/.test(b.callback_data));return a?[{id:a.callback_data.slice(2),label:all.length>1?String(i+1):''}]:[];});
   if(await this.one!.relay(text,cards).catch(()=>false)){this.delivered('main','accepted');return;}
  }
  await this.sendLocal(text,buttons,quiet||this.routeState.destination!==undefined);
 }
 private async sendLocal(text:string,buttons?:Button[][],fallback=this.routeState.destination!==undefined){
  try{await this.api.send(this.chatId,text,buttons);this.delivered('local','accepted',fallback);}
  catch(e){this.delivered('local','failed',fallback);throw e;}
 }

 /** On the main base: shows what another base relayed, its cards with buttons that decide on that base. */
 async relayed(fromId:string,fromName:string,relay:{text:string;cards:{id:string;label:string}[]}):Promise<boolean>{
  const buttons=relay.cards.map(c=>[{text:c.label?`✅ ${c.label}`:'✅ Approve once',callback_data:`k:${fromId}:a:${c.id}`},{text:c.label?`❌ ${c.label}`:'❌ Reject',callback_data:`k:${fromId}:r:${c.id}`}]);
  await this.sendLocal(`🛰 ${fromName} · ${relay.text}`,buttons.length?buttons:undefined);return true;
 }
 private state:State={cards:[]};private stopping=new AbortController();private queue:Promise<void>=Promise.resolve();private timer?:NodeJS.Timeout;private delivery?:Promise<void>;
 constructor(options:{api:TelegramApi;store:StoreApi;chatId:number;statePath:string;log?:(line:string)=>void;oneChannel?:OneChannel;remote?:RemoteDecide}) {
  this.one=options.oneChannel;this.remote=options.remote;
  this.api=options.api;this.store=options.store;this.chatId=options.chatId;this.statePath=options.statePath;this.log=options.log ?? (line=>console.error(line));
  if(existsSync(this.statePath)){try{const saved=JSON.parse(readFileSync(this.statePath,'utf8')) as Partial<State>;this.state={...saved,cards:Array.isArray(saved.cards)?saved.cards:[]};}catch{this.log('Telegram: unreadable state file; starting fresh.');}}
 }
 private save(){const tmp=this.statePath+'.tmp';writeFileSync(tmp,JSON.stringify(this.state),{mode:0o600});renameSync(tmp,this.statePath);}
 async start(deliverEveryMs=2000):Promise<void> {
  // First run: reminders already in the inbox are not replayed to the phone.
  if(!this.state.inbox){const page=await this.store.inboxPage(0,1);this.state.inbox=page.head;this.save();}
  // Misato's follow-up after an approval (F-033) reaches the owner here, after the decision's own message.
  this.store.onResumed?.(reply=>{this.queue=this.queue.then(async()=>{if(this.stopping.signal.aborted)return;await this.out(reply.reply ?? `I could not finish: ${reply.error ?? 'no reply'}`);await this.deliver();}).catch(e=>this.log(`Telegram: ${e instanceof Error?e.message:'follow-up failed'}.`));});
  void this.poll();
  this.timer=setInterval(()=>{void this.deliver();},deliverEveryMs);
  await this.deliver();
 }
 /** Waits for a delivery in progress, so a restart never sends the same reminder twice. */
 async stop(){this.stopping.abort();if(this.timer)clearInterval(this.timer);await Promise.allSettled([this.queue,this.delivery]);}
 private owner(id:number|undefined){return id===this.chatId;}
 private async poll():Promise<void> {
  while(!this.stopping.signal.aborted){
   // Quiet: the owner talks to the main base's Aoba; messages to this bot wait in Telegram until this base speaks again.
   if(await this.quiet()){await new Promise(done=>setTimeout(done,5000));continue;}
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
   const far=/^k:([A-Z0-9-]{1,16}):([ar]):([a-f0-9-]{36})$/.exec(q.data ?? '');
   if(far&&this.remote){
    const outcome=await this.remote.decide(far[1]!,far[3]!,far[2]==='a'?'approve':'reject').catch((e:unknown)=>`Not applied: ${far[1]} could not be reached (${e instanceof Error?e.message:'error'}). Try again when it is online.`);
    await this.api.call('answerCallbackQuery',{callback_query_id:q.id,text:outcome.slice(0,180)});
    const rest=(q.message?.reply_markup?.inline_keyboard ?? []).filter(row=>!row.some(b=>b.callback_data.endsWith(':'+far[3])));
    if(q.message&&!outcome.startsWith('Not applied: '+far[1]+' could not'))await this.api.call('editMessageReplyMarkup',{chat_id:this.chatId,message_id:q.message.message_id,reply_markup:{inline_keyboard:rest}}).catch(()=>{});
    await this.sendLocal(`🛰 ${far[1]} · ${outcome}`);return;
   }
   const match=/^([ar]):([a-f0-9-]{36})$/.exec(q.data ?? '');
   if(!match){await this.api.call('answerCallbackQuery',{callback_query_id:q.id,text:'Unknown button.'});return;}
   const decision=match[1]==='a'?'approve':'reject';
   const result=await Promise.resolve().then(()=>this.store.decide(match[2]!,decision,'telegram')).catch((e:unknown)=>({decision:'error',error:e instanceof Error?e.message:'Decision failed.'}));
   await this.api.call('answerCallbackQuery',{callback_query_id:q.id,text:result.decision==='error'?'Could not apply it.':`Decision: ${result.decision}`});
   const outcome=decisionText(result);
   // Only the decided card's row goes: in a bundle the other facts keep their buttons.
   const rest=(q.message?.reply_markup?.inline_keyboard ?? []).filter(row=>!row.some(b=>b.callback_data.endsWith(':'+match[2])));
   if(q.message)await this.api.call('editMessageReplyMarkup',{chat_id:this.chatId,message_id:q.message.message_id,reply_markup:{inline_keyboard:rest}}).catch(()=>{});
   await this.sendLocal(outcome);
   return;
  }
  const m=u.message;if(!m?.text)return;
  if(m.chat.type!=='private'||!this.owner(m.chat.id)||(m.from&&!this.owner(m.from.id))){this.log('Telegram: ignored a message from another chat.');return;}
  // Messages queued while the service was down for long are not replayed as fresh requests.
  if(Date.now()/1000-m.date>STALE_SECONDS){await this.sendLocal('I was offline when you sent that; send it again if it still matters.');return;}
  const text=m.text.trim();
  if(text==='/start'){await this.sendLocal('Aoba here. Write what you need; actions that need you arrive with buttons.');return;}
  if(!this.store.chat){await this.sendLocal('The agent loop is not available.');return;}
  const typing=setInterval(()=>{void this.api.call('sendChatAction',{chat_id:this.chatId,action:'typing'}).catch(()=>{});},4000);
  void this.api.call('sendChatAction',{chat_id:this.chatId,action:'typing'}).catch(()=>{});
  try{
   const reply=await this.store.chat(text.slice(0,4000),`telegram:${this.chatId}`);
   await this.sendLocal(reply.reply ?? `I could not finish: ${reply.error ?? 'no reply'}`);
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
   const fresh=(await this.store.approvals(20)).filter(a=>!this.state.cards.includes(a.id));
   const sent=(ids:string[])=>{this.state.cards=[...this.state.cards,...ids].slice(-200);this.save();};
   // Fact cards from one sortie go out together, once none has newly appeared for BUNDLE_WAIT_MS.
   const facts=new Map<string,Approval[]>();
   for(const a of fresh){if(a.card.tool==='memory.remember'){facts.set(a.card.sortieId,[...(facts.get(a.card.sortieId) ?? []),a]);continue;}const c=card(a);await this.out(c.text,c.buttons);sent([a.id]);}
   const now=Date.now();
   for(const [sortie,group] of facts){
    const key=sortie+':'+group.length;if(this.held.get(sortie)?.key!==key)this.held.set(sortie,{key,since:now});
    if(now-this.held.get(sortie)!.since<BUNDLE_WAIT_MS)continue;this.held.delete(sortie);
    const c=group.length>1?bundle(group):card(group[0]!);await this.out(c.text,c.buttons);sent(group.map(a=>a.id));
   }
   for(;;){
    const at=this.state.inbox ?? {sequence:0};const page=await this.store.inboxPage(at.sequence,5,at.id);
    // Checkpoint after every message: a stop or crash resends at most the one in flight.
    for(const item of page.items){await this.out(item.kind==='brief'?item.message:`⏰ ${item.message}`);this.state.inbox={sequence:item.sequence,id:item.id};this.save();}
    // A reset means the checkpoint no longer matches the inbox (restored database): continue from its head, replay nothing.
    if(page.reset){this.state.inbox=page.next;this.save();break;}
    if(!page.items.length)break;this.state.inbox=page.next;this.save();
   }
  }catch(e){this.log(`Telegram delivery: ${e instanceof Error?e.message:'failed'}.`);}
 }
}
