/** First-hand Telegram telemetry only: no bot token, chat/account identifier or message content. */
export interface ChannelState {
 mode:'via-main'|'local-fallback'|'local'|'unavailable'|'unknown';
 destination?:string;
 checkedAt:string;
 lastDelivery?:{route:'main'|'local';result:'accepted'|'failed';at:string};
}
export interface HeardChannel extends ChannelState {receivedAt:string}
const modes=new Set(['via-main','local-fallback','local','unavailable','unknown']);
const timestamp=(value:unknown):value is string=>typeof value==='string'&&value.length===24&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
/** Strip unknown fields, reject invalid enums/identifiers/times; a report cannot carry private channel details. */
export function sanitizeChannel(value:unknown):ChannelState|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const v=value as Record<string,unknown>;
 if(typeof v.mode!=='string'||!modes.has(v.mode)||!timestamp(v.checkedAt))return undefined;
 if(v.destination!==undefined&&(typeof v.destination!=='string'||!/^[A-Z0-9-]{1,16}$/.test(v.destination)))return undefined;
 let lastDelivery:ChannelState['lastDelivery'];
 if(v.lastDelivery!==undefined){
  if(!v.lastDelivery||typeof v.lastDelivery!=='object'||Array.isArray(v.lastDelivery))return undefined;
  const d=v.lastDelivery as Record<string,unknown>;
  if(!['main','local'].includes(String(d.route))||!['accepted','failed'].includes(String(d.result))||!timestamp(d.at))return undefined;
  lastDelivery={route:d.route as 'main'|'local',result:d.result as 'accepted'|'failed',at:d.at};
 }
 return {mode:v.mode as ChannelState['mode'],checkedAt:v.checkedAt,...(typeof v.destination==='string'?{destination:v.destination}:{}),...(lastDelivery?{lastDelivery}:{})};
}
