import type {ChannelState} from './channel-state.ts';
/** Read commands are recognized before planning/dispatch; prose aliases are deliberately narrow. */
export function readCommand(text:string):{name:'status'|'help'|'unknown';target?:string}|undefined {
 const value=text.trim();const alias=/^ask (.{1,60}?) (?:his |her |its |for )?\/status[.!?]?$/i.exec(value);
 if(alias)return {name:'status',target:alias[1]!.trim()};
 const match=/^\/([a-z]+)(?:@[a-z0-9_]+)?(?:\s+(.{1,80}))?$/i.exec(value);
 if(!match)return value.startsWith('/')?{name:'unknown'}:undefined;
 const name=match[1]!.toLowerCase();return {name:name==='status'||name==='help'?name:'unknown',...(match[2]?{target:match[2].trim()}:{})};
}
export interface StatusBase {baseId:string;name:string;online:boolean;self?:boolean;health?:{state:string;reasons:string[]}|null;channel?:ChannelState|null;channelFresh?:boolean}
export function statusText(bases:StatusBase[],target:string|undefined,language:'en'|'it'):string {
 const it=language==='it';const selected=target?bases.filter(b=>b.baseId.toLowerCase()===target.toLowerCase()||b.name.toLowerCase()===target.toLowerCase()):bases.filter(b=>b.self);
 if(!selected.length)return it?'Base non trovata nei registri locali. Usa /status ID-base.':'Base not found in the local registry. Use /status BASE-ID.';
 return selected.map(b=>{
  const mode=b.channelFresh&&b.channel?b.channel.mode:'unknown';
  return `${b.baseId} · ${b.name}\n${it?'Stato':'State'}: ${b.online?b.health?.state ?? 'online':'offline'}${b.health?.reasons.length?' · '+b.health.reasons.join('; '):''}\nMidori: ${mode}${b.channel?.destination?' → '+b.channel.destination:''}\n${it?'Fonte: registri e ultimo rapporto della base; nessuna chiamata al modello.':'Source: local records and the base’s last report; no model call.'}`;
 }).join('\n\n');
}
