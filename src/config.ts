import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { validateModels, type Models } from './model.ts';
import { defaultPolicy, validatePolicy, type Policy } from './policy.ts';
/** telegram.chatId: the one private chat (the owner's) the Aoba bot answers; set by `telegram link`. */
export interface Config {port:number; language:'it'|'en'; timeZone:string;nativePort?:number;models:Models;telegram?:{chatId:number};brief?:{at:string};instrumentality?:{at:string};base:Base}
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
export function setting(name:'HOME'|'PORT'|'TOKEN'):string|undefined {return process.env['NERV_'+name] ?? process.env['NODO_'+name];}
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
  if('instrumentality' in raw){const b=raw.instrumentality as Record<string,unknown>;if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>k!=='at')||typeof b.at!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.at))throw new Error('Invalid instrumentality: {"at": "HH:MM"} in your time zone.');config.instrumentality={at:b.at};}
  if('brief' in raw){const b=raw.brief as Record<string,unknown>;if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>k!=='at')||typeof b.at!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.at))throw new Error('Invalid brief: {"at": "HH:MM"} in your time zone.');config.brief={at:b.at};}
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
/** Aoba's Telegram bot token: a private file in the data home, like the cloud key. */
export function readTelegramToken(home:string):string|undefined {
  const file=join(home,'telegram-token');if(!existsSync(file))return undefined;
  if(!privateEnough(file,0o077))throw new Error('telegram-token must be private: chmod 600.');
  const token=readFileSync(file,'utf8').trim();
  if(!/^\d{5,15}:[A-Za-z0-9_-]{30,64}$/.test(token))throw new Error('Invalid telegram-token file: paste the token BotFather gave you.');
  return token;
}
/** Sets this machine's base identity in config.json, keeping every other setting. */
export function setBase(home:string,base:Base):Base {
  const path=join(home,'config.json');const valid=validateBase(base);
  const current=existsSync(path)?JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>:{...defaults};
  writeFileSync(path,JSON.stringify({...current,base:valid},null,2)+'\n',{mode:0o600});chmodSync(path,0o600);readConfig(home);return valid;
}
export function initialize(home:string,base?:Base):void {
  mkdirSync(home,{recursive:true,mode:0o700});
  const config=join(home,'config.json'),token=join(home,'token');
  if(!existsSync(config))writeFileSync(config,JSON.stringify({...defaults,...(base?{base:validateBase(base)}:{})},null,2)+'\n',{flag:'wx',mode:0o600});
  else if(base)setBase(home,base);
  if(!existsSync(token))writeFileSync(token,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});
  chmodSync(config,0o600);chmodSync(token,0o600);readConfig(home);readToken(home);
}
