#!/usr/bin/env -S node --use-system-ca
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.ts';
import { makeServer } from './server.ts';
import { setKajiOffers, dataHome, databasePath, initialize, isTelegramToken, pinKajiRoot, telegramTokenPath, readConfig, readModelKey, readScrolls, readTelegramToken, readToken, setBase, setting, type Base } from './config.ts';
import { TelegramApi, TelegramChannel, decisionText, diagnoseNoStart, startChats, telegramBase } from './telegram.ts';
import { composeBrief, gatherBrief } from './brief.ts';
import { KajiLink } from './kaji-link.ts';
import { ROOT_KEY_FILE, Registry, baseKey, createRootKey, enrolmentArgs, fingerprint, signRecord, unlockRootKey, type SignedRecord } from './kaji.ts';
import { service } from './service.ts';
import {initializeNativeTLS,loadNativeTLS,nativeAdmin,NativeAuth,type Invitation} from './native-auth.ts';
import { Runtime, type ChatReply } from './runtime.ts';
import { builtinTools } from './executors.ts';
import { MODEL_TIMEOUT_MS } from './model.ts';
import { MAX_STEPS } from './misato.ts';
import { OLLAMA_URL, detectOllama, modelsReport, ollamaUrlOf, planModels, setupAtInit, writeModels, type ModelChange } from './model-setup.ts';
const [command,...args]=process.argv.slice(2);
/** --base NERV-02 --name "Tabgha" (both, or neither). */
function baseFlags(list:string[]):Base|undefined {
  const at=(flag:string)=>{const i=list.indexOf(flag);return i>=0?list[i+1]:undefined;};const id=at('--base'),name=at('--name');
  if(id===undefined&&name===undefined)return undefined;if(!id||!name)throw new Error('Give both --base ID and --name "Name".');return {id:id.toUpperCase(),name};
}
/** A secret typed without echo (or one line from stdin with --passphrase-stdin, for scripts and tests). Never from argv or env. */
/** After a change: the running service re-reads its models in place; when it is not running, the change waits for its start. */
async function reloadIfRunning(homeDir:string,port:number):Promise<string> {
  const response=await fetch(`http://127.0.0.1:${port}/api/models/reload`,{method:'POST',headers:{authorization:`Bearer ${readToken(homeDir)}`}}).catch(()=>undefined);
  if(!response)return 'The NERV service is not running: the change applies when it starts. Start it with: nerv launch';
  const value=await response.json() as {error?:string;kept?:boolean};
  return response.ok?'The running service now uses it.':`The running service refused it: ${value.error ?? 'reload failed'}${value.kept?' (it keeps the previous settings)':''}.`;
}
async function readSecret(prompt:string):Promise<string> {
  if(args.includes('--passphrase-stdin')||args.includes('--stdin')){let data='';for await(const chunk of process.stdin)data+=chunk;return data.split(/\r?\n/)[0] ?? '';}
  if(!process.stdin.isTTY)throw new Error('A passphrase is needed: run this in a terminal (or pass --passphrase-stdin).');
  process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((done,fail)=>{let value='';const onData=(b:Buffer)=>{for(const c of b.toString('utf8')){
    if(c==='\r'||c==='\n'){process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',onData);process.stdout.write('\n');done(value);return;}
    if(c==='\u0003'){process.stdin.setRawMode(false);process.stdout.write('\n');fail(new Error('Cancelled.'));return;}
    if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else value+=c;}};process.stdin.on('data',onData);});
}
const flag=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
/** Mints a one-use login code from the running service and opens (or prints) the page signed in. */
async function openPage(home:string,page:'/'|'/dashboard/',print:boolean) {
  const config=readConfig(home);
  const response=await fetch(`http://127.0.0.1:${config.port}/api/session/codes`,{method:'POST',headers:{authorization:`Bearer ${readToken(home)}`}}).catch(()=>{throw new Error('NERV Agency is not running: start it with serve, launch or service start.');});
  const value=await response.json() as {code?:string;error?:string};
  if(!response.ok||!value.code)throw new Error(value.error ?? 'Could not create a login code.');
  const url=`http://127.0.0.1:${config.port}${page}#code=${value.code}`;
  // Windows: `start` is a cmd built-in; its first quoted argument is a window title, hence the empty string.
  const [opener,openArgs]=print?[undefined,[]]:process.platform==='darwin'?['open',[url]]:process.platform==='linux'?['xdg-open',[url]]:process.platform==='win32'?['cmd',['/c','start','',url]]:[undefined,[]];
  if(opener){const run=spawnSync(opener,openArgs,{stdio:'ignore'});if(run.status!==0)console.log(url);}else console.log(url);
}
let store:Store|undefined;let running=false;
try {
  const home=dataHome();
  if(command==='init'){initialize(home,baseFlags(args));const b=readConfig(home).base;console.log(`NERV Agency configured: ${home} · base ${b.id} · ${b.name}\nAccess token: ${join(home,'token')}`);console.log(await setupAtInit(home,readConfig(home).models,setting('OLLAMA') ?? OLLAMA_URL));}
  else if(command==='native-init'){initialize(home);initializeNativeTLS(home);console.log('Native TLS configured. Restart NERV Agency, then run pair.');}
  else if(['pair','clients','revoke'].includes(command ?? '')){const config=readConfig(home);const path=command==='pair'?'/api/pairing/tickets':command==='clients'?'/api/clients':'/api/clients/'+encodeURIComponent(args[0] ?? '');const value=await nativeAdmin(home,config.nativePort ?? 4319,readToken(home),path,command==='pair'?'POST':command==='revoke'?'DELETE':'GET',command==='pair'?{label:args[0] ?? 'NERV Agency Menu Bar'}:undefined);if(command==='pair'){const invitation=value as Invitation;console.log('Private invitation (expires in 2 minutes; paste only into the NERV Agency companion):\n'+Buffer.from(JSON.stringify(invitation)).toString('base64url'));}else console.log(JSON.stringify(value,null,2));}
  else if(command==='service')service(args[0] ?? '',home);
  else if(command==='telegram'){
    // telegram link [CHAT_ID]: binds Aoba to the private chat that sent /start to the bot.
    // telegram token: asks for the BotFather token without showing it, checks its format and saves it privately.
    if(args[0]==='token'){
      const path=telegramTokenPath(home);const token=(await readSecret('Paste the bot token from @BotFather (it is not shown), then Enter: ')).trim();
      if(!isTelegramToken(token))throw new Error('That does not look like a BotFather token (digits, a colon, then letters and digits). Nothing was saved.');
      mkdirSync(home,{recursive:true,mode:0o700});writeFileSync(path,token+'\n',{mode:0o600});chmodSync(path,0o600);
      console.log(`Saved to ${path}. Now send /start to your bot in Telegram, then run: nerv telegram link`);
    }
    else {
    if(args[0]!=='link')throw new Error('Usage: telegram token | telegram link [CHAT_ID]');
    const botToken=readTelegramToken(home);if(!botToken)throw new Error(`No Telegram bot token at ${telegramTokenPath(home)}. Run: nerv telegram token (it asks for the token from @BotFather and saves it there).`);
    if(readConfig(home).telegram&&!args.includes('--relink')){console.log(`Already linked to chat ${readConfig(home).telegram!.chatId}: nothing to do. To link another chat, run: nerv telegram link --relink`);}
    else {
    const api=new TelegramApi(botToken,telegramBase());const chats=await startChats(api);
    const wanted=args[1]&&/^\d+$/.test(args[1])?Number(args[1]):undefined;const pick=wanted!==undefined?chats.find(c=>c.chatId===wanted):chats.length===1?chats[0]:undefined;
    if(!pick){if(!chats.length)throw new Error(`No /start found. ${await diagnoseNoStart(api)}`);throw new Error(`Several chats sent /start; choose one: ${chats.map(c=>`telegram link ${c.chatId} (${c.name})`).join(' | ')}`);}
    const path=join(home,'config.json');const current=existsSync(path)?JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>:{};
    writeFileSync(path,JSON.stringify({...current,telegram:{chatId:pick.chatId}},null,2)+'\n',{mode:0o600});chmodSync(path,0o600);readConfig(home);
    console.log(`Aoba linked to ${pick.name} (chat ${pick.chatId}). Restart the service to start it.`);
    }
  }
    }
  else if(command==='open'){
    // open dashboard: the same sign-in, landing on the live dashboard instead of the workspace.
    await openPage(home,args.includes('dashboard')?'/dashboard/':'/',args.includes('--print'));
  }
  else if(command==='base'){
    // base: show this machine's identity; base ID "Name": change it (restart the service to show it everywhere).
    if(args[0]==='pubkey'){const k=baseKey(home);console.log(`${k.publicKey}\nFingerprint: ${fingerprint(k.publicKey)}`);}
    else if(args.length){const b=setBase(home,{id:(args[0] ?? '').toUpperCase(),name:args.slice(1).join(' ')});console.log(`Base set: ${b.id} · ${b.name}. Restart the service to apply it.`);}
    else if(args.length===0){const b=readConfig(home).base;console.log(`${b.id} · ${b.name}`);}
  }
  else if(command==='chat'){
    // A request to Misato through the running service. It plans, the gate reviews each action, and the reply comes back.
    const message=args.join(' ');if(!message)throw new Error('Usage: chat "what you want"');
    const config=readConfig(home);
    const response=await fetch(`http://127.0.0.1:${config.port}/api/chat`,{method:'POST',headers:{authorization:`Bearer ${readToken(home)}`,'content-type':'application/json'},body:JSON.stringify({message,conversation:'cli'})}).catch(()=>{throw new Error('NERV Agency is not running: start it with serve or service start.');});
    const value=await response.json() as {reply?:string;error?:string;sortieId?:string;steps?:{tool?:string;outcome:string;reason?:string;error?:string}[];waiting?:{approvalId:string;tool:string}[];base?:{id:string;name:string}};
    if(!response.ok)throw new Error(value.error ?? 'Chat failed.');
    for(const s of value.steps ?? [])console.log(`· ${s.tool ?? '(invalid reply)'} → ${s.outcome}${s.error?` · ${s.error}`:s.reason?` · ${s.reason}`:''}`);
    // Dispatched (F-036): the main base's Misato answered; its cards are decided there (Aoba or its dashboard).
    for(const w of value.waiting ?? [])console.log(value.base?`⏸ ${w.tool} waits for you on ${value.base.name}: decide it on Aoba or on ${value.base.name}'s dashboard`:`⏸ ${w.tool} waits for you: approve ${w.approvalId} | reject ${w.approvalId}`);
    console.log(value.reply ?? `[no reply: ${value.error}]`);
    console.log(value.base?`— answered by ${value.base.name} (${value.base.id}), sortie ${value.sortieId} there`:`— sortie ${value.sortieId}`);
    if(!value.reply)process.exitCode=1;
  }
  else if(command==='instrumentality'){
    // Runs tonight's consolidation now, through the running service (it needs the brain's model).
    const config=readConfig(home);
    const response=await fetch(`http://127.0.0.1:${config.port}/api/memory/consolidate`,{method:'POST',headers:{authorization:`Bearer ${readToken(home)}`}}).catch(()=>{throw new Error('NERV Agency is not running: start it with serve, launch or service start.');});
    const value=await response.json() as {summary?:string;exchanges?:number;proposed?:number;skipped?:number;error?:string};
    if(!response.ok||value.error)throw new Error(value.error ?? 'Consolidation failed.');
    console.log(`${value.exchanges} exchange(s) consolidated · ${value.proposed} fact(s) proposed as cards · ${value.skipped} already known${value.summary?`\n${value.summary}`:''}`);
  }
  else if(command==='sessions'){
    // Ends every dashboard session (F-039): each open dashboard asks to sign in again; the admin token is unchanged.
    if(args[0]!=='revoke')throw new Error('Usage: sessions revoke');
    const config=readConfig(home);
    const response=await fetch(`http://127.0.0.1:${config.port}/api/session/revoke`,{method:'POST',headers:{authorization:`Bearer ${readToken(home)}`}}).catch(()=>{throw new Error('NERV Agency is not running: start it with serve, launch or service start.');});
    const value=await response.json() as {revoked?:number;error?:string};if(!response.ok)throw new Error(value.error ?? 'Revoke failed.');
    console.log(`${value.revoked ?? 0} dashboard session(s) ended. Open the dashboard again with: open dashboard`);
  }
  else if(command==='models'){
    // F-038: see the routes and what Ollama has; pick Misato's and Casper's model; the cloud route on or off; its key.
    const [sub,a1,a2]=args;const config=readConfig(home);
    if(!sub){
      const found=await detectOllama(setting('OLLAMA') ?? ollamaUrlOf(config.models));let key=false;try{key=!!readModelKey(home);}catch{key=false;}
      console.log(modelsReport(config.models,key,found));
    }else if(sub==='key'){
      const value=(await readSecret('Claude API key (not shown): ')).trim();
      if(value.length<20||/\s/.test(value))throw new Error('That does not look like an API key: nothing was saved.');
      const file=join(home,'anthropic-key');writeFileSync(file,value+'\n',{mode:0o600});chmodSync(file,0o600);
      console.log(`Saved to ${file} (readable only by you). Turn the route on with: models cloud on`);
      console.log(await reloadIfRunning(home,config.port));
    }else{
      const change:ModelChange=sub==='set'&&a1==='misato'&&a2==='cloud'?{misato:{route:'cloud',...(args[3]?{model:args[3]}:{})}}
        :sub==='set'&&a1==='misato'&&a2?{misato:{route:'local',model:a2}}:sub==='set'&&a1==='casper'&&a2?{casper:{model:a2}}
        :sub==='cloud'&&(a1==='on'||a1==='off')?{cloud:{enabled:a1==='on',...(a2?{model:a2}:{})}}:(()=>{throw new Error('Usage: models | models set misato MODEL | models set misato cloud [MODEL] | models set casper MODEL | models cloud on|off [MODEL] | models key');})();
      const found=await detectOllama(setting('OLLAMA') ?? ollamaUrlOf(config.models));
      writeModels(home,planModels(config.models,change,found.reachable?found.models.map(m=>m.name):undefined));
      console.log(`Saved. ${await reloadIfRunning(home,config.port)}`);
    }
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
  else if(!command||command==='help')console.log('NERV Agency\nCommands: init [--base ID --name "Name"] | base [ID "Name" | pubkey] | launch | key init [--out PATH] | kaji enrol|revoke|list|export|import | native-init | pair [label] | clients | revoke CLIENT_ID | doctor | models [set misato|casper MODEL | cloud on|off | key] | ask [--cloud] "text" | open [dashboard] | sessions revoke | chat "text" | telegram token | telegram link [CHAT_ID] | act "request" TOOL [JSON args] | reload | brief | memory list|add|edit|forget|history|episodes | instrumentality | remind "title" "ISO timestamp with timezone" | list | cancel ID | tick | inbox | approvals | approve ID | reject ID | events SORTIE_ID | spear SORTIE_ID [reason] | serve | service install|start|stop|status|uninstall');
  else {
    const config=readConfig(home);
    const scrolls=readScrolls(home);
    if(command!=='serve'&&command!=='launch')store=new Store(databasePath(home),scrolls,{home});
    const local=()=>store!;
    switch(command) {
      case 'remind':console.log(JSON.stringify(local().add(args[0] ?? '',args[1] ?? ''),null,2));break;
      case 'list':console.log(JSON.stringify(local().list(),null,2));break;
      case 'cancel':if(!local().cancel(args[0] ?? ''))throw new Error('No pending reminder with that ID.');console.log('Cancelled.');break;
      case 'memory':{
        // The owner's direct control of Lilith: facts added here are active at once; every change keeps its history.
        const m=local().memory;const [sub,id,...rest]=args;
        if(sub==='list'||!sub){const facts=m.list();console.log(facts.length?facts.map(f=>`${f.id.slice(0,8)}  ${f.text}  (${f.source}${f.shareable?', shareable':''})`).join('\n'):'No facts yet.');}
        else if(sub==='episodes'){const list=m.episodes();console.log(list.length?list.map(e=>`${e.until.slice(0,16)}  ${e.exchanges} exchange(s), ${e.proposed} proposed  ${e.summary||'(nothing to consolidate)'}`).join('\n'):'No episodes yet.');}
        else if(sub==='add'){const f=m.add([id,...rest].join(' '),'owner');console.log(`Remembered ${f.id.slice(0,8)}: ${f.text}`);}
        else{
          const match=m.list(200).filter(f=>f.id.startsWith(id ?? '-'));if(match.length!==1)throw new Error(match.length?'Several facts start with that id; give more of it.':'No active fact with that id (see memory list).');
          const f=match[0]!;
          if(sub==='forget'){m.forget(f.id,'owner');console.log(`Forgot ${f.id.slice(0,8)}.`);}
          else if(sub==='edit'){const e=m.edit(f.id,rest.join(' '),'owner');console.log(`Updated ${f.id.slice(0,8)}: ${e?.text}`);}
          else if(sub==='history')console.log(m.historyOf(f.id).map(h=>`${h.created}  ${h.kind}  ${h.source}  ${h.text}`).join('\n'));
          else throw new Error('Usage: memory list | add "fact" | edit ID "fact" | forget ID | history ID | episodes');
        }
        break;
      }
      case 'key':{
        // key init [--out PATH]: creates the Key of Nebuchadnezzar on the owner's main base and pins its public half here.
        if(args[0]!=='init')throw new Error('Usage: key init [--out PATH]');
        const out=flag('--out') ?? join(home,ROOT_KEY_FILE);if(existsSync(out))throw new Error(`A key file already exists at ${out}; it is never overwritten.`);
        const pass=await readSecret('New passphrase for the Key of Nebuchadnezzar (12+ characters): ');
        if(!args.includes('--passphrase-stdin')&&pass!==await readSecret('Repeat it: '))throw new Error('The two passphrases differ.');
        const key=createRootKey(pass);writeFileSync(out,key.file,{mode:0o600});chmodSync(out,0o600);pinKajiRoot(home,key.publicKey);
        console.log(`Key of Nebuchadnezzar created: ${out}\nRoot fingerprint: ${fingerprint(key.publicKey)}\nKeep a second copy offline (for example on a USB stick) and the passphrase somewhere safe: without them no new base can be enrolled. It is never sent over the Kaji line.`);
        break;
      }
      case 'kaji':{
        const registry=new Registry(local().db,config.kaji?.root);const me=baseKey(home).publicKey;const [sub]=args;
        const unlock=async()=>{const path=flag('--key') ?? join(home,ROOT_KEY_FILE);if(!existsSync(path))throw new Error(`No key file at ${path}: enrol on the base that holds the Key, or pass --key PATH.`);
          const root=unlockRootKey(readFileSync(path,'utf8'),await readSecret('Passphrase for the Key of Nebuchadnezzar: '));
          if(config.kaji?.root&&root.publicKey!==config.kaji.root)throw new Error('This key file does not match the root pinned on this base.');return root;};
        if(sub==='enrol'){
          // Every argument is checked before the passphrase is asked for.
          const e=enrolmentArgs(args[1],args[2],args[3],args[4],me);
          const root=await unlock();const rec=signRecord(root.privateKey,{kind:'enrol',serial:registry.nextSerial(),baseId:e.baseId,name:e.name,publicKey:e.publicKey,address:e.address,issued:new Date().toISOString()});
          new Registry(local().db,root.publicKey).add(rec);console.log(`Enrolled ${e.baseId} · ${e.name} at ${e.address} (key ${fingerprint(e.publicKey)}).`);
        }
        else if(sub==='revoke'){
          const id=(args[1] ?? '').toUpperCase();const entry=registry.bases().find(b=>b.baseId===id&&b.status==='enrolled');if(!entry)throw new Error('No enrolled base with that id (see kaji list).');
          const root=await unlock();new Registry(local().db,root.publicKey).add(signRecord(root.privateKey,{kind:'revoke',serial:registry.nextSerial(),baseId:id,publicKey:entry.publicKey,issued:new Date().toISOString()}));
          console.log(`Revoked ${id}: its key is refused from now on; re-enrolling it needs a new base key.`);
        }
        else if(sub==='offer'){
          // Slice 3b: the actions this base lets the main base run here; each still passes this base's own gate.
          const names=args.slice(1);const offerable=builtinTools.map(t=>t.name).filter(n=>n!=='kaji.run');
          if(!names.length){const o=config.kaji?.offers ?? [];console.log(o.length?`This base offers: ${o.join(', ')}`:'This base offers nothing to the main base. Offer actions with: kaji offer reminders.add reminders.list (or: kaji offer none).');break;}
          const list=names.length===1&&names[0]==='none'?[]:names;const bad=list.filter(n=>!offerable.includes(n));
          if(bad.length)throw new Error(`Not an action this base can offer: ${bad.join(', ')}. Offerable: ${offerable.join(', ')}.`);
          setKajiOffers(home,[...new Set(list)]);
          console.log(list.length?`This base now offers: ${list.join(', ')}. The main base sees it at the next heartbeat; restart is not needed.`:'This base now offers nothing to the main base.');
        }
        else if(sub==='main'){
          // The owner names the main base (F-036): Aoba there is the one channel while the line is up. Signed by the Key.
          const id=(args[1] ?? '').toUpperCase();
          if(!id){console.log(registry.main()?`Main base: ${registry.main()}`:'No main base named yet: kaji main BASE-ID (on the base that holds the Key).');break;}
          if(!registry.bases().some(b=>b.baseId===id&&b.status==='enrolled'))throw new Error('No enrolled base with that id (see kaji list).');
          const root=await unlock();new Registry(local().db,root.publicKey).add(signRecord(root.privateKey,{kind:'main',serial:registry.nextSerial(),baseId:id,issued:new Date().toISOString()}));
          console.log(`Main base: ${id}. While it is online, the other bases send their cards, reminders and briefs through its Aoba and keep their own bots quiet.`);
        }
        else if(sub==='list'||!sub){
          const bases=registry.bases();if(!config.kaji?.root)console.log('No root pinned yet: key init (main base) or kaji import --root FINGERPRINT.');
          else {const main=registry.main();console.log(`Root ${fingerprint(config.kaji.root)}\n`+(bases.length?bases.map(b=>`${b.baseId.padEnd(8)} ${b.name.padEnd(16)} ${b.address.padEnd(24)} ${b.status}${b.publicKey===me?'  (this base)':''}${b.baseId===main?'  (main)':''}`).join('\n'):'No bases enrolled yet.'));}
        }
        else if(sub==='export'){const bundle=JSON.stringify({root:config.kaji?.root,records:registry.records()},null,2)+'\n';if(!config.kaji?.root)throw new Error('Nothing to export: no root pinned.');if(args[1]){writeFileSync(args[1],bundle);console.log(`Wrote ${registry.records().length} signed record(s) to ${args[1]}.`);}else process.stdout.write(bundle);}
        else if(sub==='import'){
          // The root is pinned only when the owner confirms its fingerprint, read on the main base: no trust on first use.
          const file=args[1];const expect=flag('--root');if(!file)throw new Error('Usage: kaji import FILE --root FINGERPRINT');
          const bundle=JSON.parse(readFileSync(file,'utf8')) as {root:string;records:SignedRecord[]};
          if(!config.kaji?.root){
            const given=(expect ?? '').toLowerCase();const where='the "Root …" line of nerv kaji list on the base that holds the Key of Nebuchadnezzar (also printed by key init)';
            if(!given)throw new Error(`Give --root with the root fingerprint: ${where}.`);
            if(given===fingerprint(me))throw new Error(`That is this base's own fingerprint (from base pubkey). --root needs the root fingerprint: ${where}.`);
            // The file's own fingerprint is never printed: the owner compares what the main base shows with the file.
            if(fingerprint(bundle.root)!==given)throw new Error(`The root fingerprint does not match the one this file was signed with. Check ${where}; if they really differ, the file is not from your Key: do not import it.`);
            pinKajiRoot(home,bundle.root);
          }
          else if(bundle.root!==config.kaji.root)throw new Error('This file is signed by a different root than the one pinned here.');
          const reg=new Registry(local().db,bundle.root);let added=0;for(const r of bundle.records)if(reg.add(r)==='added')added++;
          console.log(`Imported ${added} new record(s); ${reg.bases().filter(b=>b.status==='enrolled').length} base(s) enrolled.`);
        }
        else throw new Error('Usage: kaji enrol | revoke | main [BASE-ID] | offer [ACTION…|none] | list | export [FILE] | import FILE --root FINGERPRINT');
        break;
      }
      case 'brief':console.log(composeBrief({now:new Date(),timeZone:config.timeZone,language:config.language,base:config.base.name,...await gatherBrief(local(),new Date(Date.now()-86_400_000))}));break;
      case 'tick':console.log(JSON.stringify({delivered:local().tick()}));break;
      case 'inbox':console.log(JSON.stringify(local().inbox(),null,2));break;
      case 'approvals':console.log(JSON.stringify(local().approvals(),null,2));break;
      case 'approve':case 'reject':console.log(JSON.stringify(local().decide(args[0] ?? '',command,'cli'),null,2));break;
      case 'events':console.log(JSON.stringify(local().events(args[0] ?? ''),null,2));break;
      case 'spear':console.log(JSON.stringify(local().ledger.spear(args[0] ?? '',args[1] ?? 'cli'),null,2));break;
      case 'doctor':console.log(JSON.stringify({node:process.version,home,port:config.port,language:config.language,timeZone:config.timeZone,hostTimeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,...local().doctor(),delivery:'Durable local inbox; phone notifications not configured.',workers:'Contract only; no remote execution.'},null,2));break;
      case 'serve':case 'launch':{
        const webRoot=resolve(fileURLToPath(new URL('../dist/web/browser',import.meta.url)));
        if(!existsSync(join(webRoot,'index.html')))throw new Error('Frontend missing: run npm run build.');
        const token=readToken(home);const nativeTLS=loadNativeTLS(home);const botToken=readTelegramToken(home);
        const nativeAuth=nativeTLS?new NativeAuth(home):undefined;
        const runtime=new Runtime(databasePath(home),undefined,home);
        try{await runtime.ready();}catch(e){await runtime.close();nativeAuth?.close();throw e;}
        // Misato resumes after the owner decides, wherever the decision came from (F-033).
        runtime.startResumer();
        // Kaji line (F-036): this base's own key; the link starts once a root is pinned and listens only on the enrolled address.
        const own=baseKey(home);runtime.setBaseKey(own.publicKey);let kaji:KajiLink|undefined;
        // Schedules are re-read every minute, so the owner can change them by chat or by hand without a restart.
        const live=()=>{try{return readConfig(home);}catch{return config;}};
        runtime.startInstrumentality(()=>{const c=live();return {...(c.instrumentality?{mode:c.instrumentality}:{}),timeZone:c.timeZone};});
        let server:ReturnType<typeof makeServer>;let native:ReturnType<typeof makeServer>|undefined;
        let close:()=>void=()=>{};
        try{server=makeServer(runtime,token,{webRoot,...config,onStop:()=>close()});native=nativeTLS&&nativeAuth?makeServer(runtime,token,{...config,tls:nativeTLS,native:{auth:nativeAuth,fingerprint:nativeTLS.fingerprint,port:config.nativePort ?? 4319,webPort:config.port}}):undefined;}catch(e){await runtime.close();nativeAuth?.close();throw e;}
        const servers=native?[server,native]:[server];let stopped=false;
        let aoba:TelegramChannel|undefined;
        close=()=>{if(stopped)return;stopped=true;void aoba?.stop();void kaji?.stop();void Promise.all(servers.map(s=>new Promise<void>(done=>{s.close(()=>done());s.closeIdleConnections();}))).then(()=>runtime.close()).finally(()=>nativeAuth?.close());};
        runtime.nervous.child.once('exit',()=>{if(!stopped){console.error('Scheduler unavailable; shutting down for supervisor recovery.');process.exitCode=1;close();}});
        for(const listener of servers)listener.on('error',e=>{console.error(e.message);process.exitCode=1;close();});
        if(native)await new Promise<void>((done,reject)=>{native.once('error',reject);native.listen(config.nativePort ?? 4319,'127.0.0.1',done);}).catch(e=>{close();throw e;});
        // launch = serve, then open the live dashboard signed in once the server listens.
        server.listen(config.port,'127.0.0.1',()=>{console.log(`NERV Agency ${config.base.id} · ${config.base.name}: http://127.0.0.1:${config.port} · ${config.language} · ${config.timeZone}`);if(command==='launch')void openPage(home,'/dashboard/',args.includes('--print')).catch(e=>console.error(e instanceof Error?e.message:'Could not open the dashboard.'));});running=true;
        // Aoba starts only when both the private bot token and the linked owner chat exist.
        if(botToken&&config.telegram){aoba=new TelegramChannel({api:new TelegramApi(botToken,telegramBase()),store:runtime,chatId:config.telegram.chatId,statePath:join(home,'telegram-state.json'),
          // F-036 phase 2: quiet while another base is the main one and online; relayed cards are decided where they were made.
          oneChannel:{quiet:async()=>{const m=await runtime.mainBase();return !!m&&!m.self&&m.online;},relay:(text,cards)=>kaji?kaji.relay({text,cards}):Promise.resolve(false)},
          remote:{decide:(baseId,approvalId,decision)=>{if(!kaji)throw new Error('The Kaji line is not running.');return kaji.decide(baseId,approvalId,decision);}},brief:()=>{const c=live();return c.brief?{at:c.brief.at,timeZone:c.timeZone,language:c.language,base:c.base.name}:undefined;}});await aoba.start().then(()=>console.log('Aoba (Telegram): linked, listening.'),e=>console.error(`Aoba (Telegram) did not start: ${e instanceof Error?e.message:'error'}.`));}
        else if(botToken)console.log('Aoba (Telegram): token found, no chat linked yet. Send /start to your bot, then run telegram link.');
        if(config.kaji?.root){kaji=new KajiLink({baseId:config.base.id,key:own.privateKey,publicKey:own.publicKey,registry:runtime.kaji,health:()=>runtime.baseHealth(),onHealth:(id,h)=>runtime.notePeerHealth(id,h),
          onRelay:async(from,relay)=>{if(!aoba)return false;const name=(await runtime.bases()).find(b=>b.baseId===from)?.name ?? from;return aoba.relayed(from,name,relay);},
          onDecide:async(approvalId,decision)=>decisionText(await runtime.decide(approvalId,decision,'telegram')),
          // Dispatch, on the main base: a request asked on another base, with its own conversation per base and channel.
          // Slice 3b, on the base asked: only actions this base offers, once per id, through this base's own gate.
          offers:()=>live().kaji?.offers ?? [],onOffers:(id,tools)=>runtime.notePeerOffers(id,tools),
          onRun:(from,item)=>runtime.runFromPeer(from,item,live().kaji?.offers ?? []),
          onChat:async(from,message,conversation)=>({...await runtime.chat(message,`kaji:${from.toLowerCase()}${conversation?'-'+conversation:''}`),base:{id:config.base.id,name:config.base.name}})});
        // Slice 3b, on the main base: actions queued by kaji.run go out over the line, each until it reached its base.
        if(kaji){const link=kaji;runtime.startOutbox((base,item)=>link.run(base,item,MODEL_TIMEOUT_MS*2));}
        // Dispatch, on the other bases: while the main base is online, requests go to its Misato (one planner, one memory).
        runtime.setDispatch(async(message,conversation)=>{const main=await runtime.mainBase();if(!main||main.self||!main.online||!kaji)return undefined;
          return await kaji.chat(message,conversation&&/^[a-z]{1,20}$/.test(conversation)?conversation:undefined,MODEL_TIMEOUT_MS*MAX_STEPS*2) as ChatReply|undefined;});void kaji.start();}
        process.once('SIGINT',close);process.once('SIGTERM',close);break;
      }
      default:throw new Error('Unknown command. Run help.');
    }
  }
}catch(e){console.error(e instanceof Error?e.message:'Command failed.');process.exitCode=1;}
finally{if(!running)store?.close();}
