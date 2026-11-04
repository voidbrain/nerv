import {ProcessClient} from './process-client.ts';
import type {Reminder,InboxPage,ActResult} from './store.ts';
import type {ActionDetail,Approval,Decision,SortieSummary} from './ledger.ts';
import type {SortieEvent} from './events.ts';
import {MODEL_TIMEOUT_MS,type Ask,type Reply} from './model.ts';
import type {Effect,Pattern,Stage,Verdict} from './policy.ts';
import {MAX_STEPS,type Plan,type Recalled,type Step,type Turn} from './misato.ts';
import {argsHash} from './ledger.ts';
import {toolDocs} from './executors.ts';
import type {Digest,Exchange} from './instrumentality.ts';
import {briefDue,localClock} from './brief.ts';
export interface ChatReply {sortieId:string;reply?:string;error?:string;steps:Step[];waiting:{approvalId:string;tool:string;reason:string}[]}
/** An action the owner asks for directly: the request is what Casper checks the action against. */
export interface OwnerAction {request:string;tool:string;args:Record<string,unknown>;stage?:Stage}
export type ActReply=ActResult&{casperError?:string};
export interface StoreApi {
 list():Reminder[]|Promise<Reminder[]>;
 pendingReminders():Reminder[]|Promise<Reminder[]>;
 inboxPage(after?:number,limit?:number,afterId?:string):InboxPage|Promise<InboxPage>;
 add(title:string,due:string):Reminder|Promise<Reminder>;
 cancel(id:string):boolean|Promise<boolean>;
 inbox():unknown|Promise<unknown>;
 doctor():object|Promise<object>;
 health():object|Promise<object>;
 approvals(limit?:number):Approval[]|Promise<Approval[]>;
 decide(id:string,decision:Decision,source?:'api'|'cli'|'telegram'):{decision:string;result?:unknown;error?:string}|Promise<{decision:string;result?:unknown;error?:string}>;
 act?(action:OwnerAction):Promise<ActReply>;
 chat?(message:string,conversation?:string):Promise<ChatReply>;
 onResumed?(listener:(reply:ChatReply)=>void):void;
 reloadModels?():Promise<{error?:string;kept?:boolean;models:unknown}>;
 consolidate?():Promise<{summary?:string;exchanges:number;proposed:number;skipped:number;error?:string}>;
 spear?(id:string,reason:string):Promise<{revoked:number;stoodDown:number;happened:{actionId:string;tool:string;inverse:string|null}[]}|null>;
 events(sortieId:string,after?:number,limit?:number):SortieEvent[]|Promise<SortieEvent[]>;
 sorties(limit?:number,before?:string):SortieSummary[]|Promise<SortieSummary[]>;
 sortie(id:string):(SortieSummary&{detail:ActionDetail[]})|null|Promise<(SortieSummary&{detail:ActionDetail[]})|null>;
 ask?(ask:Ask):Promise<Reply>;
}
export class Runtime implements StoreApi {
 readonly nervous:ProcessClient;readonly brain:ProcessClient;
 constructor(database:string,brainEntry=new URL('./brain-process.ts',import.meta.url),home?:string) {
  this.nervous=new ProcessClient(new URL('./nervous-process.ts',import.meta.url),home?[database,home]:[database],'nervous');
  this.brain=new ProcessClient(brainEntry,home?[home]:[],'brain',1500);
 }
 async ready(){await this.nervous.call('runtime.ping');}
 async list(){return await this.nervous.call('reminders.list') as Reminder[];}
 async pendingReminders(){return await this.nervous.call('reminders.pending') as Reminder[];}
 async inboxPage(after=0,limit=5,afterId?:string){return await this.nervous.call('inbox.page',{after,limit,...(afterId?{afterId}:{})}) as InboxPage;}
 async add(title:string,due:string){return await this.nervous.call('reminders.add',{title,due}) as Reminder;}
 async cancel(id:string){return await this.nervous.call('reminders.cancel',{id}) as boolean;}
 async inbox(){return this.nervous.call('inbox.list');}
 async approvals(limit=5){return await this.nervous.call('approvals.pending',{limit}) as Approval[];}
 async decide(id:string,decision:Decision,source:'api'|'cli'|'telegram'='api'){const result=await this.nervous.call('approvals.decide',{id,decision,source}) as {decision:string;result?:unknown;error?:string};if(this.resumer)void this.sweep();return result;}
 /** Spear of Longinus for one sortie: revoke its unused grants, stand down its cards, close it; executed effects are reported. */
 async spear(id:string,reason:string){if(!await this.sortie(id))return null;return await this.nervous.call('sorties.spear',{id,reason}) as {revoked:number;stoodDown:number;happened:{actionId:string;tool:string;inverse:string|null}[]};}
 async sorties(limit=20,before?:string){return await this.nervous.call('sorties.list',{limit,...(before?{before}:{})}) as SortieSummary[];}
 async sortie(id:string){return await this.nervous.call('sorties.get',{id}) as (SortieSummary&{detail:ActionDetail[]})|null;}
 async events(sortieId:string,after=0,limit=50){return await this.nervous.call('events.page',{sortieId,after,limit}) as SortieEvent[];}
 /** Coordinator side of the gate: open the sortie, ask Casper only for Orange/Blue, then ballot and (on a grant) run in the scheduler process. */
 async act(action:OwnerAction):Promise<ActReply> {
  const sortieId=await this.nervous.call('sorties.open',{title:action.request.slice(0,500)}) as string;
  return this.gate(sortieId,action);
 }
 private async gate(sortieId:string,action:OwnerAction,askCasper=true):Promise<ActReply> {
  const {pattern,effect}=await this.nervous.call('actions.preview',{sortieId,tool:action.tool}) as {pattern:Pattern;effect:Effect};
  let casper:Verdict|undefined,casperError:string|undefined;
  if(pattern!=='green'&&askCasper){
   const reply=await this.brain.call('casper.verdict',{request:action.request,tool:action.tool,args:action.args,effect},MODEL_TIMEOUT_MS).catch(()=>({verdict:null,error:'Brain unavailable.'})) as {verdict:Verdict|null;error?:string};
   if(reply.verdict)casper=reply.verdict;else casperError=reply.error ?? 'No verdict.';
  }
  const result=await this.nervous.call('actions.act',{sortieId,tool:action.tool,args:action.args,stage:action.stage ?? 'production',...(casper?{casper}:{})}) as ActResult;
  return casperError?{...result,casperError}:result;
 }
 /** A new request to Misato (F-003): its text and every step go to the ledger, so the loop can resume later. */
 async chat(message:string,conversation?:string):Promise<ChatReply> {
  // Earlier exchanges of the same conversation (read before this request is recorded), so "yes" has its question.
  const context=conversation?await this.nervous.call('misato.context',{conversation}).catch(()=>[]) as Turn[]:[];
  const sortieId=await this.nervous.call('sorties.open',{title:message.slice(0,500),source:'misato'}) as string;
  await this.note(sortieId,'misato.request',{text:message,...(conversation?{conversation}:{})});
  return this.loop(sortieId,message,[],context);
 }
 private note(sortieId:string,kind:'misato.request'|'misato.step'|'misato.waiting',payload:object){return this.nervous.call('misato.note',{sortieId,kind,payload});}
 /** Records a step, cutting an oversized result so the event stays within its bound. */
 private async record(sortieId:string,steps:Step[],step:Step,actionId?:string){
  const fitted=JSON.stringify(step).length>12000?{...step,result:{truncated:true}}:step;
  steps.push(fitted);await this.note(sortieId,'misato.step',{step:fitted,...(actionId?{actionId}:{})});
 }
 /**
  * Misato's loop: plan one action, gate it, show Misato the outcome, repeat until Misato replies or the step limit is
  * reached. When actions wait for the owner, the sortie stays open and resumes once they are decided (F-033).
  */
 private async loop(sortieId:string,message:string,steps:Step[],context:Turn[]=[]):Promise<ChatReply> {
  const waiting:ChatReply['waiting']=[];const pending=new Set<string>();
  // LCL fill: Lilith's facts that match this request and its recent conversation.
  const memory=await this.nervous.call('memory.recall',{text:[message,...context.map(t=>t.request)].join(' ').slice(0,8000)}).catch(()=>[]) as Recalled[];
  const finish=async(status:'done'|'failed',reply?:string,error?:string):Promise<ChatReply>=>{
   if(waiting.length&&reply){
    // Not finished: the reply is recorded, the sortie waits for the owner's decisions and then resumes.
    await this.nervous.call('sorties.finish',{sortieId,reply});await this.note(sortieId,'misato.waiting',{approvalIds:waiting.map(w=>w.approvalId)});
   }else await this.nervous.call('sorties.finish',{sortieId,status,...(reply?{reply}:{})});
   return {sortieId,...(reply?{reply}:{}),...(error?{error}:{}),steps,waiting};
  };
  for(let turn=0;turn<MAX_STEPS;turn++){
   const out=await this.brain.call('misato.step',{request:message,history:steps.slice(-12),...(context.length?{context}:{}),...(memory.length?{memory:memory.slice(0,5)}:{})},MODEL_TIMEOUT_MS).catch(()=>({error:'Brain unavailable.'})) as {plan?:Plan;invalid?:boolean;error?:string};
   if(out.error)return finish('failed',undefined,out.error);
   if(!out.plan){await this.record(sortieId,steps,{outcome:'invalid',error:'Reply was not one JSON action or reply.'});continue;}
   if('reply' in out.plan)return finish('done',out.plan.reply);
   const {tool,args}=out.plan.action;
   // A tool Misato was not offered (often a misspelling) has no executor: it goes back to Misato, never to the owner as a card.
   if(!toolDocs.some(t=>t.name===tool)){await this.record(sortieId,steps,{tool,args,outcome:'invalid',error:`Unknown tool "${tool}". Use exactly one of: ${toolDocs.map(t=>t.name).join(', ')}.`});continue;}
   // The same action already waits for the owner: a second card would ask twice for one decision.
   const same=tool+':'+argsHash(args);
   if(pending.has(same)){await this.record(sortieId,steps,{tool,args,outcome:'invalid',error:'This exact action already waits for the owner. Do not propose it again; reply instead.'});continue;}
   // An action the ledger refuses outright (malformed, oversized) never reached a ballot: Misato sees it as invalid.
   const r=await this.gate(sortieId,{request:message,tool,args}).catch(()=>({outcome:'invalid' as const,reason:'The gate refused this action as malformed (unknown shape or too large).'}));
   if(r.outcome==='approval')pending.add(same);
   // Spelled out for the planner: an action waiting for the owner has not happened.
   const reason=r.outcome==='approval'?`Waiting for the owner's approval; NOT done yet. ${r.reason ?? ''}`.trim():r.reason;
   await this.record(sortieId,steps,{tool,args,outcome:r.outcome,...(reason?{reason}:{}),...('result' in r&&r.result!==undefined?{result:r.result}:{}),...('error' in r&&r.error?{error:r.error}:{})},'actionId' in r?r.actionId:undefined);
   if('approvalId' in r&&r.approvalId)waiting.push({approvalId:r.approvalId,tool,reason:r.reason});
  }
  return finish('failed',undefined,`Step limit (${MAX_STEPS}) reached.`);
 }
 private resumeListeners:((reply:ChatReply)=>void)[]=[];private resuming=new Set<string>();private resumer?:NodeJS.Timeout;
 /** Called with Misato's follow-up after a resume (Aoba sends it to the owner). */
 onResumed(listener:(reply:ChatReply)=>void){this.resumeListeners.push(listener);}
 /** Resumes every Misato sortie whose wait is over; each is claimed once in the ledger, so two sweeps never resume twice. */
 async sweep():Promise<void> {
  const ids=await this.nervous.call('misato.resumable').catch(()=>[]) as string[];
  for(const id of ids){
   if(this.resuming.has(id))continue;this.resuming.add(id);
   try{const reply=await this.resume(id);if(reply)for(const l of this.resumeListeners)l(reply);}
   catch{/* the next sweep will not retry a claimed sortie; its events show where it stopped */}
   finally{this.resuming.delete(id);}
  }
 }
 /** Decisions can come from anywhere (CLI approve, expiry): a periodic sweep catches those the coordinator did not see. */
 startResumer(everyMs=2000){if(!this.resumer)this.resumer=setInterval(()=>{void this.sweep();},everyMs);}
 private async resume(sortieId:string):Promise<ChatReply|null> {
  const claim=await this.nervous.call('misato.claim',{sortieId}) as {request:string;steps:{step:Step}[];decisions:{actionId:string;tool:string;args:Record<string,unknown>;decision:string;result?:unknown;error?:string}[]}|null;
  if(!claim)return null;
  const steps=claim.steps.map(s=>s.step);
  for(const d of claim.decisions){
   const step:Step=d.decision==='approve'
    ?{tool:d.tool,args:d.args,outcome:'grant',reason:d.error?'The owner approved it; it ran and failed.':'The owner approved it; it ran.',...(d.result!==undefined?{result:d.result}:{}),...(d.error?{error:d.error}:{})}
    :{tool:d.tool,args:d.args,outcome:'reject',reason:d.decision==='expired'?'The approval expired before the owner decided; nothing ran.':`The owner did not approve it (${d.decision}); nothing ran.`};
   await this.record(sortieId,steps,step,d.actionId);
  }
  return this.loop(sortieId,claim.request,steps);
 }
 /**
  * Instrumentality (F-022): Misato's exchanges since the last episode → a summary (kept) and candidate facts, each
  * proposed as a memory.remember card. Facts already known are skipped. The ledger is never changed.
  */
 async consolidate(now=new Date()):Promise<{summary?:string;exchanges:number;proposed:number;skipped:number;error?:string}> {
  const last=(await this.nervous.call('memory.episodes',{limit:1}) as {until:string}[])[0];
  const since=last?.until ?? new Date(now.getTime()-86_400_000).toISOString();const until=now.toISOString();
  const exchanges=await this.nervous.call('memory.exchanges',{since,until}) as Exchange[];
  if(!exchanges.length){await this.nervous.call('memory.saveEpisode',{since,until,summary:'',exchanges:0,proposed:0});return {exchanges:0,proposed:0,skipped:0};}
  // A local model occasionally returns an unreadable digest: one more try before giving up until tomorrow.
  const ask=()=>this.brain.call('instrumentality.digest',{exchanges},MODEL_TIMEOUT_MS).catch(()=>({error:'Brain unavailable.'})) as Promise<{digest?:Digest;error?:string}>;
  let out=await ask();if(!out.digest&&out.error==='The digest reply was not readable.')out=await ask();
  if(!out.digest)return {exchanges:exchanges.length,proposed:0,skipped:0,error:out.error ?? 'No digest.'};
  const known=new Set((await this.nervous.call('memory.known',{texts:out.digest.facts}) as string[]));
  const fresh=out.digest.facts.filter(f=>!known.has(f));
  if(fresh.length){
   // An Instrumentality sortie holds the proposals; Casper is not asked (the request is ours, not the owner's), the owner decides each card.
   const sortieId=await this.nervous.call('sorties.open',{title:`Instrumentality: ${fresh.length} fact(s) to confirm`,source:'instrumentality'}) as string;
   for(const text of fresh)await this.gate(sortieId,{request:'Instrumentality: a fact the owner stated, to confirm before it is remembered.',tool:'memory.remember',args:{text}},false);
  }
  await this.nervous.call('memory.saveEpisode',{since,until,summary:out.digest.summary,exchanges:exchanges.length,proposed:fresh.length});
  return {summary:out.digest.summary,exchanges:exchanges.length,proposed:fresh.length,skipped:out.digest.facts.length-fresh.length};
 }
 private instrumentality?:NodeJS.Timeout;
 /**
  * Instrumentality's schedule, read on every tick so a change (by chat or by hand) applies within a minute:
  * at HH:MM once per local day, or when idle (an hour without requests, at most once in 20 hours, only with something new).
  * Each day or idle window is marked attempted before any await, so overlapping ticks never consolidate twice.
  */
 startInstrumentality(schedule:()=>{mode?:{at:string}|{when:'idle'};timeZone:string},everyMs=60_000){
  let attempted:string|undefined;
  const tick=async()=>{
   const {mode,timeZone}=schedule();if(!mode)return;const now=new Date();
   if('at' in mode){
    const day=briefDue(now,timeZone,mode.at,attempted);if(!day)return;attempted=day;
    const last=(await this.nervous.call('memory.episodes',{limit:1}).catch(()=>[]) as {created:string}[])[0];
    if(last&&localClock(new Date(last.created),timeZone).date===day)return;
    await this.consolidate().catch(()=>{});return;
   }
   const hour=now.toISOString().slice(0,13);if(attempted===hour)return;attempted=hour;
   const [last,activity]=await Promise.all([this.nervous.call('memory.episodes',{limit:1}).catch(()=>[]) as Promise<{until:string}[]>,this.nervous.call('memory.lastRequest').catch(()=>null) as Promise<string|null>]);
   const since=last[0]?.until;
   if(!activity||(since&&activity<=since))return;
   if(now.getTime()-Date.parse(activity)<3_600_000)return;
   if(since&&now.getTime()-Date.parse(since)<20*3_600_000)return;
   await this.consolidate().catch(()=>{});
  };
  if(!this.instrumentality)this.instrumentality=setInterval(()=>{void tick();},everyMs);void tick();
 }
 /** Re-reads config.json and the cloud key in the brain, without restarting the service. */
 async reloadModels(){return await this.brain.call('models.reload') as {error?:string;kept?:boolean;models:unknown};}
 async ask(ask:Ask){return await this.brain.call('model.complete',{...ask},MODEL_TIMEOUT_MS) as Reply;}
 async health(){await this.nervous.call('runtime.ping');return {integrityCheck:'not-run',processes:{nervous:this.nervous.child.pid,brain:this.brain.child.pid,brainAlive:this.brain.child.connected}};}
 async doctor(){return {...await this.nervous.call('runtime.doctor') as object,processes:{nervous:this.nervous.child.pid,brain:this.brain.child.pid,brainAlive:this.brain.child.connected},models:await this.brain.call('runtime.ping').then(p=>(p as {models:unknown}).models,()=>'brain unavailable'),agentLoop:'not implemented'};}
 async close(){if(this.resumer)clearInterval(this.resumer);if(this.instrumentality)clearInterval(this.instrumentality);await Promise.allSettled([this.nervous.close(),this.brain.close()]);}
}
