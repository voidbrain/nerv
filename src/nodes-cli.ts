import {writeFileSync,existsSync,openSync,fstatSync,readSync,closeSync} from 'node:fs';
import {inventoryCandidates,sshCandidates,tailscaleCandidates,registryCandidates,parseNodeInput,mergeCandidates,nodeTarget,NODE_INVENTORY_BYTES,type NodeCandidate} from './node-discovery.ts';
import {inspectLocalNode,inspectNode,runNodeCommand,type CommandRunner} from './node-inspection.ts';
import {fileURLToPath} from 'node:url';
import {bootstrapPlan} from './node-bootstrap.ts';
const NODES_HELP='nodes discover --inventory FILE | --ssh-config FILE | --tailscale FILE | --tailscale-live | --registry FILE --root-key PUBKEY; nodes inspect --local | --ssh HOST [--user USER] [--port PORT] [--out FILE]; nodes plan --inspection FILE --revision FULL-SHA --checkout ABS --home ABS --base ID --name NAME [--service] [--out FILE]';
function file(path:string):string {const fd=openSync(path,'r');try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>NODE_INVENTORY_BYTES)throw Error('Node input must be a regular file up to 256 KiB.');const bytes=Buffer.alloc(NODE_INVENTORY_BYTES+1);let size=0,n=0;while(size<bytes.length&&(n=readSync(fd,bytes,size,bytes.length-size,null))>0)size+=n;if(size>NODE_INVENTORY_BYTES)throw Error('Node input exceeds 256 KiB.');return bytes.subarray(0,size).toString('utf8');}finally{closeSync(fd);}}
export async function nodesCommand(args:string[],runner:CommandRunner=runNodeCommand):Promise<unknown>{
 const [command,...rest]=args,values=new Map<string,string>(),switches=new Set<string>();
 const schema:Record<string,{values:string[];switches:string[]}>= {discover:{values:['inventory','ssh-config','tailscale','registry','root-key'],switches:['tailscale-live']},inspect:{values:['ssh','user','port','out'],switches:['local']},plan:{values:['inspection','revision','checkout','home','base','name','out'],switches:['service']}};
 if(!command||command==='help')return {usage:NODES_HELP,execution:'none'};if(!schema[command])throw Error(NODES_HELP);const allowed=schema[command]!;
 for(let i=0;i<rest.length;i++){const key=rest[i]!.replace(/^--/,'');if(!rest[i]!.startsWith('--')||values.has(key)||switches.has(key))throw Error('Invalid or duplicate nodes option.');if(allowed.switches.includes(key))switches.add(key);else if(allowed.values.includes(key)&&rest[i+1]&&!rest[i+1]!.startsWith('--'))values.set(key,rest[++i]!);else throw Error('Invalid nodes option: '+key);}
 const required=(key:string)=>{const value=values.get(key);if(!value)throw Error('Missing --'+key);return value;};
 if(values.has('out')&&existsSync(values.get('out')!))throw Error('EEXIST: choose a new output file; nothing was inspected.');
 let result:unknown;
 if(command==='discover'){
  const sources:NodeCandidate[][]=[];
  if(values.has('inventory'))sources.push(inventoryCandidates(parseNodeInput(file(required('inventory')))));
  if(values.has('ssh-config'))sources.push(sshCandidates(file(required('ssh-config'))));
  if(values.has('tailscale'))sources.push(tailscaleCandidates(parseNodeInput(file(required('tailscale')))));
  if(switches.has('tailscale-live'))sources.push(tailscaleCandidates(parseNodeInput(await runner({program:'tailscale',args:['status','--json'],timeoutMs:5000,maxBytes:NODE_INVENTORY_BYTES}))));
  if(values.has('registry'))sources.push(registryCandidates(parseNodeInput(file(required('registry'))),required('root-key')));else if(values.has('root-key'))throw Error('--root-key needs --registry.');
  if(!sources.length)throw Error('Select a discovery source; no network range is scanned automatically.');result={version:1,candidates:mergeCandidates(...sources),trust:'Discovery does not enroll a host or establish reachability.'};
 }else if(command==='inspect'){
  if(switches.has('local')){if(values.has('ssh')||values.has('user')||values.has('port'))throw Error('Choose local or SSH inspection.');result=await inspectLocalNode(runner);}
  else result=await inspectNode(nodeTarget({host:required('ssh'),...(values.has('user')?{user:values.get('user')}:{}),port:values.has('port')?Number(values.get('port')):22}),runner);
 }else {
  const revision=required('revision');if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Pin the full 40-character NERV commit ID.');
  let declaration:unknown;try{declaration=parseNodeInput(await runner({program:'git',args:['-C',fileURLToPath(new URL('..',import.meta.url)),'show',revision+':shared/node-bootstrap.json'],timeoutMs:5000,maxBytes:16384}));}catch{throw Error('Pinned source must declare bootstrap protocol 1; select a compatible NERV commit available in this source checkout.');}
  if(!declaration||typeof declaration!=='object'||Array.isArray(declaration)||(declaration as Record<string,unknown>).version!==1||(declaration as Record<string,unknown>).initNoModelSetup!==true)throw Error('Pinned source does not support model-free bootstrap protocol 1.');
  result=bootstrapPlan(parseNodeInput(file(required('inspection'))),{sourceProtocol:1,revision,checkout:required('checkout'),home:required('home'),base:{id:required('base'),name:required('name')},installService:switches.has('service')});
 }
 if(values.has('out')){writeFileSync(required('out'),JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});return {saved:required('out'),execution:'none'};}
 return result;
}
