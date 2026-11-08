import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,globSync} from 'node:fs';
import {plan} from '../tools/verification.mjs';
import {selectedTests} from '../tools/selected-tests.mjs';
const config=JSON.parse(readFileSync('.harness.json','utf8')),workflow=readFileSync('.github/workflows/ci.yml','utf8');
const fresh={now:Date.parse('2026-11-08T12:00:00Z'),baseline:{run:1,commit:'a'.repeat(40),completed:'2026-11-07T12:00:00Z'},merges:1};
test('NERV policy selects doc, affected, risk, stale and explicit full scopes without running models',()=>{
 const docs=plan(config.verification,{...fresh,files:['docs/BACKLOG.md']});assert.equal(docs.full,false);assert.deepEqual(docs.groups,[]);
 const brief=plan(config.verification,{...fresh,files:['src/brief.ts']});assert.equal(brief.full,false);assert.deepEqual(brief.groups,['brief']);assert.deepEqual(selectedTests(config,brief.groups,brief.files),['test/brief-recovery.test.ts','test/brief.test.ts','test/telegram.test.ts']);
 for(const files of [['src/worker-link.ts'],['src/store.ts'],['.github/workflows/ci.yml'],['src/new-module.ts']])assert.equal(plan(config.verification,{...fresh,files}).full,true,files.join(','));
 for(const data of [{merges:10},{baseline:null},{requested:true},{baseline:{...fresh.baseline,completed:'2026-11-01T12:00:00Z'}}])assert.equal(plan(config.verification,{...fresh,...data}).full,true);
});
test('changed tests join mapped dependencies; missing or empty selections fail rather than claim a check',()=>{
 assert.ok(selectedTests(config,['tests'],['test/core.test.ts']).includes('test/core.test.ts'));
 assert.throws(()=>selectedTests(config,['unknown'],[]),/Unknown/);assert.throws(()=>selectedTests(config,['tests'],['test/deleted.test.ts']),/no runnable/);
 for(const group of config.verification.groups)for(const pattern of group.tests){const files=globSync(pattern);assert.ok(files.length,group.id+': '+pattern);assert.ok(files.every(existsSync));}
});
test('CI has one PR trigger, manual/periodic selection and a full marker gated on every required outcome',()=>{
 assert.match(workflow,/on:\n  pull_request:/);assert.doesNotMatch(workflow,/^  push:/m);assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/schedule:/);assert.match(workflow,/cancel-in-progress: true/);
 const marker=workflow.slice(workflow.indexOf('  full-suite:'));
 assert.match(marker,/needs: \[plan, validate, windows, native-macos\]/);assert.match(marker,/if: always\(\) && needs.plan.outputs.full == 'true'/);
 for(const name of ['PLAN','VALIDATE','WINDOWS','NATIVE'])assert.ok(marker.includes('test "$'+name+'" = success'),name+' must succeed');
 assert.ok(workflow.includes("if: needs.plan.outputs.full != 'true' && needs.plan.outputs.unit == 'true'"));
 assert.match(workflow,/GH_TOKEN: \$\{\{ github.token \}\}/);assert.match(workflow,/actions: read/);assert.doesNotMatch(workflow,/pull_request_target|secrets\./);
});

test('shared event persistence/privacy requires full verification and route recovery selects its integration case',()=>{
 assert.equal(plan(config.verification,{...fresh,files:['src/events.ts']}).full,true,'event schema and legacy grant redaction are shared persistence/privacy contracts');
 const route=plan(config.verification,{...fresh,files:['src/route-health.ts']});assert.ok(selectedTests(config,route.groups,route.files).includes('test/dummy-plug.test.ts'),'route outage/recovery must include its direct brain/runtime integration regression');
});

test('Windows glob separators normalize to repository paths before validating selected regressions',()=>{
 const paths=selectedTests(config,['brief'],[],{expand:pattern=>[pattern.replaceAll('/','\\')],exists:()=>true});
 assert.deepEqual(paths,['test/brief-recovery.test.ts','test/brief.test.ts','test/telegram.test.ts']);
});
