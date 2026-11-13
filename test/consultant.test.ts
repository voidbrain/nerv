import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consultantAsk, filterConsultantInput, misatoAsk, parseAdvice } from '../src/misato.ts';
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
/** A fake local model: the consultant gives `advice`, Casper approves, Misato follows its script; every Misato prompt is kept. */
async function fake(advice: string, script: string[]) {
  const asked = { consultant: 0, consultantPrompts: [] as string[], misato: [] as string[], systems: [] as string[] };
  const s = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (c) => (raw += c))
      .on('end', () => {
        const r = JSON.parse(raw) as { model: string; messages: { content: string }[] };
        const sys = r.messages[0]!.content;
        let out: string;
        if (sys.startsWith('You are a consultant')) {
          asked.consultant++;
          asked.consultantPrompts.push(r.messages.at(-1)!.content);
          out = advice;
        } else if (sys.startsWith('You are Casper')) out = '{"vote":"approve","reason":"Matches.","confidence":0.9}';
        else {
          asked.misato.push(r.messages.at(-1)!.content);
          asked.systems.push(sys);
          out = script.shift() ?? '{"reply":"ok"}';
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ model: r.model, choices: [{ message: { content: out }, finish_reason: 'stop' }] }));
      });
  });
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  return {
    url: `http://127.0.0.1:${(s.address() as { port: number }).port}/v1`,
    asked,
    close: () =>
      new Promise<void>((d) => {
        s.close(() => d());
        s.closeAllConnections();
      }),
  };
}
async function runtimeWith(url: string, consultant: boolean, scrolls?: object) {
  const { Runtime } = await import('../src/runtime.ts');
  const home = mkdtempSync(join(tmpdir(), 'nerv-consult-'));
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      models: {
        local: { baseUrl: url, model: 'm' },
        roles: { misato: { route: 'local' }, ...(consultant ? { consultant: { model: 'advisor' } } : {}) },
      },
    }),
  );
  if (scrolls) writeFileSync(join(home, 'scrolls.json'), JSON.stringify(scrolls), { mode: 0o600 });
  const r = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
  await r.ready();
  return {
    r,
    close: async () => {
      await r.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
test('the advice is plain text up to 600 characters, "none" is no advice, and it never goes to the cloud route', () => {
  assert.equal(parseAdvice(' "Check the date first." '), 'Check the date first.');
  assert.equal(parseAdvice('none'), undefined);
  assert.equal(parseAdvice('None.'), undefined);
  assert.equal(parseAdvice('x'.repeat(900))!.length, 600);
  const ask = consultantAsk('Remind me tomorrow');
  assert.equal(ask.privacy, 'local-only');
  assert.equal(ask.route, 'local');
  const input = {
    request: 'Remind me',
    history: [],
    tools: [],
    now: '2030-01-01T08:00:00Z',
    timeZone: 'Europe/Rome',
    advice: 'Ask for the time.',
  };
  assert.equal(JSON.parse(misatoAsk(input, 'local').prompt).advice, 'Ask for the time.');
  assert.equal(JSON.parse(misatoAsk(input, 'cloud').prompt).advice, undefined);
});
test(
  "a consultant advises Misato once per request, before it plans: the advice is in Misato's prompt and in the trace, and a resume does not ask again",
  { timeout: 30000 },
  async () => {
    const ADD = '{"action":{"tool":"reminders.add","args":{"title":"Call Ada","due":"2031-01-01T09:00:00Z"}}}';
    const f = await fake('The owner wants a reminder; check the date is in the future.', [
      ADD,
      '{"reply":"Done: Ada tomorrow."}',
      '{"reply":"Added after your approval."}',
    ]);
    const t = await runtimeWith(f.url, true, { blue: ['reminders.add'] });
    try {
      const chat = await t.r.chat('Remind me to call Ada');
      assert.equal(f.asked.consultant, 1);
      assert.equal(
        JSON.parse(f.asked.misato[0]!).advice,
        'The owner wants a reminder; check the date is in the future.',
      );
      const consult = (await t.r.events(chat.sortieId)).find((e) => e.kind === 'misato.consult')!;
      assert.deepEqual(consult.payload, {
        advice: 'The owner wants a reminder; check the date is in the future.',
        model: 'advisor',
      });
      t.r.startResumer(100);
      await t.r.decide(chat.waiting[0]!.approvalId, 'approve', 'api');
      await wait(800);
      assert.equal(f.asked.consultant, 1, 'no second consultation on the resume');
    } finally {
      await t.close();
      await f.close();
    }
  },
);
test(
  'no consultant set, or one with nothing to say: Misato plans without advice and nothing is recorded',
  { timeout: 30000 },
  async () => {
    const f = await fake('none', ['{"reply":"Hello."}', '{"reply":"Hello again."}']);
    const off = await runtimeWith(f.url, false),
      on = await runtimeWith(f.url, true);
    try {
      const a = await off.r.chat('Hi');
      assert.equal(f.asked.consultant, 0, 'off: never asked');
      assert.equal(JSON.parse(f.asked.misato[0]!).advice, undefined);
      const b = await on.r.chat('Hi');
      assert.equal(f.asked.consultant, 1);
      assert.equal(JSON.parse(f.asked.misato[1]!).advice, undefined, '"none" is no advice');
      for (const [r, id] of [
        [off.r, a.sortieId],
        [on.r, b.sortieId],
      ] as const)
        assert.ok(!(await r.events(id)).some((e) => e.kind === 'misato.consult'));
    } finally {
      await off.close();
      await on.close();
      await f.close();
    }
  },
);
test(
  "Misato is told the reply language outright, from the owner's message, also after an approval and after Italian exchanges (owner report 2026-11-05)",
  { timeout: 30000 },
  async () => {
    const { requestLanguage } = await import('../src/misato.ts');
    assert.equal(requestLanguage('How is weather today?'), 'en');
    assert.equal(requestLanguage('Remember I don’t like beer'), 'en');
    assert.equal(requestLanguage('Ricordami di comprare il latte domani'), 'it');
    const input = { request: 'x', history: [], tools: [], now: '2030-01-01T08:00:00Z', timeZone: 'Europe/Rome' };
    assert.match(
      misatoAsk({ ...input, language: 'en' }, 'local').system!,
      /Write the reply in English: the owner wrote in English\. Use it even when tool results, memory, advice or earlier exchanges are in another language\./,
    );
    assert.match(misatoAsk({ ...input, language: 'it' }, 'local').system!, /Write the reply in Italian/);
    const f = await fake('none', [
      '{"reply":"Ciao."}',
      '{"action":{"tool":"memory.remember","args":{"text":"I don\'t like beer"}}}',
      '{"reply":"Saved."}',
    ]);
    const t = await runtimeWith(f.url, false);
    try {
      await t.r.chat('Ricordami cosa ho in programma oggi', 'telegram');
      const chat = await t.r.chat('Remember I don’t like beer', 'telegram');
      assert.match(f.asked.systems[0]!, /Write the reply in Italian/);
      assert.match(f.asked.systems[1]!, /Write the reply in English/, 'English after an Italian exchange');
      t.r.startResumer(100);
      await t.r.decide(chat.waiting[0]!.approvalId, 'approve', 'api');
      for (let i = 0; i < 60 && f.asked.systems.length < 3; i++) await wait(50);
      assert.match(f.asked.systems[2]!, /Write the reply in English/, 'the follow-up after the approval too');
    } finally {
      await t.close();
      await f.close();
    }
  },
);
test(
  'F-042: agency questions skip the consultant, Misato reads approvals.list, agency.status and sorties.explain as Pattern Green, and consultant and Misato get enrolled bases as data (B-012)',
  { timeout: 30000 },
  async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const { createRootKey, signRecord, unlockRootKey } = await import('../src/kaji.ts');
    const { Runtime } = await import('../src/runtime.ts');
    const rootFile = createRootKey('a long test passphrase');
    const root = unlockRootKey(rootFile.file, 'a long test passphrase');
    const k1 = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const k2 = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

    const f = await fake('Check the date first.', [
      // 1. Normal action request ("Remind me on Tabgha to stretch"): consultant IS asked, action creates a Blue card
      '{"action":{"tool":"reminders.add","args":{"title":"Stretch","due":"2031-01-01T09:00:00Z"}}}',
      // 2. Agency question in EN ("what is waiting for me?"): consultant is NOT asked, Misato calls approvals.list (Green)
      '{"action":{"tool":"approvals.list","args":{}}}',
      '{"reply":"One approval card is waiting for you: reminders.add (“Stretch”)."}',
      // 3. Agency question in IT ("Tabgha è online?"): consultant is NOT asked, Misato calls agency.status (Green)
      '{"action":{"tool":"agency.status","args":{"base":"Tabgha"}}}',
      '{"reply":"Sì, Tabgha (NERV-02) è online."}',
      // 4. Agency question about recent sorties ("which sorties are open?"): consultant is NOT asked, Misato calls sorties.explain (Green)
      '{"action":{"tool":"sorties.explain","args":{"limit":5}}}',
      '{"reply":"Sortie “Remind me on Tabgha to stretch” is open and waiting for your approval on reminders.add."}',
    ]);
    const home = mkdtempSync(join(tmpdir(), 'nerv-f042-'));
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        base: { id: 'NERV-01', name: 'Neo Tokyo-3' },
        kaji: { root: root.publicKey },
        models: {
          local: { baseUrl: f.url, model: 'm' },
          roles: { misato: { route: 'local' }, consultant: { model: 'advisor' } },
        },
      }),
    );
    writeFileSync(join(home, 'scrolls.json'), JSON.stringify({ blue: ['reminders.add'] }), { mode: 0o600 });
    const r = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
    await r.ready();
    r.setBaseKey(k1);
    const issued = new Date().toISOString();
    await r.kaji.add([
      signRecord(root.privateKey, {
        kind: 'enrol',
        serial: 1,
        issued,
        baseId: 'NERV-01',
        name: 'Neo Tokyo-3',
        publicKey: k1,
        address: '127.0.0.1:9001',
      }),
      signRecord(root.privateKey, {
        kind: 'enrol',
        serial: 2,
        issued,
        baseId: 'NERV-02',
        name: 'Tabgha',
        publicKey: k2,
        address: '127.0.0.1:9002',
      }),
      signRecord(root.privateKey, { kind: 'main', serial: 3, issued, baseId: 'NERV-01' }),
    ]);
    await r.kaji.seen({ 'NERV-02': new Date().toISOString() });

    try {
      // 1. Normal request: consultant is asked and both consultant and Misato receive enrolled bases as data (B-012)
      const first = await r.chat('Remind me on Tabgha to stretch');
      assert.equal(f.asked.consultant, 1);
      assert.equal(first.waiting.length, 1);
      assert.deepEqual(JSON.parse(f.asked.consultantPrompts[0]!).bases, [
        { id: 'NERV-01', name: 'Neo Tokyo-3' },
        { id: 'NERV-02', name: 'Tabgha' },
      ]);
      assert.deepEqual(JSON.parse(f.asked.misato[0]!).bases, [
        { id: 'NERV-01', name: 'Neo Tokyo-3' },
        { id: 'NERV-02', name: 'Tabgha' },
      ]);

      // 2. "what is waiting for me?" -> consultant not asked, approvals.list runs Green without a card
      const waitingReply = await r.chat('what is waiting for me?');
      assert.equal(f.asked.consultant, 1, 'consultant is not asked for agency questions');
      assert.equal(waitingReply.waiting.length, 0);
      assert.equal(waitingReply.steps[0]?.tool, 'approvals.list');
      assert.equal(waitingReply.steps[0]?.outcome, 'grant');
      assert.match(waitingReply.reply ?? '', /reminders\.add/);
      const seenByMisatoWaiting = JSON.parse(f.asked.misato[2]!).steps[0].result as {
        approvals: { shortId: string; tool: string; title: string }[];
      };
      assert.equal(seenByMisatoWaiting.approvals.length, 1);
      assert.equal(seenByMisatoWaiting.approvals[0]!.tool, 'reminders.add');
      assert.equal(seenByMisatoWaiting.approvals[0]!.title, 'Remind me on Tabgha to stretch');

      // 3. "Tabgha è online?" -> consultant not asked, agency.status runs Green, Italian reply grounded in tool result
      const statusReply = await r.chat('Tabgha è online?');
      assert.equal(f.asked.consultant, 1, 'consultant is not asked for base status questions');
      assert.equal(statusReply.waiting.length, 0);
      assert.equal(statusReply.steps[0]?.tool, 'agency.status');
      assert.equal(statusReply.steps[0]?.outcome, 'grant');
      assert.match(statusReply.reply ?? '', /Tabgha \(NERV-02\) è online/);
      const seenByMisatoStatus = JSON.parse(f.asked.misato[4]!).steps[0].result as {
        bases: { baseId: string; name: string; online: boolean; lastSeenLocal?: string }[];
      };
      assert.equal(seenByMisatoStatus.bases.length, 1);
      assert.equal(seenByMisatoStatus.bases[0]!.baseId, 'NERV-02');
      assert.equal(seenByMisatoStatus.bases[0]!.name, 'Tabgha');
      assert.equal(seenByMisatoStatus.bases[0]!.online, true);
      assert.ok(seenByMisatoStatus.bases[0]!.lastSeenLocal, 'lastSeenLocal is attached in local time');

      // 4. "which sorties are open?" -> consultant not asked, sorties.explain runs Green
      const sortiesReply = await r.chat('which sorties are open?');
      assert.equal(f.asked.consultant, 1, 'consultant is not asked for sortie questions');
      assert.equal(sortiesReply.waiting.length, 0);
      assert.equal(sortiesReply.steps[0]?.tool, 'sorties.explain');
      assert.equal(sortiesReply.steps[0]?.outcome, 'grant');
      assert.match(sortiesReply.reply ?? '', /Remind me on Tabgha to stretch/);
    } finally {
      await r.close();
      rmSync(home, { recursive: true, force: true });
      await f.close();
    }
  },
);

