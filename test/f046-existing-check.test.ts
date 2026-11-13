import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Runtime } from '../src/runtime.ts';
import { matchExistingReminders, misatoAsk, waitingReply } from '../src/misato.ts';
import { toolDocs } from '../src/executors.ts';
import { card } from '../src/telegram.ts';
import type { Approval } from '../src/ledger.ts';

async function until(fn: () => boolean | Promise<boolean>, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('Timed out waiting');
}

interface AskedPrompt {
  who: 'misato' | 'casper';
  system: string;
  prompt: string;
}

async function withRuntime(
  plan: (asked: AskedPrompt) => string,
  fn: (runtime: Runtime, asked: AskedPrompt[]) => Promise<void>,
  scrolls?: Record<string, unknown>,
) {
  const asked: AskedPrompt[] = [];
  const model = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (c) => (raw += c))
      .on('end', () => {
        const body = JSON.parse(raw) as { messages: { content: string }[] };
        const system = body.messages[0]?.content ?? '';
        const prompt = body.messages.at(-1)?.content ?? '';
        const who = system.startsWith('You are Casper') ? 'casper' : 'misato';
        const entry: AskedPrompt = { who, system, prompt };
        asked.push(entry);
        const content =
          who === 'casper' ? '{"vote":"approve","reason":"Matches the owner request.","confidence":0.95}' : plan(entry);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
      });
  });
  await new Promise<void>((done) => model.listen(0, '127.0.0.1', done));
  const home = mkdtempSync(join(tmpdir(), 'nerv-f046-'));
  const port = (model.address() as { port: number }).port;
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      timeZone: 'Europe/Rome',
      brief: { at: '08:00' },
      models: { local: { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm' } },
    }),
  );
  if (scrolls) writeFileSync(join(home, 'scrolls.json'), JSON.stringify(scrolls), { mode: 0o600 });
  const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
  try {
    await runtime.ready();
    await fn(runtime, asked);
  } finally {
    await runtime.close();
    await new Promise<void>((done) => model.close(() => done()));
    rmSync(home, { recursive: true, force: true });
  }
}

