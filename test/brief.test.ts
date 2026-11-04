import {test} from 'node:test';
import assert from 'node:assert/strict';
import {briefDue,composeBrief,localClock} from '../src/brief.ts';
const now=new Date('2030-01-15T07:30:00Z');// 08:30 in Rome
const facts={approvals:[{tool:'mail.send',expires:'2030-01-15T09:00:00Z'}],reminders:[{title:'Renew insurance',due:'2030-01-15T16:00:00Z'},{title:'Far away',due:'2030-02-01T09:00:00Z'},{title:'Past',due:'2030-01-14T09:00:00Z'}],
 sorties:[{title:'Remind me',status:'done',closed:'2030-01-15T06:00:00Z'},{title:'Mail Ada',status:'failed',closed:'2030-01-15T06:10:00Z'}],health:[] as string[]};
test('the brief lists waiting cards, the next 24 h of reminders in local time, what finished or failed, and health',()=>{
 const en=composeBrief({now,timeZone:'Europe/Rome',language:'en',...facts});
 assert.match(en,/Needs you: 1\n• mail\.send \(expires .*10:00\)/);
 assert.match(en,/Due in the next 24 h: 1\n• .*17:00 Renew insurance/,'only the next 24 hours, in Rome time');assert.doesNotMatch(en,/Far away|Past/);
 assert.match(en,/Since the last brief: 1 done, 1 failed\n• ✗ Mail Ada/);assert.match(en,/Health: All checks pass\./);
 const it=composeBrief({now,timeZone:'Europe/Rome',language:'it',...facts,approvals:[],health:['brain process not alive']});
 assert.match(it,/Buongiorno/);assert.match(it,/Ti aspettano: 0\nNulla ti aspetta\./);assert.match(it,/Stato: brain process not alive/);
});
test('the brief is due once per local day, at or after its time, in the owner\'s time zone',()=>{
 assert.deepEqual(localClock(now,'Europe/Rome'),{date:'2030-01-15',minutes:8*60+30});
 assert.equal(briefDue(now,'Europe/Rome','08:00',undefined),'2030-01-15');
 assert.equal(briefDue(now,'Europe/Rome','09:00',undefined),undefined,'not before its time');
 assert.equal(briefDue(now,'Europe/Rome','08:00','2030-01-15'),undefined,'once a day');
 assert.equal(briefDue(new Date('2030-01-15T23:30:00Z'),'Europe/Rome','08:00','2030-01-15'),undefined,'00:30 the next day is before 08:00');
 assert.equal(briefDue(new Date('2030-01-15T23:30:00Z'),'America/New_York','08:00','2030-01-14'),'2030-01-15','the date is the owner\'s, not UTC');
});
