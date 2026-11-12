import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainSortie, type WhyInput } from '../src/why.ts';
const last = (over: Partial<NonNullable<WhyInput['last']>> = {}): NonNullable<WhyInput['last']> => ({
  tool: 'mail.send',
  outcome: 'approval',
  reason: 'Sync Ratio 70% below 80%',
  decision: null,
  ran: null,
  ...over,
});
test('the why sentence says where a sortie stands and the reason, from the latest action', () => {
  const one = (w: Partial<WhyInput>) => explainSortie({ status: 'open', actions: 1, replied: false, ...w });
  assert.equal(one({ last: last() }), 'Waits for you to approve mail.send: Sync Ratio 70% below 80%.');
  assert.equal(one({ last: last({ decision: 'approve' }) }), 'You approved mail.send; it is running.');
  assert.equal(
    one({ status: 'done', actions: 2, last: last({ decision: 'approve', ran: 'done' }) }),
    'Done (2 actions): the last action, mail.send, ran.',
  );
  assert.equal(
    one({ status: 'failed', last: last({ outcome: 'grant', ran: 'failed', error: 'SMTP timeout' }) }),
    'mail.send failed: SMTP timeout.',
  );
  assert.equal(
    one({ last: last({ outcome: 'reject', reason: 'Denied by the Scrolls.' }) }),
    'The MAGI refused mail.send: Denied by the Scrolls.',
  );
  assert.equal(
    one({ last: last({ decision: 'reject' }) }),
    'You rejected mail.send; Misato is deciding what to do instead.',
  );
  assert.equal(
    one({ status: 'done', last: last({ decision: 'expired' }) }),
    'Your approval for mail.send expired; expiry never approves.',
  );
  assert.equal(
    one({ status: 'revoked', spearReason: 'dashboard', last: last({ decision: 'revoked' }) }),
    'Stopped with the Spear: dashboard. Nothing more will run.',
  );
  assert.equal(one({ actions: 0 }), 'Misato is working on it; no action proposed yet.');
  assert.equal(one({ status: 'done', actions: 0, replied: true }), 'Answered without taking any action.');
  assert.equal(
    one({ status: 'open', last: last({ outcome: 'grant', ran: 'done' }) }),
    'mail.send ran; Misato is deciding the next step.',
  );
  assert.ok(one({ last: last({ reason: 'x'.repeat(400) }) }).length <= 170, 'a long reason is clipped');
});
test('a "why" question names a sortie by its short ID, in English or Italian; anything else is not one (B-004)', async () => {
  const { askedWhy } = await import('../src/why.ts');
  assert.equal(askedWhy('why S-D263 approved?'), 'd263');
  assert.equal(askedWhy('Perché S-1a2b è stata rifiutata?'), '1a2b');
  assert.equal(askedWhy('come mai S-00ff?'), '00ff');
  assert.equal(askedWhy('explain s-abcd'), 'abcd');
  assert.equal(askedWhy('S-D263 approved'), undefined, 'no question word');
  assert.equal(askedWhy('why is the sky blue?'), undefined, 'no sortie');
  assert.equal(askedWhy('why S-12?'), undefined, 'too short to name one');
});
test('the why answer marks shadow seats, says when an approval waits or expired, and reports a failure', async () => {
  const { explainRecord } = await import('../src/why.ts');
  const rec = {
    id: 'abcd1234',
    title: 'Send the report',
    status: 'open',
    why: '',
    advice: { text: 'Check the recipient first.', model: 'gemma4:12b' },
    actions: [
      {
        tool: 'mail.send',
        pattern: 'orange',
        outcome: 'approval' as const,
        reason: 'Sync Ratio 70% below 80%',
        verdicts: [
          { seat: 'Melchior', vote: 'approve', reason: 'Fine.' },
          { seat: 'Tabgha·Casper', vote: 'reject', reason: 'Wrong address.', shadow: true },
        ],
        decision: null,
        decided: null,
        source: null,
        ran: null,
      },
      {
        tool: 'files.write',
        pattern: 'green',
        outcome: 'grant' as const,
        reason: '',
        verdicts: [],
        decision: null,
        decided: null,
        source: null,
        ran: 'failed' as const,
        error: 'Disk full',
      },
      {
        tool: 'mail.send',
        pattern: 'orange',
        outcome: 'approval' as const,
        reason: '',
        verdicts: [],
        decision: 'expired',
        decided: '2026-11-05T09:00:00Z',
        source: 'ttl',
        ran: null,
      },
    ],
  };
  const en = explainRecord({ found: 'one', record: rec }, 'abcd', 'en', 'UTC');
  assert.match(en, /^S-ABCD · “Send the report” · Status: open\./);
  assert.match(en, /Consultant \(gemma4:12b\): Check the recipient first\./);
  assert.match(en, /Tabgha·Casper reject \(shadow, not counted\) — Wrong address\./);
  assert.match(en, /It is waiting for your decision\./);
  assert.match(en, /It failed: Disk full\./);
  assert.match(en, /Your approval expired \(expiry never approves\) on 5 Nov, 09:00\./);
  assert.equal(
    explainRecord({ found: 'many', count: 3 }, 'abcd', 'it', 'UTC'),
    "3 sortie iniziano con S-ABCD: indica più caratteri dell'ID.",
  );
});
test('a sortie reference never decides the reply language: its letters are not words (B-016)', async () => {
  const { requestLanguage } = await import('../src/misato.ts');
  assert.equal(requestLanguage('why S-1E0E approved?'), 'en', '"1E0E" once read as two Italian "e"');
  assert.equal(requestLanguage('why S-E0E0?'), 'en');
  assert.equal(requestLanguage('perché S-1E0E è stata approvata?'), 'it');
  assert.equal(requestLanguage('remind me at 10e30'), 'en', 'a token with digits is not a word');
});
test('F-042: isAgencyQuestion detects agency questions in EN and IT and excludes action requests on a base', async () => {
  const { isAgencyQuestion } = await import('../src/why.ts');
  const bases = [
    { id: 'NERV-01', name: 'Tokyo-3' },
    { id: 'NERV-02', name: 'Tabgha' },
  ];
  assert.equal(isAgencyQuestion('why was S-1A2B approved?', bases), true);
  assert.equal(isAgencyQuestion('spiegami la sortie S-1a2b', bases), true);
  assert.equal(isAgencyQuestion('what is waiting for me?', bases), true);
  assert.equal(isAgencyQuestion("cosa c'è in attesa per me?", bases), true);
  assert.equal(isAgencyQuestion('do I have any pending approvals?', bases), true);
  assert.equal(isAgencyQuestion('is Tabgha up?', bases), true);
  assert.equal(isAgencyQuestion('Tabgha è online?', bases), true);
  assert.equal(isAgencyQuestion('how is agency health?', bases), true);
  assert.equal(isAgencyQuestion('come stanno le basi?', bases), true);
  assert.equal(isAgencyQuestion('Remind me on Tabgha to stretch tomorrow', bases), false);
  assert.equal(isAgencyQuestion('Ricordami su Tabgha di chiamare Ada', bases), false);
  assert.equal(isAgencyQuestion('Remember I prefer tea', bases), false);
});
test('F-042: sorties.explain, approvals.list and agency.status run as Pattern Green and return grounded records', async () => {
  const { defaultPolicy } = await import('../src/policy.ts');
  const { Store } = await import('../src/store.ts');
  const store = new Store(':memory:', { policy: { ...defaultPolicy, blue: ['reminders.add'] }, source: 'scrolls' });
  try {
    // 1. Open a sortie with consultant advice, a peer seat and a late shadow vote, waiting for owner approval
    const waitingSortie = store.ledger.openSortie('misato', 'Send the quarterly report', 'trusted');
    store.ledger.note(waitingSortie, 'misato.consult', {
      advice: 'Confirm the recipient address first.',
      model: 'gemma4:12b',
      pilot: { id: 'comms', name: 'Aoba', why: 'keywords' },
    });
    const proposed = store.runAction(waitingSortie, {
      tool: 'reminders.add',
      args: { title: 'Send the quarterly report', due: '2030-05-01T09:00:00Z' },
      stage: 'production',
      casper: { seat: 'casper', vote: 'approve', reason: 'Matches request.', confidence: 0.92 },
      extras: [{ seat: 'NERV-02', vote: 'approve', reason: 'Peer agrees.' }],
    });
    assert.equal(proposed.outcome, 'approval');
    store.shadowVote(waitingSortie, proposed.actionId, {
      seat: 'NERV-03',
      vote: 'reject',
      reason: 'Late shadow caution.',
    });

    // 2. Open a sortie with an open clarification question waiting for the owner
    const questionSortie = store.ledger.openSortie('misato', 'Schedule the call', 'trusted');
    store.ledger.ask(questionSortie, 'Which day should I schedule the call?', 'cli');

    // 3. Read-only agency tools run as Pattern Green (outcome: 'grant') without creating approval cards
    const probeSortie = store.ledger.openSortie('misato', 'Inspect agency state', 'trusted');
    const approvalsOut = store.runAction(probeSortie, {
      tool: 'approvals.list',
      args: {},
      stage: 'production',
    });
    assert.equal(approvalsOut.outcome, 'grant');
    assert.equal(approvalsOut.pattern, 'green');
    assert.equal(approvalsOut.approvalId, undefined);
    const listed = (
      approvalsOut as {
        result: {
          approvals: { shortId: string; title: string; tool: string }[];
          questions: { shortId: string; question: string }[];
        };
      }
    ).result;
    assert.equal(listed.approvals.length, 1);
    assert.equal(listed.approvals[0]!.shortId, 'S-' + waitingSortie.slice(0, 4).toUpperCase());
    assert.equal(listed.approvals[0]!.title, 'Send the quarterly report');
    assert.equal(listed.approvals[0]!.tool, 'reminders.add');
    assert.equal(listed.questions.length, 1);
    assert.equal(listed.questions[0]!.shortId, 'S-' + questionSortie.slice(0, 4).toUpperCase());
    assert.equal(listed.questions[0]!.question, 'Which day should I schedule the call?');

    // Decide the approval card as owner and explain the sortie via sorties.explain
    store.decide(proposed.approvalId!, 'approve', 'cli');
    const explainOut = store.runAction(probeSortie, {
      tool: 'sorties.explain',
      args: { ref: 'S-' + waitingSortie.slice(0, 4).toUpperCase() },
      stage: 'production',
    });
    assert.equal(explainOut.outcome, 'grant');
    assert.equal(explainOut.pattern, 'green');
    const explained = (
      explainOut as {
        result: {
          found: string;
          shortId: string;
          advice?: { text: string; model: string };
          actions: {
            decision: string;
            approver?: string;
            decided: string | null;
            verdicts: { seat: string; shadow?: boolean }[];
          }[];
          summary: string;
        };
      }
    ).result;
    assert.equal(explained.found, 'one');
    assert.equal(explained.shortId, 'S-' + waitingSortie.slice(0, 4).toUpperCase());
    assert.equal(explained.advice?.model, 'Aoba · gemma4:12b');
    assert.equal(explained.actions[0]!.decision, 'approve');
    assert.equal(explained.actions[0]!.approver, 'owner');
    assert.ok(explained.actions[0]!.decided);
    assert.ok(explained.actions[0]!.verdicts.some((v) => v.seat === 'extra:NERV-02'));
    assert.ok(
      explained.actions[0]!.verdicts.some((v) => v.seat === 'extra:NERV-03' && v.shadow === true),
      'late shadow vote is included in the sortie explanation',
    );
    assert.match(explained.summary, /NERV-02.*approve/);
    assert.match(explained.summary, /NERV-03 reject \(shadow, not counted\)/);

    // 4. agency.status returns base health and bases status (with optional filter by base name)
    const statusOut = store.runAction(
      probeSortie,
      {
        tool: 'agency.status',
        args: { base: 'Tabgha' },
        stage: 'production',
      },
      undefined,
      {
        health: { state: 'online', reasons: [] },
        bases: [
          {
            baseId: 'NERV-01',
            name: 'Tokyo-3',
            status: 'enrolled',
            self: true,
            main: true,
            online: true,
            lastSeen: null,
            health: { state: 'online', reasons: [] },
            channel: { mode: 'polling' },
          },
          {
            baseId: 'NERV-02',
            name: 'Tabgha',
            status: 'enrolled',
            self: false,
            main: false,
            online: true,
            lastSeen: '2030-05-01T08:59:30Z',
            health: { state: 'online', reasons: [] },
            channel: null,
          },
        ],
      },
    );
    assert.equal(statusOut.outcome, 'grant');
    assert.equal(statusOut.pattern, 'green');
    const agency = (
      statusOut as {
        result: {
          health: { state: string; pendingReminders: number };
          bases: { baseId: string; name: string; online: boolean }[];
        };
      }
    ).result;
    assert.equal(agency.health.state, 'online');
    assert.equal(agency.health.pendingReminders, 1);
    assert.equal(agency.bases.length, 1);
    assert.equal(agency.bases[0]!.baseId, 'NERV-02');
    assert.equal(agency.bases[0]!.name, 'Tabgha');
    assert.equal(agency.bases[0]!.online, true);
  } finally {
    store.close();
  }
});
