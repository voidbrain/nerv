#!/usr/bin/env node
// Node's test runner writes coverage as LCOV; tools/coverage-table.mjs reads the standard json-summary (Istanbul / V8).
// This turns coverage/lcov.info into coverage/coverage-summary.json. Files under src/ that no test loaded are added
// with zero coverage (their line count from the source, a close estimate), so they show as untested instead of missing.
// Statements are not in LCOV: they are reported equal to lines. Code run only inside the scheduler and brain child
// processes is not counted (they start with a clean environment); most of it is also tested in-process.
//   node tools/lcov-summary.mjs [lcov.info] [coverage-summary.json]
import {existsSync,readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
/** Per-file metrics from LCOV text: lines, branches and functions found and hit. */
export function parseLcov(text){
 const files={};let cur=null;
 for(const raw of text.split('\n')){
  const line=raw.trim();
  if(line.startsWith('SF:')){cur={path:line.slice(3),LF:0,LH:0,BRF:0,BRH:0,FNF:0,FNH:0};continue;}
  if(!cur)continue;
  if(line==='end_of_record'){files[cur.path]=cur;cur=null;continue;}
  const m=/^(LF|LH|BRF|BRH|FNF|FNH):(\d+)$/.exec(line);if(m)cur[m[1]]=Number(m[2]);
 }
 return files;
}
const metric=(total,covered)=>({total,covered,skipped:0,pct:total?Math.round(10000*covered/total)/100:100});
const entry=(f)=>({lines:metric(f.LF,f.LH),statements:metric(f.LF,f.LH),branches:metric(f.BRF,f.BRH),functions:metric(f.FNF,f.FNH)});
/** The json-summary for the files under `include` (repository-relative folder), untested ones added at zero. */
export function toSummary(files,{rootDir=root,include='src/',listSources=null}={}){
 const inside=p=>{const r=relative(rootDir,p).split('\\').join('/');return !r.startsWith('..')&&r.startsWith(include);};
 const out={};for(const f of Object.values(files)){const abs=resolve(rootDir,f.path);if(inside(abs))out[abs]=entry(f);}
 const sources=listSources??(()=>{const dir=join(rootDir,include);return existsSync(dir)?readdirSync(dir,{recursive:true}).map(String).filter(n=>/\.(ts|mjs|js)$/.test(n)).map(n=>join(dir,n)):[];});
 for(const abs of sources()){if(out[abs])continue;const n=readFileSync(abs,'utf8').split('\n').filter(l=>l.trim()&&!/^\s*(\/\/|\/\*|\*)/.test(l)).length;out[abs]=entry({LF:n,LH:0,BRF:0,BRH:0,FNF:0,FNH:0});}
 const sum=k=>{const t=Object.values(out).reduce((a,m)=>a+m[k].total,0),c=Object.values(out).reduce((a,m)=>a+m[k].covered,0);return metric(t,c);};
 return {total:{lines:sum('lines'),statements:sum('statements'),branches:sum('branches'),functions:sum('functions')},...out};
}
if(import.meta.url===`file://${process.argv[1]}`){
 const input=resolve(root,process.argv[2] ?? 'coverage/lcov.info'),output=resolve(root,process.argv[3] ?? 'coverage/coverage-summary.json');
 if(!existsSync(input)){console.error(`No ${relative(root,input)}: run npm run test:coverage first.`);process.exit(1);}
 const summary=toSummary(parseLcov(readFileSync(input,'utf8')));
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(summary,null,1)+'\n');
 console.log(`${relative(root,output)}: ${Object.keys(summary).length-1} file(s); lines ${summary.total.lines.pct} %, branches ${summary.total.branches.pct} %`);
}
