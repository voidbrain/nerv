import { validatePilots, type Pilot } from './pilots.ts';
import { validateTools, type ToolsConfig } from './mcp.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { validateModels, type Models } from './model.ts';
import { defaultPolicy, validatePolicy, type Policy } from './policy.ts';
/** telegram.chatId: the one private chat (the owner's) the Aoba bot answers; set by `telegram link`. */
export interface Config {port:number; language:'it'|'en'; timeZone:string;nativePort?:number;models:Models;telegram?:{chatId:number};brief?:{at:string};instrumentality?:{at:string}|{when:'idle'};base:Base;kaji?:{root:string;offers?:string[];seats?:Record<string,'shadow'|'veto'|'off'>};pilots?:Pilot[];tools?:ToolsConfig}
/** This machine's identity in the NERV mesh: an id (NERV-01) and a name (Neo Tokyo-3), shown in the dashboard, doctor and brief. */
export interface Base {id:string;name:string}
export const defaultBase:Base={id:'NERV-01',name:'Neo Tokyo-3'};
export function validateBase(value:unknown):Base {
  const b=value as Record<string,unknown>;
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['id','name'].includes(k))||typeof b.id!=='string'||!/^[A-Z0-9][A-Z0-9-]{1,15}$/.test(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>40||/[\u0000-\u001f<>]/.test(b.name))throw new Error('Invalid base: {"id": "NERV-01" (capitals, digits, dashes), "name": up to 40 characters}.');
  return {id:b.id,name:b.name.trim()};
}
export const defaults:Omit<Config,'models'|'base'> = {port:4317,language:'en',timeZone:'Europe/Rome'};
/** NERV_* settings; the pre-rename NODO_* names are still read as a fallback. */
export function setting(name:'HOME'|'PORT'|'TOKEN'|'OLLAMA'):string|undefined {return process.env['NERV_'+name] ?? process.env['NODO_'+name];}
/** ~/.nerv, or the pre-rename ~/.nodo when only that exists. Nothing is moved automatically. */
export function dataHome():string {
  const explicit=setting('HOME');
  const home=resolve(explicit ?? join(homedir(),'.nerv')),previous=resolve(join(homedir(),'.nodo'));
  const checkout=resolve('.nodo');
  if(!explicit && checkout!==previous && existsSync(join(checkout,'nodo.sqlite')))throw new Error('Legacy project database found. Set NERV_HOME to its absolute .nodo path, or migrate it with NERV Agency stopped.');
  if(!explicit && !existsSync(home) && existsSync(previous))return previous;
  return home;
}
/** nerv.sqlite, or the pre-rename nodo.sqlite when only that exists in the data home. */
export function databasePath(home:string):string {
  const current=join(home,'nerv.sqlite'),previous=join(home,'nodo.sqlite');
  return !existsSync(current)&&existsSync(previous)?previous:current;
}
export function readConfig(home:string):Config {
  const path=join(home,'config.json');
  const value:unknown=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid config.json.');
  const raw={...defaults,...value};
  const config:Config={port:Number(setting('PORT') ?? raw.port),language:raw.language,timeZone:raw.timeZone,models:validateModels((raw as Record<string,unknown>).models),base:'base' in raw?validateBase((raw as Record<string,unknown>).base):defaultBase};
  if('nativePort' in raw){const native=Number(raw.nativePort);if(!Number.isInteger(native)||native<1||native>65535||native===config.port)throw new Error('Invalid native port.');config.nativePort=native;}
  if('telegram' in raw){const t=raw.telegram as Record<string,unknown>;if(!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).some(k=>k!=='chatId')||!Number.isSafeInteger(t.chatId)||(t.chatId as number)<=0)throw new Error('Invalid telegram: only chatId, a private chat id (run telegram link).');config.telegram={chatId:t.chatId as number};}
  if('instrumentality' in raw){const b=raw.instrumentality as Record<string,unknown>;const keys=b&&typeof b==='object'&&!Array.isArray(b)?Object.keys(b):[];
    if(keys.length===1&&keys[0]==='when'&&b.when==='idle')config.instrumentality={when:'idle'};
    else if(keys.length===1&&keys[0]==='at'&&typeof b.at==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(b.at))config.instrumentality={at:b.at};
    else throw new Error('Invalid instrumentality: {"at": "HH:MM"} in your time zone, or {"when": "idle"}.');}
  if('kaji' in raw){const k=raw.kaji as Record<string,unknown>;if(!k||typeof k!=='object'||Array.isArray(k)||Object.keys(k).some(x=>!['root','offers','seats'].includes(x))||typeof k.root!=='string'||!/^[A-Za-z0-9+/=]{40,120}$/.test(k.root))throw new Error('Invalid kaji: {"root": the root public key} (set by key init or kaji import).');
    // F-036 slice 3b: the actions this base lets the main base run here (none unless listed); each still passes this base's gate.
    if(k.offers!==undefined&&(!Array.isArray(k.offers)||k.offers.length>20||k.offers.some(o=>typeof o!=='string'||!/^[a-z]+\.[a-z]+$/.test(o))))throw new Error('Invalid kaji.offers: a list of action names such as "reminders.add" (set with kaji offer).');
    // F-036 phase 2: how the other bases' Casper votes on this base's actions; a base not listed is a shadow seat.
    if(k.seats!==undefined&&(!k.seats||typeof k.seats!=='object'||Array.isArray(k.seats)||Object.entries(k.seats).some(([id,m])=>!/^[A-Z0-9-]{2,16}$/.test(id)||!['shadow','veto','off'].includes(m as string))))throw new Error('Invalid kaji.seats: {"BASE-ID": "shadow" | "veto" | "off"} (set with kaji seat).');
    config.kaji={root:k.root,...(Array.isArray(k.offers)&&k.offers.length?{offers:[...new Set(k.offers as string[])]}:{}),...(k.seats&&Object.keys(k.seats).length?{seats:k.seats as Record<string,'shadow'|'veto'|'off'>}:{})};}
  if('brief' in raw){const b=raw.brief as Record<string,unknown>;if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>k!=='at')||typeof b.at!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.at))throw new Error('Invalid brief: {"at": "HH:MM"} in your time zone.');config.brief={at:b.at};}
  if('tools' in raw){const t=validateTools((raw as Record<string,unknown>).tools);if(t.mcp.length||t.grants.length)config.tools=t;}
  if('pilots' in raw){const list=validatePilots((raw as Record<string,unknown>).pilots);if(list.length)config.pilots=list;}
  if(config.port===(config.nativePort ?? 4319))throw new Error('Web and native ports must differ.');
  if(!Number.isInteger(config.port)||config.port<1||config.port>65535)throw new Error('Invalid NERV Agency port.');
  if(!['it','en'].includes(config.language))throw new Error('Invalid language: use it or en.');
  if(typeof config.timeZone!=='string')throw new Error('Invalid timezone.');
  try{new Intl.DateTimeFormat('it',{timeZone:config.timeZone}).format();}catch{throw new Error('Invalid IANA timezone.');}
  return config;
}
export function readToken(home:string):string {
  const file=join(home,'token');
  const token=setting('TOKEN') ?? (existsSync(file)?readFileSync(file,'utf8').trim():'');
  if(token.length<24||/[\r\n]/.test(token))throw new Error('Run init first, or set NERV_TOKEN to at least 24 characters.');
  return token;
}
/**
 * A secret or rule file is private enough when no group/other permission bits in `mask` are set. Windows has no such
 * bits (Node reports 0o666): there the user profile's ACLs keep the data home private, so the check is the folder's.
 */
