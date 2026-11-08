#!/usr/bin/env node
// Optional change-aware verification planner. No tests, models, writes or workflows are launched.
import {readFileSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function matches(file,pattern){
 if(typeof pattern!=='string'||!pattern||pattern.startsWith('/')||pattern.includes('..'))throw Error('Invalid verification glob');
 const expression=pattern.split('**').map(part=>part.split('*').map(s=>s.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('[^/]*')).join('.*');
 return new RegExp('^'+expression+'$').test(file);
}
export function policy(value){
 if(!value||value.enabled!==true)return null;
 const p={days:7,prs:10,historyLimit:30,...value};
 if(!Number.isInteger(p.days)||p.days<1||p.days>365||!Number.isInteger(p.prs)||p.prs<1||p.prs>1000||!Number.isInteger(p.historyLimit)||p.historyLimit<1||p.historyLimit>100||typeof p.workflow!=='string'||!p.workflow.trim()||typeof p.fullJob!=='string'||!p.fullJob.trim())throw Error('Invalid verification freshness policy');
 const ids=new Set();
 for(const field of ['risk','sources','documentation']){if(!Array.isArray(p[field]))throw Error('Missing verification '+field);for(const glob of p[field])matches('',glob);}
 if(!Array.isArray(p.groups)||!p.groups.length)throw Error('Missing verification groups');
 for(const group of p.groups){if(!/^[a-z][a-z0-9-]*$/.test(group.id)||ids.has(group.id)||['full','groups'].includes(group.id)||!Array.isArray(group.paths)||!group.paths.length)throw Error('Invalid verification group');ids.add(group.id);for(const glob of group.paths)matches('',glob);}
 return p;
}
export function plan(settings,{files=[],baseline=null,merges=null,requested=false,now=Date.now(),unavailable=null}={}){
 const p=policy(settings);if(!p)return {schemaVersion:1,full:true,reasons:['Scoped verification is not enabled'],groups:[],files};
 const reasons=[],selected=new Set(),unique=[...new Set(files)].sort();
 if(requested)reasons.push('Full checks explicitly requested');
 if(!baseline||!Number.isFinite(Date.parse(baseline.completed))||Date.parse(baseline.completed)>now||!Number.isInteger(merges)||merges<0)reasons.push('No verified successful full-run baseline'+(unavailable?': '+unavailable:''));
 else{if(now-Date.parse(baseline.completed)>=p.days*86400000)reasons.push(`Full run is at least ${p.days} days old`);if(merges>=p.prs)reasons.push(`At least ${p.prs} merged PRs since the full run`);}
 for(const file of unique){
  const hit=p.groups.filter(group=>group.paths.some(glob=>matches(file,glob)));for(const group of hit)selected.add(group.id);
  if(file==='.harness.json'||file.startsWith('.github/workflows/')||file==='tools/verification.mjs'||p.risk.some(glob=>matches(file,glob)))reasons.push('Risk-sensitive change: '+file);
  else if(!hit.length&&(p.sources.some(glob=>matches(file,glob))||!p.documentation.some(glob=>matches(file,glob))))reasons.push('Unmapped change: '+file);
 }
 const full=reasons.length>0;
 return {schemaVersion:1,full,reasons:full?[...new Set(reasons)]:['Current full-run evidence; affected checks selected'],groups:p.groups.filter(g=>full||selected.has(g.id)).map(g=>g.id),files:unique,baseline:baseline?{run:baseline.run,commit:baseline.commit,completed:baseline.completed,mergedPRs:merges}:null,limits:{days:p.days,prs:p.prs}};
}
/** GitHub metadata is trusted only after the full marker succeeds and its exact tested head reaches main. */
export async function history(p,{api,ancestor,countMerges,base,now=Date.now()}){
 const runs=await api(`actions/workflows/${encodeURIComponent(p.workflow)}/runs?status=success&per_page=${p.historyLimit}`);
 if(!Array.isArray(runs.workflow_runs))throw Error('Invalid workflow history');
 for(const run of runs.workflow_runs){
  if(run.conclusion!=='success'||run.status!=='completed'||!Number.isSafeInteger(run.id)||typeof run.head_sha!=='string'||!/^[a-f0-9]{40,64}$/.test(run.head_sha))continue;
  const jobs=await api(`actions/runs/${run.id}/jobs?per_page=100`);
  const marker=jobs.jobs?.find(job=>job.name===p.fullJob&&job.status==='completed'&&job.conclusion==='success');
  if(!marker||!Number.isFinite(Date.parse(marker.completed_at))||Date.parse(marker.completed_at)>now)continue;
  let commit=run.head_sha;
  if(run.event==='pull_request'){
   let number=run.pull_requests?.[0]?.number;
   if(!Number.isSafeInteger(number)){const linked=await api(`commits/${run.head_sha}/pulls`);if(!Array.isArray(linked))throw Error('Invalid commit PR history');number=linked.find(pr=>pr.merged_at&&pr.base?.ref===base&&pr.head?.sha===run.head_sha)?.number;}
   if(!Number.isSafeInteger(number))continue;const pr=await api(`pulls/${number}`);
   if(!pr.merged_at||pr.base?.ref!==base||pr.head?.sha!==run.head_sha||typeof pr.merge_commit_sha!=='string')continue;
   commit=pr.merge_commit_sha;
  }else if(!['push','schedule','workflow_dispatch'].includes(run.event)||run.head_branch!==base)continue;
  if(!/^[a-f0-9]{40,64}$/.test(commit)||!ancestor(commit))continue;
  const merges=countMerges(commit);if(!Number.isInteger(merges)||merges<0)throw Error('Invalid merge count');
  return {baseline:{run:run.id,commit,completed:marker.completed_at},merges};
 }
 return {baseline:null,merges:null};
}
export async function run(args=process.argv.slice(2),cwd=process.cwd(),env=process.env){
 const options={base:'origin/main',full:false,githubOutput:false};const seen=new Set();
 for(const arg of args){const key=arg.startsWith('--base=')?'base':arg==='--full'?'full':arg==='--github-output'?'githubOutput':null;if(!key||seen.has(key))throw Error('Use unique --base=REF, --full, --github-output');seen.add(key);options[key]=key==='base'?arg.slice(7):true;}
 if(!/^[a-zA-Z0-9_./-]+$/.test(options.base)||options.base.startsWith('-'))throw Error('Invalid base ref');
 const config=JSON.parse(readFileSync(resolve(cwd,'.harness.json'),'utf8')),p=policy(config.verification);
 const git=(...argv)=>execFileSync('git',argv,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const base=git('rev-parse','--verify',options.base),mergeBase=git('merge-base',base,'HEAD');
 const paths=[...git('diff','--name-only','--no-renames',mergeBase,'--').split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')].filter(Boolean);
 let evidence={};
 if(p){try{
  const repository=env.GITHUB_REPOSITORY||git('remote','get-url','origin').replace(/^.*github.com[:/]/,'').replace(/\.git$/,'');
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository))throw Error('Unknown GitHub repository');
  const api=async path=>JSON.parse(execFileSync('gh',['api',`repos/${repository}/${path}`],{cwd,env,encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));
  evidence=await history(p,{api,base:config.defaultBranch||'main',ancestor:commit=>{try{git('merge-base','--is-ancestor',commit,base);return true;}catch{return false;}},countMerges:commit=>Number(git('rev-list','--first-parent','--count',`${commit}..${base}`))});
 }catch{evidence={unavailable:'GitHub full-run history could not be verified'};}}
 const result=plan(config.verification,{files:paths,...evidence,requested:options.full});
 if(options.githubOutput){if(!env.GITHUB_OUTPUT)throw Error('GITHUB_OUTPUT is required');appendFileSync(env.GITHUB_OUTPUT,`full=${result.full}\ngroups=${result.groups.join(',')}\n`);for(const group of p?.groups??[])appendFileSync(env.GITHUB_OUTPUT,`${group.id}=${result.groups.includes(group.id)}\n`);}
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().then(value=>console.log(JSON.stringify(value,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
