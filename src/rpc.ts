import { Ajv } from 'ajv';
export const MAX_FRAME_BYTES=65536;
export interface RpcError {code:number;message:string}
export type RpcResponse={jsonrpc:'2.0';id:string|number|null;result:unknown}|{jsonrpc:'2.0';id:string|number|null;error:RpcError};
export class RpcFault extends Error {readonly code:number;constructor(code:number,message:string){super(message);this.code=code;}}
const ajv=new Ajv({allErrors:false,strict:true});
const empty={type:'object',properties:{},additionalProperties:false};
export const methodSchemas={
 'runtime.ping':empty,
 'runtime.doctor':empty,
 'reminders.list':empty,
 'reminders.pending':empty,
 'reminders.add':{type:'object',required:['title','due'],properties:{title:{type:'string',minLength:1,maxLength:500},due:{type:'string',maxLength:64}},additionalProperties:false},
 'reminders.update':{type:'object',required:['id'],minProperties:2,properties:{id:{type:'string',minLength:1,maxLength:100},title:{type:'string',minLength:1,maxLength:500},due:{type:'string',maxLength:64}},additionalProperties:false},
 'reminders.cancel':{type:'object',required:['id'],properties:{id:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},
 'inbox.list':empty,
 'inbox.brief':{type:'object',required:['message'],properties:{message:{type:'string',minLength:1,maxLength:4000}},additionalProperties:false},
 'inbox.lastBrief':empty,
 'approvals.expired':{type:'object',required:['since'],properties:{since:{type:'string',minLength:10,maxLength:40}},additionalProperties:false},
 'approvals.pending':{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:20}},additionalProperties:false},
 'approvals.decide':{type:'object',required:['id','decision','source'],properties:{id:{type:'string',minLength:1,maxLength:100},decision:{enum:['approve','reject','edit']},source:{enum:['api','cli','telegram']}},additionalProperties:false},
 'events.page':{type:'object',required:['sortieId'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},after:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},limit:{type:'integer',minimum:1,maximum:50}},additionalProperties:false},
 'model.complete':{type:'object',required:['prompt','privacy'],properties:{prompt:{type:'string',minLength:1,maxLength:16000},system:{type:'string',maxLength:8000},privacy:{enum:['local-only','any']},route:{enum:['local','cloud']}},additionalProperties:false},
 'sorties.list':{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:50},before:{type:'string',minLength:10,maxLength:40},q:{type:'string',minLength:1,maxLength:200}},additionalProperties:false},
 'sorties.get':{type:'object',required:['id'],properties:{id:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},
 'sorties.closedSince':{type:'object',required:['since'],properties:{since:{type:'string',minLength:10,maxLength:40}},additionalProperties:false},
 'sorties.explain':{type:'object',required:['ref'],properties:{ref:{type:'string',pattern:'^[0-9a-f]{4,36}$'}},additionalProperties:false},
 'sorties.spear':{type:'object',required:['id','reason'],properties:{id:{type:'string',minLength:1,maxLength:100},reason:{type:'string',minLength:1,maxLength:500}},additionalProperties:false},
 'sorties.open':{type:'object',required:['title'],properties:{title:{type:'string',minLength:1,maxLength:500},source:{enum:['owner','misato','instrumentality']}},additionalProperties:false},
 'sorties.finish':{type:'object',required:['sortieId'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},status:{enum:['done','failed']},reply:{type:'string',minLength:1,maxLength:4000}},additionalProperties:false},
 'misato.note':{type:'object',required:['sortieId','kind','payload'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},kind:{enum:['misato.request','misato.step','misato.waiting','misato.consult']},payload:{type:'object'}},additionalProperties:false},
 'misato.resumable':empty,
 'consultant.advise':{type:'object',required:['request'],properties:{request:{type:'string',minLength:1,maxLength:4000},context:{type:'array',maxItems:3,items:{type:'object'}}},additionalProperties:false},
 'kaji.bases':empty,
 'kaji.records':empty,
 'kaji.lastSeen':empty,
 'kaji.main':empty,
 'kaji.outbox':empty,
 'kaji.outboxDone':{type:'object',required:['id','result'],properties:{id:{type:'string',minLength:1,maxLength:100},result:{type:'object'}},additionalProperties:false},
 'kaji.remoteRun':{type:'object',required:['id'],properties:{id:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},
 'kaji.saveRemoteRun':{type:'object',required:['id','from','result'],properties:{id:{type:'string',minLength:1,maxLength:100},from:{type:'string',minLength:1,maxLength:16},result:{type:'object'}},additionalProperties:false},
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
 'memory.saveEpisode':{type:'object',required:['since','until','summary','exchanges','proposed'],properties:{since:{type:'string',minLength:10,maxLength:40},until:{type:'string',minLength:10,maxLength:40},summary:{type:'string',maxLength:2000},exchanges:{type:'integer',minimum:0},proposed:{type:'integer',minimum:0}},additionalProperties:false},
 'instrumentality.digest':{type:'object',required:['exchanges'],properties:{exchanges:{type:'array',maxItems:200,items:{type:'object'}}},additionalProperties:false},
 'memory.recall':{type:'object',required:['text'],properties:{text:{type:'string',minLength:1,maxLength:8000}},additionalProperties:false},
 'misato.context':{type:'object',required:['conversation'],properties:{conversation:{type:'string',pattern:'^[a-z]+(:[a-z0-9-]{1,30})?$',maxLength:40}},additionalProperties:false},
 'misato.claim':{type:'object',required:['sortieId'],properties:{sortieId:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},
 'misato.step':{type:'object',required:['request','history'],properties:{request:{type:'string',minLength:1,maxLength:4000},history:{type:'array',maxItems:12,items:{type:'object'}},context:{type:'array',maxItems:3,items:{type:'object'}},memory:{type:'array',maxItems:10,items:{type:'object'}},remote:{type:'array',maxItems:10,items:{type:'object'}},advice:{type:'string',maxLength:1200},language:{enum:['it','en']}},additionalProperties:false},
 'actions.preview':{type:'object',required:['sortieId','tool'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},tool:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},
 'actions.act':{type:'object',required:['sortieId','tool','args','stage'],properties:{sortieId:{type:'string',minLength:1,maxLength:100},tool:{type:'string',minLength:1,maxLength:100},args:{type:'object',maxProperties:50},stage:{enum:['prototype','test','production']},casper:{type:'object',required:['seat','vote','reason'],properties:{seat:{const:'casper'},vote:{enum:['approve','reject','abstain']},reason:{type:'string',maxLength:500},confidence:{type:'number',minimum:0,maximum:1}},additionalProperties:false},extras:{type:'array',maxItems:6,items:{type:'object',required:['seat','vote','reason'],properties:{seat:{type:'string',pattern:'^[A-Z0-9-]{2,16}$'},vote:{enum:['approve','reject','abstain']},reason:{type:'string',maxLength:500},confidence:{type:'number',minimum:0,maximum:1},shadow:{type:'boolean'}},additionalProperties:false}}},additionalProperties:false},
 'casper.verdict':{type:'object',required:['request','tool','args','effect'],properties:{request:{type:'string',minLength:1,maxLength:4000},tool:{type:'string',minLength:1,maxLength:100},args:{type:'object',maxProperties:50},effect:{enum:['read','write-local','write-external','irreversible','physical']}},additionalProperties:false},
 'models.reload':empty,
 'inbox.page':{type:'object',properties:{after:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},afterId:{type:'string',minLength:1,maxLength:100},limit:{type:'integer',minimum:1,maximum:20}},additionalProperties:false},
} as const;
export type Method=keyof typeof methodSchemas;
const validators=new Map(Object.entries(methodSchemas).map(([name,schema])=>[name,ajv.compile(schema)]));
export function validateParams(method:string,params:unknown):asserts method is Method {
 const validate=validators.get(method);if(!validate)throw new RpcFault(-32601,'Method not found.');
 if(!validate(params))throw new RpcFault(-32602,'Invalid method parameters.');
}
export type Principal='interface'|'coordinator'|'nervous'|'brain';
/** Directed edges describe permission, not routing or model capability. Deny by default. */
export const communicationGraph=[
 {from:'interface',to:'coordinator',methods:['runtime.ping','runtime.doctor','reminders.list','reminders.pending','reminders.add','reminders.update','reminders.cancel','inbox.list','inbox.page','approvals.pending','events.page','sorties.list','sorties.get']},
 {from:'coordinator',to:'nervous',methods:['runtime.ping','runtime.doctor','reminders.list','reminders.pending','reminders.add','reminders.update','reminders.cancel','inbox.list','inbox.brief','inbox.lastBrief','inbox.page','approvals.pending','approvals.expired','approvals.decide','events.page','sorties.list','sorties.get','sorties.closedSince','sorties.explain','sorties.spear','sorties.open','sorties.finish','actions.preview','actions.act','misato.note','misato.resumable','misato.context','misato.claim','memory.recall','kaji.bases','kaji.records','kaji.lastSeen','kaji.main','kaji.outbox','kaji.outboxDone','kaji.remoteRun','kaji.saveRemoteRun','kaji.add','kaji.seen','memory.lastRequest','memory.list','memory.add','memory.edit','memory.forget','memory.share','memory.history','memory.episodes','memory.exchanges','memory.known','memory.saveEpisode']},
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
