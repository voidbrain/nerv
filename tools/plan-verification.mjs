// NERV's CI adapter; the planner and freshness contract belong to the shared harness.
import {appendFileSync} from 'node:fs';
import {run} from './verification.mjs';
const args=process.argv.slice(2);if(process.env.NERV_FULL_CHECKS==='true'&&!args.includes('--full'))args.push('--full');
const plan=await run(args);
if(args.includes('--github-output')){
 appendFileSync(process.env.GITHUB_OUTPUT,`paths=${JSON.stringify(plan.files)}\nunit=${plan.full||plan.groups.length>0}\nfrontend=${plan.full||plan.groups.includes('frontend')}\nnative=${plan.full||plan.groups.includes('native')}\nservice=${plan.full||plan.groups.includes('service')}\n`);
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,'### Verification selection\n\n```json\n'+JSON.stringify(plan,null,2)+'\n```\n');
}
console.log(JSON.stringify(plan,null,2));
