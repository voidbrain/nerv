import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.ts';
import { makeServer } from './server.ts';
import { dataHome, initialize, readConfig, readToken } from './config.ts';
import { service } from './service.ts';
import {initializeNativeTLS,loadNativeTLS,nativeAdmin,NativeAuth,type Invitation} from './native-auth.ts';
import { Runtime } from './runtime.ts';
const [command,...args]=process.argv.slice(2);
let store:Store|undefined;let running=false;
try {
  const home=dataHome();
  if(command==='init'){initialize(home);console.log(`Nodo configurato / configured: ${home}\nAccess token: ${join(home,'token')}`);}
  else if(command==='native-init'){initialize(home);initializeNativeTLS(home);console.log('Native TLS configured. Restart Nodo, then run pair.');}
  else if(['pair','clients','revoke'].includes(command ?? '')){const config=readConfig(home);const path=command==='pair'?'/api/pairing/tickets':command==='clients'?'/api/clients':'/api/clients/'+encodeURIComponent(args[0] ?? '');const value=await nativeAdmin(home,config.nativePort ?? 4319,readToken(home),path,command==='pair'?'POST':command==='revoke'?'DELETE':'GET',command==='pair'?{label:args[0] ?? 'Nodo Menu Bar'}:undefined);if(command==='pair'){const invitation=value as Invitation;console.log('Private invitation (expires in 2 minutes; paste only into Nodo companion):\n'+Buffer.from(JSON.stringify(invitation)).toString('base64url'));}else console.log(JSON.stringify(value,null,2));}
  else if(command==='service')service(args[0] ?? '',home);
  else if(!command||command==='help')console.log('Nodo\nCommands: init | native-init | pair [label] | clients | revoke CLIENT_ID | doctor | remind "title" "ISO timestamp with timezone" | list | cancel ID | tick | inbox | approvals | approve ID | reject ID | events SORTIE_ID | spear SORTIE_ID [reason] | serve | service install|start|stop|status|uninstall');
  else {
    const config=readConfig(home);
    if(command!=='serve')store=new Store(join(home,'nodo.sqlite'));
    const local=()=>store!;
    switch(command) {
      case 'remind':console.log(JSON.stringify(local().add(args[0] ?? '',args[1] ?? ''),null,2));break;
      case 'list':console.log(JSON.stringify(local().list(),null,2));break;
      case 'cancel':if(!local().cancel(args[0] ?? ''))throw new Error('No pending reminder with that ID.');console.log('Cancelled.');break;
      case 'tick':console.log(JSON.stringify({delivered:local().tick()}));break;
      case 'inbox':console.log(JSON.stringify(local().inbox(),null,2));break;
      case 'approvals':console.log(JSON.stringify(local().approvals(),null,2));break;
      case 'approve':case 'reject':console.log(JSON.stringify(local().ledger.decide(args[0] ?? '',command,'cli'),null,2));break;
      case 'events':console.log(JSON.stringify(local().events(args[0] ?? ''),null,2));break;
      case 'spear':console.log(JSON.stringify(local().ledger.spear(args[0] ?? '',args[1] ?? 'cli'),null,2));break;
      case 'doctor':console.log(JSON.stringify({node:process.version,home,port:config.port,language:config.language,timeZone:config.timeZone,hostTimeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,...local().doctor(),delivery:'Durable local inbox; phone notifications not configured.',workers:'Contract only; no remote execution.'},null,2));break;
      case 'serve':{
        const webRoot=resolve(fileURLToPath(new URL('../dist/web/browser',import.meta.url)));
        if(!existsSync(join(webRoot,'index.html')))throw new Error('Frontend missing: run npm run build.');
        const token=readToken(home);const nativeTLS=loadNativeTLS(home);
        const nativeAuth=nativeTLS?new NativeAuth(home):undefined;
        const runtime=new Runtime(join(home,'nodo.sqlite'));
        try{await runtime.ready();}catch(e){await runtime.close();nativeAuth?.close();throw e;}
        let server:ReturnType<typeof makeServer>;let native:ReturnType<typeof makeServer>|undefined;
        try{server=makeServer(runtime,token,{webRoot,...config});native=nativeTLS&&nativeAuth?makeServer(runtime,token,{...config,tls:nativeTLS,native:{auth:nativeAuth,fingerprint:nativeTLS.fingerprint,port:config.nativePort ?? 4319,webPort:config.port}}):undefined;}catch(e){await runtime.close();nativeAuth?.close();throw e;}
        const servers=native?[server,native]:[server];let stopped=false;
        const close=()=>{if(stopped)return;stopped=true;void Promise.all(servers.map(s=>new Promise<void>(done=>{s.close(()=>done());s.closeIdleConnections();}))).then(()=>runtime.close()).finally(()=>nativeAuth?.close());};
        runtime.nervous.child.once('exit',()=>{if(!stopped){console.error('Scheduler unavailable; shutting down for supervisor recovery.');process.exitCode=1;close();}});
        for(const listener of servers)listener.on('error',e=>{console.error(e.message);process.exitCode=1;close();});
        if(native)await new Promise<void>((done,reject)=>{native.once('error',reject);native.listen(config.nativePort ?? 4319,'127.0.0.1',done);}).catch(e=>{close();throw e;});
        server.listen(config.port,'127.0.0.1',()=>console.log(`Nodo: http://127.0.0.1:${config.port} · ${config.language} · ${config.timeZone}`));running=true;
        process.once('SIGINT',close);process.once('SIGTERM',close);break;
      }
      default:throw new Error('Unknown command. Run help.');
    }
  }
}catch(e){console.error(e instanceof Error?e.message:'Command failed.');process.exitCode=1;}
finally{if(!running)store?.close();}
