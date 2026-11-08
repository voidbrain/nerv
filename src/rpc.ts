import {HISTORY_LIMIT} from './history.ts';
import { Ajv } from 'ajv';
export const MAX_FRAME_BYTES=65536;
export interface RpcError {code:number;message:string}
export type RpcResponse={jsonrpc:'2.0';id:string|number|null;result:unknown}|{jsonrpc:'2.0';id:string|number|null;error:RpcError};
export class RpcFault extends Error {readonly code:number;constructor(code:number,message:string){super(message);this.code=code;}}
const ajv=new Ajv({allErrors:false,strict:true});
const history={type:'object',properties:{before:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},limit:{type:'integer',minimum:1,maximum:HISTORY_LIMIT}},additionalProperties:false};
const empty={type:'object',properties:{},additionalProperties:false};
const workerContext={type:'object',required:['session','epoch','expires'],properties:{session:{type:'string',pattern:'^[a-f0-9-]{36}$'},epoch:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},expires:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER}},additionalProperties:false};
const workerLease={...workerContext,required:['session','epoch','expires','owner','id','fence','key','ownerKey'],properties:{...workerContext.properties,ownerKey:{type:'string',minLength:40,maxLength:128},key:{type:'string',minLength:40,maxLength:128},session:{anyOf:[{const:'legacy'},workerContext.properties.session]},epoch:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},owner:{type:'string',pattern:'^[A-Z0-9-]{1,16}$'},id:{type:'string',pattern:'^[a-f0-9-]{36}$'},fence:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}}};
const workerItem={type:'object',required:['id','request','tool','args'],properties:{deadline:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},id:{type:'string',pattern:'^[a-f0-9-]{36}$'},sequence:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},request:{type:'string',maxLength:500},tool:{type:'string',pattern:'^[a-z]+\\.[a-z]+$'},args:{type:'object',maxProperties:50}},additionalProperties:false};
const outboxResult={type:'object',required:['id','result'],properties:{id:{type:'string',minLength:1,maxLength:100},result:{type:'object'},said:{type:'object',required:['base','text'],properties:{base:{type:'string',minLength:1,maxLength:60},text:{type:'string',minLength:1,maxLength:600}},additionalProperties:false}},additionalProperties:false};
export const methodSchemas={
 'usage.begin':{type:'object',required:['operation'],properties:{operation:{enum:['model.complete','misato.step','casper.verdict','consultant.advise','instrumentality.digest']}},additionalProperties:false},
 'usage.finish':{type:'object',required:['id','observation','prices'],properties:{id:{type:'string',pattern:'^[a-f0-9-]{36}$'},observation:{anyOf:[{type:'null'},{type:'object',required:['route','requestedModel','returnedModel','inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','durationMs','outcome'],properties:{route:{enum:['local','cloud']},requestedModel:{type:'string',minLength:1,maxLength:200},returnedModel:{type:['string','null'],maxLength:200},inputTokens:{type:['integer','null'],minimum:0,maximum:Number.MAX_SAFE_INTEGER},outputTokens:{type:['integer','null'],minimum:0,maximum:Number.MAX_SAFE_INTEGER},cacheReadTokens:{type:['integer','null'],minimum:0,maximum:Number.MAX_SAFE_INTEGER},cacheWriteTokens:{type:['integer','null'],minimum:0,maximum:Number.MAX_SAFE_INTEGER},durationMs:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},outcome:{enum:['success','refused','error']}},additionalProperties:false}]},prices:{type:'array',maxItems:100,items:{type:'object',maxProperties:10}}},additionalProperties:false},
 'usage.page':{type:'object',properties:{before:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},limit:{type:'integer',minimum:1,maximum:20}},additionalProperties:false},
 'dashboard.revision':empty,
 'instrumentality.claim':{type:'object',required:['slot','now'],properties:{slot:{type:'string',pattern:'^(at|idle):[0-9]{4}-[0-9]{2}-[0-9]{2}$'},now:{type:'string',maxLength:30}},additionalProperties:false},
 'instrumentality.finish':{type:'object',required:['id','status','reason','now'],properties:{id:{type:'string',pattern:'^[a-f0-9-]{36}$'},status:{enum:['failed','completed','skipped']},reason:{enum:[null,'local-unavailable','cloud-unavailable','unreadable','unavailable','interrupted','no-exchanges']},now:{type:'string',maxLength:30}},additionalProperties:false},
 'instrumentality.latest':empty,
 'runtime.ping':empty,
 'runtime.doctor':empty,
 'reminders.list':empty,
 'reminders.page':history,
 'inbox.history':history,
 'dashboard.history':{type:'object',required:['since'],properties:{since:{type:'string',minLength:20,maxLength:40}},additionalProperties:false},
 'reminders.pending':empty,
 'reminders.add':{type:'object',required:['title','due'],properties:{title:{type:'string',minLength:1,maxLength:500},due:{type:'string',maxLength:64}},additionalProperties:false},
 'reminders.update':{type:'object',required:['id'],minProperties:2,properties:{id:{type:'string',minLength:1,maxLength:100},title:{type:'string',minLength:1,maxLength:500},due:{type:'string',maxLength:64}},additionalProperties:false},
 'reminders.cancel':{type:'object',required:['id'],properties:{id:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},
 'inbox.list':empty,
 'inbox.brief':{type:'object',required:['message'],properties:{message:{type:'string',minLength:1,maxLength:4000},day:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}},additionalProperties:false},
 'inbox.lastBrief':empty,
 'approvals.expired':{type:'object',required:['since'],properties:{since:{type:'string',minLength:10,maxLength:40}},additionalProperties:false},
 'approvals.pendingIds':{type:'object',required:['ids'],properties:{ids:{type:'array',maxItems:200,uniqueItems:true,items:{type:'string',pattern:'^[a-f0-9-]{36}$'}}},additionalProperties:false},
 'approvals.pending':{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:20}},additionalProperties:false},
 'approvals.decide':{type:'object',required:['id','decision','source'],properties:{id:{type:'string',minLength:1,maxLength:100},decision:{enum:['approve','reject','edit']},source:{enum:['api','cli','telegram']}},additionalProperties:false},
 'events.page':{type:'object',required:['sortieId'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},after:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},limit:{type:'integer',minimum:1,maximum:50}},additionalProperties:false},
 'model.complete':{type:'object',required:['prompt','privacy'],properties:{prompt:{type:'string',minLength:1,maxLength:16000},system:{type:'string',maxLength:8000},privacy:{enum:['local-only','any']},route:{enum:['local','cloud']}},additionalProperties:false},
 'sorties.list':{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:50},before:{type:'string',minLength:10,maxLength:40},q:{type:'string',minLength:1,maxLength:200}},additionalProperties:false},
 'sorties.get':{type:'object',required:['id'],properties:{id:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},
 'actions.shadowVote':{type:'object',required:['sortieId','actionId','seat','vote','reason'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},actionId:{type:'string',minLength:1,maxLength:100},seat:{type:'string',minLength:1,maxLength:40},vote:{enum:['approve','reject','abstain']},reason:{type:'string',maxLength:500},confidence:{type:'number',minimum:0,maximum:1}},additionalProperties:false},
 'pilots.unmatched':{type:'object',required:['domain','since'],properties:{domain:{type:'string',minLength:1,maxLength:40},since:{type:'string',minLength:10,maxLength:40}},additionalProperties:false},
 'tools.list':empty,
 'tools.call':{type:'object',required:['server','tool','args','fingerprint'],properties:{server:{type:'string',pattern:'^[a-z][a-z0-9]{1,15}$'},tool:{type:'string',pattern:'^[A-Za-z0-9_-]{1,64}$'},args:{type:'object',maxProperties:50},fingerprint:{type:'string',pattern:'^[0-9a-f]{16}$'}},additionalProperties:false},
 'actions.finished':{type:'object',required:['sortieId','actionId','tool'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},actionId:{type:'string',minLength:1,maxLength:100},tool:{type:'string',minLength:1,maxLength:100},text:{type:'string',maxLength:8000},error:{type:'string',maxLength:1000}},additionalProperties:false},
 'sorties.closedSince':{type:'object',required:['since'],properties:{since:{type:'string',minLength:10,maxLength:40}},additionalProperties:false},
 'sorties.explain':{type:'object',required:['ref'],properties:{ref:{type:'string',pattern:'^[0-9a-f]{4,36}$'}},additionalProperties:false},
 'sorties.spear':{type:'object',required:['id','reason'],properties:{id:{type:'string',minLength:1,maxLength:100},reason:{type:'string',minLength:1,maxLength:500}},additionalProperties:false},
 'sorties.open':{type:'object',required:['title'],properties:{title:{type:'string',minLength:1,maxLength:500},source:{enum:['owner','misato','instrumentality','marduk']}},additionalProperties:false},
 'sorties.finish':{type:'object',required:['sortieId'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},status:{enum:['done','failed']},reply:{type:'string',minLength:1,maxLength:4000}},additionalProperties:false},
 'misato.note':{type:'object',required:['sortieId','kind','payload'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},kind:{enum:['misato.request','misato.step','misato.waiting','misato.consult','pilot.unmatched','kaji.forwarded','kaji.answered']},payload:{type:'object'}},additionalProperties:false},
 'misato.resumable':empty,
 'misato.interrupted':{type:'object',required:['before'],properties:{before:{type:'string',minLength:10,maxLength:40}},additionalProperties:false},
 'misato.closeInterrupted':{type:'object',required:['sortieId','reply'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},reply:{type:'string',minLength:1,maxLength:4000}},additionalProperties:false},
 'consultant.advise':{type:'object',required:['request'],properties:{previousAdvice:{type:'string',maxLength:1200},request:{type:'string',minLength:1,maxLength:4000},tools:{type:'array',maxItems:80,items:{type:'object',required:['name','about'],properties:{name:{type:'string',minLength:1,maxLength:100},about:{type:'string',maxLength:200}},additionalProperties:false}},context:{type:'array',maxItems:3,items:{type:'object'}},pilot:{type:'object',required:['name','domain','model'],properties:{name:{type:'string',minLength:1,maxLength:40},domain:{type:'string',minLength:1,maxLength:200},model:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},bases:{type:'array',maxItems:20,items:{type:'object',required:['id','name'],properties:{id:{type:'string',minLength:1,maxLength:16},name:{type:'string',minLength:1,maxLength:60}},additionalProperties:false}}},additionalProperties:false},
 'kaji.bases':empty,
 'kaji.records':empty,
 'kaji.lastSeen':empty,
 'kaji.main':empty,
 'kaji.outbox':empty,
 'kaji.outboxAttempt':{type:'object',required:['id'],properties:{id:{type:'string',pattern:'^[a-f0-9-]{36}$'}},additionalProperties:false},
 'kaji.outboxHeld':{type:'object',properties:{before:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}},additionalProperties:false},
 'kaji.outboxDone':outboxResult,
 'kaji.outboxProgress':outboxResult,
 'worker.open':{type:'object',required:['owner','session','key','ownerKey'],properties:{ownerKey:{type:'string',minLength:40,maxLength:128},key:{type:'string',minLength:40,maxLength:128},owner:{type:'string',pattern:'^[A-Z0-9-]{1,16}$'},session:{type:'string',pattern:'^[a-f0-9-]{36}$'}},additionalProperties:false},
 'worker.close':{type:'object',required:['owner','session'],properties:{owner:{type:'string',pattern:'^[A-Z0-9-]{1,16}$'},session:{type:'string',pattern:'^[a-f0-9-]{36}$'}},additionalProperties:false},
 'worker.claim':{type:'object',required:['owner','item','key','ownerKey'],properties:{ownerKey:{type:'string',minLength:40,maxLength:128},key:{type:'string',minLength:40,maxLength:128},owner:{type:'string',pattern:'^[A-Z0-9-]{1,16}$'},item:workerItem,context:workerContext},additionalProperties:false},
 'worker.finish':{type:'object',required:['lease','result'],properties:{lease:workerLease,result:{type:'object'}},additionalProperties:false},
 'kaji.add':{type:'object',required:['records'],properties:{records:{type:'array',maxItems:1000,items:{type:'object'}}},additionalProperties:false},
 'kaji.seen':{type:'object',required:['updates'],properties:{updates:{type:'object',maxProperties:64}},additionalProperties:false},
 'memory.lastRequest':empty,
 'memory.list':{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:200}},additionalProperties:false},
 'memory.add':{type:'object',required:['text'],properties:{text:{type:'string',minLength:1,maxLength:500}},additionalProperties:false},
 'memory.edit':{type:'object',required:['id','text'],properties:{id:{type:'string',minLength:1,maxLength:100},text:{type:'string',minLength:1,maxLength:500}},additionalProperties:false},
 'memory.forget':{type:'object',required:['id'],properties:{id:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},
 'memory.share':{type:'object',required:['id','shareable'],properties:{id:{type:'string',minLength:1,maxLength:100},shareable:{type:'boolean'}},additionalProperties:false},
 'memory.history':{type:'object',required:['id'],properties:{id:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},
 'memory.episodes':{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:100}},additionalProperties:false},
 'memory.exchanges':{type:'object',required:['since','until'],properties:{since:{type:'string',minLength:10,maxLength:40},until:{type:'string',minLength:10,maxLength:40}},additionalProperties:false},
 'memory.known':{type:'object',required:['texts'],properties:{texts:{type:'array',maxItems:10,items:{type:'string',maxLength:500}}},additionalProperties:false},
 'memory.saveEpisode':{type:'object',required:['since','until','summary','exchanges','proposed'],properties:{runId:{type:'string',pattern:'^[a-f0-9-]{36}$'},since:{type:'string',minLength:10,maxLength:40},until:{type:'string',minLength:10,maxLength:40},summary:{type:'string',maxLength:2000},exchanges:{type:'integer',minimum:0},proposed:{type:'integer',minimum:0}},additionalProperties:false},
 'instrumentality.digest':{type:'object',required:['exchanges'],properties:{exchanges:{type:'array',maxItems:200,items:{type:'object'}}},additionalProperties:false},
 'memory.recall':{type:'object',required:['text'],properties:{text:{type:'string',minLength:1,maxLength:8000}},additionalProperties:false},
 'misato.question':{type:'object',required:['conversation'],properties:{conversation:{type:'string',pattern:'^[a-z]+(:[a-z0-9-]{1,30})?$',maxLength:40}},additionalProperties:false},
 'misato.ask':{type:'object',required:['sortieId','text','conversation'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},text:{type:'string',minLength:1,maxLength:4000},conversation:{type:'string',pattern:'^[a-z]+(:[a-z0-9-]{1,30})?$',maxLength:40},forwarded:{type:'object',required:['id','name'],properties:{id:{type:'string',maxLength:16},name:{type:'string',maxLength:100}},additionalProperties:false}},additionalProperties:false},
 'misato.answer':{type:'object',required:['conversation','sequence','text'],properties:{conversation:{type:'string',pattern:'^[a-z]+(:[a-z0-9-]{1,30})?$',maxLength:40},sequence:{type:'integer',minimum:1},text:{type:'string',minLength:1,maxLength:4000}},additionalProperties:false},
 'misato.context':{type:'object',required:['conversation'],properties:{conversation:{type:'string',pattern:'^[a-z]+(:[a-z0-9-]{1,30})?$',maxLength:40}},additionalProperties:false},
 'misato.claim':{type:'object',required:['sortieId'],properties:{sortieId:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},
 'misato.step':{type:'object',required:['request','history'],properties:{clarification:{type:'boolean'},request:{type:'string',minLength:1,maxLength:4000},history:{type:'array',maxItems:12,items:{type:'object'}},context:{type:'array',maxItems:3,items:{type:'object'}},memory:{type:'array',maxItems:10,items:{type:'object'}},remote:{type:'array',maxItems:10,items:{type:'object'}},external:{type:'array',maxItems:40,items:{type:'object',required:['name','effect','args','about'],properties:{name:{type:'string',maxLength:100},effect:{type:'string',maxLength:20},args:{type:'string',maxLength:1500},about:{type:'string',maxLength:700}},additionalProperties:false}},advice:{type:'string',maxLength:1200},language:{enum:['it','en']}},additionalProperties:false},
 'actions.preview':{type:'object',required:['sortieId','tool'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},tool:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},
 'actions.act':{type:'object',required:['sortieId','tool','args','stage'],properties:{worker:workerLease,sortieId:{type:'string',minLength:1,maxLength:100},tool:{type:'string',minLength:1,maxLength:100},args:{type:'object',maxProperties:50},stage:{enum:['prototype','test','production']},casper:{type:'object',required:['seat','vote','reason'],properties:{seat:{const:'casper'},vote:{enum:['approve','reject','abstain']},reason:{type:'string',maxLength:500},confidence:{type:'number',minimum:0,maximum:1}},additionalProperties:false},extras:{type:'array',maxItems:6,items:{type:'object',required:['seat','vote','reason'],properties:{seat:{type:'string',pattern:'^[A-Z0-9-]{2,16}$'},vote:{enum:['approve','reject','abstain']},reason:{type:'string',maxLength:500},confidence:{type:'number',minimum:0,maximum:1},shadow:{type:'boolean'}},additionalProperties:false}}},additionalProperties:false},
 'casper.verdict':{type:'object',required:['request','tool','args','effect'],properties:{request:{type:'string',minLength:1,maxLength:4000},tool:{type:'string',minLength:1,maxLength:100},args:{type:'object',maxProperties:50},effect:{enum:['read','write-local','write-external','irreversible','physical']},earlier:{type:'array',maxItems:3,items:{type:'object',required:['request'],properties:{request:{type:'string',maxLength:600},reply:{type:'string',maxLength:600}},additionalProperties:false}},bases:{type:'array',maxItems:20,items:{type:'object',required:['id','name'],properties:{id:{type:'string',minLength:1,maxLength:16},name:{type:'string',minLength:1,maxLength:60}},additionalProperties:false}}},additionalProperties:false},
 'models.reload':empty,
 'inbox.page':{type:'object',properties:{after:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},afterId:{type:'string',minLength:1,maxLength:100},limit:{type:'integer',minimum:1,maximum:20}},additionalProperties:false},
} as const;
export type Method=keyof typeof methodSchemas;
const validators=new Map(Object.entries(methodSchemas).map(([name,schema])=>[name,ajv.compile(schema)]));
export function validateParams(method:string,params:unknown):asserts method is Method {
 const validate=validators.get(method);if(!validate)throw new RpcFault(-32601,'Method not found.');
 if(!validate(params))throw new RpcFault(-32602,'Invalid method parameters.');
}
export type Principal='interface'|'coordinator'|'nervous'|'brain'|'tools';
/** Directed edges describe permission, not routing or model capability. Deny by default. */
export const communicationGraph=[
 {from:'interface',to:'coordinator',methods:['runtime.ping','runtime.doctor','reminders.list','reminders.page','inbox.history','dashboard.history','reminders.pending','reminders.add','reminders.update','reminders.cancel','inbox.list','inbox.page','approvals.pending','events.page','sorties.list','sorties.get']},
 {from:'coordinator',to:'nervous',methods:['instrumentality.claim','instrumentality.finish','instrumentality.latest','dashboard.revision','usage.begin','usage.finish','usage.page','runtime.ping','runtime.doctor','reminders.list','reminders.page','inbox.history','dashboard.history','reminders.pending','reminders.add','reminders.update','reminders.cancel','inbox.list','inbox.brief','inbox.lastBrief','inbox.page','approvals.pending','approvals.pendingIds','approvals.expired','approvals.decide','events.page','sorties.list','sorties.get','actions.finished','pilots.unmatched','actions.shadowVote','sorties.closedSince','sorties.explain','sorties.spear','sorties.open','sorties.finish','actions.preview','actions.act','misato.note','misato.resumable','misato.interrupted','misato.closeInterrupted','misato.context','misato.question','misato.ask','misato.answer','misato.claim','memory.recall','kaji.bases','kaji.records','kaji.lastSeen','kaji.main','kaji.outbox','kaji.outboxAttempt','kaji.outboxHeld','kaji.outboxDone','kaji.outboxProgress','worker.open','worker.close','worker.claim','worker.finish','kaji.add','kaji.seen','memory.lastRequest','memory.list','memory.add','memory.edit','memory.forget','memory.share','memory.history','memory.episodes','memory.exchanges','memory.known','memory.saveEpisode']},
 {from:'coordinator',to:'tools',methods:['runtime.ping','tools.list','tools.call']},
 {from:'coordinator',to:'brain',methods:['runtime.ping','model.complete','casper.verdict','misato.step','consultant.advise','models.reload','instrumentality.digest']},
] as const;
export function authorize(from:Principal,to:Principal,method:string):void {
 if(!communicationGraph.some(edge=>edge.from===from&&edge.to===to&&(edge.methods as readonly string[]).includes(method)))throw new RpcFault(-32003,'Communication edge denied.');
}
export type RpcHandler=(method:Method,params:Record<string,unknown>)=>unknown|Promise<unknown>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const error=(id:string|number|null,code:number,message:string):RpcResponse=>({jsonrpc:'2.0',id,error:{code,message}});
/** Sent by a child process once it handles requests; the coordinator sends nothing before it (B-007). */
export const READY={nerv:'ready'} as const;
export async function dispatchRpc(value:unknown,handler:RpcHandler):Promise<RpcResponse|undefined> {
 if(!object(value)||value.jsonrpc!=='2.0'||typeof value.method!=='string'||Object.keys(value).some(k=>!['jsonrpc','method','params','id'].includes(k))||('id'in value&&value.id!==null&&typeof value.id!=='string'&&!(typeof value.id==='number'&&Number.isSafeInteger(value.id))))return error(null,-32600,'Invalid Request.');
 const id=value.id as string|number|null;const notification=!('id'in value);
 try{const params=value.params ?? {};validateParams(value.method,params);const result=await handler(value.method,params as Record<string,unknown>);return notification?undefined:{jsonrpc:'2.0',id,result:result ?? null};}
 catch(e){return notification?undefined:error(id,e instanceof RpcFault?e.code:-32603,e instanceof RpcFault?e.message:'Internal error.');}
}
export async function handleFrame(text:string,handler:RpcHandler):Promise<RpcResponse|RpcResponse[]|undefined> {
 if(Buffer.byteLength(text)>MAX_FRAME_BYTES)return error(null,-32600,'Frame too large.');
 let value:unknown;try{value=JSON.parse(text);}catch{return error(null,-32700,'Parse error.');}
 if(Array.isArray(value)) {
  if(!value.length||value.length>16)return error(null,-32600,'Invalid batch.');
  const replies:RpcResponse[]=[];for(const item of value){const response=await dispatchRpc(item,handler);if(response)replies.push(response);}return replies.length?replies:undefined;
 }
 return dispatchRpc(value,handler);
}
