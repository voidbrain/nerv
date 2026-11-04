import type { Tool } from './policy.ts';
import type { Reminder } from './store.ts';
import type { ToolDoc } from './misato.ts';
/**
 * Built-in tools with an executor in the scheduler process (F-017). Each declares its effect class for the gate; an
 * executor runs only after `Ledger.authorize` accepted the grant for these exact arguments.
 */
export interface ReminderBackend {list():Reminder[];add(title:string,due:string):Reminder;cancel(id:string):boolean}
export const builtinTools:Tool[]=[
 {name:'reminders.list',effect:'read'},
 {name:'reminders.add',effect:'write-local',inverse:'reminders.cancel'},
 {name:'reminders.cancel',effect:'write-local'},
];
const text=(args:Record<string,unknown>,key:string)=>{const v=args[key];if(typeof v!=='string')throw new Error(`Argument ${key} must be a string.`);return v;};
const only=(args:Record<string,unknown>,keys:string[])=>{if(Object.keys(args).some(k=>!keys.includes(k)))throw new Error(`Arguments allowed: ${keys.join(', ')||'none'}.`);};
/** What Misato is told about each built-in tool. */
export const toolDocs:ToolDoc[]=[
 {name:'reminders.list',effect:'read',about:'Lists pending reminders (up to 20).',args:'none, {}'},
 {name:'reminders.add',effect:'write-local',about:'Adds a reminder delivered to the local inbox when due.',args:'{"title": text up to 500 characters, "due": ISO 8601 date-time in the future with an explicit offset}'},
 {name:'reminders.cancel',effect:'write-local',about:'Cancels a pending reminder by its id from reminders.list.',args:'{"id": reminder id}'},
];
export function hasExecutor(tool:string):boolean {return builtinTools.some(t=>t.name===tool);}
export function execute(backend:ReminderBackend,tool:string,args:Record<string,unknown>):unknown {
 switch(tool){
  case 'reminders.list':only(args,[]);return backend.list().filter(r=>!r.delivered&&!r.cancelled).slice(0,20).map(r=>({id:r.id,title:r.title,due:r.due}));
  case 'reminders.add':{only(args,['title','due']);const r=backend.add(text(args,'title'),text(args,'due'));return {id:r.id,title:r.title,due:r.due};}
  case 'reminders.cancel':only(args,['id']);return {cancelled:backend.cancel(text(args,'id'))};
  default:throw new Error('No executor for this tool.');
 }
}
