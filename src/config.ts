import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
export interface Config {port:number; language:'it'|'en'; timeZone:string}
export const defaults: Config = {port:4317,language:'it',timeZone:'Europe/Rome'};
export function dataHome():string {
  const home=resolve(process.env.NODO_HOME ?? join(homedir(),'.nodo'));
  const legacy=resolve('.nodo');
  if(!process.env.NODO_HOME && legacy!==home && existsSync(join(legacy,'nodo.sqlite')))throw new Error('Legacy project database found. Set NODO_HOME to its absolute .nodo path, or migrate it with Nodo stopped.');
  return home;
}
export function readConfig(home:string):Config {
  const path=join(home,'config.json');
  const value:unknown=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid config.json.');
  const raw={...defaults,...value};
  const config:Config={port:Number(process.env.NODO_PORT ?? raw.port),language:raw.language,timeZone:raw.timeZone};
  if(!Number.isInteger(config.port)||config.port<1||config.port>65535)throw new Error('Invalid Nodo port.');
  if(!['it','en'].includes(config.language))throw new Error('Invalid language: use it or en.');
  if(typeof config.timeZone!=='string')throw new Error('Invalid timezone.');
  try{new Intl.DateTimeFormat('it',{timeZone:config.timeZone}).format();}catch{throw new Error('Invalid IANA timezone.');}
  return config;
}
export function readToken(home:string):string {
  const file=join(home,'token');
  const token=process.env.NODO_TOKEN ?? (existsSync(file)?readFileSync(file,'utf8').trim():'');
  if(token.length<24||/[\r\n]/.test(token))throw new Error('Run init first, or set NODO_TOKEN to at least 24 characters.');
  return token;
}
export function initialize(home:string):void {
  mkdirSync(home,{recursive:true,mode:0o700});
  const config=join(home,'config.json'),token=join(home,'token');
  if(!existsSync(config))writeFileSync(config,JSON.stringify(defaults,null,2)+'\n',{flag:'wx',mode:0o600});
  if(!existsSync(token))writeFileSync(token,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});
  chmodSync(config,0o600);chmodSync(token,0o600);readConfig(home);readToken(home);
}
