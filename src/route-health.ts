import type { RouteName } from './model.ts';
/**
 * Dummy Plug (F-030): what the brain knows about each model route, from real calls and a cheap local probe. A route is
 * `down` after a call or probe could not reach it (unreachable, timed out, HTTP 5xx, key refused, rate limited), `ok`
 * after one that answered, `off` when it is not configured, `unknown` until it is first used. Reminders and deterministic
 * work never depend on it; it only says why model-needing work fails, and when the route came back.
 */
export type RouteState='ok'|'down'|'off'|'unknown';
export interface RouteHealth {state:RouteState;since:string|null;checked:string|null;error?:string}
export interface RouteChange {route:RouteName;from:RouteState;to:RouteState;error?:string;downFor?:number}
const OUTAGE=/unreachable|timed out|failed with HTTP 5\d\d|rejected the API key|rate limited|has no API key/;
/** A route error that means the route itself cannot serve, as opposed to one bad reply (invalid JSON, no text, a refusal). */
export const isOutage=(message:string)=>OUTAGE.test(message);
export class RouteWatch {
 private readonly routes:Record<RouteName,RouteHealth>={local:{state:'unknown',since:null,checked:null},cloud:{state:'unknown',since:null,checked:null}};
 /** Which routes are configured; an unconfigured route is `off`, a newly configured one starts `unknown`. */
 configure(configured:Record<RouteName,boolean>,now=new Date()):RouteChange[] {
  return (['local','cloud'] as const).flatMap(r=>{const cur=this.routes[r].state;
   if(!configured[r]&&cur!=='off')return [this.set(r,'off',now)];
   if(configured[r]&&cur==='off')return [this.set(r,'unknown',now)];
   return [];});
 }
 /** The outcome of one call or probe; a change of state is returned so the caller can log it. */
 record(route:RouteName,ok:boolean,error?:string,now=new Date()):RouteChange|undefined {
  const h=this.routes[route];if(h.state==='off')return undefined;
  h.checked=now.toISOString();
  if(ok){if(h.state==='ok')return undefined;return this.set(route,'ok',now);}
  if(!error||!isOutage(error)){if(h.state==='unknown')return this.set(route,'ok',now);return undefined;}
  if(h.state==='down'){h.error=error.slice(0,200);return undefined;}
  return this.set(route,'down',now,error);
 }
 private set(route:RouteName,to:RouteState,now:Date,error?:string):RouteChange {
  const h=this.routes[route];const from=h.state;const downFor=from==='down'&&h.since?now.getTime()-Date.parse(h.since):undefined;
  this.routes[route]={state:to,since:now.toISOString(),checked:h.checked ?? null,...(error?{error:error.slice(0,200)}:{})};
  return {route,from,to,...(error?{error:error.slice(0,200)}:{}),...(downFor!==undefined?{downFor}:{})};
 }
 snapshot():Record<RouteName,RouteHealth> {return {local:{...this.routes.local},cloud:{...this.routes.cloud}};}
}
const NAME:Record<RouteName,string>={local:'S² local route',cloud:'Umbilical cloud route'};
/** One log line per change, for the service log: when a route went down and why, and how long it was down. */
export function describeChange(c:RouteChange):string|undefined {
 if(c.to==='down')return `NERV: ${NAME[c.route]} down: ${c.error ?? 'unreachable'} Reminders and deterministic actions continue; model-needing requests fail with this reason until it is back.`;
 if(c.to==='ok'&&c.from==='down')return `NERV: ${NAME[c.route]} back after ${Math.max(1,Math.round((c.downFor ?? 0)/60000))} min.`;
 return undefined;
}
/** The degraded reasons for status, doctor and the brief: every configured route that is down, with its reason. */
export function degradedReasons(routes:Record<RouteName,RouteHealth>):string[] {
 return (['local','cloud'] as const).filter(r=>routes[r].state==='down').map(r=>`${NAME[r]} down since ${routes[r].since}: ${routes[r].error ?? 'unreachable'}`);
}
