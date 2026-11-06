// Optional archive index: Monday–Sunday closure cohorts derived from immutable records.
import assert from 'node:assert/strict';
import {existsSync,lstatSync,readdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
export const START='<!-- archive-recap:start -->',END='<!-- archive-recap:end -->';
const DAY=86400000,iso=t=>new Date(t).toISOString().slice(0,10);
function date(value){const t=Date.parse(value+'T00:00:00Z');assert(Number.isFinite(t)&&iso(t)===value,`Invalid closing date: ${value}`);return t;}
function week(value){const t=date(value),day=new Date(t).getUTCDay();return iso(t-((day+6)%7)*DAY);}
function raw(text){
 const starts=text.split(START).length-1,ends=text.split(END).length-1;
 assert(starts===ends&&starts<=1,'Archive recap markers must be a single balanced pair');
 if(!starts)return text;
 const a=text.indexOf(START),b=text.indexOf(END);assert(b>a,'Archive recap markers out of order');
 assert(!/^### [FB]-\d+/m.test(text.slice(0,a)),'Archive recap belongs before the records');
 return text.slice(0,a)+text.slice(b+END.length).replace(/^\n\n/,'');
}
/** Every archived record remains outside the generated summary. Section dates support legacy closures. */
export function closureRecords(text){
 const lines=raw(text).split('\n'),out=[];let section=null,sectionLine=-1;
 for(let i=0;i<lines.length;i++){
  const heading=/^## Closed (\d{4}-\d\d-\d\d)\s*$/.exec(lines[i]);if(heading){section=heading[1];sectionLine=i;continue;}
  const id=/^### ([FB]-\d{3,})\s*$/.exec(lines[i]);if(!id)continue;
  let j=i+1;while(j<lines.length&&!/^#{2,3} /.test(lines[j]))j++;
  const body=lines.slice(i,j).join('\n');
  const explicit=/\*\*(?:Resolution|Next action \/ closure evidence):\*\* Closed (\d{4}-\d\d-\d\d)/.exec(body)?.[1];
  const closed=explicit??section??[...body.matchAll(/Closed (\d{4}-\d\d-\d\d)/g)].at(-1)?.[1];
  assert(closed,`${id[1]}: archived record has no closing date`);date(closed);
  out.push({id:id[1],kind:id[1][0],closed,week:week(closed),line:i,sectionLine:section&&week(section)===week(closed)?sectionLine:i});i=j-1;
 }
 return out;
}
/** Adds stable cohort anchors and replaces only the checked derived block. Original record lines are untouched. */
export function archiveRecap(text){
 let body=raw(text).replace(/^<a id="archive-week-\d{4}-\d\d-\d\d"><\/a>\n/gm,'');
 const records=closureRecords(body),groups=new Map();
 for(const record of records){const g=groups.get(record.week)??{features:0,bugs:0,line:record.sectionLine};g[record.kind==='F'?'features':'bugs']++;groups.set(record.week,g);}
 const lines=body.split('\n');for(const [start,g] of [...groups].sort((a,b)=>b[1].line-a[1].line))lines.splice(g.line,0,`<a id="archive-week-${start}"></a>`);
 body=lines.join('\n');
 const rows=[...groups].sort((a,b)=>b[0].localeCompare(a[0])).map(([start,g])=>`| [${start} – ${iso(date(start)+6*DAY)}](#archive-week-${start}) | ${g.features} | ${g.bugs} |`);
 const block=[START,'## Weekly closure recaps','','Closed records in this archive, grouped by closing date (Monday–Sunday). Links open the first section for that week; current status stays in the active backlog.','', '| Closing week | Features closed | Bugs closed |','|---|---:|---:|',...(rows.length?rows:['| — | 0 | 0 |']),END].join('\n');
 const index=body.search(/^(?:#{2,3} |<a id="archive-week-)/m);const at=index<0?body.length:index;
 return body.slice(0,at).replace(/\n*$/,'\n\n')+block+'\n\n'+body.slice(at);
}
/** check-backlog uses this only after exact recomputation; editable summary text cannot hide historical records. */
export function stripArchiveRecap(text,validate=true){if(!text.includes(START))return text;if(validate)assert.equal(text,archiveRecap(text),'Archive closure recap is stale or contains non-derived content; run archive-recap.mjs');return raw(text);}
export function run(root,args){
 assert(args.length<=1&&args.every(a=>a==='--check'||a==='--write'),'Use archive-recap.mjs [--check|--write]');
 const folder=join(root,'docs/archive');if(!existsSync(folder))return 0;
 const base=realpathSync(root);assert(!lstatSync(folder).isSymbolicLink()&&realpathSync(folder).startsWith(base+sep),'Archive folder must stay inside this repository');
 const files=readdirSync(folder).filter(f=>/^backlog-\d{4}\.md$/.test(f));const changes=[];
 // Preflight all files before writing any of them.
 for(const name of files){const path=join(folder,name);assert(!lstatSync(path).isSymbolicLink(),'Archive files must not be symlinks');const text=readFileSync(path,'utf8');const next=archiveRecap(text);if(text!==next)changes.push({path,next});}
 if(args.includes('--check'))assert(!changes.length,`Archive recaps differ in ${changes.length} file(s); run node tools/archive-recap.mjs`);
 else for(const c of changes)writeFileSync(c.path,c.next);
 return files.length;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(`${run(process.cwd(),process.argv.slice(2))} archive recap(s) ${process.argv.includes('--check')?'checked':'written'}.`);}catch(e){console.error(e.message);process.exitCode=1;}}
