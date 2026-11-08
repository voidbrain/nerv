import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('NERV CI and maintenance share the reviewed action release/commit pins',()=>{
 const pins=JSON.parse(readFileSync('.harness.json','utf8')).ciActionPins;
 const seen=new Set();
 for(const file of ['.github/workflows/ci.yml','.github/workflows/maintenance.yml']){
  const source=readFileSync(file,'utf8');
  const uses=[...source.matchAll(/^\s+(?:- )?uses: ([^\n]+)$/gm)];assert.ok(uses.length>0,file);
  for(const [,value] of uses){
   const match=/^([^@ ]+)@([a-f0-9]{40}) # (v[\d.]+)$/.exec(value);
   assert.ok(match,file+': use a full reviewed SHA with its release comment');
   const [,action,sha,release]=match;assert.deepEqual({sha,release},pins[action],file+': '+action);seen.add(action);
  }
 }
 assert.deepEqual([...seen].sort(),Object.keys(pins).sort(),'the manifest contains only actions the workflows use');
});