export function privateEnough(file:string,mask:number,platform:NodeJS.Platform=process.platform):boolean {return platform==='win32'||(statSync(file).mode&mask)===0;}
/** Cloud route key: a private file in the data home, never an environment variable, argv or config.json. */
export function readModelKey(home:string):string|undefined {
  const file=join(home,'anthropic-key');if(!existsSync(file))return undefined;
  if(!privateEnough(file,0o077))throw new Error('anthropic-key must be private: chmod 600.');
  const key=readFileSync(file,'utf8').trim();
  if(key.length<20||/[\s]/.test(key))throw new Error('Invalid anthropic-key file.');
  return key;
}
export interface Scrolls {policy:Policy;source:'default'|'scrolls.json'}
/** The Scrolls (F-017): the owner's gate rules in scrolls.json. Missing means the defaults; an invalid or tamperable file stops startup rather than relaxing a rule. */
export function readScrolls(home:string):Scrolls {
  const file=join(home,'scrolls.json');if(!existsSync(file))return {policy:defaultPolicy,source:'default'};
  if(!privateEnough(file,0o022))throw new Error('scrolls.json must not be writable by others: chmod 600.');
  let value:unknown;try{value=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('Invalid scrolls.json: not JSON.');}
  try{return {policy:validatePolicy(value),source:'scrolls.json'};}catch(e){throw new Error(`Invalid scrolls.json: ${e instanceof Error?e.message:'invalid policy'}`);}
}
/** BotFather's format: digits, a colon, then 30–64 URL-safe characters. */
export const isTelegramToken=(token:string)=>/^\d{5,15}:[A-Za-z0-9_-]{30,64}$/.test(token);
export const telegramTokenPath=(home:string)=>join(home,'telegram-token');
/** Aoba's Telegram bot token: a private file in the data home, like the cloud key. */
export function readTelegramToken(home:string):string|undefined {
  const file=join(home,'telegram-token');if(!existsSync(file))return undefined;
  if(!privateEnough(file,0o077))throw new Error('telegram-token must be private: chmod 600.');
  const token=readFileSync(file,'utf8').trim();
  if(!isTelegramToken(token))throw new Error(`Invalid token in ${file}: run nerv telegram token and paste the token BotFather gave you.`);
  return token;
}
/** Sets this machine's base identity in config.json, keeping every other setting. */
export function setBase(home:string,base:Base):Base {
  const path=join(home,'config.json');const valid=validateBase(base);
  const current=existsSync(path)?JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>:{...defaults};
  writeFileSync(path,JSON.stringify({...current,base:valid},null,2)+'\n',{mode:0o600});chmodSync(path,0o600);readConfig(home);return valid;
}
/** Pins the owner's root public key on this base: every registry record must verify against it. */
export function pinKajiRoot(home:string,root:string):void {
  const path=join(home,'config.json');const current=existsSync(path)?JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>:{...defaults};
  writeFileSync(path,JSON.stringify({...current,kaji:{...(current.kaji as object|undefined),root}},null,2)+'\n',{mode:0o600});chmodSync(path,0o600);readConfig(home);
}
/** The actions this base offers to the main base (F-036 slice 3b); an empty list offers nothing. */
export function setKajiOffers(home:string,offers:string[]):void {
  const path=join(home,'config.json');const current=JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>;const k=current.kaji as Record<string,unknown>|undefined;
  if(!k?.root)throw new Error('No root pinned on this base yet: kaji import --root FINGERPRINT first.');
  const next={...current,kaji:{...k,root:k.root,...(offers.length?{offers}:{offers:undefined})}};if(!offers.length)delete (next.kaji as Record<string,unknown>).offers;validateKajiOffersOnly(next);
  writeFileSync(path,JSON.stringify(next,null,2)+'\n',{mode:0o600});chmodSync(path,0o600);readConfig(home);
}
/** How another base's Casper votes on this base's actions (F-036 phase 2): shadow (logged), veto (may stop it) or off. */
export function setKajiSeat(home:string,baseId:string,mode:'shadow'|'veto'|'off'):void {
  const path=join(home,'config.json');const current=JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>;const k=current.kaji as Record<string,unknown>|undefined;
  if(!k?.root)throw new Error('No root pinned on this base yet.');
  const seats={...(k.seats as Record<string,string>|undefined),[baseId]:mode};
  writeFileSync(path,JSON.stringify({...current,kaji:{...k,seats}},null,2)+'\n',{mode:0o600});chmodSync(path,0o600);readConfig(home);
}
function validateKajiOffersOnly(c:Record<string,unknown>){const o=(c.kaji as {offers?:unknown}).offers;if(o!==undefined&&(!Array.isArray(o)||o.some(x=>typeof x!=='string'||!/^[a-z]+\.[a-z]+$/.test(x))))throw new Error('Invalid action names.');}
/** Writes the pilot roster (F-045); validated first, so a bad change leaves config.json as it was. */
export function savePilots(home:string,pilots:Pilot[]):void {
  const path=join(home,'config.json');const current=existsSync(path)?JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>:{...defaults};
  const list=validatePilots(pilots);const next:Record<string,unknown>={...current,pilots:list};if(!list.length)delete next.pilots;
  writeFileSync(path,JSON.stringify(next,null,2)+'\n',{mode:0o600});chmodSync(path,0o600);readConfig(home);
}
/** Writes the tools section (F-021); validated first, so a bad change leaves config.json as it was. */
export function saveTools(home:string,tools:ToolsConfig):void {
  const path=join(home,'config.json');const current=existsSync(path)?JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>:{...defaults};
  const t=validateTools(tools);const next:Record<string,unknown>={...current,tools:t};if(!t.mcp.length&&!t.grants.length)delete next.tools;
  writeFileSync(path,JSON.stringify(next,null,2)+'\n',{mode:0o600});chmodSync(path,0o600);readConfig(home);
}
export type ScheduleValue=string|null;
/** The two schedules the owner may change by talking to Misato (F-003): times, "idle" or off. Nothing security-relevant. */
export function readSchedule(home:string):{brief:string;instrumentality:string} {
  const c=readConfig(home);return {brief:c.brief?.at ?? 'off',instrumentality:!c.instrumentality?'off':'when' in c.instrumentality?'idle':c.instrumentality.at};
}
export function setSchedule(home:string,patch:{brief?:string;instrumentality?:string}):{previous:{brief:string;instrumentality:string};now:{brief:string;instrumentality:string}} {
  const time=/^([01]\d|2[0-3]):[0-5]\d$/;const previous=readSchedule(home);
  if(patch.brief!==undefined&&patch.brief!=='off'&&!time.test(patch.brief))throw new Error('brief is HH:MM or off.');
  if(patch.instrumentality!==undefined&&!['off','idle'].includes(patch.instrumentality)&&!time.test(patch.instrumentality))throw new Error('instrumentality is HH:MM, idle or off.');
  const path=join(home,'config.json');const current=existsSync(path)?JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>:{...defaults};
  if(patch.brief!==undefined){if(patch.brief==='off')delete current.brief;else current.brief={at:patch.brief};}
  if(patch.instrumentality!==undefined){if(patch.instrumentality==='off')delete current.instrumentality;else current.instrumentality=patch.instrumentality==='idle'?{when:'idle'}:{at:patch.instrumentality};}
  writeFileSync(path,JSON.stringify(current,null,2)+'\n',{mode:0o600});chmodSync(path,0o600);readConfig(home);
  return {previous,now:readSchedule(home)};
}
export function initialize(home:string,base?:Base):void {
  mkdirSync(home,{recursive:true,mode:0o700});
  const config=join(home,'config.json'),token=join(home,'token');
  if(!existsSync(config))writeFileSync(config,JSON.stringify({...defaults,...(base?{base:validateBase(base)}:{})},null,2)+'\n',{flag:'wx',mode:0o600});
  else if(base)setBase(home,base);
  if(!existsSync(token))writeFileSync(token,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});
  chmodSync(config,0o600);chmodSync(token,0o600);readConfig(home);readToken(home);
}
