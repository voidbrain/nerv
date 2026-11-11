import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,lstatSync,realpathSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {renderService} from '../src/service.ts';
import type {ServiceHost,ServiceObservation,ServicePlan} from '../src/node-lifecycle-execution.ts';
import {rehearseUpgrade,type UpgradeReader} from '../src/upgrade-rehearsal.ts';
export function serviceFixture(directory=realpathSync(mkdtempSync(join(tmpdir(),'nerv-service-')))){
 const context={userHome:directory,home:join(directory,'.nerv'),source:join(directory,'source'),node:realpathSync(process.execPath),uid:process.getuid!()};
 for(const dir of [context.home,context.source,join(directory,'Library'),join(directory,'Library/LaunchAgents')])mkdirSync(dir,{recursive:true,mode:0o700});
 const revision=join(context.source,'REVISION'),manager=join(directory,'manager.json'),definition=join(directory,'Library/LaunchAgents/io.nerv.agent.plist');
 if(!existsSync(revision))writeFileSync(revision,'a'.repeat(40));
 if(!existsSync(manager))writeFileSync(manager,JSON.stringify(false));
 if(!existsSync(join(context.home,'config.json')))for(const [name,content] of [['config.json','{"base":{"id":"BASE-01","name":"Neutral fixture"}}'],['token','neutral-fixture-token'],['base-key','neutral-fixture-private'],['base.pub','neutral-fixture-public']])writeFileSync(join(context.home,name!),content!,{mode:0o600});
 const data=join(context.home,'nerv.sqlite');if(!existsSync(data)){const db=new DatabaseSync(data);db.exec("PRAGMA user_version=5;CREATE TABLE reminders(id TEXT PRIMARY KEY,title TEXT);INSERT INTO reminders VALUES('original','Neutral existing reminder')");db.close();}
 const calls:string[]=[],controls={clean:true,session:true,pending:false,legacy:false,built:true,compatible:true};let beforeCommand:((step:string,plan:ServicePlan)=>Promise<void>|void)|undefined;let reader:UpgradeReader=()=>{};
 const host:ServiceHost={context,
  inspect:async()=>{let kind:ServiceObservation['definition']='absent';try{const s=lstatSync(definition);kind=!s.isSymbolicLink()&&s.isFile()&&(s.mode&0o077)===0&&readFileSync(definition,'utf8')===renderService('darwin',context.home,context.source,context.node)?'owned':'foreign';}catch(e){if(!(e instanceof Error)||!('code' in e)||e.code!=='ENOENT')throw e;}const running=JSON.parse(readFileSync(manager,'utf8')) as boolean;return {revision:readFileSync(revision,'utf8'),schema:5,profile:createHash('sha256').update(readFileSync(join(context.home,'config.json'))).digest('hex'),definition:kind,registration:running?'owned':'absent',runtime:running?'owned':'stopped',pids:[],...controls};},
  compatible:async()=>controls.compatible,
  command:async(step,plan)=>{const db=new DatabaseSync(join(directory,'.nerv-lifecycle/journal.sqlite'),{readOnly:true});try{const row=db.prepare('SELECT receipt FROM operations WHERE digest=?').get(plan.digest) as {receipt:string};if(!row||!JSON.parse(row.receipt).steps.at(-1).endsWith(':started')||!db.prepare('SELECT 1 FROM resource WHERE digest=?').get(plan.digest))throw Error('Effect ran without durable acceptance/started/resource');}finally{db.close();}calls.push(step);await beforeCommand?.(step,plan);if(step==='register')writeFileSync(manager,JSON.stringify(true));if(step==='unregister')writeFileSync(manager,JSON.stringify(false));if(step==='checkout')writeFileSync(revision,plan.nextRevision!);},
  rehearse:(_plan,backup)=>rehearseUpgrade(backup,reader),
  backup:async dest=>{const db=new DatabaseSync(data);try{db.prepare('VACUUM INTO ?').run(join(dest,'database.sqlite'));}finally{db.close();}chmodSync(join(dest,'database.sqlite'),0o600);}
 };
 return {host,controls,calls,directory,definition,data,revision,setBeforeCommand:(f:typeof beforeCommand)=>{beforeCommand=f;},setReader:(f:UpgradeReader)=>{reader=f;},setManager:(on:boolean)=>writeFileSync(manager,JSON.stringify(on)),close:()=>rmSync(directory,{recursive:true,force:true})};
}
