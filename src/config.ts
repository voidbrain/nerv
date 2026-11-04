import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { validateModels, type Models } from './model.ts';
import { defaultPolicy, validatePolicy, type Policy } from './policy.ts';
/** telegram.chatId: the one private chat (the owner's) the Aoba bot answers; set by `telegram link`. */
export interface Config {port:number; language:'it'|'en'; timeZone:string;nativePort?:number;models:Models;telegram?:{chatId:number};brief?:{at:string}}
export const defaults:Omit<Config,'models'> = {port:4317,language:'en',timeZone:'Europe/Rome'};
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
  const config:Config={port:Number(setting('PORT') ?? raw.port),language:raw.language,timeZone:raw.timeZone,models:validateModels((raw as Record<string,unknown>).models)};
  if('nativePort' in raw){const native=Number(raw.nativePort);if(!Number.isInteger(native)||native<1||native>65535||native===config.port)throw new Error('Invalid native port.');config.nativePort=native;}
  if('telegram' in raw){const t=raw.telegram as Record<string,unknown>;if(!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).some(k=>k!=='chatId')||!Number.isSafeInteger(t.chatId)||(t.chatId as number)<=0)throw new Error('Invalid telegram: only chatId, a private chat id (run telegram link).');config.telegram={chatId:t.chatId as number};}
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
/** Cloud route key: a private file in the data home, never an environment variable, argv or config.json. */
export function readModelKey(home:string):string|undefined {
  const file=join(home,'anthropic-key');if(!existsSync(file))return undefined;
  if(statSync(file).mode&0o077)throw new Error('anthropic-key must be private: chmod 600.');
  const key=readFileSync(file,'utf8').trim();
  if(key.length<20||/[\s]/.test(key))throw new Error('Invalid anthropic-key file.');
  return key;
}
export interface Scrolls {policy:Policy;source:'default'|'scrolls.json'}
/** The Scrolls (F-017): the owner's gate rules in scrolls.json. Missing means the defaults; an invalid or tamperable file stops startup rather than relaxing a rule. */
export function readScrolls(home:string):Scrolls {
  const file=join(home,'scrolls.json');if(!existsSync(file))return {policy:defaultPolicy,source:'default'};
  if(statSync(file).mode&0o022)throw new Error('scrolls.json must not be writable by others: chmod 600.');
  let value:unknown;try{value=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('Invalid scrolls.json: not JSON.');}
  try{return {policy:validatePolicy(value),source:'scrolls.json'};}catch(e){throw new Error(`Invalid scrolls.json: ${e instanceof Error?e.message:'invalid policy'}`);}
}
/** Aoba's Telegram bot token: a private file in the data home, like the cloud key. */
export function readTelegramToken(home:string):string|undefined {
  const file=join(home,'telegram-token');if(!existsSync(file))return undefined;
  if(statSync(file).mode&0o077)throw new Error('telegram-token must be private: chmod 600.');
  const token=readFileSync(file,'utf8').trim();
  if(!/^\d{5,15}:[A-Za-z0-9_-]{30,64}$/.test(token))throw new Error('Invalid telegram-token file: paste the token BotFather gave you.');
  return token;
}
export function initialize(home:string):void {
  mkdirSync(home,{recursive:true,mode:0o700});
  const config=join(home,'config.json'),token=join(home,'token');
  if(!existsSync(config))writeFileSync(config,JSON.stringify(defaults,null,2)+'\n',{flag:'wx',mode:0o600});
  if(!existsSync(token))writeFileSync(token,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});
  chmodSync(config,0o600);chmodSync(token,0o600);readConfig(home);readToken(home);
}
