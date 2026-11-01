import {ProcessClient} from './process-client.ts';
import type {Reminder} from './store.ts';
export interface StoreApi {
 list():Reminder[]|Promise<Reminder[]>;
 add(title:string,due:string):Reminder|Promise<Reminder>;
 cancel(id:string):boolean|Promise<boolean>;
 inbox():unknown|Promise<unknown>;
 doctor():object|Promise<object>;
}
export class Runtime implements StoreApi {
 readonly nervous:ProcessClient;readonly brain:ProcessClient;
 constructor(database:string,brainEntry=new URL('./brain-process.ts',import.meta.url)) {
  this.nervous=new ProcessClient(new URL('./nervous-process.ts',import.meta.url),[database],'nervous');
  this.brain=new ProcessClient(brainEntry,[],'brain',1500);
 }
 async ready(){await this.nervous.call('runtime.ping');}
 async list(){return await this.nervous.call('reminders.list') as Reminder[];}
 async add(title:string,due:string){return await this.nervous.call('reminders.add',{title,due}) as Reminder;}
 async cancel(id:string){return await this.nervous.call('reminders.cancel',{id}) as boolean;}
 async inbox(){return this.nervous.call('inbox.list');}
 async doctor(){return {...await this.nervous.call('runtime.doctor') as object,processes:{nervous:this.nervous.child.pid,brain:this.brain.child.pid,brainAlive:this.brain.child.connected},agentLoop:'not implemented'};}
 async close(){await Promise.allSettled([this.nervous.close(),this.brain.close()]);}
}
