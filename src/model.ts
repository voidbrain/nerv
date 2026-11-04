import type Anthropic from '@anthropic-ai/sdk';
/**
 * Model routes (F-003). S² is a local OpenAI-compatible endpoint on this machine (Ollama, LM Studio).
 * Umbilical is the Claude cloud route, off until the owner enables it. There is no automatic fallback
 * between routes: local-only text never leaves the machine, and a failed route reports failure.
 */
export type Privacy='local-only'|'any';
export type RouteName='local'|'cloud';
export interface LocalRoute {baseUrl:string;model:string}
export interface CloudRoute {provider:'anthropic';model:string;enabled:boolean}
/** Which route and model each role uses. Casper is local only: it sees the action's arguments, which may be private. */
export interface Roles {misato?:{route:RouteName;model?:string};casper?:{model?:string}}
export interface Models {local?:LocalRoute;cloud?:CloudRoute;roles?:Roles}
export interface Ask {prompt:string;system?:string;privacy:Privacy;route?:RouteName}
export interface Reply {text:string;route:RouteName;model:string;stop:string;truncated:boolean}
export const MAX_REPLY_BYTES=16384;
/** Coordinator wait for a brain model call; the route itself gives up 5 s earlier so the brain can answer. */
export const MODEL_TIMEOUT_MS=120000;
const MAX_TOKENS=4096;
const loopback=new Set(['127.0.0.1','localhost','[::1]']);
export class ModelError extends Error {}
export function validateModels(value:unknown):Models {
 if(value===undefined)return {};
 const v=value as Record<string,unknown>;
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['local','cloud','roles'].includes(k)))throw new Error('Invalid models: use local, cloud and roles.');
 const out:Models={};
 if(v.local!==undefined){
  const l=v.local as Record<string,unknown>;
  if(!l||typeof l!=='object'||Object.keys(l).some(k=>!['baseUrl','model'].includes(k))||typeof l.baseUrl!=='string'||typeof l.model!=='string'||!l.model||l.model.length>200)throw new Error('Invalid models.local: baseUrl and model are required.');
  let url:URL;try{url=new URL(l.baseUrl);}catch{throw new Error('Invalid models.local.baseUrl.');}
  if(url.protocol!=='http:'&&url.protocol!=='https:'||!loopback.has(url.hostname)||url.username||url.password)throw new Error('models.local.baseUrl must be a loopback address on this machine.');
  out.local={baseUrl:url.href.replace(/\/$/,''),model:l.model};
 }
 if(v.cloud!==undefined){
  const c=v.cloud as Record<string,unknown>;
  if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['provider','model','enabled'].includes(k))||c.provider!=='anthropic'||typeof c.enabled!=='boolean'||(c.model!==undefined&&(typeof c.model!=='string'||!c.model||c.model.length>200)))throw new Error('Invalid models.cloud: provider "anthropic" and enabled are required.');
  out.cloud={provider:'anthropic',model:(c.model as string|undefined) ?? 'claude-opus-5-5',enabled:c.enabled};
 }
 if(v.roles!==undefined){
  const r=v.roles as Record<string,unknown>;const model=(x:unknown)=>x===undefined||(typeof x==='string'&&x.length>0&&x.length<=200);
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['misato','casper'].includes(k)))throw new Error('Invalid models.roles: use misato and/or casper.');
  const roles:Roles={};
  if(r.misato!==undefined){const m=r.misato as Record<string,unknown>;if(!m||typeof m!=='object'||Object.keys(m).some(k=>!['route','model'].includes(k))||!['local','cloud'].includes(m.route as string)||!model(m.model))throw new Error('Invalid models.roles.misato: route local or cloud, optional model.');roles.misato={route:m.route as RouteName,...(m.model?{model:m.model as string}:{})};}
  if(r.casper!==undefined){const c=r.casper as Record<string,unknown>;if(!c||typeof c!=='object'||Object.keys(c).some(k=>k!=='model')||!model(c.model))throw new Error('Invalid models.roles.casper: only model, on the local route.');roles.casper={...(c.model?{model:c.model as string}:{})};}
  out.roles=roles;
 }
 return out;
}
/** Picks the route without side effects. Never substitutes one route for another. */
export function selectRoute(ask:Ask,models:Models,hasKey:boolean):RouteName {
 const cloudReady=!!models.cloud?.enabled&&hasKey;
 const wanted=ask.route ?? (models.local||ask.privacy==='local-only'?'local':'cloud');
 if(wanted==='cloud'){
  if(ask.privacy==='local-only')throw new ModelError('Local-only input never goes to the cloud route.');
  if(!models.cloud?.enabled)throw new ModelError('Cloud route (Umbilical) is disabled.');
  if(!cloudReady)throw new ModelError('Cloud route (Umbilical) has no API key.');
  return 'cloud';
 }
 if(!models.local)throw new ModelError('Local route (S²) is not configured.');
 return 'local';
}
function bound(text:string):{text:string;truncated:boolean} {
 const bytes=Buffer.from(text);if(bytes.length<=MAX_REPLY_BYTES)return {text,truncated:false};
 return {text:bytes.subarray(0,MAX_REPLY_BYTES).toString('utf8').replace(/�$/,''),truncated:true};
}
export interface RouteOptions {timeoutMs:number;fetch?:typeof fetch;cloudBaseUrl?:string}
export async function complete(ask:Ask,models:Models,key:string|undefined,options:RouteOptions):Promise<Reply> {
 const route=selectRoute(ask,models,!!key);
 return route==='local'?completeLocal(ask,models.local!,options):completeCloud(ask,models.cloud!,key!,options);
}
async function completeLocal(ask:Ask,local:LocalRoute,options:RouteOptions):Promise<Reply> {
 const messages=[...(ask.system?[{role:'system',content:ask.system}]:[]),{role:'user',content:ask.prompt}];
 let response:Response;
 try{response=await (options.fetch ?? fetch)(local.baseUrl+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:local.model,messages,max_tokens:MAX_TOKENS,stream:false}),signal:AbortSignal.timeout(options.timeoutMs),redirect:'error'});}
 catch(e){throw new ModelError(e instanceof Error&&e.name==='TimeoutError'?'Local route (S²) timed out.':'Local route (S²) unreachable.');}
 const raw=await response.text().catch(()=>'');
 if(Buffer.byteLength(raw)>1048576)throw new ModelError('Local route (S²) response too large.');
 if(!response.ok)throw new ModelError(`Local route (S²) failed with HTTP ${response.status}.`);
 let body:{choices?:{message?:{content?:unknown};finish_reason?:unknown}[]};
 try{body=JSON.parse(raw);}catch{throw new ModelError('Local route (S²) returned invalid JSON.');}
 const choice=body.choices?.[0];
 if(typeof choice?.message?.content!=='string')throw new ModelError('Local route (S²) returned no text.');
 return {...bound(choice.message.content),route:'local',model:local.model,stop:typeof choice.finish_reason==='string'?choice.finish_reason:'unknown'};
}
async function completeCloud(ask:Ask,cloud:CloudRoute,key:string,options:RouteOptions):Promise<Reply> {
 const {default:SDK}=await import('@anthropic-ai/sdk');
 const client=new SDK({apiKey:key,maxRetries:1,timeout:options.timeoutMs,...(options.cloudBaseUrl?{baseURL:options.cloudBaseUrl}:{})});
 let message:Anthropic.Beta.BetaMessage;
 try{
  // Server-side refusal fallback stays with the same provider; the reply names the model that answered.
  message=await client.beta.messages.create({model:cloud.model,max_tokens:MAX_TOKENS,output_config:{effort:'medium'},betas:['server-side-fallback-2026-07-01'],fallbacks:'default',...(ask.system?{system:ask.system}:{}),messages:[{role:'user',content:ask.prompt}]});
 }catch(e){
  if(e instanceof SDK.AuthenticationError)throw new ModelError('Cloud route (Umbilical) rejected the API key.');
  if(e instanceof SDK.RateLimitError)throw new ModelError('Cloud route (Umbilical) is rate limited; try later.');
  if(e instanceof SDK.APIConnectionTimeoutError)throw new ModelError('Cloud route (Umbilical) timed out.');
  if(e instanceof SDK.APIConnectionError)throw new ModelError('Cloud route (Umbilical) unreachable.');
  if(e instanceof SDK.APIError)throw new ModelError(`Cloud route (Umbilical) failed with HTTP ${e.status ?? 'unknown'}.`);
  throw new ModelError('Cloud route (Umbilical) failed.');
 }
 if(message.stop_reason==='refusal')throw new ModelError('Cloud route (Umbilical) declined the request.');
 const text=message.content.flatMap(b=>b.type==='text'?[b.text]:[]).join('');
 return {...bound(text),route:'cloud',model:message.model,stop:message.stop_reason ?? 'unknown'};
}
/** The routes as one role sees them: its model replaces the route's default model. */
export function forRole(models:Models,role:keyof Roles):Models {
 const pick=models.roles?.[role];const route=role==='casper'?'local':models.roles?.misato?.route;
 if(!pick?.model)return models;
 return route==='cloud'?{...models,...(models.cloud?{cloud:{...models.cloud,model:pick.model}}:{})}:{...models,...(models.local?{local:{...models.local,model:pick.model}}:{})};
}
export function describe(models:Models,hasKey:boolean):Record<RouteName,string>&{roles:Record<keyof Roles,string>} {
 const misato=models.roles?.misato;const casperModel=models.roles?.casper?.model ?? models.local?.model;
 return {roles:{misato:misato?`${misato.route} (${misato.model ?? (misato.route==='cloud'?models.cloud?.model:models.local?.model) ?? 'route not configured'})`:'not set',casper:models.local?`local (${casperModel})`:'local route not configured: the owner decides every non-Green action'},local:models.local?`configured (${models.local.model})`:'not configured',cloud:!models.cloud?'not configured':!models.cloud.enabled?'disabled':hasKey?`enabled (${models.cloud.model})`:'enabled, API key missing'};
}
