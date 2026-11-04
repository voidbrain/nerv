import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.ts';
import { makeServer } from './server.ts';
import { dataHome, databasePath, initialize, readConfig, readScrolls, readTelegramToken, readToken } from './config.ts';
import { TelegramApi, TelegramChannel, startChats, telegramBase } from './telegram.ts';
import { service } from './service.ts';
import {initializeNativeTLS,loadNativeTLS,nativeAdmin,NativeAuth,type Invitation} from './native-auth.ts';
import { Runtime } from './runtime.ts';
const [command,...args]=process.argv.slice(2);
let store:Store|undefined;let running=false;
try {
  const home=dataHome();
  if(command==='init'){initialize(home);console.log(`NERV Agency configurata / configured: ${home}\nAccess token: ${join(home,'token')}`);}
  else if(command==='native-init'){initialize(home);initializeNativeTLS(home);console.log('Native TLS configured. Restart NERV Agency, then run pair.');}
  else if(['pair','clients','revoke'].includes(command ?? '')){const config=readConfig(home);const path=command==='pair'?'/api/pairing/tickets':command==='clients'?'/api/clients':'/api/clients/'+encodeURIComponent(args[0] ?? '');const value=await nativeAdmin(home,config.nativePort ?? 4319,readToken(home),path,command==='pair'?'POST':command==='revoke'?'DELETE':'GET',command==='pair'?{label:args[0] ?? 'NERV Agency Menu Bar'}:undefined);if(command==='pair'){const invitation=value as Invitation;console.log('Private invitation (expires in 2 minutes; paste only into the NERV Agency companion):\n'+Buffer.from(JSON.stringify(invitation)).toString('base64url'));}else console.log(JSON.stringify(value,null,2));}
  else if(command==='service')service(args[0] ?? '',home);
  else if(command==='telegram'){
    // telegram link [CHAT_ID]: binds Aoba to the private chat that sent /start to the bot.
    if(args[0]!=='link')throw new Error('Usage: telegram link [CHAT_ID]');
    const botToken=readTelegramToken(home);if(!botToken)throw new Error('No telegram-token in the data home: store the BotFather token there first (INSTALL, "Telegram").');
    const chats=await startChats(new TelegramApi(botToken,telegramBase()));
    const wanted=args[1]?Number(args[1]):undefined;const pick=wanted!==undefined?chats.find(c=>c.chatId===wanted):chats.length===1?chats[0]:undefined;
    if(!pick){if(!chats.length)throw new Error('No /start found: send /start to your bot in Telegram, then run this again (within 24 hours).');throw new Error(`Several chats sent /start; choose one: ${chats.map(c=>`telegram link ${c.chatId} (${c.name})`).join(' | ')}`);}
    const path=join(home,'config.json');const current=existsSync(path)?JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>:{};
    writeFileSync(path,JSON.stringify({...current,telegram:{chatId:pick.chatId}},null,2)+'\n',{mode:0o600});chmodSync(path,0o600);readConfig(home);
    console.log(`Aoba linked to ${pick.name} (chat ${pick.chatId}). Restart the service to start it.`);
  }
  else if(command==='open'){
    // Opens the web workspace signed in: the service mints a one-use code, the page swaps it for the token in memory.
    const config=readConfig(home);
    const response=await fetch(`http://127.0.0.1:${config.port}/api/session/codes`,{method:'POST',headers:{authorization:`Bearer ${readToken(home)}`}}).catch(()=>{throw new Error('NERV Agency is not running: start it with serve or service start.');});
    const value=await response.json() as {code?:string;error?:string};
    if(!response.ok||!value.code)throw new Error(value.error ?? 'Could not create a login code.');
    const url=`http://127.0.0.1:${config.port}/#code=${value.code}`;
    const opener=args[0]==='--print'?undefined:process.platform==='darwin'?'open':process.platform==='linux'?'xdg-open':undefined;
    if(opener){const run=spawnSync(opener,[url],{stdio:'ignore'});if(run.status!==0)console.log(url);}else console.log(url);
  }
  else if(command==='chat'){
    // A request to Misato through the running service. It plans, the gate reviews each action, and the reply comes back.
    const message=args.join(' ');if(!message)throw new Error('Usage: chat "what you want"');
    const config=readConfig(home);
    const response=await fetch(`http://127.0.0.1:${config.port}/api/chat`,{method:'POST',headers:{authorization:`Bearer ${readToken(home)}`,'content-type':'application/json'},body:JSON.stringify({message})}).catch(()=>{throw new Error('NERV Agency is not running: start it with serve or service start.');});
    const value=await response.json() as {reply?:string;error?:string;sortieId?:string;steps?:{tool?:string;outcome:string;reason?:string;error?:string}[];waiting?:{approvalId:string;tool:string}[]};
    if(!response.ok)throw new Error(value.error ?? 'Chat failed.');
    for(const s of value.steps ?? [])console.log(`· ${s.tool ?? '(invalid reply)'} → ${s.outcome}${s.error?` · ${s.error}`:s.reason?` · ${s.reason}`:''}`);
    for(const w of value.waiting ?? [])console.log(`⏸ ${w.tool} waits for you: approve ${w.approvalId} | reject ${w.approvalId}`);
    console.log(value.reply ?? `[no reply: ${value.error}]`);
    console.log(`— sortie ${value.sortieId}`);
    if(!value.reply)process.exitCode=1;
  }
  else if(command==='reload'){
    // The running brain re-reads config.json and anthropic-key; a broken file keeps the last working settings.
    const config=readConfig(home);
    const response=await fetch(`http://127.0.0.1:${config.port}/api/models/reload`,{method:'POST',headers:{authorization:`Bearer ${readToken(home)}`}}).catch(()=>{throw new Error('NERV Agency is not running: start it with serve or service start.');});
    const value=await response.json() as {error?:string;kept?:boolean;models?:unknown};
    if(!response.ok)throw new Error(`${value.error ?? 'Reload failed.'}${value.kept?' The previous model settings stay in use.':''}`);
    console.log(JSON.stringify(value.models,null,2));
  }
  else if(command==='act'){
    // Through the running service, like ask: the gate, Casper and the executors live there.
    const [request,tool,json]=args;if(!request||!tool)throw new Error('Usage: act "what you want" TOOL [\'{"arg":"value"}\']');
    let toolArgs:unknown;try{toolArgs=JSON.parse(json ?? '{}');}catch{throw new Error('Tool arguments must be a JSON object.');}
    const config=readConfig(home);
    const response=await fetch(`http://127.0.0.1:${config.port}/api/actions`,{method:'POST',headers:{authorization:`Bearer ${readToken(home)}`,'content-type':'application/json'},body:JSON.stringify({request,tool,args:toolArgs})}).catch(()=>{throw new Error('NERV Agency is not running: start it with serve or service start.');});
    const value=await response.json() as {error?:string};
    if(!response.ok)throw new Error(value.error ?? 'Action failed.');
    console.log(JSON.stringify(value,null,2));
  }
  else if(command==='ask'){
    // Goes through the running service so only one brain and one scheduler exist. Local-only unless --cloud.
    const cloud=args[0]==='--cloud';const prompt=(cloud?args.slice(1):args).join(' ');
    if(!prompt)throw new Error('Usage: ask [--cloud] "text"');
    const config=readConfig(home);
    const response=await fetch(`http://127.0.0.1:${config.port}/api/ask`,{method:'POST',headers:{authorization:`Bearer ${readToken(home)}`,'content-type':'application/json'},body:JSON.stringify(cloud?{prompt,privacy:'any',route:'cloud'}:{prompt,privacy:'local-only'})}).catch(()=>{throw new Error('NERV Agency is not running: start it with serve or service start.');});
    const value=await response.json() as {text?:string;route?:string;model?:string;truncated?:boolean;error?:string};
    if(!response.ok)throw new Error(value.error ?? 'Ask failed.');
    console.log(value.text+(value.truncated?'\n[reply truncated]':'')+`\n— ${value.route} · ${value.model}`);
  }
  else if(!command||command==='help')console.log('NERV Agency\nCommands: init | native-init | pair [label] | clients | revoke CLIENT_ID | doctor | ask [--cloud] "text" | open | chat "text" | telegram link [CHAT_ID] | act "request" TOOL [JSON args] | reload | remind "title" "ISO timestamp with timezone" | list | cancel ID | tick | inbox | approvals | approve ID | reject ID | events SORTIE_ID | spear SORTIE_ID [reason] | serve | service install|start|stop|status|uninstall');
  else {
    const config=readConfig(home);
    const scrolls=readScrolls(home);
    if(command!=='serve')store=new Store(databasePath(home),scrolls);
    const local=()=>store!;
    switch(command) {
      case 'remind':console.log(JSON.stringify(local().add(args[0] ?? '',args[1] ?? ''),null,2));break;
      case 'list':console.log(JSON.stringify(local().list(),null,2));break;
      case 'cancel':if(!local().cancel(args[0] ?? ''))throw new Error('No pending reminder with that ID.');console.log('Cancelled.');break;
      case 'tick':console.log(JSON.stringify({delivered:local().tick()}));break;
      case 'inbox':console.log(JSON.stringify(local().inbox(),null,2));break;
      case 'approvals':console.log(JSON.stringify(local().approvals(),null,2));break;
      case 'approve':case 'reject':console.log(JSON.stringify(local().decide(args[0] ?? '',command,'cli'),null,2));break;
      case 'events':console.log(JSON.stringify(local().events(args[0] ?? ''),null,2));break;
      case 'spear':console.log(JSON.stringify(local().ledger.spear(args[0] ?? '',args[1] ?? 'cli'),null,2));break;
      case 'doctor':console.log(JSON.stringify({node:process.version,home,port:config.port,language:config.language,timeZone:config.timeZone,hostTimeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,...local().doctor(),delivery:'Durable local inbox; phone notifications not configured.',workers:'Contract only; no remote execution.'},null,2));break;
      case 'serve':{
        const webRoot=resolve(fileURLToPath(new URL('../dist/web/browser',import.meta.url)));
        if(!existsSync(join(webRoot,'index.html')))throw new Error('Frontend missing: run npm run build.');
        const token=readToken(home);const nativeTLS=loadNativeTLS(home);const botToken=readTelegramToken(home);
        const nativeAuth=nativeTLS?new NativeAuth(home):undefined;
        const runtime=new Runtime(databasePath(home),undefined,home);
        try{await runtime.ready();}catch(e){await runtime.close();nativeAuth?.close();throw e;}
        let server:ReturnType<typeof makeServer>;let native:ReturnType<typeof makeServer>|undefined;
        try{server=makeServer(runtime,token,{webRoot,...config});native=nativeTLS&&nativeAuth?makeServer(runtime,token,{...config,tls:nativeTLS,native:{auth:nativeAuth,fingerprint:nativeTLS.fingerprint,port:config.nativePort ?? 4319,webPort:config.port}}):undefined;}catch(e){await runtime.close();nativeAuth?.close();throw e;}
        const servers=native?[server,native]:[server];let stopped=false;
        let aoba:TelegramChannel|undefined;
        const close=()=>{if(stopped)return;stopped=true;void aoba?.stop();void Promise.all(servers.map(s=>new Promise<void>(done=>{s.close(()=>done());s.closeIdleConnections();}))).then(()=>runtime.close()).finally(()=>nativeAuth?.close());};
        runtime.nervous.child.once('exit',()=>{if(!stopped){console.error('Scheduler unavailable; shutting down for supervisor recovery.');process.exitCode=1;close();}});
        for(const listener of servers)listener.on('error',e=>{console.error(e.message);process.exitCode=1;close();});
        if(native)await new Promise<void>((done,reject)=>{native.once('error',reject);native.listen(config.nativePort ?? 4319,'127.0.0.1',done);}).catch(e=>{close();throw e;});
        server.listen(config.port,'127.0.0.1',()=>console.log(`NERV Agency: http://127.0.0.1:${config.port} · ${config.language} · ${config.timeZone}`));running=true;
        // Aoba starts only when both the private bot token and the linked owner chat exist.
        if(botToken&&config.telegram){aoba=new TelegramChannel({api:new TelegramApi(botToken,telegramBase()),store:runtime,chatId:config.telegram.chatId,statePath:join(home,'telegram-state.json')});await aoba.start().then(()=>console.log('Aoba (Telegram): linked, listening.'),e=>console.error(`Aoba (Telegram) did not start: ${e instanceof Error?e.message:'error'}.`));}
        else if(botToken)console.log('Aoba (Telegram): token found, no chat linked yet. Send /start to your bot, then run telegram link.');
        process.once('SIGINT',close);process.once('SIGTERM',close);break;
      }
      default:throw new Error('Unknown command. Run help.');
    }
  }
}catch(e){console.error(e instanceof Error?e.message:'Command failed.');process.exitCode=1;}
finally{if(!running)store?.close();}
