/**
 * One sentence of "why" per sortie (F-019): where it stands and the reason, from the ledger's facts only (no model), so
 * the dashboard can say it without opening the sortie. It speaks about the latest action, which decides what happens next.
 */
export interface WhyInput {
 status:string;
 actions:number;
 replied:boolean;
 spearReason?:string|undefined;
 last?:{tool:string;outcome:'grant'|'approval'|'reject';reason:string;decision:string|null;ran:'done'|'failed'|null;error?:string|undefined}|undefined;
}
const clip=(text:string,max=160)=>text.length>max?text.slice(0,max-1)+'…':text;
const stop=(text:string)=>/[.!?…]$/.test(text)?text:text+'.';
export function explainSortie(w:WhyInput):string {
 const l=w.last;
 if(w.status==='revoked')return stop(clip('Stopped with the Spear'+(w.spearReason?': '+w.spearReason:'')))+' Nothing more will run.';
 if(!l){
  if(w.status==='open')return 'Misato is working on it; no action proposed yet.';
  if(w.status==='failed')return 'Failed before any action was proposed.';
  return w.replied?'Answered without taking any action.':'Closed without taking any action.';
 }
 const more=w.actions>1?` (${w.actions} actions)`:'';
 if(l.ran==='failed')return stop(clip(`${l.tool} failed: ${l.error ?? 'no reason recorded'}`));
 if(l.ran==='done')return w.status==='open'?`${l.tool} ran; Misato is deciding the next step.`:`Done${more}: the last action, ${l.tool}, ran.`;
 if(l.outcome==='reject')return stop(clip(`The MAGI refused ${l.tool}: ${l.reason}`));
 if(l.outcome==='approval'){
  if(l.decision===null)return w.status==='open'?stop(clip(`Waits for you to approve ${l.tool}: ${l.reason}`)):`${l.tool} waited for your approval; the sortie closed first.`;
  if(l.decision==='reject')return `You rejected ${l.tool}${w.status==='open'?'; Misato is deciding what to do instead':''}.`;
  if(l.decision==='edit')return `You sent ${l.tool} back to Misato to change.`;
  if(l.decision==='expired')return `Your approval for ${l.tool} expired; expiry never approves.`;
  if(l.decision==='revoked')return `The card for ${l.tool} was stood down.`;
  if(l.decision==='approve')return w.status==='open'?`You approved ${l.tool}; it is running.`:`You approved ${l.tool}.`;
 }
 return w.status==='open'?`${l.tool} was cleared to run; it is running.`:`${l.tool} was cleared to run.`;
}
