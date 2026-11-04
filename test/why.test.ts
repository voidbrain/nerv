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
