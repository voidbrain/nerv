import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { NODE_FLAGS } from './process-client.ts';
import { readConfig,readToken } from './config.ts';
const label='io.nerv.agent',unit='nerv.service';
/** Pre-rename names: install replaces them; other actions still find them until then. */
const previous={label:'io.nodo.agent',unit:'nodo.service'};
const xml=(s:string)=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
const quoted=(s:string,command=false)=>'"'+s.replace(/[%\\"$]/g,c=>c==='%'?'%%':c==='$'?(command?'$$':'$'):'\\'+c)+'"';
export function renderService(platform:string,home:string,root:string,node:string):string {
  for(const value of [home,root,node])if(/[\r\n\0]/.test(value))throw new Error('Invalid service path.');
  const cli=join(root,'src/cli.ts');
  if(platform==='darwin')return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string>${NODE_FLAGS.map(f=>`<string>${f}</string>`).join('')}<string>${xml(cli)}</string><string>serve</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>NERV_HOME</key><string>${xml(home)}</string></dict>
<key>Umask</key><integer>63</integer>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(join(home,'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(home,'service-error.log'))}</string>
</dict></plist>\n`;
  if(platform==='linux')return `[Unit]
Description=NERV Agency local personal agent
[Service]
Type=simple
WorkingDirectory=${root.replace(/%/g,'%%')}
Environment=${quoted('NERV_HOME='+home)}
ExecStart=${quoted(node,true)} ${NODE_FLAGS.join(' ')} ${quoted(cli,true)} serve
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
[Install]
WantedBy=default.target
`;
  throw new Error('Services support macOS and Linux only.');
}
export function service(action:string,home:string):void {
  const platform=process.platform;
  if(platform!=='darwin'&&platform!=='linux')throw new Error('Services support macOS and Linux only.');
  const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
  const directory=platform==='darwin'?join(homedir(),'Library/LaunchAgents'):join(process.env.XDG_CONFIG_HOME ?? join(homedir(),'.config'),'systemd/user');
  const file=(names:{label:string;unit:string})=>join(directory,platform==='darwin'?names.label+'.plist':names.unit);
  const domain=`gui/${process.getuid?.()}`;
  const run=(program:string,args:string[],allowFailure=false)=>{const result=spawnSync(program,args,{stdio:'inherit'});if(!allowFailure&&(result.error||result.status!==0))throw new Error(`${program} failed; inspect service status and logs.`);};
  const current={label,unit},legacy=!existsSync(file(current))&&existsSync(file(previous));
  const names=legacy&&action!=='install'?previous:current;const path=file(names);
  if(action==='install') {
    if(!existsSync(join(home,'config.json'))||!existsSync(join(home,'token')))throw new Error('Run init first: installed services require persistent config and token files.');
    readConfig(home);readToken(home);
    if(!existsSync(join(root,'dist/web/browser/index.html')))throw new Error('Run npm run build before service install.');
    mkdirSync(directory,{recursive:true});
    if(existsSync(path))throw new Error('Service file exists. Uninstall it explicitly before reinstalling.');
    if(legacy){ // replace the pre-rename Nodo service so two schedulers never run
      if(platform==='darwin')run('launchctl',['bootout',domain+'/'+previous.label],true);else run('systemctl',['--user','disable','--now',previous.unit],true);
      unlinkSync(file(previous));console.log(`Replaced the previous Nodo service: ${file(previous)}`);
    }
    writeFileSync(path,renderService(platform,home,root,process.execPath),{flag:'wx',mode:0o600});
    if(platform==='darwin')run('launchctl',['bootstrap',domain,path]);else{run('systemctl',['--user','daemon-reload']);run('systemctl',['--user','enable','--now',unit]);}
    console.log(`Service installed: ${path}`);return;
  }
  if(!['start','stop','status','uninstall'].includes(action))throw new Error('Use service install|start|stop|status|uninstall.');
  if(!existsSync(path))throw new Error('NERV Agency service is not installed.');
  if(platform==='darwin') {
    if(action==='status')run('launchctl',['print',domain+'/'+names.label]);
    if(action==='stop'||action==='uninstall')run('launchctl',['bootout',domain+'/'+names.label],action==='uninstall');
    if(action==='start')run('launchctl',['bootstrap',domain,path]);
  } else {
    if(action==='uninstall')run('systemctl',['--user','disable','--now',names.unit]);
    else run('systemctl',['--user',action,names.unit]);
  }
  if(action==='uninstall'){unlinkSync(path);if(platform==='linux')run('systemctl',['--user','daemon-reload']);console.log('Service removed; reminders and credentials retained.');}
}
