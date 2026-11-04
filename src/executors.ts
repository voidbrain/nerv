import type { Tool } from './policy.ts';
import type { Reminder } from './store.ts';
import type { ToolDoc } from './misato.ts';
/**
 * Built-in tools with an executor in the scheduler process (F-017). Each declares its effect class for the gate; an
 * executor runs only after `Ledger.authorize` accepted the grant for these exact arguments.
 */
export interface ReminderBackend {list():Reminder[];add(title:string,due:string):Reminder;cancel(id:string):boolean;restore(id:string):boolean}
export const builtinTools:Tool[]=[
 {name:'reminders.list',effect:'read'},
 {name:'reminders.add',effect:'write-local',inverse:'reminders.cancel'},
 {name:'reminders.cancel',effect:'write-local',inverse:'reminders.restore'},
 {name:'reminders.restore',effect:'write-local',inverse:'reminders.cancel'},
];
const text=(args:Record<string,unknown>,key:string)=>{const v=args[key];if(typeof v!=='string')throw new Error(`Argument ${key} must be a string.`);return v;};
const only=(args:Record<string,unknown>,keys:string[])=>{if(Object.keys(args).some(k=>!keys.includes(k)))throw new Error(`Arguments allowed: ${keys.join(', ')||'none'}.`);};
/** What Misato is told about each built-in tool. */
export const toolDocs:ToolDoc[]=[
 {name:'reminders.list',effect:'read',about:'Lists pending reminders (up to 20). The owner may call reminders notes, promemoria or note.',args:'none, {}'},
 {name:'reminders.add',effect:'write-local',about:'Adds a reminder delivered to the local inbox when due.',args:'{"title": text up to 500 characters, "due": ISO 8601 date-time in the future with an explicit offset}'},
 {name:'reminders.cancel',effect:'write-local',about:'Cancels pending reminders by id from reminders.list; several at once with ids. Undo with reminders.restore.',args:'{"id": reminder id} or {"ids": [up to 20 reminder ids]}'},
 {name:'reminders.restore',effect:'write-local',about:'Restores cancelled reminders that are still in the future.',args:'{"id": reminder id} or {"ids": [up to 20 reminder ids]}'},
];
/** {id} or {ids: [...]} (1–20 distinct strings): bulk changes stay one reviewed action, bound by the gate's argument hash. */
function ids(args:Record<string,unknown>):string[] {
 only(args,['id','ids']);if(('id' in args)===('ids' in args))throw new Error('Give id or ids.');
 const list='id' in args?[text(args,'id')]:args.ids;
 if(!Array.isArray(list)||!list.length||list.length>20||list.some(v=>typeof v!=='string'||!v||v.length>100)||new Set(list).size!==list.length)throw new Error('ids must be 1–20 distinct reminder ids.');
 return list as string[];
}
export function hasExecutor(tool:string):boolean {return builtinTools.some(t=>t.name===tool);}
export function execute(backend:ReminderBackend,tool:string,args:Record<string,unknown>):unknown {
 switch(tool){
  case 'reminders.list':only(args,[]);return backend.list().filter(r=>!r.delivered&&!r.cancelled).slice(0,20).map(r=>({id:r.id,title:r.title,due:r.due}));
  case 'reminders.add':{only(args,['title','due']);const r=backend.add(text(args,'title'),text(args,'due'));return {id:r.id,title:r.title,due:r.due};}
  case 'reminders.cancel':{const list=ids(args);return {cancelled:list.filter(id=>backend.cancel(id)),ids:list};}
  case 'reminders.restore':{const list=ids(args);return {restored:list.filter(id=>backend.restore(id)),ids:list};}
  default:throw new Error('No executor for this tool.');
 }
}
