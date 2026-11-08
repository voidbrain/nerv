// Optional record sources and bounded executable tasks. No models or commands are executed.
import {existsSync,readFileSync,readdirSync,mkdirSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export const RECORD=/^[BF]-\d{3}$/;
export const TASK=/^[BF]-\d{3}-T\d{2}$/;
const recap=/<!-- recap:start[^>]*-->[\s\S]*?<!-- recap:end[^>]*-->/;
export const normalizeLedger=text=>text.replace(recap,'<!-- derived recap -->');
function local(root,path){
 if(typeof path!=='string'||isAbsolute(path)||path.split(/[\\/]/).some(p=>p==='..'||p==='')||path.includes('\\'))throw Error('Expected a repository-relative path');
 const full=resolve(root,path);let at=full;while(!existsSync(at))at=dirname(at);
 const resolved=realpathSync(at);if(relative(realpathSync(root),resolved).startsWith('..')||isAbsolute(relative(realpathSync(root),resolved)))throw Error('Path escapes repository');
 if(existsSync(full)&&lstatSync(full).isSymbolicLink())throw Error('Symlink source refused');return full;
}
export function settings(root=process.cwd()){
 const config=JSON.parse(readFileSync(join(root,'.harness.json'),'utf8')).workItems;
 if(!config?.enabled)return null;
 for(const name of ['layout','records','tasks','profiles'])local(root,config[name]);
 return config;
}
function readJSON(path){if(lstatSync(path).size>1024*1024)throw Error('Input exceeds 1 MiB');return JSON.parse(readFileSync(path,'utf8'));}
function relocateLinks(text,fromFile,toFile,referenceIds=new Set()){
 const change=url=>{
  if(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)||url.startsWith('/'))return url;
  if(/[\s<>\\()]/.test(url))throw Error('Unsupported Markdown link; review relocation before migration');
  const [,path,suffix]=url.match(/^([^?#]*)(.*)$/),target=path?resolve(dirname(fromFile),path):fromFile;
  return (target===toFile?'':relative(dirname(toFile),target).replaceAll('\\','/'))+suffix;
 };
 const prose=part=>{
  // Delimiters of any backtick length protect literal inline examples.
  const code=/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;let out='',cursor=0;
  const links=chunk=>{
   if(/^ {0,3}\[[^\]]+\]:\s*(?![a-zA-Z][a-zA-Z0-9+.-]*:|\/)[^\n]+/m.test(chunk))throw Error('Unsupported Markdown link reference; review relocation before migration');
   const inline=/\[([^\]]+)\]\(([\s\S]*?)\)/g;
   const remaining=chunk.replace(inline,'');
   if(/\[[^\]]*\]\s*\[[^\]]*\]/.test(remaining)||[...remaining.matchAll(/\[([^\]]+)\]/g)].some(m=>referenceIds.has(m[1].trim().replace(/\s+/g,' ').toLowerCase())))throw Error('Unsupported Markdown link/reference notation; review relocation before migration');
   return chunk.replace(inline,(whole,label,url)=>'['+label+']('+change(url)+')');
  };
  for(const match of part.matchAll(code)){out+=links(part.slice(cursor,match.index))+match[0];cursor=match.index+match[0].length;}
  return out+links(part.slice(cursor));
 };
 let out='',pending='',fence=null;
 for(const line of text.match(/[^\n]*\n|[^\n]+$/g)||[]){
  const marker=line.match(/^ {0,3}(`{3,}|~{3,})(.*?)(?:\n)?$/);
  if(fence){out+=line;if(marker&&marker[1][0]===fence.char&&marker[1].length>=fence.length&&!marker[2].trim())fence=null;}
  else if(marker){out+=prose(pending)+line;pending='';fence={char:marker[1][0],length:marker[1].length};}
  else pending+=line;
 }
 return out+prose(pending);
}
export function renderLedger(root,config){
 const layout=readJSON(local(root,config.layout));if(layout.version!==1||!Array.isArray(layout.segments))throw Error('Invalid ledger layout');
 const dir=local(root,config.records),files=existsSync(dir)?readdirSync(dir).sort():[],seen=new Set();
 for(const file of files)if(!/^[BF]-\d{3}\.md$/.test(file))throw Error('Unknown record source: '+file);
 const referenceText=layout.segments.filter(s=>typeof s.text==='string').map(s=>s.text).join('\n')+'\n'+files.map(f=>readFileSync(local(root,config.records+'/'+f),'utf8')).join('\n');
 const referenceIds=new Set([...referenceText.matchAll(/\[([^\]]+)\]:/g)].map(m=>m[1].trim().replace(/\s+/g,' ').toLowerCase()));
 const current=existsSync(join(root,'docs/BACKLOG.md'))?readFileSync(join(root,'docs/BACKLOG.md'),'utf8'):'';
 const derived=current.match(recap)?.[0];
 let output='';
 for(const segment of layout.segments){
  if(Object.keys(segment).length!==1)throw Error('Invalid layout segment');
  if(typeof segment.text==='string')output+=derived?segment.text.replace(recap,derived):segment.text;
  else if(['B','F'].includes(segment.records)){
   if(seen.has(segment.records))throw Error('Duplicate record group');seen.add(segment.records);
   for(const file of files.filter(f=>f.startsWith(segment.records+'-'))){const text=readFileSync(local(root,config.records+'/'+file),'utf8');if(!text.startsWith('### '+file.slice(0,-3)+'\n')||/^### [BF]-\d{3}$/m.test(text.slice(text.indexOf('\n')+1)))throw Error('Record identity mismatch: '+file);output+=relocateLinks(text,local(root,config.records+'/'+file),join(root,'docs/BACKLOG.md'),referenceIds);}
  }else throw Error('Invalid layout segment');
 }
 for(const file of files)if(!seen.has(file[0]))throw Error('Unreferenced record group');
 return output;
}
export function migrateLedger(root,config){
 const path=join(root,'docs/BACKLOG.md'),text=readFileSync(path,'utf8');
 for(const name of ['layout','records'])if(existsSync(local(root,config[name])))throw Error('Migration destination already exists');
 const matches=[...text.matchAll(/^### ([BF]-\d{3})\n[\s\S]*?(?=^### [BF]-\d{3}\n|^## [^\n]+\n|$(?![\s\S]))/gm)];
 if(!matches.length||new Set(matches.map(m=>m[1])).size!==matches.length)throw Error('Missing or duplicate records');
 const segments=[],groups=new Set();let cursor=0,previous=null;
 for(const match of matches){
  const gap=text.slice(cursor,match.index);if(gap)segments.push({text:gap});
  const group=match[1][0];if(group!==previous){if(groups.has(group))throw Error('Interleaved record groups need explicit layout review');groups.add(group);segments.push({records:group});}
  else if(gap)throw Error('Separated groups need explicit layout review');
  previous=group;cursor=match.index+match[0].length;
 }
 if(cursor<text.length)segments.push({text:text.slice(cursor)});
 // Preserve the derived block as a marker; its actual values remain owned by the recap tool.
 for(const s of segments)if(s.text)s.text=s.text.replace(recap,'<!-- recap:start -->\n<!-- recap:end -->');
 const referenceIds=new Set([...text.matchAll(/\[([^\]]+)\]:/g)].map(m=>m[1].trim().replace(/\s+/g,' ').toLowerCase()));
 const sources=matches.map(match=>{const file=local(root,config.records+'/'+match[1]+'.md'),source=relocateLinks(match[0],path,file,referenceIds);if(relocateLinks(source,file,path)!==match[0])throw Error('Unsupported link formatting needs explicit migration review');return {file,source};});
 mkdirSync(local(root,config.records),{recursive:true});mkdirSync(dirname(local(root,config.layout)),{recursive:true});
 for(const {file,source} of sources)writeFileSync(file,source,{flag:'wx'});
 writeFileSync(local(root,config.layout),JSON.stringify({version:1,segments},null,2)+'\n',{flag:'wx'});
 if(renderLedger(root,config)!==text)throw Error('Migration did not preserve the exact ledger; inspect generated sources before continuing');
 return matches.length;
}
export function resource(value){
 if(typeof value!=='string'||value.length>200||!(/^(?:contract|generated):[a-z0-9][a-z0-9.-]*$/.test(value)||/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*(?:\/\*\*)?$/.test(value)))throw Error('Invalid resource');
 if(value.split('/').some(part=>part==='..'||part==='.'))throw Error('Invalid resource');return value;
}
export function overlaps(a,b){resource(a);resource(b);return a===b||(a.endsWith('/**')&&(b===a.slice(0,-3)||b.startsWith(a.slice(0,-2))))||(b.endsWith('/**')&&(a===b.slice(0,-3)||a.startsWith(b.slice(0,-2))));}
export function taskCatalog(root,config){
 const ledger=renderLedger(root,config),parents=new Set([...ledger.matchAll(/^### ([BF]-\d{3})$/gm)].map(m=>m[1]));
 const archive=join(root,'docs/archive');if(existsSync(archive))for(const f of readdirSync(archive).filter(f=>/^backlog-.*\.md$/.test(f)))for(const m of readFileSync(join(archive,f),'utf8').matchAll(/^### ([BF]-\d{3})$/gm))parents.add(m[1]);
 const profiles=readJSON(local(root,config.profiles));if(profiles.version!==1||!Array.isArray(profiles.profiles))throw Error('Invalid model profiles');
 const profileIds=new Set();for(const p of profiles.profiles){if(!p||!/^[a-z0-9-]{1,60}$/.test(p.id)||profileIds.has(p.id)||!['candidate','qualified'].includes(p.status)||typeof p.model!=='string'||!p.model||!Array.isArray(p.capabilities)||!p.capabilities.length||p.capabilities.some(c=>typeof c!=='string'||!c)||!Array.isArray(p.evidence)||p.evidence.some(e=>typeof e!=='string'||!e)||p.status==='qualified'&&!p.evidence.length)throw Error('Invalid or unevidenced model profile');profileIds.add(p.id);}
 const dir=local(root,config.tasks),tasks=[];
 if(!existsSync(dir))return {version:1,tasks,profiles:profiles.profiles};
 for(const file of readdirSync(dir).sort()){
  if(!/^[BF]-\d{3}-T\d{2}\.json$/.test(file))throw Error('Invalid task filename');const t=readJSON(local(root,config.tasks+'/'+file));
  const allowed=['version','id','parent','title','goal','status','acceptance','dependsOn','resources','capabilities','privacy','validation','escalation','suggestedProfile'];
  if(Object.keys(t).some(k=>!allowed.includes(k))||t.version!==1||t.id!==file.slice(0,-5)||!TASK.test(t.id)||t.parent!==t.id.slice(0,5)||!parents.has(t.parent)||!['planned','ready','implemented','verified','closed'].includes(t.status))throw Error('Invalid task identity/status: '+file);
  for(const k of ['title','goal','privacy'])if(typeof t[k]!=='string'||!t[k].trim()||t[k].length>2000)throw Error('Invalid '+k);
  for(const k of ['acceptance','resources','capabilities','validation','escalation','dependsOn'])if(!Array.isArray(t[k])||(k!=='dependsOn'&&!t[k].length)||t[k].length>32||t[k].some(v=>typeof v!=='string'||!v||v.length>2000)||new Set(t[k]).size!==t[k].length)throw Error('Invalid '+k);
  t.resources.forEach(resource);if(t.suggestedProfile&&!profileIds.has(t.suggestedProfile))throw Error('Unknown suggested profile');tasks.push(t);
 }
 const byId=new Map(tasks.map(t=>[t.id,t])),done=new Set(),visiting=new Set();
 function visit(id){if(done.has(id))return;if(visiting.has(id))throw Error('Task dependency cycle');visiting.add(id);for(const dep of byId.get(id).dependsOn){if(!byId.has(dep))throw Error('Unknown task prerequisite');visit(dep);}visiting.delete(id);done.add(id);}
 for(const t of tasks)visit(t.id);
 return {version:1,tasks,profiles:profiles.profiles};
}
export function checkWorkItems(root=process.cwd()){
 const config=settings(root);if(!config)return {enabled:false};
 const expected=renderLedger(root,config),actual=readFileSync(join(root,'docs/BACKLOG.md'),'utf8');
 if(normalizeLedger(expected)!==normalizeLedger(actual))throw Error('Backlog differs from record sources; run work-items build');
 const catalog=taskCatalog(root,config);return {enabled:true,records:(actual.match(/^### [BF]-\d{3}$/gm)||[]).length,tasks:catalog.tasks.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [command,...extra]=process.argv.slice(2);if(extra.length||!['migrate','build','check','tasks'].includes(command))throw Error('Use work-items.mjs migrate|build|check|tasks');const root=process.cwd(),config=settings(root);if(!config){console.log('Work items not adopted');}else if(command==='migrate')console.log('Migrated '+migrateLedger(root,config)+' records without changing the ledger');else if(command==='build')writeFileSync(join(root,'docs/BACKLOG.md'),renderLedger(root,config));else console.log(JSON.stringify(command==='check'?checkWorkItems(root):taskCatalog(root,config),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
