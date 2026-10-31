import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readConfig,readToken } from './config.ts';
const label='io.nodo.agent';
const xml=(s:string)=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
const quoted=(s:string,command=false)=>'"'+s.replace(/[%\\"$]/g,c=>c==='%'?'%%':c==='$'?(command?'$$':'$'):'\\'+c)+'"';
export function renderService(platform:string,home:string,root:string,node:string):string {
  for(const value of [home,root,node])if(/[\r\n\0]/.test(value))throw new Error('Invalid service path.');
  const cli=join(root,'src/cli.ts');
  if(platform==='darwin')return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(cli)}</string><string>serve</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>NODO_HOME</key><string>${xml(home)}</string></dict>
<key>Umask</key><integer>63</integer>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(join(home,'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(home,'service-error.log'))}</string>
</dict></plist>\n`;
  if(platform==='linux')return `[Unit]
Description=Nodo local personal agent
[Service]
Type=simple
WorkingDirectory=${root.replace(/%/g,'%%')}
Environment=${quoted('NODO_HOME='+home)}
ExecStart=${quoted(node,true)} ${quoted(cli,true)} serve
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
  const path=join(directory,platform==='darwin'?label+'.plist':'nodo.service');
  const domain=`gui/${process.getuid?.()}`;
  const run=(program:string,args:string[],allowFailure=false)=>{const result=spawnSync(program,args,{stdio:'inherit'});if(!allowFailure&&(result.error||result.status!==0))throw new Error(`${program} failed; inspect service status and logs.`);};
  if(action==='install') {
    if(!existsSync(join(home,'config.json'))||!existsSync(join(home,'token')))throw new Error('Run init first: installed services require persistent config and token files.');
    readConfig(home);readToken(home);
    if(!existsSync(join(root,'dist/web/browser/index.html')))throw new Error('Run npm run build before service install.');
    mkdirSync(directory,{recursive:true});
    if(existsSync(path))throw new Error('Service file exists. Uninstall it explicitly before reinstalling.');
    writeFileSync(path,renderService(platform,home,root,process.execPath),{flag:'wx',mode:0o600});
    if(platform==='darwin')run('launchctl',['bootstrap',domain,path]);else{run('systemctl',['--user','daemon-reload']);run('systemctl',['--user','enable','--now','nodo.service']);}
    console.log(`Service installed: ${path}`);return;
  }
  if(!['start','stop','status','uninstall'].includes(action))throw new Error('Use service install|start|stop|status|uninstall.');
  if(!existsSync(path))throw new Error('Nodo service is not installed.');
  if(platform==='darwin') {
    if(action==='status')run('launchctl',['print',domain+'/'+label]);
    if(action==='stop'||action==='uninstall')run('launchctl',['bootout',domain+'/'+label],action==='uninstall');
    if(action==='start')run('launchctl',['bootstrap',domain,path]);
  } else {
    if(action==='uninstall')run('systemctl',['--user','disable','--now','nodo.service']);
    else run('systemctl',['--user',action,'nodo.service']);
  }
  if(action==='uninstall'){unlinkSync(path);if(platform==='linux')run('systemctl',['--user','daemon-reload']);console.log('Service removed; reminders and credentials retained.');}
}
