/**
 * What this NERV Agency is running (owner, 2026-11-06): the package version and the git commit of its checkout, read
 * once when the service starts, so the dashboard shows the code actually running, not what is on disk now.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export interface BuildInfo {version:string;commit:string|null}
let cached:BuildInfo|undefined;
/** The version and commit, read on first call and kept; commit is null outside a git checkout. */
export function buildInfo(root=fileURLToPath(new URL('..',import.meta.url))):BuildInfo {
 if(cached)return cached;
 let version='unknown';
 try{const v=(JSON.parse(readFileSync(join(root,'package.json'),'utf8')) as {version?:unknown}).version;if(typeof v==='string'&&/^\d+\.\d+\.\d+/.test(v))version=v;}catch{/* not found: unknown */}
 const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:3000});
 const sha=typeof git.stdout==='string'?git.stdout.trim():'';
 cached={version,commit:git.status===0&&/^[0-9a-f]{40}$/.test(sha)?sha:null};
 return cached;
}