test('F-046: matchExistingReminders, misatoAsk, waitingReply and Telegram card format', () => {
  const matched = matchExistingReminders(
    'Remind me to call the dentist tomorrow at 11',
    [
      { id: 'r1', title: 'Buy milk', due: '2030-02-03T09:00:00Z' },
      { id: 'r2', title: 'Call the dentist', due: '2030-02-03T10:00:00Z' },
    ],
    5,
  );
  assert.deepEqual(
    matched.map((r) => r.id),
    ['r2'],
  );

  const ask = misatoAsk(
    {
      request: 'Call the dentist at 11',
      history: [],
      tools: toolDocs,
      now: '2030-02-02T09:00:00Z',
      timeZone: 'Europe/Rome',
      reminders: [{ id: 'r2', title: 'Call the dentist', due: '2030-02-03T09:00:00Z' }],
    },
    'local',
  );
  assert.match(ask.system ?? '', /reminders\.update/);
  assert.match(ask.system ?? '', /memory\.edit/);
  const parsed = JSON.parse(ask.prompt) as { reminders: { id: string; dueLocal?: string }[] };
  assert.equal(parsed.reminders[0]!.id, 'r2');
  assert.match(parsed.reminders[0]!.dueLocal!, /10:00/);

  assert.match(
    waitingReply('en', 'memory.edit', { id: 'f1', oldText: "I don't like tea", text: 'I like tea' }),
    /I don't like tea → I like tea/,
  );
  assert.match(
    waitingReply('it', 'memory.edit', { id: 'f1', oldText: 'Mi piace il tè', text: 'Non mi piace il tè' }),
    /Mi piace il tè → Non mi piace il tè/,
  );

  const approval: Approval = {
    id: 'a1',
    expires: '2030-02-03T12:00:00Z',
    decision: null,
    card: {
      sortieId: 's1',
      actionId: 'act1',
      tool: 'memory.edit',
      args: { id: 'f1', oldText: "I don't like tea", text: 'I like tea' },
      effect: 'write-local',
      pattern: 'blue',
      sync: { value: 90, inputs: {} },
      reason: 'Pattern Blue always needs the owner.',
      verdicts: [],
      expires: '2030-02-03T12:00:00Z',
    },
  };
  assert.match(card(approval).text, /memory\.edit: “I don't like tea” → “I like tea”/);
});

test('F-046-T01/T02 (EN): reminders support new, same (no duplicate), and changed (reminders.update) through scheduler', async () => {
  const script: string[] = [
    // 1. New reminder
    '{"action":{"tool":"reminders.add","args":{"title":"Call the dentist","due":"2030-02-03T10:00:00+01:00"}}}',
    '{"reply":"New reminder added: Call the dentist on 3 February at 10:00."}',
    // 2. Same reminder: model attempts duplicate add -> runtime blocks -> model replies it already exists
    '{"action":{"tool":"reminders.add","args":{"title":"Call the dentist","due":"2030-02-03T10:00:00+01:00"}}}',
    '{"reply":"That reminder already exists: Call the dentist on 3 February 2030 at 10:00."}',
    // 3. Changed reminder: model sees existing reminder in prompt and proposes reminders.update
    '__UPDATE_DENTIST_11__',
    '{"reply":"Updated your existing reminder Call the dentist to 11:00."}',
  ];

  await withRuntime(
    (entry) => {
      const next = script.shift() ?? '{"reply":"ok"}';
      if (next === '__UPDATE_DENTIST_11__') {
        const p = JSON.parse(entry.prompt) as { reminders?: { id: string; title: string }[] };
        const id = p.reminders?.[0]?.id ?? 'missing';
        return JSON.stringify({
          action: { tool: 'reminders.update', args: { id, due: '2030-02-03T11:00:00+01:00' } },
        });
      }
      return next;
    },
    async (runtime, asked) => {
      // 1. New
      const addChat = await runtime.chat('Remind me to call the dentist on 3 February 2030 at 10');
      assert.match(addChat.reply!, /New reminder/);
      const list1 = await runtime.list();
      assert.equal(list1.length, 1);
      const dentistId = list1[0]!.id;

      // 2. Same (runtime sees matching reminder, passes it to Misato, and blocks duplicate add)
      const sameChat = await runtime.chat('Remind me to call the dentist on 3 February 2030 at 10');
      assert.equal(sameChat.steps[0]!.outcome, 'invalid');
      assert.match(sameChat.steps[0]!.error!, /already exists/);
      assert.match(sameChat.reply!, /already exists/);
      assert.equal((await runtime.list()).length, 1);

      // 3. Changed time -> reminders.update
      const misatoPromptBeforeUpdate = JSON.parse(asked.at(-1)!.prompt) as {
        reminders?: { id: string; title: string; dueLocal?: string }[];
      };
      assert.equal(misatoPromptBeforeUpdate.reminders?.[0]?.id, dentistId);

      const updateChat = await runtime.chat('Actually, call the dentist on 3 February 2030 at 11');
      assert.equal(updateChat.steps[0]!.tool, 'reminders.update');
      assert.equal(updateChat.steps[0]!.outcome, 'grant');
      assert.match(updateChat.reply!, /Updated/);
      const list2 = await runtime.list();
      assert.equal(list2.length, 1);
      assert.equal(list2[0]!.id, dentistId);
      assert.equal(Date.parse(list2[0]!.due), Date.parse('2030-02-03T11:00:00+01:00'));
    },
  );
});

test('F-046-T01 (Blue approval): reminders.update waits for owner approval when configured Blue', async () => {
  const script = ['__UPDATE_TITLE__', '{"reply":"Updated the reminder title."}'];
  await withRuntime(
    (entry) => {
      const next = script.shift() ?? '{"reply":"ok"}';
      if (next === '__UPDATE_TITLE__') {
        const p = JSON.parse(entry.prompt) as { reminders?: { id: string }[] };
        return JSON.stringify({
          action: { tool: 'reminders.update', args: { id: p.reminders?.[0]?.id, title: 'Call Dr. Rossi' } },
        });
      }
      return next;
    },
    async (runtime) => {
      const created = await runtime.add('Call the dentist', '2030-02-03T10:00:00+01:00');
      runtime.startResumer(50);
      const resumed: { reply?: string }[] = [];
      runtime.onResumed((r) => resumed.push(r));

      const chat = await runtime.chat('Change the dentist reminder title to Call Dr. Rossi');
      assert.equal(chat.waiting.length, 1);
      assert.equal(chat.waiting[0]!.tool, 'reminders.update');
      assert.equal((await runtime.list())[0]!.title, 'Call the dentist', 'not updated before approval');

      await runtime.decide(chat.waiting[0]!.approvalId, 'approve', 'api');
      await until(() => resumed.length === 1);
      assert.equal((await runtime.list())[0]!.id, created.id);
      assert.equal((await runtime.list())[0]!.title, 'Call Dr. Rossi');
      assert.match(resumed[0]!.reply!, /Updated/);
    },
    { blue: ['reminders.update'] },
  );
});

test('F-046-T02/T03 (EN & IT): facts support new, same (no duplicate), and changed (memory.edit old → new) through scheduler', async () => {
  const script: string[] = [
    // 1. EN new fact
    '{"action":{"tool":"memory.remember","args":{"text":"I don\'t like tea"}}}',
    '{"reply":"New fact saved: I don\'t like tea."}',
    // 2. EN same fact -> model tries memory.remember -> runtime blocks -> model replies it already exists
    '{"action":{"tool":"memory.remember","args":{"text":"I don\'t like tea"}}}',
    '{"reply":"That fact already exists: I don\'t like tea."}',
    // 3. EN contradicting fact -> memory.edit
    '__EDIT_EN__',
    '{"reply":"Updated your existing fact to: I like tea."}',
    // 4. IT new fact
    '{"action":{"tool":"memory.remember","args":{"text":"Il mio gatto si chiama Milo"}}}',
    '{"reply":"Nuovo fatto salvato: Il mio gatto si chiama Milo."}',
    // 5. IT same fact -> Misato replies directly without proposing
    '{"reply":"Esiste già: Il mio gatto si chiama Milo."}',
    // 6. IT changed fact -> memory.edit
    '__EDIT_IT__',
    '{"reply":"Ho aggiornato il fatto esistente: Il mio gatto si chiama Luna."}',
  ];

  await withRuntime(
    (entry) => {
      const next = script.shift() ?? '{"reply":"ok"}';
      if (next === '__EDIT_EN__') {
        const p = JSON.parse(entry.prompt) as { memory?: { id: string }[] };
        return JSON.stringify({
          action: { tool: 'memory.edit', args: { id: p.memory?.[0]?.id, text: 'I like tea' } },
        });
      }
      if (next === '__EDIT_IT__') {
        const p = JSON.parse(entry.prompt) as { memory?: { id: string }[] };
        return JSON.stringify({
          action: { tool: 'memory.edit', args: { id: p.memory?.[0]?.id, text: 'Il mio gatto si chiama Luna' } },
        });
      }
      return next;
    },
    async (runtime) => {
      runtime.startResumer(50);
      const resumed: { reply?: string }[] = [];
      runtime.onResumed((r) => resumed.push(r));

      // 1. EN New fact
      const enNew = await runtime.chat("Remember that I don't like tea");
      assert.equal(enNew.waiting.length, 1);
      assert.equal(enNew.waiting[0]!.tool, 'memory.remember');
      await runtime.decide(enNew.waiting[0]!.approvalId, 'approve', 'api');
      await until(() => resumed.length === 1);

      // 2. EN Same fact (blocked by guard, no second approval card)
      const enSame = await runtime.chat("Remember that I don't like tea");
      assert.equal(enSame.waiting.length, 0);
      assert.equal(enSame.steps[0]!.outcome, 'invalid');
      assert.match(enSame.reply!, /already exists/);

      // 3. EN Changed/contradicting fact -> memory.edit with old → new on card
      const enEdit = await runtime.chat('Actually I like tea');
      assert.equal(enEdit.waiting.length, 1);
      assert.equal(enEdit.waiting[0]!.tool, 'memory.edit');
      assert.match(enEdit.reply!, /I don't like tea → I like tea/);
      const enCards = await runtime.approvals();
      assert.equal(enCards.length, 1);
      assert.match(card(enCards[0]!).text, /memory\.edit: “I don't like tea” → “I like tea”/);
      await runtime.decide(enEdit.waiting[0]!.approvalId, 'approve', 'api');
      await until(() => resumed.length === 2);
      assert.match(resumed[1]!.reply!, /Updated/);

      const enFacts = await runtime.lilith.list();
      assert.equal(enFacts.length, 1);
      assert.equal(enFacts[0]!.text, 'I like tea');
      assert.deepEqual(
        ((await runtime.lilith.history(enFacts[0]!.id)) as { kind: string }[]).map((h) => h.kind),
        ['created', 'edited'],
      );

      // 4. IT New fact
      const itNew = await runtime.chat('Ricorda che il mio gatto si chiama Milo');
      assert.equal(itNew.waiting.length, 1);
      await runtime.decide(itNew.waiting[0]!.approvalId, 'approve', 'api');
      await until(() => resumed.length === 3);

      // 5. IT Same fact
      const itSame = await runtime.chat('Ricorda che il mio gatto si chiama Milo');
      assert.equal(itSame.waiting.length, 0);
      assert.match(itSame.reply!, /Esiste già/);

      // 6. IT Changed fact -> memory.edit with old → new
      const itEdit = await runtime.chat('In realtà il mio gatto si chiama Luna');
      assert.equal(itEdit.waiting.length, 1);
      assert.equal(itEdit.waiting[0]!.tool, 'memory.edit');
      assert.match(itEdit.reply!, /Il mio gatto si chiama Milo → Il mio gatto si chiama Luna/);
      await runtime.decide(itEdit.waiting[0]!.approvalId, 'approve', 'api');
      await until(() => resumed.length === 4);
      assert.match(resumed[3]!.reply!, /aggiornato/);

      const allFacts = await runtime.lilith.list();
      assert.equal(allFacts.length, 2);
      assert.ok(allFacts.some((f) => f.text === 'Il mio gatto si chiama Luna'));
      assert.ok(!allFacts.some((f) => f.text === 'Il mio gatto si chiama Milo'));
    },
  );
});

test('F-046-T01/T02 (IT): reminders support new, same, and changed (reminders.update) in Italian', async () => {
  const script: string[] = [
    '{"action":{"tool":"reminders.add","args":{"title":"Chiamare il dentista","due":"2030-02-03T10:00:00+01:00"}}}',
    '{"reply":"Nuovo promemoria aggiunto: Chiamare il dentista il 3 febbraio alle 10:00."}',
    '{"reply":"Questo promemoria esiste già: Chiamare il dentista il 3 febbraio 2030 alle 10:00."}',
    '__UPDATE_IT__',
    '{"reply":"Ho aggiornato il promemoria esistente alle 11:00."}',
  ];

  await withRuntime(
    (entry) => {
      const next = script.shift() ?? '{"reply":"ok"}';
      if (next === '__UPDATE_IT__') {
        const p = JSON.parse(entry.prompt) as { reminders?: { id: string }[] };
        return JSON.stringify({
          action: { tool: 'reminders.update', args: { id: p.reminders?.[0]?.id, due: '2030-02-03T11:00:00+01:00' } },
        });
      }
      return next;
    },
    async (runtime) => {
      const r1 = await runtime.chat('Ricordami di chiamare il dentista il 3 febbraio 2030 alle 10');
      assert.match(r1.reply!, /Nuovo promemoria/);
      assert.equal((await runtime.list()).length, 1);

      const r2 = await runtime.chat('Ricordami di chiamare il dentista il 3 febbraio 2030 alle 10');
      assert.match(r2.reply!, /esiste già/);
      assert.equal((await runtime.list()).length, 1);

      const r3 = await runtime.chat('Sposta il dentista il 3 febbraio 2030 alle 11');
      assert.equal(r3.steps[0]!.tool, 'reminders.update');
      assert.equal(r3.steps[0]!.outcome, 'grant');
      assert.match(r3.reply!, /aggiornato/);
      const items = await runtime.list();
      assert.equal(items.length, 1);
      assert.equal(Date.parse(items[0]!.due), Date.parse('2030-02-03T11:00:00+01:00'));
    },
  );
});
