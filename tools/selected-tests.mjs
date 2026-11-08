// NERV owns the Node test adapter; copied harness tools never execute project commands.
import {readFileSync,existsSync,globSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function selectedTests(config,groups,changed,{expand=pattern=>globSync(pattern),exists=existsSync}={}){
 if(!Array.isArray(groups)||!Array.isArray(changed)||changed.some(file=>typeof file!=='string'))throw Error('Invalid selected-test inputs');
 const selected=new Set(),known=new Map(config.verification.groups.map(group=>[group.id,group]));
 for(const id of groups){const group=known.get(id);if(!group)throw Error('Unknown selected test group');for(const pattern of group.tests??[]){if(!/^test\/[a-zA-Z0-9.*-]+\.test\.(ts|mjs)$/.test(pattern))throw Error('Invalid selected-test pattern');const files=expand(pattern);if(!files.length)throw Error('Selected test pattern matched no tests: '+pattern);for(const file of files)selected.add(file);}}
 for(const file of changed)if(/^test\/[a-zA-Z0-9.-]+\.test\.(ts|mjs)$/.test(file)&&exists(file))selected.add(file);
 if(groups.length&&!selected.size)throw Error('Affected selection has no runnable Node regressions; review deletion or mapping');
 for(const file of selected)if(!/^test\/[a-zA-Z0-9.-]+\.test\.(ts|mjs)$/.test(file)||!exists(file))throw Error('Invalid selected test file');
 return [...selected].sort();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const config=JSON.parse(readFileSync('.harness.json','utf8')),groups=(process.env.NERV_VERIFY_GROUPS||'').split(',').filter(Boolean),changed=JSON.parse(process.env.NERV_VERIFY_PATHS||'[]');
 const tests=selectedTests(config,groups,changed);if(!tests.length)throw Error('No targeted tests selected');console.log('Selected regressions: '+tests.join(', '));execFileSync(process.execPath,['--test',...tests],{stdio:'inherit'});
}
