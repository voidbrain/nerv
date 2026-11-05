import {test} from 'node:test';
import assert from 'node:assert/strict';
import {briefDue,composeBrief,localClock,sortieRef} from '../src/brief.ts';
import {readFileSync} from 'node:fs';
const now=new Date('2030-01-15T07:30:00Z');// 08:30 in Rome
const facts={approvals:[{tool:'mail.send',expires:'2030-01-15T09:00:00Z'}],reminders:[{title:'Renew insurance',due:'2030-01-15T16:00:00Z'},{title:'Far away',due:'2030-02-01T09:00:00Z'},{title:'Past',due:'2030-01-14T09:00:00Z'}],
 sorties:[{title:'Remind me',status:'done',closed:'2030-01-15T06:00:00Z'},{title:'Mail Ada',status:'failed',closed:'2030-01-15T06:10:00Z'}],health:[] as string[]};
test('the brief lists waiting cards, the next 24 h of reminders in local time, what finished or failed, and health',()=>{
 const en=composeBrief({now,timeZone:'Europe/Rome',language:'en',...facts});
 assert.match(en,/Needs you: 1\n• mail\.send \(expires .*10:00\)/);
 assert.match(en,/Due in the next 24 h: 1\n• .*17:00 Renew insurance/,'only the next 24 hours, in Rome time');assert.doesNotMatch(en,/Far away|Past/);
 assert.match(en,/Since the last brief: 1 done, 1 failed\n• ✗ Mail Ada/);assert.match(en,/Health: All checks pass\./);
 const it=composeBrief({now,timeZone:'Europe/Rome',language:'it',...facts,approvals:[],health:['brain process not alive']});
 assert.match(it,/Buongiorno/);assert.match(composeBrief({now,timeZone:'Europe/Rome',language:'en',base:'Tabgha',...facts}),/^☀️ Good morning\. Hyuga's brief · Tabgha/);assert.match(it,/Ti aspettano: 0\nNulla ti aspetta\./);assert.match(it,/Stato: brain process not alive/);
});
test('the brief is due once per local day, at or after its time, in the owner\'s time zone',()=>{
 assert.deepEqual(localClock(now,'Europe/Rome'),{date:'2030-01-15',minutes:8*60+30});
 assert.equal(briefDue(now,'Europe/Rome','08:00',undefined),'2030-01-15');
 assert.equal(briefDue(now,'Europe/Rome','09:00',undefined),undefined,'not before its time');
 assert.equal(briefDue(now,'Europe/Rome','08:00','2030-01-15'),undefined,'once a day');
 assert.equal(briefDue(new Date('2030-01-15T23:30:00Z'),'Europe/Rome','08:00','2030-01-15'),undefined,'00:30 the next day is before 08:00');
 assert.equal(briefDue(new Date('2030-01-15T23:30:00Z'),'America/New_York','08:00','2030-01-14'),'2030-01-15','the date is the owner\'s, not UTC');
});
test('every brief item carries its sortie\'s short ID, and expired approvals are listed as not done (F-028)',()=>{
 const id='1a2b3c4d-0000-4000-8000-000000000000';
 const b=composeBrief({now,timeZone:'Europe/Rome',language:'en',approvals:[{tool:'mail.send',expires:'2030-01-15T09:00:00Z',sortie:id}],reminders:[],
  sorties:[{title:'Mail Ada',status:'failed',closed:'2030-01-15T06:10:00Z',id}],expired:[{tool:'reminders.cancel',sortie:id,title:'Cancel it'}],health:[]});
 assert.match(b,/Needs you: 1\n• S-1A2B mail\.send \(expires/);assert.match(b,/Expired without your decision \(nothing ran\): 1\n• ⌛ S-1A2B reminders\.cancel · Cancel it/);assert.match(b,/• ✗ S-1A2B Mail Ada/);
 assert.doesNotMatch(composeBrief({now,timeZone:'Europe/Rome',language:'en',...facts}),/Expired/,'no expired section when nothing expired');
 assert.match(composeBrief({now,timeZone:'Europe/Rome',language:'it',...facts,expired:[{tool:'mail.send',sortie:id,title:'x'}]}),/Scadute senza la tua decisione \(nulla è stato eseguito\): 1/);
 // Coupled with the dashboard (.harness.json couplings): the brief's ID is the one on the sortie's card.
 const short=new Function('id',/const short = id => (.+);/.exec(readFileSync('web/public/dashboard/live.js','utf8'))![1]!.replace(/^/,'return ')) as (id:string)=>string;
 assert.equal(sortieRef(id).trim(),short(id));
});
test('through the scheduler process: an approval that expired since the last brief is in the brief\'s facts with its sortie',{timeout:20000},async()=>{
 const {Runtime}=await import('../src/runtime.ts');const {gatherBrief}=await import('../src/brief.ts');
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {Store}=await import('../src/store.ts');
 const home=mkdtempSync(join(tmpdir(),'nerv-brief-'));writeFileSync(join(home,'scrolls.json'),JSON.stringify({blue:['reminders.cancel']}),{mode:0o600});
 const runtime=new Runtime(join(home,'nerv.sqlite'),undefined,home);
 try{
  await runtime.ready();const since=new Date(Date.now()-1000);
  const act=await runtime.act({request:'Cancel it',tool:'reminders.cancel',args:{id:'x'}});assert.equal(act.outcome,'approval');
  const direct=new Store(join(home,'nerv.sqlite'));try{direct.ledger.expire(new Date(Date.now()+2*3600_000));}finally{direct.close();}
  const facts=await gatherBrief(runtime,since);
  assert.deepEqual(facts.expired,[{tool:'reminders.cancel',sortie:act.sortieId,title:'Cancel it'}]);assert.deepEqual(facts.approvals,[]);
 }finally{await runtime.close();rmSync(home,{recursive:true,force:true});}
});
