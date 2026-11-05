import {ProcessClient} from './process-client.ts';
import type {Reminder,InboxPage,ActResult} from './store.ts';
import {degradedReasons,type RouteHealth} from './route-health.ts';
import {detectOllama,ollamaUrlOf,planModels,writeModels,type ModelChange,type ModelSetup} from './model-setup.ts';
import {readConfig,readModelKey} from './config.ts';
import type {ActionDetail,Approval,Decision,SortieSummary} from './ledger.ts';
import {argsHash} from './ledger.ts';
import type {SortieEvent} from './events.ts';
import {MODEL_TIMEOUT_MS,type Ask,type Reply,type RouteName} from './model.ts';
import type {Effect,Pattern,Stage,Verdict} from './policy.ts';
import {askedWhy,explainRecord} from './why.ts';
import {choosePilot,type Pilot} from './pilots.ts';
import {MAX_STEPS,doneReply,type RemoteOffer,requestLanguage,waitingReply,type Plan,type Recalled,type Step,type Turn} from './misato.ts';
import {toolDocs} from './executors.ts';
import type {Digest,Exchange} from './instrumentality.ts';
import type {Episode,Fact} from './memory.ts';
import type {BaseEntry,SignedRecord} from './kaji.ts';
import {ONLINE_MS,type PeerVerdict,type RunItem,type VerdictAsk,type BaseHealth,type HeardHealth,type RegistryPort} from './kaji-link.ts';
import {briefDue,composeBrief,gatherBrief,localClock} from './brief.ts';
/** What the owner reads when another base answered a kaji.run (F-036 slice 3b). */
export function remoteOutcomeText(base:string,tool:string,result:Record<string,unknown>,args:Record<string,unknown>={}):string {
 if(typeof result.refused==='string')return `${base} did not run ${tool}: ${result.refused}.`;
 const o=result.outcome;
 // In plain words (B-011): the item's title or text, from the result or the action's arguments, never raw JSON.
 const r=result.result as Record<string,unknown>|undefined;const about=[r?.title,r?.text,args.title,args.text].find((v):v is string=>typeof v==='string'&&!!v.trim());
 if(o==='grant')return typeof result.error==='string'?`${base} ran ${tool}, and it failed: ${result.error}`:`${base} ran ${tool}${about?` (“${about.slice(0,120)}”)`:''}.`;
 if(o==='approval')return `${base} asks for your approval to run ${tool}: its card is waiting for you.`;
 if(o==='reject')return `${base} refused ${tool}: ${String(result.reason ?? 'its gate said no')}.`;
 return `${base} answered for ${tool}: ${JSON.stringify(result).slice(0,400)}`;
}
export interface ChatReply {sortieId:string;reply?:string;error?:string;steps:Step[];waiting:{approvalId:string;tool:string;reason:string}[];
 /** Set when the main base handled the request (F-036 dispatch): its sortie, cards and memory are there. */
 base?:{id:string;name:string}}
