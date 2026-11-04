import {ProcessClient} from './process-client.ts';
import type {Reminder,InboxPage} from './store.ts';
import type {Approval,Decision,Event} from './ledger.ts';
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
 decide(id:string,decision:Decision,source?:'api'|'cli'|'telegram'):{decision:string}|Promise<{decision:string}>;
 events(sortieId:string,after?:number,limit?:number):Event[]|Promise<Event[]>;
}
export class Runtime implements StoreApi {
 readonly nervous:ProcessClient;readonly brain:ProcessClient;
 constructor(database:string,brainEntry=new URL('./brain-process.ts',import.meta.url)) {
  this.nervous=new ProcessClient(new URL('./nervous-process.ts',import.meta.url),[database],'nervous');
  this.brain=new ProcessClient(brainEntry,[],'brain',1500);
 }
 async ready(){await this.nervous.call('runtime.ping');}
 async list(){return await this.nervous.call('reminders.list') as Reminder[];}
 async pendingReminders(){return await this.nervous.call('reminders.pending') as Reminder[];}
 async inboxPage(after=0,limit=5,afterId?:string){return await this.nervous.call('inbox.page',{after,limit,...(afterId?{afterId}:{})}) as InboxPage;}
 async add(title:string,due:string){return await this.nervous.call('reminders.add',{title,due}) as Reminder;}
 async cancel(id:string){return await this.nervous.call('reminders.cancel',{id}) as boolean;}
 async inbox(){return this.nervous.call('inbox.list');}
 async approvals(limit=5){return await this.nervous.call('approvals.pending',{limit}) as Approval[];}
 async decide(id:string,decision:Decision,source:'api'|'cli'|'telegram'='api'){return await this.nervous.call('approvals.decide',{id,decision,source}) as {decision:string};}
 async events(sortieId:string,after=0,limit=50){return await this.nervous.call('events.page',{sortieId,after,limit}) as Event[];}
 async health(){await this.nervous.call('runtime.ping');return {integrityCheck:'not-run',processes:{nervous:this.nervous.child.pid,brain:this.brain.child.pid,brainAlive:this.brain.child.connected}};}
 async doctor(){return {...await this.nervous.call('runtime.doctor') as object,processes:{nervous:this.nervous.child.pid,brain:this.brain.child.pid,brainAlive:this.brain.child.connected},agentLoop:'not implemented'};}
 async close(){await Promise.allSettled([this.nervous.close(),this.brain.close()]);}
}
