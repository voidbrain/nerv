import {ProcessClient} from './process-client.ts';
import type {Reminder,InboxPage,ActResult} from './store.ts';
import type {Approval,Decision} from './ledger.ts';
import type {SortieEvent} from './events.ts';
import {MODEL_TIMEOUT_MS,type Ask,type Reply} from './model.ts';
import type {Effect,Pattern,Stage,Verdict} from './policy.ts';
import {MAX_STEPS,type Plan,type Step} from './misato.ts';
import {argsHash} from './ledger.ts';
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
 chat?(message:string):Promise<ChatReply>;
 reloadModels?():Promise<{error?:string;kept?:boolean;models:unknown}>;
 events(sortieId:string,after?:number,limit?:number):SortieEvent[]|Promise<SortieEvent[]>;
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
 async decide(id:string,decision:Decision,source:'api'|'cli'|'telegram'='api'){return await this.nervous.call('approvals.decide',{id,decision,source}) as {decision:string;result?:unknown;error?:string};}
 async events(sortieId:string,after=0,limit=50){return await this.nervous.call('events.page',{sortieId,after,limit}) as SortieEvent[];}
 /** Coordinator side of the gate: open the sortie, ask Casper only for Orange/Blue, then ballot and (on a grant) run in the scheduler process. */
 async act(action:OwnerAction):Promise<ActReply> {
  const sortieId=await this.nervous.call('sorties.open',{title:action.request.slice(0,500)}) as string;
  return this.gate(sortieId,action);
 }
 private async gate(sortieId:string,action:OwnerAction):Promise<ActReply> {
  const {pattern,effect}=await this.nervous.call('actions.preview',{sortieId,tool:action.tool}) as {pattern:Pattern;effect:Effect};
  let casper:Verdict|undefined,casperError:string|undefined;
  if(pattern!=='green'){
   const reply=await this.brain.call('casper.verdict',{request:action.request,tool:action.tool,args:action.args,effect},MODEL_TIMEOUT_MS).catch(()=>({verdict:null,error:'Brain unavailable.'})) as {verdict:Verdict|null;error?:string};
   if(reply.verdict)casper=reply.verdict;else casperError=reply.error ?? 'No verdict.';
  }
  const result=await this.nervous.call('actions.act',{sortieId,tool:action.tool,args:action.args,stage:action.stage ?? 'production',...(casper?{casper}:{})}) as ActResult;
  return casperError?{...result,casperError}:result;
 }
 /**
  * Misato's loop (F-003): plan one action, gate it, show Misato the outcome, repeat until Misato replies or the step
  * limit is reached. Actions waiting for the owner stay waiting; their approval runs them later.
  */
 async chat(message:string):Promise<ChatReply> {
  const sortieId=await this.nervous.call('sorties.open',{title:message.slice(0,500),source:'misato'}) as string;
  const steps:Step[]=[];const waiting:ChatReply['waiting']=[];const pending=new Set<string>();
  const finish=async(status:'done'|'failed',reply?:string,error?:string):Promise<ChatReply>=>{
   await this.nervous.call('sorties.finish',{sortieId,status,...(reply?{reply}:{})});
   return {sortieId,...(reply?{reply}:{}),...(error?{error}:{}),steps,waiting};
  };
  for(let turn=0;turn<MAX_STEPS;turn++){
   const out=await this.brain.call('misato.step',{request:message,history:steps},MODEL_TIMEOUT_MS).catch(()=>({error:'Brain unavailable.'})) as {plan?:Plan;invalid?:boolean;error?:string};
   if(out.error)return finish('failed',undefined,out.error);
   if(!out.plan){steps.push({outcome:'invalid',error:'Reply was not one JSON action or reply.'});continue;}
   if('reply' in out.plan)return finish('done',out.plan.reply);
   const {tool,args}=out.plan.action;
   // The same action already waits for the owner: a second card would ask twice for one decision.
   const same=tool+':'+argsHash(args);
   if(pending.has(same)){steps.push({tool,args,outcome:'invalid',error:'This exact action already waits for the owner. Do not propose it again; reply instead.'});continue;}
   // An action the ledger refuses outright (malformed, oversized) never reached a ballot: Misato sees it as invalid.
   const r=await this.gate(sortieId,{request:message,tool,args}).catch(()=>({outcome:'invalid' as const,reason:'The gate refused this action as malformed (unknown shape or too large).'}));
   if(r.outcome==='approval')pending.add(same);
   // Spelled out for the planner: an action waiting for the owner has not happened.
   const reason=r.outcome==='approval'?`Waiting for the owner's approval; NOT done yet. ${r.reason ?? ''}`.trim():r.reason;
   steps.push({tool,args,outcome:r.outcome,...(reason?{reason}:{}),...('result' in r&&r.result!==undefined?{result:r.result}:{}),...('error' in r&&r.error?{error:r.error}:{})});
   if('approvalId' in r&&r.approvalId)waiting.push({approvalId:r.approvalId,tool,reason:r.reason});
  }
  return finish('failed',undefined,`Step limit (${MAX_STEPS}) reached.`);
 }
 /** Re-reads config.json and the cloud key in the brain, without restarting the service. */
 async reloadModels(){return await this.brain.call('models.reload') as {error?:string;kept?:boolean;models:unknown};}
 async ask(ask:Ask){return await this.brain.call('model.complete',{...ask},MODEL_TIMEOUT_MS) as Reply;}
 async health(){await this.nervous.call('runtime.ping');return {integrityCheck:'not-run',processes:{nervous:this.nervous.child.pid,brain:this.brain.child.pid,brainAlive:this.brain.child.connected}};}
 async doctor(){return {...await this.nervous.call('runtime.doctor') as object,processes:{nervous:this.nervous.child.pid,brain:this.brain.child.pid,brainAlive:this.brain.child.connected},models:await this.brain.call('runtime.ping').then(p=>(p as {models:unknown}).models,()=>'brain unavailable'),agentLoop:'not implemented'};}
 async close(){await Promise.allSettled([this.nervous.close(),this.brain.close()]);}
}
