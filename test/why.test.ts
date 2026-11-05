import {test} from 'node:test';
import assert from 'node:assert/strict';
import {explainSortie,type WhyInput} from '../src/why.ts';
const last=(over:Partial<NonNullable<WhyInput['last']>>={}):NonNullable<WhyInput['last']>=>({tool:'mail.send',outcome:'approval',reason:'Sync Ratio 70% below 80%',decision:null,ran:null,...over});
test('the why sentence says where a sortie stands and the reason, from the latest action',()=>{
 const one=(w:Partial<WhyInput>)=>explainSortie({status:'open',actions:1,replied:false,...w});
 assert.equal(one({last:last()}),'Waits for you to approve mail.send: Sync Ratio 70% below 80%.');
 assert.equal(one({last:last({decision:'approve'})}),'You approved mail.send; it is running.');
 assert.equal(one({status:'done',actions:2,last:last({decision:'approve',ran:'done'})}),'Done (2 actions): the last action, mail.send, ran.');
 assert.equal(one({status:'failed',last:last({outcome:'grant',ran:'failed',error:'SMTP timeout'})}),'mail.send failed: SMTP timeout.');
 assert.equal(one({last:last({outcome:'reject',reason:'Denied by the Scrolls.'})}),'The MAGI refused mail.send: Denied by the Scrolls.');
 assert.equal(one({last:last({decision:'reject'})}),'You rejected mail.send; Misato is deciding what to do instead.');
 assert.equal(one({status:'done',last:last({decision:'expired'})}),'Your approval for mail.send expired; expiry never approves.');
 assert.equal(one({status:'revoked',spearReason:'dashboard',last:last({decision:'revoked'})}),'Stopped with the Spear: dashboard. Nothing more will run.');
 assert.equal(one({actions:0}),'Misato is working on it; no action proposed yet.');
 assert.equal(one({status:'done',actions:0,replied:true}),'Answered without taking any action.');
 assert.equal(one({status:'open',last:last({outcome:'grant',ran:'done'})}),'mail.send ran; Misato is deciding the next step.');
 assert.ok(one({last:last({reason:'x'.repeat(400)})}).length<=170,'a long reason is clipped');
});
test('a "why" question names a sortie by its short ID, in English or Italian; anything else is not one (B-004)',async()=>{
 const {askedWhy}=await import('../src/why.ts');
 assert.equal(askedWhy('why S-D263 approved?'),'d263');assert.equal(askedWhy('Perché S-1a2b è stata rifiutata?'),'1a2b');
 assert.equal(askedWhy('come mai S-00ff?'),'00ff');assert.equal(askedWhy('explain s-abcd'),'abcd');
 assert.equal(askedWhy('S-D263 approved'),undefined,'no question word');assert.equal(askedWhy('why is the sky blue?'),undefined,'no sortie');
 assert.equal(askedWhy('why S-12?'),undefined,'too short to name one');
});
test('the why answer marks shadow seats, says when an approval waits or expired, and reports a failure',async()=>{
 const {explainRecord}=await import('../src/why.ts');
 const rec={id:'abcd1234',title:'Send the report',status:'open',why:'',advice:{text:'Check the recipient first.',model:'gemma4:12b'},actions:[
  {tool:'mail.send',pattern:'orange',outcome:'approval' as const,reason:'Sync Ratio 70% below 80%',verdicts:[{seat:'Melchior',vote:'approve',reason:'Fine.'},{seat:'Tabgha·Casper',vote:'reject',reason:'Wrong address.',shadow:true}],decision:null,decided:null,source:null,ran:null},
  {tool:'files.write',pattern:'green',outcome:'grant' as const,reason:'',verdicts:[],decision:null,decided:null,source:null,ran:'failed' as const,error:'Disk full'},
  {tool:'mail.send',pattern:'orange',outcome:'approval' as const,reason:'',verdicts:[],decision:'expired',decided:'2026-11-05T09:00:00Z',source:'ttl',ran:null}]};
 const en=explainRecord({found:'one',record:rec},'abcd','en','UTC');
 assert.match(en,/^S-ABCD · “Send the report” · Status: open\./);assert.match(en,/Consultant \(gemma4:12b\): Check the recipient first\./);
 assert.match(en,/Tabgha·Casper reject \(shadow, not counted\) — Wrong address\./);assert.match(en,/It is waiting for your decision\./);
 assert.match(en,/It failed: Disk full\./);assert.match(en,/Your approval expired \(expiry never approves\) on 5 Nov, 09:00\./);
 assert.equal(explainRecord({found:'many',count:3},'abcd','it','UTC'),"3 sortie iniziano con S-ABCD: indica più caratteri dell'ID.");
});
test('a sortie reference never decides the reply language: its letters are not words (B-016)',async()=>{
 const {requestLanguage}=await import('../src/misato.ts');
 assert.equal(requestLanguage('why S-1E0E approved?'),'en','"1E0E" once read as two Italian "e"');
 assert.equal(requestLanguage('why S-E0E0?'),'en');assert.equal(requestLanguage('perché S-1E0E è stata approvata?'),'it');
 assert.equal(requestLanguage('remind me at 10e30'),'en','a token with digits is not a word');
});
