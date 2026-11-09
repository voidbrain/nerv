import type { Tool } from './policy.ts';
import type { Reminder } from './store.ts';
import type { ToolDoc } from './misato.ts';
import type { Memory } from './memory.ts';
import { readConfig, savePilots, setSchedule } from './config.ts';
/**
 * Built-in tools with an executor in the scheduler process (F-017). Each declares its effect class for the gate; an
 * executor runs only after `Ledger.authorize` accepted the grant for these exact arguments.
 */
export interface ReminderBackend {pendingReminders(limit?:number):Reminder[];add(title:string,due:string):Reminder&{existing?:true};cancel(id:string):boolean;restore(id:string):boolean;memory:Memory;home?:string;
 /** F-036 slice 3b: queues one action for another base; the coordinator sends it over the Kaji line. */
 queueRemote?(sortieId:string,base:string,tool:string,args:Record<string,unknown>):{id:string}}
export const builtinTools:Tool[]=[
 {name:'reminders.list',effect:'read'},
 {name:'reminders.add',effect:'write-local',inverse:'reminders.cancel'},
 {name:'reminders.cancel',effect:'write-local',inverse:'reminders.restore',removes:true},
 {name:'reminders.restore',effect:'write-local',inverse:'reminders.cancel'},
 {name:'memory.recall',effect:'read'},
 // A new fact is only stored after the owner approves its card: Misato never writes memory on its own.
 {name:'memory.remember',effect:'write-local',inverse:'memory.forget',owner:true},
 {name:'memory.forget',effect:'write-local',removes:true},
 // Only the brief and Instrumentality schedules: local, reversible by setting the previous values back.
 {name:'settings.schedule',effect:'write-local',inverse:'settings.schedule'},
 // F-045: a new pilot only after the owner approves its card.
 {name:'pilots.create',effect:'write-local',owner:true},
 // F-036 slice 3b: one action on another base. Owner-only for now (always a card); that base's own gate reviews it again.
 {name:'kaji.run',effect:'write-external',owner:true},
];
const text=(args:Record<string,unknown>,key:string)=>{const v=args[key];if(typeof v!=='string')throw new Error(`Argument ${key} must be a string.`);return v;};
const only=(args:Record<string,unknown>,keys:string[])=>{if(Object.keys(args).some(k=>!keys.includes(k)))throw new Error(`Arguments allowed: ${keys.join(', ')||'none'}.`);};
/** What Misato is told about each built-in tool. */
export const toolDocs:ToolDoc[]=[
 {name:'reminders.list',effect:'read',about:'Lists pending reminders (up to 20). The owner may call reminders notes, promemoria or note.',args:'none, {}'},
 {name:'reminders.add',effect:'write-local',about:'Adds a reminder delivered to the local inbox when due.',args:'{"title": text up to 500 characters, "due": ISO 8601 date-time in the future with an explicit offset}'},
 {name:'reminders.cancel',effect:'write-local',about:'Cancels pending reminders by id from reminders.list; several at once with ids. Undo with reminders.restore.',args:'{"id": reminder id} or {"ids": [up to 20 reminder ids]}'},
 {name:'reminders.restore',effect:'write-local',about:'Restores cancelled reminders that are still in the future.',args:'{"id": reminder id} or {"ids": [up to 20 reminder ids]}'},
 {name:'memory.recall',effect:'read',about:'Searches the facts the owner confirmed earlier (Lilith) by keywords.',args:'{"query": words to look for}'},
 {name:'memory.remember',effect:'write-local',about:'Proposes a lasting fact about the owner (a preference, a person, a routine). It always asks the owner first; store only what they stated, in their words.',args:'{"text": one fact, up to 500 characters}'},
 {name:'memory.forget',effect:'write-local',about:'Forgets a fact by its id from memory.recall or the memory list.',args:'{"id": fact id}'},
 {name:'settings.schedule',effect:'write-local',about:'Changes when the daily brief is sent and when Instrumentality (nightly memory consolidation) runs. Times are the owner\'s local time.',args:'{"brief": "HH:MM" or "off", "instrumentality": "HH:MM", "idle" or "off"} (one or both)'},
 {name:'pilots.create',effect:'write-local',about:'Proposes a new pilot, a permanent specialist that advises you before you plan on requests with its keywords. The owner approves it first; it starts at Prototype.',args:'{"id": lower-case letters and dashes, "name": up to 40 characters, "domain": what it knows, "keywords": [1 to 30 words or short phrases], "model": a local model (optional: the generic pilot\'s)}'},
];
/** {id} or {ids: [...]} (1–20 distinct strings): bulk changes stay one reviewed action, bound by the gate's argument hash. */
function ids(args:Record<string,unknown>):string[] {
 only(args,['id','ids']);if(('id' in args)===('ids' in args))throw new Error('Give id or ids.');
 const list='id' in args?[text(args,'id')]:args.ids;
 if(!Array.isArray(list)||!list.length||list.length>20||list.some(v=>typeof v!=='string'||!v||v.length>100)||new Set(list).size!==list.length)throw new Error('ids must be 1–20 distinct reminder ids.');
 return list as string[];
}
export function hasExecutor(tool:string):boolean {return builtinTools.some(t=>t.name===tool);}
export function execute(backend:ReminderBackend,tool:string,args:Record<string,unknown>,context:{sortieId?:string;tainted?:boolean}={}):unknown {
 switch(tool){
  case 'reminders.list':only(args,[]);return backend.pendingReminders(20).map(r=>({id:r.id,title:r.title,due:r.due}));
  case 'reminders.add':{only(args,['title','due']);const r=backend.add(text(args,'title'),text(args,'due'));return {id:r.id,title:r.title,due:r.due,...(r.existing?{existing:true,note:'This reminder already existed; nothing was added.'}:{})};}
  case 'reminders.cancel':{const list=ids(args);return {cancelled:list.filter(id=>backend.cancel(id)),ids:list};}
  case 'reminders.restore':{const list=ids(args);return {restored:list.filter(id=>backend.restore(id)),ids:list};}
  case 'memory.recall':only(args,['query']);return backend.memory.recall(text(args,'query')).map(f=>({id:f.id,text:f.text,source:f.source,tainted:f.tainted}));
  case 'memory.remember':{only(args,['text']);const f=backend.memory.add(text(args,'text'),'misato',{tainted:context.tainted,...(context.sortieId?{sortieId:context.sortieId}:{})});return {id:f.id,text:f.text};}
  case 'settings.schedule':{only(args,['brief','instrumentality']);if(!Object.keys(args).length)throw new Error('Give brief and/or instrumentality.');if(!backend.home)throw new Error('Settings are not available here.');
   return setSchedule(backend.home,{...(args.brief!==undefined?{brief:text(args,'brief')}:{}),...(args.instrumentality!==undefined?{instrumentality:text(args,'instrumentality')}:{})});}
  case 'pilots.create':{only(args,['id','name','domain','keywords','model']);if(!backend.home)throw new Error('Pilots are not available here.');
   const config=readConfig(backend.home);const model=typeof args.model==='string'&&args.model.trim()?args.model:config.models.roles?.consultant?.model ?? config.models.local?.model;
   if(!model)throw new Error('No local model for the pilot: set one with models set consultant MODEL.');
   const roster=config.pilots ?? [];if(roster.some(p=>p.id===args.id))throw new Error(`A pilot ${String(args.id)} already exists.`);
   savePilots(backend.home,[...roster,{id:text(args,'id'),name:text(args,'name'),domain:text(args,'domain'),keywords:args.keywords as string[],model,stage:'prototype',parent:'generic'}]);
   return {created:args.id,name:args.name,model,stage:'prototype'};}
  case 'memory.forget':only(args,['id']);return {forgotten:backend.memory.forget(text(args,'id'),'misato')};
  case 'kaji.run':{
   only(args,['base','tool','args']);const base=text(args,'base'),tool=text(args,'tool');
   if(!/^[A-Z0-9-]{2,16}$/.test(base)||!/^[a-z]+\.[a-z]+$/.test(tool)||tool==='kaji.run'||!args.args||typeof args.args!=='object'||Array.isArray(args.args))throw new Error('kaji.run needs a base id, one of its actions and that action\'s arguments.');
   if(!backend.queueRemote||!context.sortieId)throw new Error('Running actions on other bases is not available here.');
   const q=backend.queueRemote(context.sortieId,base,tool,args.args as Record<string,unknown>);
   return {queued:true,to:base,tool,id:q.id,note:'Sent over the Kaji line; its result follows as a message.'};
  }
  default:throw new Error('No executor for this tool.');
 }
}