test('F-025-T03: filterConsultantInput and Runtime.useRemoteConsultant pass only Scrolls-allowed data and never vote', async () => {
  const tools = [
    { name: 'reminders.list', about: 'List reminders' },
    { name: 'reminders.add', about: 'Add reminder' },
    { name: 'reminders.cancel', about: 'Cancel reminder' },
  ];
  const policy = { deny: ['reminders.cancel'], localOnly: ['reminders.add'] };
  const localOut = filterConsultantInput(
    { request: 'Help', tainted: true, context: [{ request: 'a', tainted: true }], tools },
    policy,
    false,
  );
  assert.equal(localOut.allowed, true);
  assert.deepEqual(
    localOut.tools.map((t) => t.name),
    ['reminders.list', 'reminders.add'],
  );

  const remoteClean = filterConsultantInput(
    {
      request: 'Help',
      tainted: false,
      context: [
        { request: 'clean', tainted: false },
        { request: 'dirty', tainted: true },
      ],
      tools,
    },
    policy,
    true,
  );
  assert.equal(remoteClean.allowed, true);
  assert.deepEqual(
    remoteClean.tools.map((t) => t.name),
    ['reminders.list'],
  );
  assert.deepEqual(
    remoteClean.context.map((c) => c.request),
    ['clean'],
  );

  const remoteTainted = filterConsultantInput({ request: 'Help', tainted: true, tools }, policy, true);
  assert.equal(remoteTainted.allowed, false);

  const f = await fake('', [JSON.stringify({ reply: 'Done.' })]);
  const { r, close } = await runtimeWith(f.url, false, { deny: ['reminders.cancel'], localOnly: ['reminders.add'] });
  try {
    const received: { request: string; tools: string[] }[] = [];
    r.useRemoteConsultant({
      name: 'peer-consultant',
      advise: async (input) => {
        received.push({ request: input.request, tools: (input.tools ?? []).map((t) => t.name) });
        return { advice: 'Check the due date first.', model: 'peer-model' };
      },
    });
    const reply = await r.chat('Schedule a check');
    assert.equal(received.length, 1);
    assert.ok(!received[0]!.tools.includes('reminders.cancel'));
    assert.ok(!received[0]!.tools.includes('reminders.add'));
    const consult = (await r.events(reply.sortieId)).find((e) => e.kind === 'misato.consult');
    assert.ok(consult && consult.kind === 'misato.consult');
    assert.equal(consult.payload.advice, 'Check the due date first.');
    assert.match(f.asked.misato[0]!, /Check the due date first\./);
  } finally {
    await close();
    await f.close();
  }
});
