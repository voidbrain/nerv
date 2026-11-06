import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weekOf,recap} from '../tools/backlog-recap.mjs';

const r=(id,status,opened,closed=null)=>({id,kind:id.startsWith('F')?'feature':'bug',status,human:false,opened,closed,archived:status==='Closed'});

test('the recap week runs Monday to Sunday (UTC), the same weeks as the archive', ()=>{
 assert.deepEqual(weekOf('2026-11-02'),{from:'2026-11-02',to:'2026-11-08'},'a Monday starts its own week');
 assert.deepEqual(weekOf('2026-11-06'),{from:'2026-11-02',to:'2026-11-08'});
 assert.deepEqual(weekOf('2026-11-08'),{from:'2026-11-02',to:'2026-11-08'},'a Sunday ends it');
 assert.deepEqual(weekOf('2027-01-01'),{from:'2026-12-28',to:'2027-01-03'},'a week across the new year');
 assert.throws(()=>weekOf('2026-02-30'),/Invalid date/);
});

test('opened and closed count the whole current week, not the 7 days before the date', ()=>{
 const records={active:[r('F-001','Open','2026-11-02'),r('F-002','Open','2026-11-01'),r('B-001','Open','2026-11-08')],
  archived:[r('F-003','Closed','2026-10-20','2026-11-03'),r('B-002','Closed','2026-11-02','2026-11-09')]};
 const block=recap(records,'2026-11-04');
 assert.match(block,/\*\*Week 2026-11-02 – 2026-11-08\*\*/);
 assert.match(block,/\| \*\*This week\*\* \| 1 \| 1 \| 2 \| 0 \|/,'Sunday counts, the previous Sunday and the next Monday do not');
 assert.doesNotMatch(block,/Recap as of|Last 7 days/);
});
