import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import type {RouteName} from './model.ts';
/** Null means unavailable, including after timeout. Token counts are provider reports, never text estimates. */
export interface UsageObservation {
 route:RouteName;requestedModel:string;returnedModel:string|null;
 inputTokens:number|null;outputTokens:number|null;cacheReadTokens:number|null;cacheWriteTokens:number|null;
 durationMs:number;outcome:'success'|'refused'|'error';
}
export interface Price {route:RouteName;model:string;currency:string;source:string;asOf:string;input:number;output:number;cacheRead:number;cacheWrite:number}
export interface UsageRecord {id:string;operation:string;started:string;state:'unknown'|'not-called'|'finished';observation:UsageObservation|null;cost:{status:'estimated';amount:number;price:Price}|{status:'unavailable'}}
export const USAGE_SCHEMA=`CREATE TABLE IF NOT EXISTS model_usage(id TEXT PRIMARY KEY, operation TEXT NOT NULL, started TEXT NOT NULL, record TEXT NOT NULL);`;
export function tokenCount(value:unknown):number|null {return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;}
export function usageCost(o:UsageObservation|null,prices:readonly Price[]):UsageRecord['cost'] {
 if(!o||o.outcome==='error'||[o.inputTokens,o.outputTokens,o.cacheReadTokens,o.cacheWriteTokens].some(x=>x===null))return {status:'unavailable'};
 if(o.route==='local'&&o.cacheReadTokens!>o.inputTokens!)return {status:'unavailable'};
 const p=prices.find(p=>p.route===o.route&&p.model===o.returnedModel);if(!p)return {status:'unavailable'};
 const amount=((o.inputTokens!-(o.route==='local'?o.cacheReadTokens!:0))*p.input+o.outputTokens!*p.output+o.cacheReadTokens!*p.cacheRead+o.cacheWriteTokens!*p.cacheWrite)/1_000_000;
 return Number.isFinite(amount)?{status:'estimated',amount,price:p}:{status:'unavailable'};
}
/** Explicit rate snapshots; never guess a price from a model family or the requested fallback model. */
export function parsePrices(value:unknown):Price[] {
 if(!Array.isArray(value)||value.length>100)throw new Error('Invalid model price snapshots.');
 const seen=new Set<string>();return value.map((v:unknown)=>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid model price snapshot.');
  const p=v as Record<string,unknown>;
  if(Object.keys(p).sort().join(',')!=='asOf,cacheRead,cacheWrite,currency,input,model,output,route,source'||!['local','cloud'].includes(String(p.route))||typeof p.model!=='string'||!p.model||p.model.length>200||typeof p.currency!=='string'||!/^[A-Z]{3}$/.test(p.currency)||typeof p.source!=='string'||p.source.length>500||!/^https:\/\/[^\s]+$/.test(p.source)||typeof p.asOf!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.asOf)||['input','output','cacheRead','cacheWrite'].some(k=>typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<0))throw new Error('Invalid model price snapshot.');
  const date=new Date(p.asOf as string);if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==p.asOf)throw new Error('Invalid model price date.');
  const url=new URL(p.source as string);if(url.username||url.password||url.search||url.hash)throw new Error('Price source must be a public credential-free URL.');
  const key=p.route+':'+p.model;if(seen.has(key))throw new Error('Duplicate model price snapshot.');seen.add(key);return p as unknown as Price;
 });
}
export class UsageStore {
 private readonly db:DatabaseSync;
 constructor(db:DatabaseSync){this.db=db;db.exec(USAGE_SCHEMA);}
 begin(operation:string):string {
  if(!['model.complete','misato.step','casper.verdict','consultant.advise','instrumentality.digest'].includes(operation))throw new Error('Invalid model operation.');
  const id=randomUUID();const r:UsageRecord={id,operation,started:new Date().toISOString(),state:'unknown',observation:null,cost:{status:'unavailable'}};
  this.db.prepare('INSERT INTO model_usage VALUES(?,?,?,?)').run(id,operation,r.started,JSON.stringify(r));return id;
 }
 finish(id:string,observation:UsageObservation|null,prices:readonly Price[]=[]):void {
  const row=this.db.prepare('SELECT record FROM model_usage WHERE id=?').get(id) as {record:string}|undefined;if(!row)throw new Error('Unknown model call.');
  const r=JSON.parse(row.record) as UsageRecord;r.state=observation?'finished':'not-called';r.observation=observation;r.cost=usageCost(observation,prices);
  this.db.prepare('UPDATE model_usage SET record=? WHERE id=?').run(JSON.stringify(r),id);
 }
 page(before=Number.MAX_SAFE_INTEGER,limit=20):{items:(UsageRecord&{sequence:number})[];next:number|null} {
  if(!Number.isSafeInteger(before)||before<0||!Number.isInteger(limit)||limit<1||limit>20)throw new Error('Invalid usage page.');
  const rows=this.db.prepare('SELECT rowid AS sequence,record FROM model_usage WHERE rowid<? ORDER BY rowid DESC LIMIT ?').all(before,limit+1) as {sequence:number;record:string}[];
  const items=rows.slice(0,limit).map(r=>({...JSON.parse(r.record) as UsageRecord,sequence:r.sequence}));return {items,next:rows.length>limit?items.at(-1)!.sequence:null};
 }
}
