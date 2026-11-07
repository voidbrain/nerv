import {randomUUID} from 'node:crypto';
import type {Config} from './config.ts';
import {effectiveRoles,type Detected} from './model-setup.ts';

interface Property {name:string;value:string}
interface ModelComponent {type:'machine-learning-model';'bom-ref':string;name:string;properties:Property[];hashes?:{alg:'SHA-256';content:string}[]}
/** An allowlisted configuration snapshot, not an assertion that a provider or MCP server executed. */
export function runtimeBom(config:Pick<Config,'models'|'pilots'|'tools'>,found:Pick<Detected,'reachable'|'models'>,version:string,now=new Date()) {
 const components:ModelComponent[]=[];
 const property=(name:string,value:string):Property=>({name:'nerv:'+name,value});
 const model=(role:string,route:'local'|'cloud',name:string,enabled=true)=>{
  const normalized=(n:string)=>n.includes(':')?n:n+':latest';
  const digest=route==='local'&&found.reachable?found.models.find(m=>normalized(m.name)===normalized(name))?.digest:undefined;
  components.push({type:'machine-learning-model','bom-ref':'model:'+role,name,
   properties:[property('role',role),property('route',route),property('enabled',String(enabled)),property('digest',digest?'reported-by-ollama':'unavailable')],
   ...(digest?{hashes:[{alg:'SHA-256',content:digest}]}:{})});
 };
 const m=config.models,roles=effectiveRoles(m);
 if(m.local)model('local-default','local',m.local.model);
 if(m.cloud)model('cloud-default','cloud',m.cloud.model,m.cloud.enabled);
 if(roles.misato)model('misato',roles.misato.route,roles.misato.model,roles.misato.route==='local'?!!m.local:!!m.cloud?.enabled);
 if(roles.casper)model('casper','local',roles.casper.model);
 if(roles.consultant)model('consultant','local',roles.consultant.model);
 // Pilot labels, domains, ids and other owner text are deliberately absent. Ordinals identify configured roles.
 for(const [i,pilot] of (config.pilots ?? []).entries())model('pilot-'+(i+1),'local',pilot.model,!!m.local&&!pilot.retired);
 const services=(config.tools?.grants ?? []).map(g=>({
  'bom-ref':'mcp:'+g.server+':'+g.tool,name:g.server+'.'+g.tool,
  properties:[property('mcp:server',g.server),property('mcp:tool',g.tool),property('mcp:fingerprint',g.fingerprint),property('mcp:fingerprint-kind','tool-description'),property('effect',g.effect),property('eva',g.eva)]
 }));
 return {$schema:'http://cyclonedx.org/schema/bom-1.6.schema.json',bomFormat:'CycloneDX',specVersion:'1.6',serialNumber:'urn:uuid:'+randomUUID(),version:1,
  metadata:{timestamp:now.toISOString(),lifecycles:[{name:'configuration snapshot'}],component:{type:'application',name:'nerv-agency',version},
   properties:[property('inventory','configured models and granted MCP tools; not execution history'),property('ollama',m.local?(found.reachable?'available':'unavailable'):'not-configured')]},components,services};
}
