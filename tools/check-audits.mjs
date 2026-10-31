// Scope-aware audit freshness. Narrative-only historical reports are never silently promoted to full audits.
import {existsSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
export const AUDIT_AREAS=['code','logic','tests','documentation','harness','security','delivery','backlog'];
export function auditStatus(root,now=Date.now()) {
 root=realpathSync(root);
 const stamp=JSON.parse(readFileSync(resolve(root,'.harness.json'),'utf8'));
 const days=stamp.audit?.days??stamp.freshness?.auditDays??7;
 if(!Number.isInteger(days)||days<1)throw Error('Audit days must be positive');
 const safe=path=>{
  if(typeof path!=='string'||isAbsolute(path)||path.split(/[\\/]/).some(p=>p==='..'||p==='.git'))throw Error('Invalid audit path');
  const full=resolve(root,path),rel=relative(root,realpathSync(full));
  if(rel.startsWith('..')||isAbsolute(rel))throw Error('Audit path escapes repository');
  return full;
 };
 const dir=resolve(root,'docs/audits');
 if(!existsSync(dir))return {days,lastFull:null,areas:Object.fromEntries(AUDIT_AREAS.map(a=>[a,{status:'missing'}])),due:[...AUDIT_AREAS],reports:0};
 safe('docs/audits');
 const reports=[];
 for(const name of readdirSync(dir).filter(n=>n.endsWith('.audit.json')).sort()){
  const row=JSON.parse(readFileSync(safe('docs/audits/'+name),'utf8'));
  const time=Date.parse(row.reviewed);
  if(row.schemaVersion!==1||!['full','scoped'].includes(row.kind)||!Number.isFinite(time)||new Date(time).toISOString()!==row.reviewed||time>now+60000||!/^[0-9a-f]{40}$/.test(row.baseline??'')||!row.areas||Array.isArray(row.areas))throw Error(`Invalid audit manifest ${name}`);
  const date=new Date(time).toISOString().slice(0,10),keys=Object.keys(row.areas);
  if(!name.startsWith(date)||!keys.length||keys.some(a=>!AUDIT_AREAS.includes(a))||row.kind==='full'&&keys.length!==AUDIT_AREAS.length)throw Error(`Incomplete or unknown audit scope ${name}`);
  if(typeof row.report!=='string'||!row.report.startsWith('docs/audits/'+date)||!row.report.endsWith('.md'))throw Error(`Dated report required: ${name}`);
  const report=safe(row.report);if(!readFileSync(report,'utf8').trim().startsWith('#'))throw Error('Audit report must have a title');
  for(const [area,value] of Object.entries(row.areas)){
   if(!value||!['checked','not-applicable','blocked'].includes(value.result)||typeof value.evidence!=='string'||!value.evidence.trim()||typeof value.limits!=='string'||!value.limits.trim())throw Error(`Missing audit result/evidence/limits: ${name} ${area}`);
   if(value.result==='blocked'&&(typeof value.blocker!=='string'||!value.blocker.trim()))throw Error(`Named blocker required: ${name} ${area}`);
  }
  reports.push({...row,time,file:name});
 }
 reports.sort((a,b)=>a.time-b.time||a.file.localeCompare(b.file));
 const areas=Object.fromEntries(AUDIT_AREAS.map(a=>[a,{status:'missing'}]));let lastFull=null;
 for(const row of reports){
  if(row.kind==='full'&&Object.values(row.areas).every(a=>a.result!=='blocked'))lastFull={reviewed:row.reviewed,report:row.report,baseline:row.baseline};
  for(const [area,value] of Object.entries(row.areas)){
   const ageDays=(now-row.time)/86400000;
   areas[area]={status:value.result==='blocked'?'blocked':ageDays>days?'stale':'fresh',result:value.result,reviewed:row.reviewed,report:row.report,baseline:row.baseline,blocker:value.blocker??null};
  }
 }
 return {days,lastFull,areas,due:AUDIT_AREAS.filter(a=>areas[a].status!=='fresh'),reports:reports.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);if(args.some(a=>a!=='--github'&&a!=='--json')||new Set(args).size!==args.length)throw Error('Unknown or duplicate audit flag');
  const root=fileURLToPath(new URL('..',import.meta.url)),stamp=JSON.parse(readFileSync(resolve(root,'.harness.json'),'utf8'));
  const result=auditStatus(root);
  if(args.includes('--json'))console.log(JSON.stringify(result,null,2));
  else{
   console.log(`Audit scope: ${result.reports} manifest(s); last complete full report: ${result.lastFull?.report??'unknown (legacy prose is not classified)'}`);
   for(const [area,value] of Object.entries(result.areas))console.log(`${area}: ${value.status}${value.report?' — '+value.report:''}`);
   if(result.due.length)console.log(`${args.includes('--github')?'::warning title=Audit scope::':'! '}Audit review due: ${result.due.join(', ')}. A scoped report refreshes only its declared areas.`);
  }
  if(stamp.audit?.enforce&&result.due.length)process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
