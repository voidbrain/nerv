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
 'reminders.add':{type:'object',required:['title','due'],properties:{title:{type:'string',minLength:1,maxLength:500},due:{type:'string',maxLength:64}},additionalProperties:false},
 'reminders.cancel':{type:'object',required:['id'],properties:{id:{type:'string',minLength:1,maxLength:100}},additionalProperties:false},
 'inbox.list':empty,
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
 {from:'interface',to:'coordinator',methods:['runtime.ping','runtime.doctor','reminders.list','reminders.add','reminders.cancel','inbox.list']},
 {from:'coordinator',to:'nervous',methods:['runtime.ping','runtime.doctor','reminders.list','reminders.add','reminders.cancel','inbox.list']},
 {from:'coordinator',to:'brain',methods:['runtime.ping']},
] as const;
export function authorize(from:Principal,to:Principal,method:string):void {
 if(!communicationGraph.some(edge=>edge.from===from&&edge.to===to&&(edge.methods as readonly string[]).includes(method)))throw new RpcFault(-32003,'Communication edge denied.');
}
export type RpcHandler=(method:Method,params:Record<string,unknown>)=>unknown|Promise<unknown>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const error=(id:string|number|null,code:number,message:string):RpcResponse=>({jsonrpc:'2.0',id,error:{code,message}});
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
