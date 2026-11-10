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
export function codexTurn(value){
 keys(value,['version','source','eventId','activity','provider','model','event']);
 if(value.version!==1)throw Error('Invalid native metadata version');
 keys(value.event,['type','usage']);if(value.event.type!=='turn.completed')throw Error('Expected Codex turn delta; cumulative updates are unsupported');
 const u=value.event.usage;keys(u,['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens']);
 return validateUsage({version:1,kind:'delta',source:value.source,eventId:value.eventId,activity:value.activity,provider:value.provider,model:value.model,inputTokens:u.input_tokens??null,outputTokens:u.output_tokens??null,cacheReadTokens:u.cached_input_tokens??null,cacheWriteTokens:null,reasoningTokens:u.reasoning_output_tokens??null});
}
export function claudeMessage(value){
 keys(value,['version','source','activity','provider','complete','event']);
 if(value.version!==1||value.complete!==true)throw Error('Expected complete Claude assistant metadata');
 keys(value.event,['type','message']);if(value.event.type!=='assistant')throw Error('Cumulative Claude result totals are unsupported');
 const m=value.event.message;keys(m,['id','model','usage']);
 const u=m.usage;keys(u,['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens']);
 for(const key of ['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'])if(u[key]!==undefined&&u[key]!==null&&(!Number.isSafeInteger(u[key])||u[key]<0))throw Error('Invalid native token count');
 const inputs=[u.input_tokens,u.cache_read_input_tokens,u.cache_creation_input_tokens],input=inputs.every(v=>v!==undefined&&v!==null)?inputs.reduce((n,v)=>n+v,0):null;
 return validateUsage({version:1,kind:'delta',source:value.source,eventId:m.id,activity:value.activity,provider:value.provider,model:m.model,inputTokens:input,outputTokens:u.output_tokens??null,cacheReadTokens:u.cache_read_input_tokens??null,cacheWriteTokens:u.cache_creation_input_tokens??null,reasoningTokens:null});
}
const stamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const measures=['elapsedMs','activeMs','inputTokens','outputTokens'];
export function validateObservation(v){
 const fields={estimate:['at','measure','lower','upper','revision','basis'],interval:['category','start','end'],attempt:['result','failureKind'],finding:['classification'],intervention:['category','durationMs'],state:['value'],price:['usageSource','usageEventId','currency','at','rateSource','rates']};
 if(!v||!Object.hasOwn(fields,v.kind))throw Error('Invalid observation kind');keys(v,['version','source','eventId','kind',...fields[v.kind]]);
 if(v.version!==1||!id(v.source)||!id(v.eventId))throw Error('Invalid observation identity');
 const count=n=>Number.isSafeInteger(n)&&n>=0;
 if(v.kind==='estimate'&&(!stamp(v.at)||!measures.includes(v.measure)||!count(v.lower)||!count(v.upper)||v.upper<v.lower||!Number.isSafeInteger(v.revision)||v.revision<1||typeof v.basis!=='string'||!v.basis.trim()||v.basis.length>200))throw Error('Invalid estimate snapshot');
 if(v.kind==='interval'&&(!['execution','wait','active'].includes(v.category)||!stamp(v.start)||!stamp(v.end)||v.end<v.start))throw Error('Invalid measured interval');
 if(v.kind==='attempt'&&(!['succeeded','failed','interrupted'].includes(v.result)||![null,'code','infrastructure','unknown'].includes(v.failureKind)||v.result==='succeeded'&&v.failureKind!==null))throw Error('Invalid attempt observation');
 if(v.kind==='finding'&&!['review','confirmed-regression','unverified-suspicion'].includes(v.classification))throw Error('Invalid finding classification');
 if(v.kind==='intervention'&&(!['scope','clarification','approval','recovery'].includes(v.category)||v.durationMs!==null&&!count(v.durationMs)))throw Error('Invalid intervention metadata');
 if(v.kind==='state'&&!['reopened','reworked'].includes(v.value))throw Error('Invalid observed state');
 if(v.kind==='price'){
  keys(v.rates,['input','cacheRead','cacheWrite','output']);let url;try{url=new URL(v.rateSource);}catch{throw Error('Invalid price source');}
  if(!id(v.usageSource)||!id(v.usageEventId)||!['USD','EUR','GBP','JPY','CAD','AUD','CHF'].includes(v.currency)||!stamp(v.at)||url.protocol!=='https:'||url.username||url.password||url.search||url.hash||Object.keys(v.rates).length!==4||Object.values(v.rates).some(n=>n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e6)))throw Error('Invalid price metadata');
 }
 return v;
}
const sumKnown=values=>values.reduce((n,v)=>{if(!Number.isSafeInteger(n+v))throw Error('Measured sum exceeds safe integer');return n+v;},0);
function union(intervals){
 if(!intervals.length)return null;const ordered=intervals.map(([a,b])=>[Date.parse(a),Date.parse(b)]).sort((a,b)=>a[0]-b[0]);let total=0,[start,end]=ordered[0];for(const [a,b] of ordered.slice(1)){if(a>end){total+=end-start;start=a;end=b;}else end=Math.max(end,b);}return total+end-start;
}
export function effectiveness(jobs,observations,usageRows){
 const rows=observations.map(r=>({...r.observation,job:r.job,recorded:r.recorded}));
 const intervals=category=>rows.filter(r=>r.kind==='interval'&&r.category===category).map(r=>[r.start,r.end]);
 const closed=jobs.filter(j=>j.finished),elapsed=union(closed.map(j=>[j.started,j.finished]));
 const attempts=rows.filter(r=>r.kind==='attempt'),findings=rows.filter(r=>r.kind==='finding'),interventions=rows.filter(r=>r.kind==='intervention');
 const knownActive=jobs.map(j=>union(rows.filter(r=>r.job===j.job&&r.kind==='interval'&&r.category==='active').map(r=>[r.start,r.end])));
 const priceKeys=new Set();for(const p of rows.filter(r=>r.kind==='price')){const key=JSON.stringify([p.usageSource,p.usageEventId,p.currency]);if(priceKeys.has(key))throw Error('Conflicting price observations require reconciliation');priceKeys.add(key);}
 const cost=[];for(const currency of new Set(rows.filter(r=>r.kind==='price').map(r=>r.currency))){const prices=rows.filter(r=>r.kind==='price'&&r.currency===currency);let known=null,priced=0;for(const p of prices){const u=usageRows.find(r=>r.usage.source===p.usageSource&&r.usage.eventId===p.usageEventId)?.usage;if(!u)continue;const tokens=[u.inputTokens,u.cacheReadTokens,u.cacheWriteTokens,u.outputTokens];if(tokens.some(n=>n===null)||Object.values(p.rates).some(n=>n===null))continue;const amount=((u.inputTokens-u.cacheReadTokens-u.cacheWriteTokens)*p.rates.input+u.cacheReadTokens*p.rates.cacheRead+u.cacheWriteTokens*p.rates.cacheWrite+u.outputTokens*p.rates.output)/1e6;if(!Number.isFinite(amount)||amount>Number.MAX_SAFE_INTEGER-(known??0))throw Error('Price estimate exceeds bound');known=(known??0)+amount;priced++;}cost.push({currency,knownEstimatedAmount:known,pricedEvents:priced,missingEvents:usageRows.length-priced,complete:usageRows.length>0&&priced===usageRows.length&&jobs.every(j=>j.coverage==='complete'&&usageRows.some(r=>r.job===j.job)),provenance:prices.map(p=>({source:p.source,eventId:p.eventId,usageSource:p.usageSource,usageEventId:p.usageEventId,rates:p.rates,rateSource:p.rateSource,at:p.at})),note:'Explicit supplied rate estimate; not a bill or subscription/quota conversion.'});}
 const estimates=rows.filter(r=>r.kind==='estimate').sort((a,b)=>a.at.localeCompare(b.at)||a.revision-b.revision||a.eventId.localeCompare(b.eventId)).map(e=>{
  const j=jobs.find(j=>j.job===e.job),preWork=!!j&&e.at<=j.started;let observed=null;
  if(e.measure==='elapsedMs'&&j?.finished)observed=Date.parse(j.finished)-Date.parse(j.started);
  // Partial active intervals are a measured subtotal, not a complete effort comparison.
  if(e.measure.endsWith('Tokens')){const rs=usageRows.filter(r=>r.job===e.job);if(j?.coverage==='complete'&&rs.length&&rs.every(r=>r.usage[e.measure]!==null))observed=rs.reduce((n,r)=>n+r.usage[e.measure],0);}
  return {...e,preWork,observed,comparison:!preWork?'post-start revision; excluded from baseline':observed===null?'unavailable':observed<e.lower?'below range':observed>e.upper?'above range':'within range',attestation:'Source timestamp is supplied metadata, not independently proven pre-work capture.'};
 });
 return {time:{closedJobs:closed.length,openJobs:jobs.length-closed.length,elapsedUnionMs:elapsed,elapsedComplete:closed.length===jobs.length&&jobs.length>0,executionUnionMs:union(intervals('execution')),waitUnionMs:union(intervals('wait')),activeUnionMs:union(intervals('active')),measuredWorkerActiveMs:knownActive.some(n=>n!==null)?sumKnown(knownActive.map(v=>v??0)):null,jobsWithoutActiveMeasurement:knownActive.filter(n=>n===null).length,note:'Closed-job elapsed intervals use their union; open jobs are censored. Measured active/execute/wait intervals retain their separate meanings; missing intervals do not mean zero.'},attempts:attempts.length?{sampleSize:attempts.length,succeeded:attempts.filter(r=>r.result==='succeeded').length,failed:attempts.filter(r=>r.result==='failed').length,interrupted:attempts.filter(r=>r.result==='interrupted').length,infrastructureFailures:attempts.filter(r=>r.failureKind==='infrastructure').length,codeFailures:attempts.filter(r=>r.failureKind==='code').length}:null,findings:findings.length?{sampleSize:findings.length,review:findings.filter(r=>r.classification==='review').length,confirmedRegressions:findings.filter(r=>r.classification==='confirmed-regression').length,unverifiedSuspicions:findings.filter(r=>r.classification==='unverified-suspicion').length}:null,humanInterventions:interventions.length?{count:interventions.length,knownDurationMs:interventions.some(r=>r.durationMs!==null)?sumKnown(interventions.map(r=>r.durationMs??0)):null,missingDurations:interventions.filter(r=>r.durationMs===null).length,byCategory:Object.fromEntries(['scope','clarification','approval','recovery'].map(category=>{const items=interventions.filter(r=>r.category===category);return [category,items.length?{count:items.length,knownDurationMs:items.some(r=>r.durationMs!==null)?sumKnown(items.map(r=>r.durationMs??0)):null,missingDurations:items.filter(r=>r.durationMs===null).length}:null];}))}:null,states:rows.filter(r=>r.kind==='state'),estimates,cost,provenance:rows.map(r=>({source:r.source,eventId:r.eventId,kind:r.kind,job:r.job,recorded:r.recorded})),coverage:'Explicit observations only; missing classifications, durations and rates remain unknown. Counts do not prove cause, quality or suitability.',batchAdvice:estimates.length?'Review pre-work ranges and missing measurements with priority, prerequisites and human decisions; this report does not reprioritize or grant budget.':'Unavailable: no dated remaining-work estimate snapshots. Observed spend does not establish remaining complexity.'};
}
export function main(args=process.argv.slice(2),cwd=process.cwd()){
 const [command,...rest]=args,allowed={start:['store','repository','item','task','agent','model','activity','parent'],phase:['store','job','activity'],import:['store','job','file','format'],observe:['store','job','file'],finish:['store','job','coverage','outcome'],report:['store','item','repository','task']};
 if(!Object.hasOwn(allowed,command))throw Error('Use start, phase, import, observe, finish or report');const opts={};
 for(const a of rest){const m=/^--([a-z]+)=(.+)$/.exec(a);if(!m||!allowed[command].includes(m[1])||Object.hasOwn(opts,m[1]))throw Error('Unknown or duplicate argument');opts[m[1]]=m[2];}
 const base=store(opts.store??join(homedir(),'.local','state','project-harness','work-usage'),cwd),jobs=directory(join(base,'jobs')),events=directory(join(base,'events'));
 if(command==='start'){
  if(!id(opts.repository)||!id(opts.agent)||!phases.includes(opts.activity)||!(opts.item==='unallocated'||/^[BF]-\d{3}$/.test(opts.item??''))||opts.task&&(!new RegExp('^'+opts.item+'-T\\d{2}$').test(opts.task))||opts.model&&!id(opts.model))throw Error('Invalid job metadata');
  if(opts.parent){if(!uuid(opts.parent))throw Error('Invalid parent job');const parent=read(join(jobs,opts.parent+'.json'));if(parent.id!==opts.parent||parent.repository!==opts.repository)throw Error('Invalid parent repository');try{read(join(jobs,opts.parent+'.finished.json'));throw Error('Closed parent job');}catch(e){if(e.code!=='ENOENT')throw e;}}
  const job={version:1,id:randomUUID(),repository:opts.repository,item:opts.item,task:opts.task??null,parent:opts.parent??null,agent:opts.agent,model:opts.model??null,activity:opts.activity,started:new Date().toISOString()};save(join(jobs,job.id+'.json'),job);return {job:job.id,usage:'unknown',activity:job.activity};
 }
 if(command==='report'){
  if(opts.repository&&!id(opts.repository))throw Error('Invalid repository');
  if(opts.item&&!/^(?:[BF]-\d{3}|unallocated)$/.test(opts.item))throw Error('Invalid item');
  if(opts.task&&(!/^[BF]-\d{3}-T\d{2}$/.test(opts.task)||opts.item&&opts.task.slice(0,5)!==opts.item))throw Error('Invalid task filter');
  const files=readdirSync(jobs).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)),eventFiles=readdirSync(events);if(files.length>10000||eventFiles.length>100000)throw Error('Ledger report bound exceeded');
  const jobRows=files.map(f=>read(join(jobs,f))).filter(j=>(!opts.item||j.item===opts.item)&&(!opts.repository||j.repository===opts.repository)&&(!opts.task||j.task===opts.task)),selected=new Set(jobRows.map(j=>j.id));const selectedEvents=eventFiles.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>read(join(events,f))).filter(e=>selected.has(e.job));const rows=selectedEvents.filter(e=>e.usage),observations=selectedEvents.filter(e=>e.observation);
  const aggregate=rs=>Object.fromEntries(metrics.map(k=>[k,{known:rs.some(e=>e.usage[k]!==null)?rs.reduce((n,e)=>{const v=n+(e.usage[k]??0);if(!Number.isSafeInteger(v))throw Error('Token total exceeds safe integer');return v;},0):null,missing:rs.filter(e=>e.usage[k]===null).length}]));
  const coverage=jobRows.map(j=>{let end;try{end=read(join(jobs,j.id+'.finished.json'));}catch(e){if(e.code!=='ENOENT')throw e;}return {job:j.id,repository:j.repository,item:j.item,task:j.task,parent:j.parent??null,started:j.started,finished:end?.finished??null,agent:j.agent,model:j.model,coverage:end?.coverage??'unknown',outcome:end?.outcome??'open'};});
  const complete=(js,rs)=>js.length>0&&rs.length>0&&js.every(j=>j.coverage==='complete'&&rs.some(e=>e.job===j.job))&&rs.every(e=>e.usage.inputTokens!==null&&e.usage.outputTokens!==null);
  const groups=new Map();for(const j of coverage){const key=j.repository+':'+(j.task??j.item+':unassigned');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(j);}
  const byTask=Object.fromEntries([...groups].map(([key,js])=>{const ids=new Set(js.map(j=>j.job)),rs=rows.filter(e=>ids.has(e.job));return [key,{repository:js[0].repository,item:js[0].item,task:js[0].task,jobs:js.length,events:rs.length,totals:aggregate(rs),complete:complete(js,rs),effectiveness:effectiveness(js,observations.filter(e=>ids.has(e.job)),rs)}];}));
  const sum=aggregate(rows);return {version:1,jobs:coverage,events:rows.length,totals:sum,complete:complete(coverage,rows),byTask,effectiveness:effectiveness(coverage,observations,rows),byActivity:Object.fromEntries(phases.map(p=>[p,aggregate(rows.filter(e=>e.usage.activity===p))])),byModel:Object.fromEntries([...new Set(rows.map(e=>JSON.stringify([e.usage.provider,e.usage.model])))].map(k=>[k,aggregate(rows.filter(e=>JSON.stringify([e.usage.provider,e.usage.model])===k))])),cost:'unavailable',remainingEstimate:'unavailable',note:'Known counts only. Cache/reasoning are subsets, not additional tokens. Source coverage is declared, not independently verified; shared work stays unallocated.'};
 }
 if(!uuid(opts.job))throw Error('Invalid job');const job=read(join(jobs,opts.job+'.json'));if(job.id!==opts.job)throw Error('Job identity mismatch');
 if(command==='observe'){
  const observation=validateObservation(read(resolve(opts.file))),key=hash([observation.source,observation.eventId]),path=join(events,key+'.json');
  try{const existing=read(path);if(existing.job===job.id&&JSON.stringify(existing.observation)===JSON.stringify(observation))return {imported:false,event:key};throw Error('Source event already assigned or changed');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(observation.kind==='interval'){let end;try{end=read(join(jobs,job.id+'.finished.json'));}catch(e){if(e.code!=='ENOENT')throw e;}if(observation.start<job.started||observation.end>(end?.finished??new Date().toISOString()))throw Error('Measured interval outside job boundary');}
  if(observation.kind==='price'){
   const files=readdirSync(events);if(files.length>100000)throw Error('Ledger observation bound exceeded');
   const target=read(join(events,hash([observation.usageSource,observation.usageEventId])+'.json'));if(target.job!==job.id||!target.usage)throw Error('Price requires same-job usage event');
   if(files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>read(join(events,f))).some(e=>e.observation?.kind==='price'&&e.observation.currency===observation.currency&&e.observation.usageSource===observation.usageSource&&e.observation.usageEventId===observation.usageEventId))throw Error('A price for this usage event/currency is already recorded');
  }
  save(path,{job:job.id,observation,recorded:new Date().toISOString()});return {imported:true,event:key};
 }
 try{read(join(jobs,job.id+'.finished.json'));throw Error('Job already finished');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(command==='phase'){if(!phases.includes(opts.activity))throw Error('Invalid activity');save(join(jobs,job.id+'.phase.'+randomUUID()+'.json'),{activity:opts.activity,at:new Date().toISOString()});return {job:job.id,activity:opts.activity,usage:'unknown',note:'Annotations do not measure or retrospectively split model usage.'};}
 if(command==='finish'){if(!['complete','partial','unavailable'].includes(opts.coverage)||!['done','failed','interrupted'].includes(opts.outcome))throw Error('Invalid completion metadata');const row={coverage:opts.coverage,outcome:opts.outcome,finished:new Date().toISOString()};save(join(jobs,job.id+'.finished.json'),row);return {job:job.id,...row};}
 if(opts.format&&!['codex-turn','claude-message'].includes(opts.format))throw Error('Unsupported native metadata format');
 const source=read(resolve(opts.file)),usage=opts.format==='codex-turn'?codexTurn(source):opts.format==='claude-message'?claudeMessage(source):validateUsage(source),key=hash([usage.source,usage.eventId]),record={job:job.id,usage};
 try{save(join(events,key+'.json'),record);return {imported:true,event:key};}catch(e){if(e.code!=='EEXIST')throw e;if(JSON.stringify(read(join(events,key+'.json')))!==JSON.stringify(record))throw Error('Source event already assigned or changed');return {imported:false,event:key};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{process.stdout.write(JSON.stringify(main(),null,2)+'\n');}catch(e){process.stderr.write((e instanceof Error?e.message:'Usage ledger unavailable')+'\n');process.exitCode=1;}}
