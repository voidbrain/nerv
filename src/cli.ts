import { join } from 'node:path';
import { Store } from './store.ts';
import { makeServer } from './server.ts';
const [command,...args]=process.argv.slice(2);
const store=new Store(join(process.env.NODO_HOME ?? '.nodo','nodo.sqlite'));
try {
  switch(command) {
    case 'remind': console.log(JSON.stringify(store.add(args[0] ?? '',args[1] ?? ''),null,2));break;
    case 'list': console.log(JSON.stringify(store.list(),null,2));break;
    case 'cancel': if(!store.cancel(args[0] ?? '')) throw new Error('No pending reminder with that ID.'); console.log('Cancelled.');break;
    case 'tick': console.log(JSON.stringify({delivered:store.tick()}));break;
    case 'inbox': console.log(JSON.stringify(store.inbox(),null,2));break;
    case 'doctor': console.log(JSON.stringify({node:process.version,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,...store.doctor(),delivery:'Durable local inbox; no phone channel configured.',workers:'Contract only; no remote execution.'},null,2));break;
    case 'serve': {
      const token=process.env.NODO_TOKEN ?? '';const port=Number(process.env.NODO_PORT ?? 4317);
      if(!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid NODO_PORT.');
      const server=makeServer(store,token);
      server.on('error',(e)=>{console.error(e.message);clearInterval(timer);store.close();process.exitCode=1;});
      const timer=setInterval(()=>{try{store.tick();}catch(e){console.error('Scheduler failed:',e instanceof Error?e.message:'unknown error');}},1000);
      store.tick();server.listen(port,'127.0.0.1',()=>console.log(`Nodo listening on http://127.0.0.1:${port}; delivery: local inbox`));
      let stopping=false; const stop=()=>{if(stopping)return;stopping=true;clearInterval(timer);server.close(()=>store.close());server.closeIdleConnections();};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);break;
    }
    default: console.log('Nodo 0.1\nCommands: doctor | remind "title" "ISO timestamp with timezone" | list | cancel ID | tick | inbox | serve');
  }
} catch(e) {console.error(e instanceof Error?e.message:'Command failed.');process.exitCode=1;}
finally {if(command!=='serve'||process.exitCode) store.close();}
