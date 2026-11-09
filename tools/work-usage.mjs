// Optional local development usage ledger. Imports metadata deltas, never transcripts or estimated tokens.
import {readFileSync,writeFileSync,mkdirSync,lstatSync,readdirSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const phases=['planning','coding','tests','review','documentation','backlog','harness','unallocated'];
const metrics=['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens'];
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const keys=(o,allowed)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k)))throw Error('Unknown metadata field');};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const read=p=>{const s=lstatSync(p);if(s.isSymbolicLink()||!s.isFile()||s.size>65536)throw Error('Unsafe or oversized metadata file');return JSON.parse(readFileSync(p,'utf8'));};
function directory(path){
 if(process.platform==='win32')throw Error('Private ledger permission verification unavailable on Windows');
 const p=resolve(path),parent=dirname(p);if(parent!==p){try{lstatSync(parent);}catch(e){if(e.code!=='ENOENT')throw e;directory(parent);}}
 try{mkdirSync(p,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 const s=lstatSync(p);if(s.isSymbolicLink()||!s.isDirectory()||((s.mode&0o077)!==0||s.uid!==process.getuid?.()))throw Error('Ledger directory must be private and not a symlink');
 return p;
}
function store(path,cwd){
 // Resolve existing ancestors before creating anything; reject links and stores inside the checkout.
 const p=resolve(path),root=realpathSync(cwd);let ancestor=p;
 for(;;){try{const s=lstatSync(ancestor);if(s.isSymbolicLink())throw Error('Symlink ledger path');break;}catch(e){if(e.code!=='ENOENT')throw e;ancestor=dirname(ancestor);}}
 const actual=resolve(realpathSync(ancestor),relative(ancestor,p));const rel=relative(root,actual);if(rel===''||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))throw Error('Usage store must be outside the checkout');
 for(let a=ancestor;;a=dirname(a)){if(lstatSync(a).isSymbolicLink())throw Error('Symlink ledger ancestor');if(dirname(a)===a)break;}
 for(let a=actual;;a=dirname(a)){try{lstatSync(join(a,'.git'));throw Error('Usage store must be outside the checkout');}catch(e){if(e.code!=='ENOENT')throw e;}if(a===dirname(a))break;}
 return directory(actual);
}
const save=(p,v)=>{const body=JSON.stringify(v)+'\n';if(Buffer.byteLength(body)>65536)throw Error('Metadata exceeds bound');writeFileSync(p,body,{flag:'wx',mode:0o600});};
export function validateUsage(value){
 keys(value,['version','kind','source','eventId','activity','provider','model',...metrics]);
 if(value.version!==1||value.kind!=='delta'||!id(value.source)||!id(value.eventId)||!phases.includes(value.activity)||![value.provider,value.model].every(v=>v===null||id(v)))throw Error('Invalid usage identity or delta');
 for(const key of metrics)if(value[key]!==null&&(!Number.isSafeInteger(value[key])||value[key]<0))throw Error('Invalid token count');
 if(value.inputTokens!==null&&(value.cacheReadTokens??0)+(value.cacheWriteTokens??0)>value.inputTokens)throw Error('Cache counts are subsets of canonical input');
 if(value.outputTokens!==null&&value.reasoningTokens!==null&&value.reasoningTokens>value.outputTokens)throw Error('Reasoning is a subset of output');
 return value;
}
export function main(args=process.argv.slice(2),cwd=process.cwd()){
 const [command,...rest]=args,allowed={start:['store','repository','item','task','agent','model','activity'],phase:['store','job','activity'],import:['store','job','file'],finish:['store','job','coverage','outcome'],report:['store','item','repository']};
 if(!Object.hasOwn(allowed,command))throw Error('Use start, phase, import, finish or report');const opts={};
 for(const a of rest){const m=/^--([a-z]+)=(.+)$/.exec(a);if(!m||!allowed[command].includes(m[1])||Object.hasOwn(opts,m[1]))throw Error('Unknown or duplicate argument');opts[m[1]]=m[2];}
 const base=store(opts.store??join(homedir(),'.local','state','project-harness','work-usage'),cwd),jobs=directory(join(base,'jobs')),events=directory(join(base,'events'));
 if(command==='start'){
  if(!id(opts.repository)||!id(opts.agent)||!phases.includes(opts.activity)||!(opts.item==='unallocated'||/^[BF]-\d{3}$/.test(opts.item??''))||opts.task&&(!new RegExp('^'+opts.item+'-T\\d{2}$').test(opts.task))||opts.model&&!id(opts.model))throw Error('Invalid job metadata');
  const job={version:1,id:randomUUID(),repository:opts.repository,item:opts.item,task:opts.task??null,agent:opts.agent,model:opts.model??null,activity:opts.activity,started:new Date().toISOString()};save(join(jobs,job.id+'.json'),job);return {job:job.id,usage:'unknown',activity:job.activity};
 }
 if(command==='report'){
  if(opts.repository&&!id(opts.repository))throw Error('Invalid repository');
  if(opts.item&&!/^(?:[BF]-\d{3}|unallocated)$/.test(opts.item))throw Error('Invalid item');
  const files=readdirSync(jobs).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)),eventFiles=readdirSync(events);if(files.length>10000||eventFiles.length>100000)throw Error('Ledger report bound exceeded');
  const jobRows=files.map(f=>read(join(jobs,f))).filter(j=>(!opts.item||j.item===opts.item)&&(!opts.repository||j.repository===opts.repository)),selected=new Set(jobRows.map(j=>j.id));const rows=eventFiles.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>read(join(events,f))).filter(e=>selected.has(e.job));
  const aggregate=rs=>Object.fromEntries(metrics.map(k=>[k,{known:rs.some(e=>e.usage[k]!==null)?rs.reduce((n,e)=>{const v=n+(e.usage[k]??0);if(!Number.isSafeInteger(v))throw Error('Token total exceeds safe integer');return v;},0):null,missing:rs.filter(e=>e.usage[k]===null).length}]));
  const coverage=jobRows.map(j=>{let end;try{end=read(join(jobs,j.id+'.finished.json'));}catch(e){if(e.code!=='ENOENT')throw e;}return {job:j.id,repository:j.repository,item:j.item,task:j.task,agent:j.agent,model:j.model,coverage:end?.coverage??'unknown',outcome:end?.outcome??'open'};});
  const sum=aggregate(rows);return {version:1,jobs:coverage,events:rows.length,totals:sum,complete:coverage.length>0&&rows.length>0&&coverage.every(j=>j.coverage==='complete'&&rows.some(e=>e.job===j.job))&&rows.every(e=>e.usage.inputTokens!==null&&e.usage.outputTokens!==null),byActivity:Object.fromEntries(phases.map(p=>[p,aggregate(rows.filter(e=>e.usage.activity===p))])),byModel:Object.fromEntries([...new Set(rows.map(e=>JSON.stringify([e.usage.provider,e.usage.model])))].map(k=>[k,aggregate(rows.filter(e=>JSON.stringify([e.usage.provider,e.usage.model])===k))])),cost:'unavailable',remainingEstimate:'unavailable',note:'Known counts only. Cache/reasoning are subsets, not additional tokens. Source coverage is declared, not independently verified; shared work stays unallocated.'};
 }
 if(!uuid(opts.job))throw Error('Invalid job');const job=read(join(jobs,opts.job+'.json'));if(job.id!==opts.job)throw Error('Job identity mismatch');
 try{read(join(jobs,job.id+'.finished.json'));throw Error('Job already finished');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(command==='phase'){if(!phases.includes(opts.activity))throw Error('Invalid activity');save(join(jobs,job.id+'.phase.'+randomUUID()+'.json'),{activity:opts.activity,at:new Date().toISOString()});return {job:job.id,activity:opts.activity,usage:'unknown',note:'Annotations do not measure or retrospectively split model usage.'};}
 if(command==='finish'){if(!['complete','partial','unavailable'].includes(opts.coverage)||!['done','failed','interrupted'].includes(opts.outcome))throw Error('Invalid completion metadata');const row={coverage:opts.coverage,outcome:opts.outcome,finished:new Date().toISOString()};save(join(jobs,job.id+'.finished.json'),row);return {job:job.id,...row};}
 const usage=validateUsage(read(resolve(opts.file))),key=hash([usage.source,usage.eventId]),record={job:job.id,usage};
 try{save(join(events,key+'.json'),record);return {imported:true,event:key};}catch(e){if(e.code!=='EEXIST')throw e;if(JSON.stringify(read(join(events,key+'.json')))!==JSON.stringify(record))throw Error('Source event already assigned or changed');return {imported:false,event:key};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{process.stdout.write(JSON.stringify(main(),null,2)+'\n');}catch(e){process.stderr.write((e instanceof Error?e.message:'Usage ledger unavailable')+'\n');process.exitCode=1;}}
