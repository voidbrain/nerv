import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.ts';
const proposal={tool:'reminders.add',args:{title:'Private neutral fixture',due:'2099-01-01T00:00:00Z'},stage:'prototype' as const};
const open=(store:Store)=>store.ledger.openSortie('owner','Neutral approval','trusted');

test('F-023: approval and generic durable inbox notice commit together and survive restart',()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-approval-')),path=join(home,'store.sqlite');let store=new Store(path);
 try{
  const result=store.runAction(open(store),proposal);assert.ok(result.approvalId);
  const page=store.inboxPage();assert.equal(page.items.length,1);const notice=page.items[0]!;
  assert.equal(notice.kind,'approval');assert.equal(notice.approval?.id,result.approvalId);assert.equal(notice.approval?.pending,true);
  assert.doesNotMatch(JSON.stringify(notice),/Private neutral fixture|2099|grantId|args/);
  assert.equal(notice.approval?.expires,store.approvals()[0]!.expires);
  store.close();store=new Store(path);assert.deepEqual(store.inboxPage(),page);
  store.decide(result.approvalId,'approve','telegram');store.decide(result.approvalId,'approve','api');
  assert.equal(store.pendingReminders().length,1);assert.equal(store.inboxPage().items.length,1);
  assert.equal(store.inboxPage().items[0]!.approval?.pending,false);assert.equal(store.inboxPage(page.next.sequence,5,page.next.id).items.length,0);
 }finally{store.close();rmSync(home,{recursive:true,force:true});}
});

test('F-023: an inbox failure rolls back the approval and its ledger events',()=>{
 const store=new Store(':memory:');try{
  const sortie=open(store),before=store.events(sortie);
  store.db.exec("CREATE TRIGGER refuse_approval_notice BEFORE INSERT ON deliveries WHEN NEW.kind='approval' BEGIN SELECT RAISE(ABORT,'fixture inbox failure'); END");
  assert.throws(()=>store.runAction(sortie,proposal),/fixture inbox failure/);
  assert.deepEqual(store.approvals(),[]);assert.deepEqual(store.events(sortie),before);
 }finally{store.close();}
});

test('F-023: settled and expired notices are historical data, never fresh pending requests',()=>{
 const store=new Store(':memory:');try{
  const result=store.runAction(open(store),proposal);assert.ok(result.approvalId);
  const expires=store.approvals()[0]!.expires;store.expire(new Date(Date.parse(expires)+1));
  assert.equal(store.inboxPage().items[0]!.approval?.pending,false);
  store.decide(result.approvalId,'approve','api');assert.equal(store.pendingReminders().length,0);
  assert.equal(store.inboxPage(999,5,'missing').reset,true);
 }finally{store.close();}
});

test('F-023: upgrade backfills pending approvals once and preserves prior delivery IDs and rowids',()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-approval-upgrade-')),path=join(home,'store.sqlite');let store=new Store(path);
 try{
  store.add('Existing reminder','2030-01-01T01:00:00Z',new Date('2029-01-01'));store.tick(new Date('2030-01-02'));
  const old=store.inboxPage();
  // Direct ledger proposal represents the pre-delivery implementation, not a production bypass.
  const pending=store.ledger.propose(open(store),proposal);assert.ok(pending.approvalId);
  const settled=store.ledger.propose(open(store),proposal);store.decide(settled.approvalId!,'reject','api');
  store.close();store=new Store(path);
  const page=store.inboxPage();assert.deepEqual(page.items[0],old.items[0]);assert.equal(page.items.length,2);
  assert.equal(page.items[1]!.approval?.id,pending.approvalId);assert.equal(page.items[1]!.sequence,old.head.sequence+1);
  store.close();store=new Store(path);assert.deepEqual(store.inboxPage(),page);
 }finally{store.close();rmSync(home,{recursive:true,force:true});}
});


test('F-023: elapsed TTL suppresses a notice before the scheduler persists expiry',()=>{
 const store=new Store(':memory:');try{
  const result=store.runAction(open(store),proposal);assert.ok(result.approvalId);
  store.db.prepare('UPDATE approvals SET expires=? WHERE id=?').run('2000-01-01T00:00:00.000Z',result.approvalId);
  assert.equal(store.inboxPage().items[0]!.approval?.pending,false);
  assert.equal((store.db.prepare('SELECT decision FROM approvals WHERE id=?').get(result.approvalId) as {decision:null}).decision,null);
 }finally{store.close();}
});
