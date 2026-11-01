import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.ts';
import { makeServer } from './server.ts';
import { dataHome, initialize, readConfig, readToken } from './config.ts';
import { service } from './service.ts';
import { Runtime } from './runtime.ts';
const [command,...args]=process.argv.slice(2);
let store:Store|undefined;let running=false;
try {
  const home=dataHome();
  if(command==='init'){initialize(home);console.log(`Nodo configurato / configured: ${home}\nAccess token: ${join(home,'token')}`);}
  else if(command==='service')service(args[0] ?? '',home);
  else if(!command||command==='help')console.log('Nodo\nCommands: init | doctor | remind "title" "ISO timestamp with timezone" | list | cancel ID | tick | inbox | serve | service install|start|stop|status|uninstall');
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
      case 'doctor':console.log(JSON.stringify({node:process.version,home,port:config.port,language:config.language,timeZone:config.timeZone,hostTimeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,...local().doctor(),delivery:'Durable local inbox; phone notifications not configured.',workers:'Contract only; no remote execution.'},null,2));break;
      case 'serve':{
        const webRoot=resolve(fileURLToPath(new URL('../dist/web/browser',import.meta.url)));
        if(!existsSync(join(webRoot,'index.html')))throw new Error('Frontend missing: run npm run build.');
        const token=readToken(home);
        const runtime=new Runtime(join(home,'nodo.sqlite'));
        try{await runtime.ready();}catch(e){await runtime.close();throw e;}
        const server=makeServer(runtime,token,{webRoot,...config});
        let stopped=false;
        const close=()=>{if(stopped)return;stopped=true;server.close(()=>void runtime.close());server.closeIdleConnections();};
        runtime.nervous.child.once('exit',()=>{if(!stopped){console.error('Scheduler unavailable; shutting down for supervisor recovery.');process.exitCode=1;close();}});
        server.on('error',(e)=>{console.error(e.message);process.exitCode=1;stopped=true;void runtime.close();});
        server.listen(config.port,'127.0.0.1',()=>console.log(`Nodo: http://127.0.0.1:${config.port} · ${config.language} · ${config.timeZone}`));running=true;
        process.once('SIGINT',close);process.once('SIGTERM',close);break;
      }
      default:throw new Error('Unknown command. Run help.');
    }
  }
}catch(e){console.error(e instanceof Error?e.message:'Command failed.');process.exitCode=1;}
finally{if(!running)store?.close();}