/** An action the owner asks for directly: the request is what Casper checks the action against. */
/** `earlier`: the conversation's previous exchanges, for Casper's intent check (B-010). */
export interface OwnerAction {request:string;tool:string;args:Record<string,unknown>;stage?:Stage;earlier?:{request:string;reply?:string}[]}
export type ActReply=ActResult&{casperError?:string};
export interface StoreApi {
 list():Reminder[]|Promise<Reminder[]>;
 pendingReminders():Reminder[]|Promise<Reminder[]>;
 inboxPage(after?:number,limit?:number,afterId?:string):InboxPage|Promise<InboxPage>;
 add(title:string,due:string):(Reminder&{existing?:true})|Promise<Reminder&{existing?:true}>;
 update(id:string,patch:{title?:string;due?:string}):Reminder|undefined|null|Promise<Reminder|undefined|null>;
 cancel(id:string):boolean|Promise<boolean>;
 inbox():unknown|Promise<unknown>;
 doctor():object|Promise<object>;
 health():object|Promise<object>;
 approvals(limit?:number):Approval[]|Promise<Approval[]>;
 expiredApprovals?(since:string):{tool:string;sortieId:string;title:string;expired:string}[]|Promise<{tool:string;sortieId:string;title:string;expired:string}[]>;
 decide(id:string,decision:Decision,source?:'api'|'cli'|'telegram'):{decision:string;result?:unknown;error?:string}|Promise<{decision:string;result?:unknown;error?:string}>;
 act?(action:OwnerAction):Promise<ActReply>;
 chat?(message:string,conversation?:string):Promise<ChatReply>;
 onResumed?(listener:(reply:ChatReply)=>void):void;
 reloadModels?():Promise<{error?:string;kept?:boolean;models:unknown}>;
 modelSetup?():Promise<ModelSetup>;
 changeModels?(change:ModelChange):Promise<{error?:string;kept?:boolean;models:unknown}>;
 /** Kaji bases with their live status (F-036): online when heard from within the last 90 s. */
 bases?():Promise<(BaseEntry&{lastSeen:string|null;online:boolean;self:boolean})[]>;
 /** Lilith for the owner (dashboard): admin-only over REST, never on the read-only socket. */
 lilith?:{list():Promise<Fact[]>;episodes():Promise<Episode[]>;add(text:string):Promise<Fact>;edit(id:string,text:string):Promise<Fact|null>;forget(id:string):Promise<boolean>;share(id:string,shareable:boolean):Promise<Fact|null>;history(id:string):Promise<unknown[]>};
 consolidate?():Promise<{summary?:string;exchanges:number;proposed:number;skipped:number;error?:string}>;
 spear?(id:string,reason:string):Promise<{revoked:number;stoodDown:number;happened:{actionId:string;tool:string;inverse:string|null}[]}|null>;
 events(sortieId:string,after?:number,limit?:number):SortieEvent[]|Promise<SortieEvent[]>;
 sorties(limit?:number,before?:string,q?:string):SortieSummary[]|Promise<SortieSummary[]>;
 closedSince?(since:string):{done:number;failed:number;failures:{id:string;title:string;closed:string}[]}|Promise<{done:number;failed:number;failures:{id:string;title:string;closed:string}[]}>;
 sortie(id:string):(SortieSummary&{detail:ActionDetail[]})|null|Promise<(SortieSummary&{detail:ActionDetail[]})|null>;
 ask?(ask:Ask):Promise<Reply>;
}
export class Runtime implements StoreApi {
 readonly nervous:ProcessClient;readonly brain:ProcessClient;
 private readonly home:string|undefined;
 constructor(database:string,brainEntry=new URL('./brain-process.ts',import.meta.url),home?:string) {
  this.home=home;
  this.nervous=new ProcessClient(new URL('./nervous-process.ts',import.meta.url),home?[database,home]:[database],'nervous');
  this.brain=new ProcessClient(brainEntry,home?[home]:[],'brain',1500);
 }
 async ready(){await this.nervous.call('runtime.ping');}
 async list(){return await this.nervous.call('reminders.list') as Reminder[];}
 async pendingReminders(){return await this.nervous.call('reminders.pending') as Reminder[];}
 async inboxPage(after=0,limit=5,afterId?:string){return await this.nervous.call('inbox.page',{after,limit,...(afterId?{afterId}:{})}) as InboxPage;}
 async add(title:string,due:string){return await this.nervous.call('reminders.add',{title,due}) as Reminder&{existing?:true};}
 async update(id:string,patch:{title?:string;due?:string}){return await this.nervous.call('reminders.update',{id,...patch}) as Reminder|null;}
 async cancel(id:string){return await this.nervous.call('reminders.cancel',{id}) as boolean;}
 async inbox(){return this.nervous.call('inbox.list');}
 async expiredApprovals(since:string){return await this.nervous.call('approvals.expired',{since}) as {tool:string;sortieId:string;title:string;expired:string}[];}
 async approvals(limit=5){return await this.nervous.call('approvals.pending',{limit}) as Approval[];}
 async decide(id:string,decision:Decision,source:'api'|'cli'|'telegram'='api'){const result=await this.nervous.call('approvals.decide',{id,decision,source}) as {decision:string;result?:unknown;error?:string};if(this.resumer)void this.sweep();return result;}
 /** Spear of Longinus for one sortie: revoke its unused grants, stand down its cards, close it; executed effects are reported. */
 async spear(id:string,reason:string){if(!await this.sortie(id))return null;return await this.nervous.call('sorties.spear',{id,reason}) as {revoked:number;stoodDown:number;happened:{actionId:string;tool:string;inverse:string|null}[]};}
 async closedSince(since:string){return await this.nervous.call('sorties.closedSince',{since}) as {done:number;failed:number;failures:{id:string;title:string;closed:string}[]};}
 async sorties(limit=20,before?:string,q?:string){return await this.nervous.call('sorties.list',{limit,...(before?{before}:{}),...(q?{q}:{})}) as SortieSummary[];}
 async sortie(id:string){return await this.nervous.call('sorties.get',{id}) as (SortieSummary&{detail:ActionDetail[]})|null;}
 async events(sortieId:string,after=0,limit=50){return await this.nervous.call('events.page',{sortieId,after,limit}) as SortieEvent[];}
 /** Coordinator side of the gate: open the sortie, ask Casper only for Orange/Blue, then ballot and (on a grant) run in the scheduler process. */
 async act(action:OwnerAction):Promise<ActReply> {
  const sortieId=await this.nervous.call('sorties.open',{title:action.request.slice(0,500)}) as string;
  return this.gate(sortieId,action);
 }
 /** The other bases' votes on a non-Green action (F-036 phase 2), set by serve on the main base. */
 private peerSeats?:(ask:VerdictAsk)=>Promise<Verdict[]>;
 setPeerSeats(fn:(ask:VerdictAsk)=>Promise<Verdict[]>){this.peerSeats=fn;}
 /** On the base asked: this base's Casper votes on the main base's action; no local model means no verdict (abstain). */
 async peerVerdict(ask:VerdictAsk):Promise<PeerVerdict|null> {
  const reply=await this.brain.call('casper.verdict',{request:ask.request,tool:ask.tool,args:ask.args,effect:ask.effect},MODEL_TIMEOUT_MS).catch(()=>({verdict:null})) as {verdict:Verdict|null};
  return reply.verdict?{vote:reply.verdict.vote,reason:reply.verdict.reason,...(typeof reply.verdict.confidence==='number'?{confidence:reply.verdict.confidence}:{})}:null;
 }
 private async gate(sortieId:string,action:OwnerAction,askCasper=true):Promise<ActReply> {
  const {pattern,effect,intent}=await this.nervous.call('actions.preview',{sortieId,tool:action.tool}) as {pattern:Pattern;effect:Effect;intent?:boolean};
  let casper:Verdict|undefined,casperError:string|undefined;let extras:Verdict[]=[];
  // Casper (and the other bases' seats) for anything not Green, and for every removal even when Green (B-009).
  if((intent ?? pattern!=='green')&&askCasper){
   // B-012: for an action on another base, Casper is told the bases by id and name.
   const bases=action.tool==='kaji.run'?await this.baseNames():[];
   // The other bases' Casper (F-036 phase 2) is asked at the same time: veto-only seats, shadow until the owner trusts them.
   const [reply,peers]=await Promise.all([
    this.brain.call('casper.verdict',{request:action.request,tool:action.tool,args:action.args,effect,...(bases.length?{bases}:{}),...(action.earlier?.length?{earlier:action.earlier.slice(-3).map(t=>({request:t.request.slice(0,600),...(t.reply?{reply:t.reply.slice(0,600)}:{})}))}:{})},MODEL_TIMEOUT_MS).catch(()=>({verdict:null,error:'Brain unavailable.'})) as Promise<{verdict:Verdict|null;error?:string}>,
    this.peerSeats?this.peerSeats({request:action.request,tool:action.tool,args:action.args,effect}).catch(()=>[] as Verdict[]):Promise.resolve([] as Verdict[])]);
   if(reply.verdict)casper=reply.verdict;else casperError=reply.error ?? 'No verdict.';
   extras=peers;
  }
  const result=await this.nervous.call('actions.act',{sortieId,tool:action.tool,args:action.args,stage:action.stage ?? 'production',...(casper?{casper}:{}),...(extras.length?{extras}:{})}) as ActResult;
  return casperError?{...result,casperError}:result;
 }
 /** A new request to Misato (F-003): its text and every step go to the ledger, so the loop can resume later. */
 /** F-036 dispatch: while another base is the main one and online, requests go to its Misato; undefined means answer here. */
 private dispatch?:(message:string,conversation?:string)=>Promise<ChatReply|undefined>;
 setDispatch(fn:(message:string,conversation?:string)=>Promise<ChatReply|undefined>){this.dispatch=fn;}
 private pilots?:()=>Pilot[];
 /** The pilot roster (F-045), read on every request so a change applies without a restart. */
 setPilots(fn:()=>Pilot[]){this.pilots=fn;}
 async chat(message:string,conversation?:string):Promise<ChatReply> {
  const far=this.dispatch?await this.dispatch(message,conversation):undefined;if(far)return far;
  // Earlier exchanges of the same conversation (read before this request is recorded), so "yes" has its question.
  const context=conversation?await this.nervous.call('misato.context',{conversation}).catch(()=>[]) as Turn[]:[];
  const sortieId=await this.nervous.call('sorties.open',{title:message.slice(0,500),source:'misato'}) as string;
  await this.note(sortieId,'misato.request',{text:message,...(conversation?{conversation}:{})});
  // B-004: "why S-1A2B …?" is answered from the ledger, never by the model (which has no tool to read it and guessed).
  const ref=askedWhy(message);
  if(ref){const found=await this.nervous.call('sorties.explain',{ref}) as Parameters<typeof explainRecord>[0];
   const reply=explainRecord(found,ref,requestLanguage(message,context.map(t=>t.request)),Intl.DateTimeFormat().resolvedOptions().timeZone);
   await this.nervous.call('sorties.finish',{sortieId,status:'done',reply});return {sortieId,reply,steps:[],waiting:[]};}
  return this.loop(sortieId,message,[],context);
 }
 private note(sortieId:string,kind:'misato.request'|'misato.step'|'misato.waiting'|'misato.consult',payload:object){return this.nervous.call('misato.note',{sortieId,kind,payload});}
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
  const waiting:ChatReply['waiting']=[];
  // LCL fill: Lilith's facts that match this request and its recent conversation.
  const memory=await this.nervous.call('memory.recall',{text:[message,...context.map(t=>t.request)].join(' ').slice(0,8000)}).catch(()=>[]) as Recalled[];
  const finish=async(status:'done'|'failed',reply?:string,error?:string):Promise<ChatReply>=>{
   if(waiting.length&&reply){
    // Not finished: the reply is recorded, the sortie waits for the owner's decisions and then resumes.
    await this.nervous.call('sorties.finish',{sortieId,reply});await this.note(sortieId,'misato.waiting',{approvalIds:waiting.map(w=>w.approvalId)});
   }else await this.nervous.call('sorties.finish',{sortieId,status,...(reply?{reply}:{})});
   return {sortieId,...(reply?{reply}:{}),...(error?{error}:{}),steps,waiting};
  };
  const lang=()=>requestLanguage(message,context.map(t=>t.request));
  const ranSteps=()=>steps.filter(s=>s.outcome==='grant'&&!s.error&&s.tool).map(s=>({tool:s.tool!,args:s.args ?? {}}));
  // F-025: a consultant's advice, once per request before the first step (not again on a resume); no vote, no action.
  // F-045: the specialist pilot whose keywords fit the request advises; none fits, the generic pilot (roles.consultant).
  const pilot=steps.length?undefined:(()=>{try{return choosePilot(message,this.pilots?.() ?? []);}catch{return undefined;}})();
  const named=steps.length?[]:await this.baseNames();
  const advice=steps.length?undefined:await this.brain.call('consultant.advise',{request:message.slice(0,4000),...(context.length?{context:context.slice(-3)}:{}),...(pilot?{pilot:{name:pilot.name,domain:pilot.domain,model:pilot.model}}:{}),...(named.length>1?{bases:named}:{})},MODEL_TIMEOUT_MS).then(r=>r as {advice:string|null;model?:string},()=>({advice:null})).then(async r=>{
   if(!r.advice)return undefined;await this.note(sortieId,'misato.consult',{advice:r.advice,model:r.model ?? '',...(pilot?{pilot:{id:pilot.id,name:pilot.name,why:pilot.why}}:{})});return r.advice;});
  for(let turn=0;turn<MAX_STEPS;turn++){
   const remote=await this.remoteOffers();
   const out=await this.brain.call('misato.step',{request:message,history:steps.slice(-12),...(remote.length?{remote}:{}),...(advice?{advice}:{}),language:lang(),...(context.length?{context}:{}),...(memory.length?{memory:memory.slice(0,10)}:{})},MODEL_TIMEOUT_MS).catch(()=>({error:'Brain unavailable.'})) as {plan?:Plan;invalid?:boolean;error?:string};
   if(out.error)return finish('failed',undefined,out.error);
   if(!out.plan){await this.record(sortieId,steps,{outcome:'invalid',error:'Reply was not one JSON action or reply.'});continue;}
   if('reply' in out.plan)return finish('done',out.plan.reply);
   const {tool,args}=out.plan.action;
   // A tool Misato was not offered (often a misspelling) has no executor: it goes back to Misato, never to the owner as a card.
   // kaji.run (F-036 slice 3b): only to a base online now, for an action it offers; anything else goes back to Misato.
   if(tool==='kaji.run'){const a=args as {base?:unknown;tool?:unknown};const offer=remote.find(r=>r.base===a.base);
    if(!offer||typeof a.tool!=='string'||!offer.tools.includes(a.tool)){await this.record(sortieId,steps,{tool,args,outcome:'invalid',error:offer?`${offer.name} does not offer "${String(a.tool)}". It offers: ${offer.tools.join(', ')}.`:`No base by that id is online and offering actions. Online: ${remote.map(r=>r.base).join(', ') || 'none'}.`});continue;}}
   else if(!toolDocs.some(t=>t.name===tool)){await this.record(sortieId,steps,{tool,args,outcome:'invalid',error:`Unknown tool "${tool}". Use exactly one of: ${toolDocs.map(t=>t.name).join(', ')}.`});continue;}
   // The same action already ran in this sortie: running it again is never the owner's wish (a small model loops here).
   if(steps.some(s=>s.tool===tool&&s.outcome==='grant'&&!s.error&&argsHash(s.args ?? {})===argsHash(args)))return finish('done',doneReply(lang(),ranSteps()));
   // An action the ledger refuses outright (malformed, oversized) never reached a ballot: Misato sees it as invalid.
   const r=await this.gate(sortieId,{request:message,tool,args,...(context.length?{earlier:context.slice(-3)}:{})}).catch(()=>({outcome:'invalid' as const,reason:'The gate refused this action as malformed (unknown shape or too large).'}));
   // Spelled out for the planner when it resumes: an action waiting for the owner has not happened.
   const reason=r.outcome==='approval'?`Waiting for the owner's approval; NOT done yet. ${r.reason ?? ''}`.trim():r.reason;
   await this.record(sortieId,steps,{tool,args,outcome:r.outcome,...(reason?{reason}:{}),...('result' in r&&r.result!==undefined?{result:r.result}:{}),...('error' in r&&r.error?{error:r.error}:{})},'actionId' in r?r.actionId:undefined);
   // A card ends the turn: the reply is the service's, and Misato carries on after the owner decides (F-033 resume),
   // so the model is never asked to describe an action that is only waiting.
   if('approvalId' in r&&r.approvalId){waiting.push({approvalId:r.approvalId,tool,reason:r.reason});return finish('done',waitingReply(requestLanguage(message,context.map(t=>t.request)),tool,args));}
  }
  // At the step limit, what did run is reported as done rather than "could not finish".
  if(ranSteps().length)return finish('done',doneReply(lang(),ranSteps()));
  return finish('failed',undefined,`Step limit (${MAX_STEPS}) reached.`);
 }
 private resumeListeners:((reply:ChatReply)=>void)[]=[];private resuming=new Set<string>();private resumer?:NodeJS.Timeout;
 /** Called with Misato's follow-up after a resume (Aoba sends it to the owner). */
 onResumed(listener:(reply:ChatReply)=>void){this.resumeListeners.push(listener);}
 /** What each other base said it lets the main base run there (F-036 slice 3b), from its own heartbeat. */
 private readonly offersHeard=new Map<string,{tools:string[];at:number}>();
 notePeerOffers(baseId:string,tools:string[]){this.offersHeard.set(baseId,{tools,at:Date.now()});}
 /** Bases online now with something on offer: what Misato may send with kaji.run. */
 /** Every enrolled base by id and name (this one included), for Casper and the consultant (B-012); none without the Kaji line. */
 async baseNames():Promise<{id:string;name:string}[]> {try{return (await this.bases()).filter(b=>b.status==='enrolled').slice(0,20).map(b=>({id:b.baseId.slice(0,16),name:b.name.slice(0,60)}));}catch{return [];}}
 async remoteOffers():Promise<RemoteOffer[]> {
  if(!this.offersHeard.size)return [];
  const bases=await this.bases().catch(()=>[]);
  return bases.filter(b=>!b.self&&b.online&&b.status==='enrolled').flatMap(b=>{const o=this.offersHeard.get(b.baseId);return o&&o.tools.length&&Date.now()-o.at<ONLINE_MS?[{base:b.baseId,name:b.name,tools:o.tools}]:[];});
 }
 /**
  * Sends the actions queued by kaji.run (F-036 slice 3b), oldest first, each with the same id every time until it reached
  * the base (which runs it once through its own gate and remembers the id). The result reaches the owner as a follow-up.
  */
 startOutbox(send:(base:string,item:RunItem)=>Promise<{reached:boolean;result?:unknown;refused?:string}>,everyMs=3000){
  let busy=false;
  const tick=async()=>{if(busy)return;busy=true;
   try{
    for(const q of await this.nervous.call('kaji.outbox') as {id:string;sortieId:string;base:string;tool:string;args:Record<string,unknown>;request:string}[]){
     const r=await send(q.base,{id:q.id,request:q.request,tool:q.tool,args:q.args});if(!r.reached)continue;
     const result=(r.refused?{refused:r.refused}:r.result ?? {}) as Record<string,unknown>;
     const name=(await this.bases().catch(()=>[])).find(b=>b.baseId===q.base)?.name ?? q.base;
     const reply=remoteOutcomeText(name,q.tool,result,q.args);
     // B-011: recorded on the sortie too, so the trace, the dashboard and the "why" answer show what the other base did.
     await this.nervous.call('kaji.outboxDone',{id:q.id,result,said:{base:name,text:reply}});
     for(const l of this.resumeListeners)l({sortieId:q.sortieId,reply,steps:[],waiting:[]});
    }
   }catch{/* the next tick tries again */}finally{busy=false;}
  };
  if(!this.outboxTimer)this.outboxTimer=setInterval(()=>{void tick();},everyMs);void tick();
 }
 private outboxTimer?:NodeJS.Timeout;
 /** On the base asked (F-036 slice 3b): an action the main base sent, run once per id, only if this base offers it, and
     always through this base's own gate (it may run, ask the owner with a card, or refuse). */
 async runFromPeer(from:string,item:RunItem,offered:string[]):Promise<unknown> {
  const seen=await this.nervous.call('kaji.remoteRun',{id:item.id});if(seen)return seen;
  const result=!offered.includes(item.tool)?{refused:`this base does not offer ${item.tool} (on it: kaji offer)`}
   :await this.act({request:`From ${from}: ${item.request || item.tool}`.slice(0,4000),tool:item.tool,args:item.args}).catch((e:unknown)=>({outcome:'invalid',error:e instanceof Error?e.message:'failed'}));
  await this.nervous.call('kaji.saveRemoteRun',{id:item.id,from,result:result as unknown as Record<string,unknown>});return result;
 }
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
 /** The scheduler-process side of the Kaji link's registry. */
 readonly kaji:RegistryPort={
  bases:async()=>await this.nervous.call('kaji.bases') as BaseEntry[],
  records:async()=>await this.nervous.call('kaji.records') as SignedRecord[],
  add:async(records)=>await this.nervous.call('kaji.add',{records}) as number,
  seen:async(updates)=>{await this.nervous.call('kaji.seen',{updates});},
  lastSeen:async()=>await this.nervous.call('kaji.lastSeen') as Record<string,string>,
  main:async()=>(await this.nervous.call('kaji.main') as string|null) ?? undefined,
 };
 private selfKey?:string;
 /** Marks which entry is this base (by its public key) for the dashboard. */
 setBaseKey(publicKey:string){this.selfKey=publicKey;}
 /** Peers' health as each one last reported it over the Kaji line (F-036 phase 2); kept in memory, refilled within a heartbeat. */
 private readonly heard=new Map<string,HeardHealth>();
 notePeerHealth(baseId:string,health:HeardHealth){this.heard.set(baseId,health);}
 /** This base's health as it reports it to its peers: degraded with the reasons doctor and status give. */
 async baseHealth():Promise<BaseHealth> {
  const h=await this.health();const reasons=[...new Set([...(h.processes.brainAlive===false?['brain process not alive']:[]),...h.degraded])].slice(0,3);
  return {state:reasons.length?'degraded':'online',reasons};
 }
 async bases(){const [list,seen,main]=await Promise.all([this.kaji.bases(),this.kaji.lastSeen(),this.kaji.main?.()]);const now=Date.now();
  const mine=await this.baseHealth().catch(():BaseHealth=>({state:'degraded',reasons:['health check failed']}));
  return list.map(b=>{const self=b.publicKey===this.selfKey;const online=b.status==='enrolled'&&(self||(!!seen[b.baseId]&&now-Date.parse(seen[b.baseId]!)<ONLINE_MS));
   // A peer's report counts only while it is online; an older base that sends none has health null (online/offline only).
   const heard=this.heard.get(b.baseId);const health=self?{...mine,at:new Date(now).toISOString()}:online&&heard&&now-Date.parse(heard.at)<ONLINE_MS?heard:null;
   return {...b,lastSeen:seen[b.baseId] ?? null,online,self,health,main:b.baseId===main};});}
 /** The owner's main base as this base sees it (F-036 phase 2): whether it is this base and whether it is online now. */
 async mainBase():Promise<{baseId:string;self:boolean;online:boolean}|undefined> {
  const main=await this.kaji.main?.();if(!main)return undefined;
  const b=(await this.bases()).find(x=>x.baseId===main);return b?{baseId:main,self:b.self,online:b.online}:undefined;
 }
 readonly lilith={
  list:async()=>await this.nervous.call('memory.list',{limit:200}) as Fact[],
  episodes:async()=>await this.nervous.call('memory.episodes',{limit:10}) as Episode[],
  add:async(text:string)=>await this.nervous.call('memory.add',{text}) as Fact,
  edit:async(id:string,text:string)=>await this.nervous.call('memory.edit',{id,text}) as Fact|null,
  forget:async(id:string)=>await this.nervous.call('memory.forget',{id}) as boolean,
  share:async(id:string,shareable:boolean)=>await this.nervous.call('memory.share',{id,shareable}) as Fact|null,
  history:async(id:string)=>await this.nervous.call('memory.history',{id}) as unknown[],
 };
 private instrumentality?:NodeJS.Timeout;
 /**
  * Instrumentality's schedule, read on every tick so a change (by chat or by hand) applies within a minute:
  * at HH:MM once per local day, or when idle (an hour without requests, at most once in 20 hours, only with something new).
  * Each day or idle window is marked attempted before any await, so overlapping ticks never consolidate twice.
  */
 /**
  * Hyuga's brief (F-003, F-028), written into the inbox once a local day at its time, so every channel delivers it from
  * there (Telegram, the menu-bar app, the dashboard) and none sends it twice. The schedule is read on every tick, so a
  * change by chat applies within a minute. `initial` is the last brief sent before briefs lived in the inbox.
  */
 startBrief(schedule:()=>{at:string;timeZone:string;language:'it'|'en';base?:string}|undefined,initial?:string,everyMs=60_000){
  let attempted:string|undefined;
  const tick=async()=>{
   const b=schedule();if(!b)return;const now=new Date();
   const last=await this.nervous.call('inbox.lastBrief').catch(()=>null) as string|null ?? initial ?? null;
   const date=briefDue(now,b.timeZone,b.at,last?localClock(new Date(last),b.timeZone).date:undefined);if(!date||attempted===date)return;attempted=date;
   const facts=await gatherBrief(this,last?new Date(last):new Date(now.getTime()-86_400_000));
   await this.nervous.call('inbox.brief',{message:composeBrief({now,timeZone:b.timeZone,language:b.language,...(b.base?{base:b.base}:{}),...facts})}).catch(()=>{attempted=undefined;});
  };
  if(!this.briefTimer)this.briefTimer=setInterval(()=>{void tick();},everyMs);void tick();
 }
 private briefTimer?:NodeJS.Timeout;
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
 /** F-038: the model settings (never the key), whether the key is there, and what Ollama has. */
 async modelSetup():Promise<ModelSetup> {
  if(!this.home)throw new Error('Model setup needs the data home.');
  const models=readConfig(this.home).models;let cloudKey=false;try{cloudKey=!!readModelKey(this.home);}catch{cloudKey=false;}
  return {models,cloudKey,ollama:await detectOllama(ollamaUrlOf(models))};
 }
 /** Applies a change (validated, checked against Ollama's models), writes config.json and reloads the brain in place. */
 async changeModels(change:ModelChange) {
  if(!this.home)throw new Error('Model setup needs the data home.');
  const current=readConfig(this.home).models;const ollama=await detectOllama(change.localUrl ?? ollamaUrlOf(current));
  writeModels(this.home,planModels(current,change,ollama.reachable?ollama.models.map(m=>m.name):undefined));
  return this.reloadModels();
 }
 async reloadModels(){return await this.brain.call('models.reload') as {error?:string;kept?:boolean;models:unknown};}
 async ask(ask:Ask){return await this.brain.call('model.complete',{...ask},MODEL_TIMEOUT_MS) as Reply;}
 /** The brain's view of the model routes (F-030); a brain that does not answer is itself the degraded reason. */
 private async routes():Promise<{routes?:Record<RouteName,RouteHealth>;degraded:string[]}> {
  try{const p=await this.brain.call('runtime.ping',{},2000) as {routes?:Record<RouteName,RouteHealth>};return {...(p.routes?{routes:p.routes}:{}),degraded:p.routes?degradedReasons(p.routes):[]};}
  catch{return {degraded:['brain process not answering: model-needing requests fail until it is back']};}
 }
 async health(){await this.nervous.call('runtime.ping');const r=await this.routes();return {integrityCheck:'not-run',processes:{nervous:this.nervous.child.pid,brain:this.brain.child.pid,brainAlive:this.brain.child.connected},...r};}
 async doctor(){return {...await this.nervous.call('runtime.doctor') as object,processes:{nervous:this.nervous.child.pid,brain:this.brain.child.pid,brainAlive:this.brain.child.connected},models:await this.brain.call('runtime.ping').then(p=>(p as {models:unknown}).models,()=>'brain unavailable'),...await this.routes(),localModels:await this.localModels(),agentLoop:'not implemented'};}
 /** F-037: the models this base can use on its local route (Ollama's list), for doctor; unknown without a data home. */
 private async localModels():Promise<{reachable:boolean;url:string;models:string[]}|undefined> {
  if(!this.home)return undefined;let url;try{url=ollamaUrlOf(readConfig(this.home).models);}catch{return undefined;}
  const found=await detectOllama(url);return {reachable:found.reachable,url:found.url,models:found.models.map(m=>m.name)};
 }
 async close(){if(this.outboxTimer)clearInterval(this.outboxTimer);if(this.briefTimer)clearInterval(this.briefTimer);if(this.resumer)clearInterval(this.resumer);if(this.instrumentality)clearInterval(this.instrumentality);await Promise.allSettled([this.nervous.close(),this.brain.close()]);}
}
