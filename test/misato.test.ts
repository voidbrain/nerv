import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  detectToolDomains,
  filterToolsByIntent,
  misatoAsk,
  parsePlan,
  validateReminderTitle,
  MAX_STEPS,
} from '../src/misato.ts';
import { measureMisatoPrompt } from '../src/prompt-samples.ts';
import { toolDocs } from '../src/executors.ts';
import { KajiLink } from '../src/kaji-link.ts';
import { Registry, createRootKey, signRecord, unlockRootKey, type RegistryBody } from '../src/kaji.ts';
import { completeRemotePrint, receivePartTransfer, type PartTransfer } from '../src/print-transfer.ts';
import { Runtime } from '../src/runtime.ts';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';
test('Misato is asked for one JSON step with the tools, the time and the latest steps; its reply is read strictly', () => {
  const ask = misatoAsk(
    {
      request: 'Ricordami di chiamare Ada',
      history: [{ tool: 'reminders.list', args: {}, outcome: 'grant', result: [] }],
      tools: toolDocs,
      now: '2030-01-01T08:00:00.000Z',
      timeZone: 'Europe/Rome',
    },
    'local',
  );
  assert.equal(ask.privacy, 'local-only');
  assert.equal(ask.route, 'local');
  assert.match(ask.system!, /Now: 2030-01-01T08:00:00.000Z\. The owner's time zone: Europe\/Rome/);
  assert.match(ask.system!, /reminders\.add \(write-local\)/);
  assert.match(ask.system!, /same language as the "request" field/);
  assert.match(ask.system!, /"dueLocal" already in the owner's time zone \(Europe\/Rome\)/);
  assert.deepEqual(JSON.parse(ask.prompt), {
    request: 'Ricordami di chiamare Ada',
    steps: [{ tool: 'reminders.list', args: {}, outcome: 'grant', result: [] }],
  });
  assert.equal(
    misatoAsk({ request: 'x', history: [], tools: toolDocs, now: 'n', timeZone: 'z' }, 'cloud').privacy,
    'any',
  );
  const due = JSON.parse(
    misatoAsk(
      {
        request: 'x',
        history: [
          {
            tool: 'reminders.list',
            args: {},
            outcome: 'grant',
            result: [{ title: 'Insurance', due: '2030-01-15T08:00:00.000Z' }],
          },
        ],
        tools: toolDocs,
        now: 'n',
        timeZone: 'Europe/Rome',
      },
      'local',
    ).prompt,
  ).steps[0].result[0];
  assert.match(
    due.dueLocal,
    /15 January 2030 at 09:00/,
    "UTC is converted to the owner's zone in code, not by the model",
  );
  const long = Array.from({ length: 12 }, (_, i) => ({
    tool: 'reminders.list',
    args: {},
    outcome: 'grant' as const,
    result: 'r'.repeat(1500) + i,
  }));
  const kept = JSON.parse(
    misatoAsk({ request: 'x', history: long, tools: toolDocs, now: 'n', timeZone: 'Europe/Rome' }, 'local').prompt,
  ).steps as { result: string }[];
  assert.ok(kept.length < 12 && kept.at(-1)!.result.endsWith('11'), 'the newest steps are kept');
  assert.deepEqual(parsePlan('ok {"action":{"tool":"reminders.list"}}'), {
    action: { tool: 'reminders.list', args: {} },
  });
  assert.deepEqual(parsePlan('{"reply":" Fatto. "}'), { reply: 'Fatto.' });
  for (const bad of [
    'nothing',
    '{"reply":""}',
    '{"action":{"tool":"x","args":[]}}',
    '{"action":{"args":{}}}',
    '{"reply":"a","action":{"tool":"x"}}',
    '{"reply":',
  ])
    assert.equal(parsePlan(bad), undefined, bad);
});
test('fleet chat results are kept on the local model route even when Misato is configured for cloud', () => {
  const ask = misatoAsk(
    {
      request: 'How many spare motors remain?',
      history: [
        {
          tool: 'fleet.chat',
          args: { phrase: 'How many spare motors remain?' },
          outcome: 'grant',
          result: 'There are 2 spare motors.',
        },
      ],
      tools: toolDocs,
      now: '2030-01-01T08:00:00.000Z',
      timeZone: 'Europe/Rome',
    },
    'cloud',
  );
  assert.equal(ask.privacy, 'local-only');
  assert.equal(ask.route, 'local');
  assert.match(ask.prompt, /There are 2 spare motors/);
});
/** A loopback model: Casper answers from one script, Misato from another; every request is recorded. */
/** The handoff arguments of the last step in a planner prompt, copied as the planner does. */
const handoffIn = (prompt: string) =>
  (JSON.parse(prompt) as { steps: { result?: { handoff?: Record<string, unknown> } }[] }).steps.at(-1)!.result!
    .handoff!;
/** A scripted planner answer, or one built from the prompt it answers (to copy a step's result, as the model does). */
type Scripted = string | ((prompt: string) => string);
async function models(
  misato: Scripted[],
  casper: string | ((prompt: string) => string) = '{"vote":"approve","reason":"Matches.","confidence":0.9}',
) {
  const asked: { who: string; model: string; prompt: string; system: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req
      .on('data', (c) => (body += c))
      .on('end', () => {
        const r = JSON.parse(body) as { model: string; messages: { role: string; content: string }[] };
        const who = r.messages[0]!.content.startsWith('You are Casper') ? 'casper' : 'misato';
        asked.push({ who, model: r.model, prompt: r.messages.at(-1)!.content, system: r.messages[0]!.content });
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    who === 'casper'
                      ? typeof casper === 'function'
                        ? casper(r.messages.at(-1)!.content)
                        : casper
                      : (() => {
                          const next = misato.shift();
                          return typeof next === 'function'
                            ? next(r.messages.at(-1)!.content)
                            : (next ?? '{"reply":"done"}');
                        })(),
                },
                finish_reason: 'stop',
              },
            ],
          }),
        );
      });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    asked,
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
async function agent(
  script: Scripted[],
  work: (
    r: Runtime,
    m: Awaited<ReturnType<typeof models>>,
    base: string,
    headers: Record<string, string>,
    home: string,
  ) => Promise<void>,
  scrolls?: object,
  casper?: string | ((prompt: string) => string),
  setup?: (home: string) => void,
) {
  const m = await models(script, casper);
  const home = mkdtempSync(join(tmpdir(), 'nerv-misato-'));
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      models: {
        local: { baseUrl: m.url, model: 'gemma4:12b' },
        roles: { misato: { route: 'local', model: 'qwen2.5-coder:14b' }, casper: { model: 'gemma4:12b' } },
      },
    }),
  );
  if (scrolls) writeFileSync(join(home, 'scrolls.json'), JSON.stringify(scrolls), { mode: 0o600 });
  setup?.(home);
  // No test opens the real Bambu Connect: the nervous process records hand-offs to this file instead.
  const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home, {
    bambuLaunchLog: join(home, 'bambu-launches.log'),
  });
  const token = 'c'.repeat(32);
  const server = makeServer(runtime, token);
  try {
    await runtime.ready();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    await work(
      runtime,
      m,
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      },
      home,
    );
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await runtime.close();
    await m.close();
    rmSync(home, { recursive: true, force: true });
  }
}
test('through every process: an Italian request is planned by Misato, gated, executed and answered in Italian', async () => {
  await agent(
    [
      '{"action":{"tool":"reminders.add","args":{"title":"Rinnovare assicurazione","due":"2030-01-15T09:00:00+01:00"}}}',
      '{"reply":"Fatto: ti ricorderò di rinnovare l\'assicurazione il 15 gennaio alle 9."}',
    ],
    async (runtime, m, base, headers) => {
      const res = await fetch(base + '/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: "Ricordami di rinnovare l'assicurazione il 15 gennaio 2030 alle 9" }),
      });
      const chat = (await res.json()) as {
        sortieId: string;
        reply: string;
        steps: { tool: string; outcome: string; result: { title: string } }[];
        waiting: unknown[];
      };
      assert.equal(res.status, 200);
      assert.match(chat.reply, /^Fatto/);
      assert.deepEqual(chat.waiting, []);
      assert.deepEqual(
        chat.steps.map((s) => [s.tool, s.outcome, s.result.title]),
        [['reminders.add', 'grant', 'Rinnovare assicurazione']],
      );
      assert.equal((await runtime.list()).length, 1);
      assert.deepEqual(
        m.asked.map((a) => [a.who, a.model]),
        [
          ['misato', 'qwen2.5-coder:14b'],
          ['misato', 'qwen2.5-coder:14b'],
        ],
        'Green work never asks Casper',
      );
      assert.equal(
        (JSON.parse(m.asked[1]!.prompt) as { steps: { outcome: string }[] }).steps[0]!.outcome,
        'grant',
        'Misato sees the outcome of its step',
      );
      assert.deepEqual(
        (await runtime.events(chat.sortieId)).map((e) => e.kind),
        [
          'sortie.opened',
          'misato.request',
          'ballot',
          'grant.issued',
          'grant.used',
          'action.done',
          'misato.step',
          'misato.reply',
          'sortie.done',
        ],
      );
      assert.ok(!JSON.stringify(chat).includes('grantId'));
      assert.equal(
        (await fetch(base + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ message: '' }) })).status,
        400,
      );
      assert.equal((await fetch(base + '/api/chat', { method: 'POST', body: '{}' })).status, 401);
    },
  );
});
test('fleet chat records crashes, answers inventory questions, and stores battery notes through the gated chat path', async () => {
  const setup = (home: string) => {
    const store = new Store(join(home, 'nerv.sqlite'));
    store.fleet.addDrone({ name: 'TestQuad' });
    store.fleet.setPart({
      droneIdOrName: 'TestQuad',
      category: 'motor',
      position: 'rear-left',
      componentModel: 'Fictional 2207 1750KV',
    });
    store.fleet.upsertSpare({
      componentModel: 'Fictional 2207 1750KV',
      category: 'motor',
      newCount: 2,
      usedCount: 1,
    });
    store.batteries.register({
      packNumber: 42,
      series: 'blu',
      brand: 'Invented',
      batteryType: 'LiPo',
      cellCount: 2,
      capacityMah: 450,
      purchaseDate: '2026-01-01',
      initialResistanceMohm: [4.1, 4.2],
    });
    store.close();
  };
  await agent(
    [
      '{"action":{"tool":"fleet.chat","args":{"phrase":"ho crashato TestQuad, motore sinistro inferiore rotto (scorta nuova)"}}}',
      '{"action":{"tool":"fleet.chat","args":{"phrase":"quale avevo rotto l\'ultima volta?"}}}',
      '{"action":{"tool":"fleet.chat","args":{"phrase":"quanti ne sono rimasti di scorta?"}}}',
      '{"reply":"Crash registrato; danno e scorte verificati."}',
      '{"action":{"tool":"fleet.chat","args":{"phrase":"La batteria 42 blu presenta danni ma sembra ancora buona"}}}',
      '{"reply":"Nota danni registrata."}',
      '{"action":{"tool":"fleet.chat","args":{"phrase":"crashed TestQuad, rear-left motor broken"}}}',
      '{"reply":"The crash was recorded."}',
    ],
    async (runtime, m, _base, _headers, home) => {
      const crash = await runtime.chat(
        'ho crashato TestQuad, motore sinistro inferiore rotto. Quale avevo rotto l’ultima volta? Quanti ne restano di scorta?',
      );
      assert.deepEqual(
        crash.steps.map((step) => [step.tool, step.outcome]),
        [
          ['fleet.chat', 'grant'],
          ['fleet.chat', 'grant'],
          ['fleet.chat', 'grant'],
        ],
      );
      assert.match(JSON.stringify(crash.steps), /Recorded crash for TestQuad/);
      assert.match(JSON.stringify(crash.steps), /TestQuad motor \(rear-left\)/);
      assert.match(JSON.stringify(crash.steps), /1 new, 1 used/);
      assert.equal((await runtime.events(crash.sortieId)).filter((event) => event.kind === 'grant.used').length, 3);

      const battery = await runtime.chat('La batteria 42 blu presenta danni ma sembra ancora buona.');
      assert.deepEqual(
        battery.steps.map((step) => [step.tool, step.outcome]),
        [['fleet.chat', 'grant']],
      );
      assert.match(JSON.stringify(battery.steps), /Recorded damage note/);

      const english = await runtime.chat('crashed TestQuad, rear-left motor broken');
      assert.deepEqual(
        english.steps.map((step) => [step.tool, step.outcome]),
        [['fleet.chat', 'grant']],
      );
      assert.match(JSON.stringify(english.steps), /Recorded crash for TestQuad/);
      assert.ok(
        m.asked.every((request) => request.who === 'misato'),
        'Green writes never ask Casper',
      );

      const persisted = new Store(join(home, 'nerv.sqlite'));
      try {
        assert.equal(persisted.fleet.listCrashes({ droneName: 'TestQuad' }).length, 2);
        const spare = persisted.fleet.getSpare('Fictional 2207 1750KV');
        assert.ok(spare);
        assert.equal(spare.newCount, 1);
        assert.equal(spare.usedCount, 1);
        const [pack] = persisted.batteries.findByNumberAndSeries(42, 'blu');
        assert.ok(pack);
        const [note] = persisted.batteries.notes(pack.id);
        assert.ok(note);
        assert.match(note.note, /La batteria 42 blu presenta danni/);
      } finally {
        persisted.close();
      }
    },
    undefined,
    undefined,
    setup,
  );
});
test('Scrolls can deny fleet chat before it mutates local records', async () => {
  const setup = (home: string) => {
    const store = new Store(join(home, 'nerv.sqlite'));
    store.fleet.addDrone({ name: 'TestQuad' });
    store.fleet.setPart({
      droneIdOrName: 'TestQuad',
      category: 'motor',
      position: 'rear-left',
      componentModel: 'Fictional 2207 1750KV',
    });
    store.close();
  };
  await agent(
    [
      '{"action":{"tool":"fleet.chat","args":{"phrase":"ho crashato TestQuad, motore sinistro inferiore rotto"}}}',
      '{"reply":"La registrazione è stata rifiutata dalle regole."}',
    ],
    async (runtime, _m, _base, _headers, home) => {
      const result = await runtime.chat('ho crashato TestQuad, motore sinistro inferiore rotto');
      assert.deepEqual(
        result.steps.map((step) => [step.tool, step.outcome]),
        [['fleet.chat', 'reject']],
      );
      const persisted = new Store(join(home, 'nerv.sqlite'));
      try {
        assert.equal(persisted.fleet.listCrashes().length, 0);
      } finally {
        persisted.close();
      }
    },
    { deny: ['fleet.chat'] },
    undefined,
    setup,
  );
});
test('F-098-T06: fleet edits from chat go through the gated fleet.chat path into the real store', async () => {
  const setup = (home: string) => {
    const store = new Store(join(home, 'nerv.sqlite'));
    store.fleet.addDrone({ name: 'TestQuad' });
    store.fleet.setPart({
      droneIdOrName: 'TestQuad',
      category: 'motor',
      position: 'front-left',
      componentModel: 'Fictional 2207 1750KV',
    });
    store.close();
  };
  await agent(
    [
      '{"action":{"tool":"fleet.chat","args":{"phrase":"nuovo drone Ghost, frame Fictional 5, motori Fictional 2207 1750KV"}}}',
      '{"reply":"Ghost aggiunto."}',
      '{"action":{"tool":"fleet.chat","args":{"phrase":"replaced TestQuad\'s front-left motor with Fictional 2207 1950KV"}}}',
      '{"reply":"Motor replaced."}',
      '{"action":{"tool":"fleet.chat","args":{"phrase":"I have 3 new Fictional 2207 1950KV motors"}}}',
      '{"reply":"Stock set."}',
    ],
    async (runtime, m, _base, _headers, home) => {
      for (const message of [
        'nuovo drone Ghost, frame Fictional 5, motori Fictional 2207 1750KV',
        "replaced TestQuad's front-left motor with Fictional 2207 1950KV",
        'I have 3 new Fictional 2207 1950KV motors',
      ]) {
        const result = await runtime.chat(message);
        assert.deepEqual(
          result.steps.map((step) => [step.tool, step.outcome]),
          [['fleet.chat', 'grant']],
          message,
        );
      }
      assert.ok(
        m.asked.every((request) => request.who === 'misato'),
        'Green writes never ask Casper',
      );
      const persisted = new Store(join(home, 'nerv.sqlite'));
      try {
        assert.equal(persisted.fleet.listParts('Ghost').length, 5);
        assert.deepEqual(
          persisted.fleet
            .listParts('TestQuad')
            .map((p) => [p.componentModel, p.status])
            .sort(),
          [
            ['Fictional 2207 1750KV', 'removed'],
            ['Fictional 2207 1950KV', 'installed'],
          ],
        );
        assert.equal(persisted.fleet.getSpare('Fictional 2207 1950KV')?.newCount, 3);
        assert.equal(persisted.fleet.getSpare('Fictional 5')?.newCount, 0);
      } finally {
        persisted.close();
      }
    },
    undefined,
    undefined,
    setup,
  );
});
test('F-098-T06: Scrolls can deny fleet edits from chat before they change the fleet', async () => {
  await agent(
    [
      '{"action":{"tool":"fleet.chat","args":{"phrase":"new drone Ghost, motors Fictional 2207 1750KV"}}}',
      '{"reply":"Refused by the rules."}',
    ],
    async (runtime, _m, _base, _headers, home) => {
      const result = await runtime.chat('new drone Ghost, motors Fictional 2207 1750KV');
      assert.deepEqual(
        result.steps.map((step) => [step.tool, step.outcome]),
        [['fleet.chat', 'reject']],
      );
      const persisted = new Store(join(home, 'nerv.sqlite'));
      try {
        assert.equal(persisted.fleet.listDrones().length, 0);
      } finally {
        persisted.close();
      }
    },
    { deny: ['fleet.chat'] },
  );
});
test("an unreadable plan is shown back to Misato; a Blue action asks Casper, and its card ends the turn with the service's own waiting reply", async () => {
  await agent(
    [
      'sure, I will send it',
      '{"action":{"tool":"reminders.add","args":{"title":"Email Ada","due":"2030-01-15T09:00:00+01:00"}}}',
    ],
    async (runtime, m) => {
      const chat = await runtime.chat('Remind me to email Ada');
      assert.deepEqual(
        chat.steps.map((s) => s.outcome),
        ['invalid', 'approval'],
      );
      assert.equal(chat.waiting.length, 1);
      assert.match(chat.steps[1]!.reason!, /NOT done yet/);
      assert.equal(chat.waiting[0]!.tool, 'reminders.add');
      // Owner report 2026-11-04: asked again after the card, the model claimed the action was already confirmed. The model
      // is no longer asked: the reply is fixed, in the request's language, and never says the action happened.
      assert.equal(
        chat.reply,
        'Waiting for your approval: reminders.add (“Email Ada”). The card has the details; I will carry on once you decide.',
      );
      assert.deepEqual(
        m.asked.map((a) => [a.who, a.model]),
        [
          ['misato', 'qwen2.5-coder:14b'],
          ['misato', 'qwen2.5-coder:14b'],
          ['casper', 'gemma4:12b'],
        ],
      );
      const cards = await runtime.approvals();
      assert.equal(cards.length, 1);
      assert.equal(cards[0]!.card.tool, 'reminders.add');
    },
    { blue: ['reminders.add'] },
  );
});
test('the loop stops at the step limit and the sortie closes failed when nothing ran', async () => {
  await agent(
    Array.from({ length: MAX_STEPS + 2 }, () => 'not a plan'),
    async (runtime) => {
      const chat = await runtime.chat('Keep listing');
      assert.equal(chat.steps.length, MAX_STEPS);
      assert.match(chat.error!, /Step limit/);
      assert.equal(chat.reply, undefined);
      assert.equal((await runtime.events(chat.sortieId)).at(-1)!.kind, 'sortie.failed');
    },
  );
});
test('a reject from the gate goes back to Misato with its reason, and nothing runs', async () => {
  await agent(
    [
      '{"action":{"tool":"reminders.cancel","args":{"id":"r1"}}}',
      '{"reply":"I could not cancel it: the owner\'s rules deny that tool."}',
    ],
    async (runtime, m) => {
      const chat = await runtime.chat('Cancel my reminder');
      assert.deepEqual(
        chat.steps.map((s) => [s.outcome, s.reason]),
        [['reject', 'melchior: Tool denied by the Scrolls.']],
      );
      // B-009: a removal is checked by Casper too, so Misato's prompts are found by role, not by position.
      assert.match(
        JSON.parse(m.asked.filter((a) => a.who === 'misato')[1]!.prompt).steps[0].reason,
        /denied by the Scrolls/,
      );
      assert.deepEqual(
        (await runtime.events(chat.sortieId)).map((e) => e.kind),
        ['sortie.opened', 'misato.request', 'ballot', 'misato.step', 'misato.reply', 'sortie.done'],
      );
    },
    { deny: ['reminders.cancel'] },
  );
});
test('without any model route, chat says what to configure instead of blaming the cloud route', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-noroute-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en' }));
  const runtime = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
  try {
    await runtime.ready();
    const chat = await runtime.chat('Remind me');
    assert.match(chat.error!, /No model route for Misato: add models\.local/);
    assert.equal((await runtime.events(chat.sortieId)).at(-1)!.kind, 'sortie.failed');
  } finally {
    await runtime.close();
    rmSync(home, { recursive: true, force: true });
  }
});
test('a short follow-up keeps its conversation: "delete all" → Misato asks → "sì" cancels them in one reversible action', async () => {
  const script: string[] = [];
  await agent(script, async (runtime, m) => {
    const a = await runtime.add('Bere acqua', '2030-01-01T09:00:00Z'),
      b = await runtime.add('Chiamare Ada', '2030-01-02T09:00:00Z');
    script.push(
      '{"action":{"tool":"reminders.list","args":{}}}',
      '{"reply":"Hai 2 promemoria. Li cancello tutti?"}',
      `{"action":{"tool":"reminders.cancel","args":{"ids":["${a.id}","${b.id}"]}}}`,
      '{"reply":"Fatto: cancellati entrambi."}',
    );
    const first = await runtime.chat('cancella tutti i promemoria', 'telegram:1111');
    assert.equal(first.reply, 'Hai 2 promemoria. Li cancello tutti?');
    const second = await runtime.chat('sì', 'telegram:1111');
    const prompt = JSON.parse(m.asked.filter((a) => a.who === 'misato').at(-2)!.prompt) as {
      earlier: { request: string; reply: string }[];
      request: string;
    };
    assert.equal(prompt.earlier.length, 1);
    assert.equal(prompt.earlier[0]!.request, 'cancella tutti i promemoria');
    assert.equal(prompt.earlier[0]!.reply, 'Hai 2 promemoria. Li cancello tutti?');
    assert.equal(prompt.request, 'sì');
    assert.deepEqual(
      second.steps.map((s) => [s.tool, s.outcome]),
      [['reminders.cancel', 'grant']],
      'one Green action: cancel has an inverse now',
    );
    assert.deepEqual((second.steps[0]!.result as { cancelled: string[] }).cancelled.sort(), [a.id, b.id].sort());
    assert.equal((await runtime.pendingReminders()).length, 0);
    const other = await runtime.chat('sì', 'telegram:2222');
    void other;
    assert.equal(
      (JSON.parse(m.asked.at(-1)!.prompt) as { earlier?: unknown }).earlier,
      undefined,
      'another conversation does not see this one',
    );
  });
});
test('a tool Misato was not offered (a misspelling) goes back to Misato, never to the owner as a card', async () => {
  await agent(
    [
      '{"action":{"tool":"memore.remember","args":{"text":"I drink coffee at 8"}}}',
      '{"action":{"tool":"memory.remember","args":{"text":"I drink coffee at 8"}}}',
      '{"reply":"Waiting for your OK."}',
    ],
    async (runtime, m) => {
      const chat = await runtime.chat('I always drink coffee at 8', 'cli');
      assert.deepEqual(
        chat.steps.map((s) => [s.tool, s.outcome]),
        [
          ['memore.remember', 'invalid'],
          ['memory.remember', 'approval'],
        ],
      );
      assert.match(chat.steps[0]!.error!, /Unknown tool "memore\.remember"\. Use exactly one of: .*memory\.remember/);
      assert.deepEqual(
        (await runtime.approvals()).map((a) => a.card.tool),
        ['memory.remember'],
        'only the real tool reaches the owner',
      );
      void m;
    },
  );
});
test('"move the brief to 9": Misato changes the schedule with one Green, reversible action; nothing security-relevant is reachable', async () => {
  const { readSchedule, readConfig } = await import('../src/config.ts');
  await agent(
    [
      '{"action":{"tool":"settings.schedule","args":{"brief":"09:00","instrumentality":"idle"}}}',
      '{"reply":"Il brief arriverà alle 9."}',
    ],
    async (runtime, m, _base, _headers) => {
      const chat = await runtime.chat(
        'sposta il brief alle 9 e fai instrumentality quando sono inattivo',
        'telegram:1',
      );
      assert.deepEqual(
        chat.steps.map((s) => [s.tool, s.outcome]),
        [['settings.schedule', 'grant']],
      );
      assert.deepEqual(chat.steps[0]!.result as { previous: unknown; now: unknown }, {
        previous: { brief: 'off', instrumentality: 'off' },
        now: { brief: '09:00', instrumentality: 'idle' },
      });
      void m;
    },
  );
  // The executor only touches the two schedules and refuses anything else.
  const { mkdtempSync: mk, writeFileSync: wf, rmSync: rm } = await import('node:fs');
  const { join: j } = await import('node:path');
  const { tmpdir: td } = await import('node:os');
  const home = mk(j(td(), 'nerv-sched-'));
  wf(j(home, 'config.json'), JSON.stringify({ language: 'it', models: {} }));
  const { Store } = await import('../src/store.ts');
  const store = new Store(':memory:', undefined, { home });
  try {
    const run = (args: Record<string, unknown>) =>
      store.runAction(store.ledger.openSortie('owner', 's', 'trusted'), {
        tool: 'settings.schedule',
        args,
        stage: 'production',
      });
    assert.equal(run({ brief: '08:30' }).pattern, 'green');
    assert.deepEqual(readSchedule(home), { brief: '08:30', instrumentality: 'off' });
    assert.equal(readConfig(home).language, 'it', 'other settings are kept');
    for (const bad of [
      {},
      { brief: '25:00' },
      { instrumentality: 'sometimes' },
      { models: {} },
      { telegram: { chatId: 1 } },
    ])
      assert.ok(run(bad).error, JSON.stringify(bad));
    run({ brief: 'off' });
    assert.equal(readSchedule(home).brief, 'off');
  } finally {
    store.close();
    rm(home, { recursive: true, force: true });
  }
});
test("the waiting reply speaks the request's language, falls back to the conversation, and names what waits", async () => {
  const { requestLanguage, waitingReply } = await import('../src/misato.ts');
  assert.equal(requestLanguage('Ricordami di chiamare Ada domani alle 9'), 'it');
  assert.equal(requestLanguage('Remember that I drink coffee at 8'), 'en');
  assert.equal(requestLanguage('sì', ['Vuoi che li cancelli tutti?']), 'it');
  assert.equal(requestLanguage('ok', [], 'it'), 'it');
  assert.equal(
    waitingReply('it', 'memory.remember', { text: 'Bevo caffè alle 8' }),
    'In attesa della tua approvazione: memory.remember (“Bevo caffè alle 8”). I dettagli sono nella card; proseguo appena decidi.',
  );
  assert.doesNotMatch(waitingReply('en', 'reminders.cancel', { ids: ['a', 'b'] }), /done|confirmed|approved/i);
});
test('B-167: short Italian requests read as Italian, English ones stay English, with no earlier exchanges', async () => {
  const { requestLanguage } = await import('../src/misato.ts');
  // The owner uses NERV in Italian: short imperatives and questions, often with a name or a word English shares ("i", "a", "in").
  for (const request of [
    'quante batterie devo caricare?',
    'stampa i piedini di Smoke',
    'accendi la luce',
    'accendi luce cucina',
    'spegni il ventilatore per 2 ore',
    'spegni tutto',
    'aggiungi Rocca Calascio al trip di agosto',
    'ricordami di bere acqua tra 5 minuti',
    'controlla la mail di oggi',
    'elenca i promemoria',
    'mostra i droni',
    'quanto latte ho in frigo?',
    'a che ora parto?',
    'carica Smoke',
  ])
    assert.equal(requestLanguage(request), 'it', request);
  for (const request of [
    'how many batteries do I need to charge?',
    'print the AOS feet',
    "print Smoke's feet",
    'turn on the light',
    'turn off the fan for 2 hours',
    'add Rocca Calascio to the August trip',
    'remind me to drink water in 5 minutes',
    "check today's mail",
    'list my drones',
    'I have 3 new Testmot motors',
    'how much milk is in the fridge?',
    'add pasta and pizza to the pantry',
    'turn on the radio',
  ])
    assert.equal(requestLanguage(request), 'en', request);
});
test("B-168: a request with no language signal and no earlier exchange follows the owner's config.language (chat → planner → Misato)", async () => {
  for (const [language, expected] of [
    ['it', /Write the reply in Italian/],
    ['en', /Write the reply in English/],
  ] as const)
    await agent(
      ['{"reply":"Ok."}'],
      async (runtime, m) => {
        await runtime.chat('ok');
        const system = m.asked.find((a) => /Write the reply in/.test(a.system))?.system ?? '';
        assert.match(system, expected, language);
      },
      undefined,
      undefined,
      (home) => {
        const path = join(home, 'config.json');
        writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), language }));
      },
    );
});
test('B-167 review: a request with no listed word follows the earlier exchanges; Italian "me" never votes English', async () => {
  const { requestLanguage } = await import('../src/misato.ts');
  // nerv#831 review: half votes alone (a lower-case word ending in a, i or o) overrode an English conversation.
  const english = ['turn on the light in the kitchen'];
  for (const request of ['radio', 'hello', 'any extra batteries?', 'pizza tonight', 'New photo'])
    assert.equal(requestLanguage(request, english), 'en', request);
  assert.equal(requestLanguage('I want pizza'), 'en');
  assert.equal(requestLanguage('ottimo', ['spegni la luce']), 'it');
  // Italian "me" ("per me va bene") is not an English word.
  assert.equal(requestLanguage('per me va bene'), 'it');
  assert.equal(requestLanguage('remind me to stretch'), 'en');
});
test('B-167: English plurals and synonyms reach their topic', async () => {
  const { detectToolDomains } = await import('../src/misato.ts');
  for (const [domain, request] of [
    ['batteries', 'how many batteries do I need to charge?'],
    ['batteries', 'which lipos are discharged?'],
    ['fpv', 'tune the PIDs on my quads'],
    ['fpv', 'which propellers fit my drones?'],
    ['pantry', 'what expires soon?'],
    ['pantry', 'list my recipes'],
    ['pantry', 'which groceries do I need?'],
    ['gmail', "check today's emails"],
    ['gmail', 'any new mails?'],
    ['gmail', 'search my invoices'],
    ['fleet', 'list my drones'],
  ] as const)
    assert.equal(detectToolDomains({ request }).has(domain), true, `${domain}: ${request}`);
});
test("an action that already ran is never run again: a repeat ends the turn with the service's Done; at the step limit what ran is reported done", async () => {
  // Owner report 2026-11-05: a small model re-proposed an approved action until the step limit ("could not finish").
  const ADD = '{"action":{"tool":"reminders.add","args":{"title":"Stretch","due":"2031-01-01T09:00:00Z"}}}';
  await agent([ADD, ADD, ADD], async (runtime, m) => {
    const chat = await runtime.chat('Remind me to stretch');
    assert.equal(chat.reply, 'Done: reminders.add (“Stretch”).');
    assert.equal((await runtime.list()).length, 1, 'it ran once');
    assert.deepEqual(
      chat.steps.map((s) => s.outcome),
      ['grant'],
    );
    assert.equal(m.asked.filter((a) => a.who === 'misato').length, 2, 'the repeat is caught, not run');
  });
  await agent(
    ['{"action":{"tool":"reminders.list","args":{}}}', ...Array.from({ length: MAX_STEPS }, () => 'not a plan')],
    async (runtime) => {
      const chat = await runtime.chat('Ricordami cosa ho in programma');
      assert.equal(
        chat.reply,
        'Fatto: reminders.list.',
        "at the limit, what ran is reported, in the request's language",
      );
      assert.equal((await runtime.events(chat.sortieId)).at(-1)!.kind, 'sortie.done');
    },
  );
});
test('a removal the request did not ask for is checked by Casper even though it is Green, and refused: nothing is cancelled (B-009)', async () => {
  const script: string[] = [];
  await agent(
    script,
    async (runtime, m) => {
      const old = await runtime.add('Drink water', '2030-01-01T09:00:00Z');
      script.push(
        '{"action":{"tool":"reminders.add","args":{"title":"Eat","due":"2030-01-01T10:00:00Z"}}}',
        `{"action":{"tool":"reminders.cancel","args":{"id":"${old.id}"}}}`,
        '{"reply":"Added the reminder to eat."}',
      );
      const chat = await runtime.chat('remind me to eat at 10');
      assert.deepEqual(
        chat.steps.map((s) => [s.tool, s.outcome]),
        [
          ['reminders.add', 'grant'],
          ['reminders.cancel', 'reject'],
        ],
      );
      assert.match(chat.steps[1]!.reason!, /^casper: Not asked for\./);
      assert.deepEqual(
        m.asked.filter((a) => a.who === 'casper').length,
        1,
        'Casper is asked about the removal only, not about the Green add',
      );
      assert.deepEqual(
        (await runtime.pendingReminders()).map((r) => r.title).sort(),
        ['Drink water', 'Eat'],
        'the earlier reminder is still there',
      );
    },
    undefined,
    '{"vote":"reject","reason":"Not asked for.","confidence":0.9}',
  );
});
test('Casper judges a short confirmation against the request it confirms: it sees the earlier exchanges of the conversation (B-010)', async () => {
  // Casper approves only when it can see what "Am. Yes" answers; without the earlier request it would refuse.
  const casper = (prompt: string) => {
    const p = JSON.parse(prompt) as { request: string; earlier?: { request: string }[] };
    return (p.earlier ?? []).some((t) => /water the plants/.test(t.request))
      ? '{"vote":"approve","reason":"Confirms the plants reminder.","confidence":0.9}'
      : '{"vote":"reject","reason":"Does not match the request.","confidence":0.9}';
  };
  const ADD = '{"action":{"tool":"reminders.add","args":{"title":"Water the plants","due":"2031-01-01T08:00:00Z"}}}';
  await agent(
    ['{"reply":"At 9 in the morning or the evening?"}', ADD, '{"reply":"Done."}'],
    async (runtime, m) => {
      const first = await runtime.chat('Remind me tomorrow at 9 to water the plants', 'telegram:2222');
      assert.equal(first.reply, 'At 9 in the morning or the evening?');
      const second = await runtime.chat('Am. Yes', 'telegram:2222');
      assert.deepEqual(
        second.steps.map((s) => [s.tool, s.outcome]),
        [['reminders.add', 'approval']],
        'Casper approved; Blue still asks the owner',
      );
      const asked = JSON.parse(m.asked.filter((a) => a.who === 'casper').at(-1)!.prompt) as {
        request: string;
        earlier: { request: string; reply: string }[];
      };
      assert.equal(asked.request, 'Am. Yes');
      assert.deepEqual(asked.earlier, [
        { request: 'Remind me tomorrow at 9 to water the plants', reply: 'At 9 in the morning or the evening?' },
      ]);
      const ballot = (await runtime.events(second.sortieId)).find((e) => e.kind === 'ballot')!.payload as {
        verdicts: { seat: string; vote: string }[];
      };
      assert.equal(ballot.verdicts.find((v) => v.seat === 'casper')!.vote, 'approve');
    },
    { blue: ['reminders.add'] },
    casper,
  );
});

test('F-043: EN and IT reminder time kinds parse cleanly, and "remind me to renew the car insurance on 3 March" stores an all-day reminder instead of a made-up clock time', async () => {
  const { parseReminderRequest } = await import('../src/misato.ts');
  const opts = {
    now: new Date('2030-01-15T08:00:00.000Z'),
    timeZone: 'Europe/Rome',
    briefAt: '08:00',
  };

  // All-day (date without clock time) in EN and IT
  const enAllDay = parseReminderRequest('remind me to renew the car insurance on 3 March', {
    ...opts,
    fallbackDue: '2030-03-03T14:23:00+01:00',
  })!;
  assert.equal(enAllDay.kind, 'all-day');
  assert.equal(enAllDay.due, '2030-03-03T07:00:00.000Z');
  assert.equal(enAllDay.end, null);

  const itAllDay = parseReminderRequest("ricordami di rinnovare l'assicurazione il 3 marzo", {
    ...opts,
    fallbackDue: '2030-03-03T16:00:00+01:00',
  })!;
  assert.equal(itAllDay.kind, 'all-day');
  assert.equal(itAllDay.due, '2030-03-03T07:00:00.000Z');

  // At a time ("at 10" / "alle 10")
  const enAt = parseReminderRequest('remind me to call Ada on 3 March at 10', opts)!;
  assert.equal(enAt.kind, 'at');
  assert.equal(enAt.due, '2030-03-03T09:00:00.000Z');

  const itAt = parseReminderRequest('ricordami di chiamare Ada il 3 marzo alle 10', opts)!;
  assert.equal(itAt.kind, 'at');
  assert.equal(itAt.due, '2030-03-03T09:00:00.000Z');

  // From–to ("between 10 and 12" / "tra le 10 e le 12" / "dalle 10 alle 12")
  for (const text of [
    'remind me to meet Bob on 3 March between 10 and 12',
    'remind me to meet Bob on 3 March from 10 to 12',
    'ricordami di incontrare Bob il 3 marzo tra le 10 e le 12',
    'ricordami di incontrare Bob il 3 marzo dalle 10 alle 12',
  ]) {
    const parsed = parseReminderRequest(text, opts)!;
    assert.equal(parsed.kind, 'from-to', text);
    assert.equal(parsed.due, '2030-03-03T09:00:00.000Z', text);
    assert.equal(parsed.end, '2030-03-03T11:00:00.000Z', text);
  }

  // From ("after 15" / "dopo le 15" / "dalle 15")
  for (const text of [
    'remind me to call the bank on 3 March after 15',
    'ricordami di chiamare la banca il 3 marzo dopo le 15',
    'ricordami di chiamare la banca il 3 marzo dalle 15',
  ]) {
    const parsed = parseReminderRequest(text, opts)!;
    assert.equal(parsed.kind, 'from', text);
    assert.equal(parsed.due, '2030-03-03T14:00:00.000Z', text);
    assert.equal(parsed.end, null, text);
  }

  // Until ("by 18" / "until 18" / "entro le 18" / "fino alle 18")
  for (const text of [
    'remind me to send the report on 3 March by 18',
    'remind me to send the report on 3 March until 18',
    'ricordami di inviare il report il 3 marzo entro le 18',
    'ricordami di inviare il report il 3 marzo fino alle 18',
  ]) {
    const parsed = parseReminderRequest(text, opts)!;
    assert.equal(parsed.kind, 'until', text);
    assert.equal(parsed.end, '2030-03-03T17:00:00.000Z', text);
    assert.equal(parsed.due, '2030-03-03T16:00:00.000Z', text);
  }

  // End-to-end through runtime.chat: Misato invents a clock time (14:37), NERV reconciles it to an all-day reminder
  await agent(
    [
      '{"action":{"tool":"reminders.add","args":{"title":"Renew the car insurance","due":"2030-03-03T14:37:00+01:00"}}}',
      '{"reply":"Done: I will remind you to renew the car insurance on 3 March."}',
    ],
    async (runtime) => {
      const chat = await runtime.chat('remind me to renew the car insurance on 3 March');
      assert.equal(chat.steps[0]?.outcome, 'grant');
      const items = await runtime.list();
      assert.equal(items.length, 1);
      assert.equal(items[0]!.title, 'Renew the car insurance');
      assert.equal(items[0]!.kind, 'all-day');
    },
  );
});

test('B-049: Misato cannot add a reminder with a generic or invented title when the request gives none, and asks instead', async () => {
  for (const inventedTitle of ['Promemoria', 'Promemoria per il primo gennaio 2031', 'Appuntamento']) {
    await agent(
      [
        JSON.stringify({
          action: { tool: 'reminders.add', args: { title: inventedTitle, due: '2031-01-01T09:00:00Z' } },
        }),
        '{"ask":"Di cosa ti devo ricordare?"}',
      ],
      async (runtime) => {
        const chat = await runtime.chat('Imposta un promemoria per il primo gennaio 2031 alle 09:00 UTC.');
        assert.deepEqual(
          chat.steps.map((s) => s.outcome),
          ['invalid'],
          `invented title "${inventedTitle}" must be rejected back to Misato`,
        );
        assert.equal(chat.question?.text, 'Di cosa ti devo ricordare?');
        assert.equal(chat.reply, 'Di cosa ti devo ricordare?');
        assert.equal((await runtime.list()).length, 0, 'no reminder should be added');
        assert.equal((await runtime.approvals()).length, 0, 'no approval card should be created');
      },
      { blue: ['reminders.add'] },
    );
  }
});

test('B-049: validateReminderTitle accepts grounded titles and rejects missing, generic, or ungrounded ones', () => {
  const itNoTitle = 'Imposta un promemoria per il primo gennaio 2031 alle 09:00 UTC.';
  for (const bad of ['', '   ', undefined, 'Promemoria', 'Promemoria per il primo gennaio 2031', 'Reminder', 'Spesa']) {
    assert.ok(validateReminderTitle(bad, { request: itNoTitle }), `expected "${String(bad)}" to be rejected`);
  }
  assert.equal(
    validateReminderTitle('Chiamare Alex', {
      request: 'Ricordami di chiamare Alex il primo gennaio 2031 alle 09:00 UTC.',
    }),
    undefined,
  );
  assert.equal(
    validateReminderTitle('Water the plants', {
      request: 'Am. Yes',
      context: [{ request: 'Remind me tomorrow at 9 to water the plants', reply: 'Morning or evening?' }],
    }),
    undefined,
  );
  assert.equal(
    validateReminderTitle('Dentist', {
      request: 'Set a reminder for that appointment',
      memory: [{ id: 'm1', text: 'Dentist appointment on Friday', shareable: true, tainted: false }],
    }),
    undefined,
  );
  assert.equal(
    validateReminderTitle('Renew insurance', {
      request: 'Remind me about the top item tomorrow',
      steps: [{ tool: 'files.read', outcome: 'grant', result: { text: 'Renew insurance before March' } }],
    }),
    undefined,
  );
});

test('F-106: the system text and tool schemas are a byte-identical prefix across turns; the clock comes after them', () => {
  const turn = (now: string) =>
    misatoAsk(
      {
        request: 'Ricordami di chiamare Ada',
        history: [],
        tools: toolDocs,
        now,
        timeZone: 'Europe/Rome',
        language: 'it',
      },
      'local',
    );
  const a = { system: turn('2030-01-01T08:00:00.000Z').system ?? '' };
  const b = { system: turn('2030-01-01T08:01:00.000Z').system ?? '' };
  let same = 0;
  while (same < a.system.length && a.system[same] === b.system[same]) same++;
  assert.ok(same < a.system.length, 'the clock is in the system text');
  const prefix = a.system.slice(0, same);
  for (const t of toolDocs)
    assert.ok(prefix.includes(`- ${t.name} (${t.effect}):`), `${t.name} schema in the stable prefix`);
  assert.ok(prefix.includes('Never invent an action or its details'), 'the fixed rules are in the stable prefix');
  assert.equal(a.system.slice(same).split('\n').length <= 4, true, 'only the clock, language and topic lines follow');
});

test('F-106-T03: core tools stay always offered; domain toolsets load only when request or history names them and shrink prompt size', () => {
  const coreOnly = filterToolsByIntent(toolDocs, detectToolDomains({ request: 'Ricordami di chiamare Ada' }));
  const coreNames = new Set(coreOnly.map((t) => t.name));
  assert.ok(coreNames.has('reminders.add'));
  assert.ok(coreNames.has('memory.remember'));
  assert.ok(coreNames.has('docs.list'));
  assert.ok(coreNames.has('lists.show'));
  for (const prefix of ['fpv.', 'pantry.', 'gmail.', 'batteries.', 'fleet.']) {
    assert.equal(
      coreOnly.some((t) => t.name.startsWith(prefix)),
      false,
      `deferred ${prefix} tools omitted on unrelated request`,
    );
  }

  // Measure F-106-T01 prompt size before vs after deferring domain tools.
  const input = {
    request: 'Ricordami di chiamare Ada',
    history: [],
    now: '2030-01-01T08:00:00.000Z',
    timeZone: 'Europe/Rome',
    language: 'it' as const,
  };
  const before = measureMisatoPrompt(misatoAsk({ ...input, tools: toolDocs }, 'local'), toolDocs);
  const after = measureMisatoPrompt(misatoAsk({ ...input, tools: coreOnly }, 'local'), coreOnly);
  assert.ok(after.promptTokens < before.promptTokens, `expected ${after.promptTokens} < ${before.promptTokens}`);
  assert.ok(after.toolSchemaTokens < before.toolSchemaTokens);

  // Each domain is reached when named in request (IT/EN) or prior step history.
  const cases: Array<{ domain: string; tool: string; request: string }> = [
    { domain: 'fpv', tool: 'fpv.blackbox_report', request: 'Analizza il log blackbox del quad FPV' },
    { domain: 'pantry', tool: 'pantry.check', request: 'Controlla la scadenza del latte in dispensa' },
    { domain: 'gmail', tool: 'gmail.search', request: 'Cerca una email su Gmail con la fattura' },
    { domain: 'batteries', tool: 'batteries.list', request: 'Quali batterie LiPo sono da mettere in storage?' },
    { domain: 'fleet', tool: 'fleet.chat', request: 'Registra manutenzione sulla flotta' },
  ];
  for (const c of cases) {
    const byReq = filterToolsByIntent(toolDocs, detectToolDomains({ request: c.request }));
    assert.ok(
      byReq.some((t) => t.name === c.tool),
      `${c.domain} reached from request`,
    );

    const byHist = filterToolsByIntent(
      toolDocs,
      detectToolDomains({
        request: 'continua pure',
        history: [{ tool: c.tool, args: {}, outcome: 'grant' }],
      }),
    );
    assert.ok(
      byHist.some((t) => t.name === c.tool),
      `${c.domain} reached from history`,
    );
  }
});

test('F-098-T04: Italian crash and spares phrases unlock the fleet domain (fleet.chat)', () => {
  assert.equal(detectToolDomains({ request: 'ho crashato Smoke, motore sinistro inferiore rotto' }).has('fleet'), true);
  assert.equal(detectToolDomains({ request: 'quanti motori di scorta mi restano?' }).has('fleet'), true);
});
test('F-098-T06: add-drone, replace-part and stock phrases unlock the fleet domain (fleet.chat)', () => {
  for (const request of [
    'nuovo drone Ghost, frame Apex 5, motori Testmot 2207 1750KV',
    'sostituito motore anteriore sinistro di Smoke con Testmot 2207 1950KV',
    "replaced Smoke's front-left motor with Testmot 2207 1950KV",
    'ho 3 motori Testmot nuovi',
    'I have 3 new Testmot motors',
  ]) {
    assert.equal(detectToolDomains({ request }).has('fleet'), true, request);
  }
});
test('F-121-T02: print phrases unlock the fleet domain (fleet.print)', () => {
  for (const request of ['stampa i piedini di Smoke', 'print the AOS feet', "print Smoke's feet"]) {
    assert.equal(detectToolDomains({ request }).has('fleet'), true, request);
  }
  const ask = misatoAsk(
    {
      request: 'print the feet',
      history: [{ tool: 'fleet.print', args: { phrase: 'print the feet' }, outcome: 'grant', result: 'Sliced.' }],
      tools: toolDocs,
      now: '2030-01-01T08:00:00.000Z',
      timeZone: 'Europe/Rome',
    },
    'cloud',
  );
  assert.equal(ask.route, 'local', 'part names and library paths stay local');
});
// The fake slicer is a `#!node` script found on PATH; Windows cannot execute an extensionless script (and Node refuses
// .cmd files without a shell), while the real Bambu Studio there is an .exe. Slicing itself is covered on every platform
// by test/fleet-print-job.test.ts with an injected exec; this end-to-end chat test runs on macOS and Linux.
test(
  'F-121-T02: "stampa i piedini di Wisp" through chat: fleet.print slices with the slicer on PATH, then the hand-off waits for the owner even when Casper approves',
  { skip: process.platform === 'win32' ? 'a #! script on PATH cannot run on Windows' : false },
  async () => {
    const foot = 'solid foot\nendsolid foot\n';
    // The planner copies the result's handoff arguments (each slice has its own output file).
    const script: Scripted[] = [
      '{"action":{"tool":"fleet.print","args":{"phrase":"stampa i piedini di Wisp"}}}',
      (prompt) => JSON.stringify({ action: { tool: 'bambu.handoff', args: handoffIn(prompt) } }),
    ];
    // A fake bambu-studio first on PATH: the nervous process inherits PATH and runs it as the real slicer.
    const bin = mkdtempSync(join(tmpdir(), 'nerv-fake-slicer-'));
    writeFileSync(
      join(bin, 'bambu-studio'),
      [
        `#!${process.execPath}`,
        "const { writeFileSync } = require('node:fs');",
        'const args = process.argv.slice(2);',
        "writeFileSync(args[args.indexOf('--export-3mf') + 1], 'PK-sliced');",
        "console.log('estimated printing time: 42m');",
        "console.log('total filament used [g] = 7.5');",
      ].join('\n'),
      { mode: 0o755 },
    );
    const path = process.env.PATH;
    process.env.PATH = `${bin}${delimiter}${path ?? ''}`;
    const setup = (home: string) => {
      writeFileSync(
        join(home, 'slicer-profiles.json'),
        JSON.stringify([
          { name: 'Test TPU 0.4', machineProfile: 'test-machine.json', materialProfile: 'test-tpu.json' },
        ]),
      );
      mkdirSync(join(home, 'prints', 'kite-5'), { recursive: true });
      writeFileSync(join(home, 'prints', 'kite-5', 'foot.stl'), foot);
      const store = new Store(join(home, 'nerv.sqlite'));
      store.fleet.importFleet(
        {
          version: 1,
          models: [
            {
              name: 'Kite 5.1',
              parts: [
                {
                  name: 'motor foot',
                  aliases: ['piedini'],
                  file: 'kite-5/foot.stl',
                  count: 4,
                  profile: 'Test TPU 0.4',
                },
              ],
            },
          ],
          drones: [{ name: 'Wisp', model: 'Kite 5.1', parts: [] }],
        },
        undefined,
        { slicerProfiles: ['Test TPU 0.4'] },
      );
      store.close();
    };
    try {
      await agent(
        script,
        async (runtime, _m, _base, _headers, home) => {
          const chat = await runtime.chat('stampa i piedini di Wisp');
          assert.deepEqual(
            chat.steps.map((step) => [step.tool, step.outcome]),
            [
              ['fleet.print', 'grant'],
              ['bambu.handoff', 'approval'],
            ],
          );
          const sliced = chat.steps[0]!.result as { reply: string; handoff: Record<string, unknown> };
          for (const text of [
            'kite-5/foot.stl',
            '4 prints',
            'Test TPU 0.4',
            'external spool',
            '42m',
            '7.5 g',
            '30 g',
          ]) {
            assert.ok(sliced.reply.includes(text), `${text} in: ${sliced.reply}`);
          }
          assert.equal(chat.waiting.length, 1);
          const cards = await runtime.approvals();
          assert.equal(cards.length, 1);
          assert.equal(cards[0]!.card.tool, 'bambu.handoff');
          assert.deepEqual(cards[0]!.card.args, sliced.handoff, 'the card carries the slice result, unchanged');
          const launches = join(home, 'bambu-launches.log');
          assert.equal(existsSync(launches), false, 'nothing opens before the owner approves');
          const decided = (await runtime.decide(cards[0]!.id, 'approve')) as { result?: { printStarted: boolean } };
          assert.equal(decided.result?.printStarted, false);
          assert.match(readFileSync(launches, 'utf8'), /^bambu-connect:\/\/import-file\?path=.*prints-out/);
        },
        undefined,
        // Owner decision 2026-11-24: opening Bambu Connect always waits for the owner, even when Casper approves.
        undefined,
        setup,
      );
    } finally {
      process.env.PATH = path;
      rmSync(bin, { recursive: true, force: true });
    }
  },
);

// F-121-T04 across every process: the Mac's nervous process resolves and hashes the part, its coordinator sends it over
// a real Kaji line to Tabgha, which verifies, caches and slices it with a fake slicer; the hand-off is proposed on Tabgha.
test('F-121-T04: "stampa i piedini di Wisp" with NERV-02 as the slicing base: the part goes over the Kaji line, the hand-off card targets NERV-02', async () => {
  const foot = 'solid foot\nendsolid foot\n';
  const digest = createHash('sha256').update(foot).digest('hex');
  const dir = mkdtempSync(join(tmpdir(), 'nerv-tabgha-'));
  const tabgha = join(dir, 'home');
  mkdirSync(tabgha);
  const profiles = [{ name: 'Test TPU 0.4', machineProfile: 'test-machine.json', materialProfile: 'test-tpu.json' }];
  writeFileSync(join(tabgha, 'slicer-profiles.json'), JSON.stringify(profiles));
  const rootKey = unlockRootKey(createRootKey('a long test passphrase').file, 'a long test passphrase');
  const pair = () => {
    const k = generateKeyPairSync('ed25519');
    return {
      privateKey: k.privateKey,
      publicKey: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    };
  };
  const A = pair(),
    B = pair();
  const freePort = () =>
    new Promise<number>((done) => {
      const s = createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => done(p));
      });
    });
  const pa = await freePort(),
    pb = await freePort();
  const sb = new Store(':memory:');
  const rb = new Registry(sb.db, rootKey.publicKey);
  let serial = 0;
  const records = [
    { kind: 'enrol', baseId: 'NERV-01', name: 'Neo Tokyo-3', publicKey: A.publicKey, address: `127.0.0.1:${pa}` },
    { kind: 'enrol', baseId: 'NERV-02', name: 'Tabgha', publicKey: B.publicKey, address: `127.0.0.1:${pb}` },
    { kind: 'main', baseId: 'NERV-01' },
  ].map((body) =>
    signRecord(rootKey.privateKey, { ...body, serial: ++serial, issued: new Date().toISOString() } as RegistryBody),
  );
  for (const r of records) rb.add(r);
  const registry = (reg: Registry) => ({
    bases: async () => reg.bases(),
    records: async () => reg.records(),
    add: async () => 0,
    seen: async (u: Record<string, string>) => reg.seen(u),
    lastSeen: async () => reg.lastSeen(),
  });
  const sliced: string[] = [];
  let la: KajiLink | undefined;
  const lb = new KajiLink({
    baseId: 'NERV-02',
    key: B.privateKey,
    publicKey: B.publicKey,
    registry: registry(rb),
    log: () => {},
    // Tabgha offers the hand-off to the main base (owner step: `nerv kaji offer bambu.handoff` there).
    offers: () => ['bambu.handoff'],
    onPartTransfer: async (from, body) =>
      receivePartTransfer(tabgha, ['NERV-01'], from, body, {
        exec: (_bin, args) => {
          sliced.push(args.at(-1)!);
          writeFileSync(args[args.indexOf('--export-3mf') + 1]!, 'PK-sliced');
          return 'estimated printing time: 42m\ntotal filament used [g] = 7.5\n';
        },
      }),
  });
  const script: Scripted[] = [
    '{"action":{"tool":"fleet.print","args":{"phrase":"stampa i piedini di Wisp"}}}',
    (prompt) =>
      JSON.stringify({
        action: { tool: 'kaji.run', args: { base: 'NERV-02', tool: 'bambu.handoff', args: handoffIn(prompt) } },
      }),
  ];
  const setup = (home: string) => {
    const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ ...config, kaji: { root: rootKey.publicKey }, prints: { slicer: 'NERV-02' } }),
    );
    writeFileSync(join(home, 'slicer-profiles.json'), JSON.stringify(profiles));
    mkdirSync(join(home, 'prints', 'kite-5'), { recursive: true });
    writeFileSync(join(home, 'prints', 'kite-5', 'foot.stl'), foot);
    const store = new Store(join(home, 'nerv.sqlite'));
    store.fleet.importFleet(
      {
        version: 1,
        models: [
          {
            name: 'Kite 5.1',
            parts: [
              { name: 'motor foot', aliases: ['piedini'], file: 'kite-5/foot.stl', count: 4, profile: 'Test TPU 0.4' },
            ],
          },
        ],
        drones: [{ name: 'Wisp', model: 'Kite 5.1', parts: [] }],
      },
      undefined,
      { slicerProfiles: ['Test TPU 0.4'] },
    );
    store.close();
  };
  try {
    await agent(
      script,
      async (runtime, _m, _base, _headers, home) => {
        await runtime.kaji.add(records);
        runtime.setBaseKey(A.publicKey);
        // Wired as serve does: the Mac's link hears Tabgha's offers and sends parts for the gate.
        const link = new KajiLink({
          baseId: 'NERV-01',
          key: A.privateKey,
          publicKey: A.publicKey,
          registry: runtime.kaji,
          log: () => {},
          onOffers: (id, tools) => runtime.notePeerOffers(id, tools),
        });
        la = link;
        const sent: PartTransfer[] = [];
        runtime.useRemotePrint((pending) =>
          completeRemotePrint(home, pending, (base, message) => {
            sent.push(message);
            return link.sendPartTransfer(base, message);
          }),
        );
        await Promise.all([link.start(200), lb.start(200)]);
        for (const end = Date.now() + 10_000; !(await runtime.remoteOffers()).length;) {
          if (Date.now() > end)
            throw new Error('Tabgha never offered bambu.handoff ' + JSON.stringify(await runtime.bases()));
          await new Promise((r) => setTimeout(r, 50));
        }
        const chat = await runtime.chat('stampa i piedini di Wisp');
        assert.deepEqual(
          chat.steps.map((step) => [step.tool, step.outcome]),
          [
            ['fleet.print', 'grant'],
            ['kaji.run', 'approval'],
          ],
        );
        const result = chat.steps[0]!.result as {
          reply: string;
          handoff: Record<string, unknown>;
          handoffBase: string;
        };
        assert.match(result.reply, /^Sliced on NERV-02 motor foot/);
        assert.equal(result.handoffBase, 'NERV-02');
        const { gcode3mfPath, ...rest } = result.handoff;
        assert.ok(
          String(gcode3mfPath).startsWith(join(tabgha, 'prints-out', `${digest.slice(0, 16)}-test-tpu-0-4-`)),
          String(gcode3mfPath),
        );
        assert.deepEqual(rest, {
          profileName: 'Test TPU 0.4',
          printTimeText: '42m',
          filamentGrams: 7.5,
          amsMapping: 'External spool (TPU)',
          sourceFile: 'kite-5/foot.stl',
          repeats: 4,
        });
        assert.deepEqual(
          sent.map((m) => m.content !== undefined),
          [false, true],
        );
        assert.deepEqual(sliced, [join(tabgha, 'prints-cache', `${digest}.stl`)]);
        // The Mac sliced nothing and kept no copy; the hand-off is the owner's card for NERV-02.
        assert.equal(existsSync(join(home, 'prints-cache')), false);
        const cards = await runtime.approvals();
        assert.equal(cards.length, 1);
        assert.equal(cards[0]!.card.tool, 'kaji.run');
        assert.deepEqual(cards[0]!.card.args, { base: 'NERV-02', tool: 'bambu.handoff', args: result.handoff });
        // The ledger records the slice once, as it came back from NERV-02.
        const events = (await runtime.events(chat.sortieId)) as {
          kind: string;
          payload: { tool?: string; result?: { text?: string } };
        }[];
        const done = events.filter((e) => e.kind === 'action.done' && e.payload.tool === 'fleet.print');
        assert.equal(done.length, 1);
        assert.match(done[0]!.payload.result!.text!, /Sliced on NERV-02/);
        assert.equal(existsSync(join(home, 'bambu-launches.log')), false, 'nothing opens before the owner approves');
        // Review of #722: a direct action (POST /act, nerv act) sends the part too, and its sortie closes after.
        const acted = await runtime.act({
          request: 'stampa i piedini di Wisp',
          tool: 'fleet.print',
          args: { phrase: 'stampa i piedini di Wisp' },
        });
        assert.equal((acted as { result?: { sliced?: boolean } }).result?.sliced, true);
        assert.equal((await runtime.sortie(acted.sortieId))?.status, 'done');
      },
      undefined,
      undefined,
      setup,
    );
  } finally {
    await la?.stop();
    await lb.stop();
    sb.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B-138: after a granted fleet.chat spares step, chat answers with the spare outcome instead of a generic greeting', async () => {
  const setup = (home: string) => {
    const store = new Store(join(home, 'nerv.sqlite'));
    store.fleet.importFleet({
      version: 1,
      drones: [{ name: 'Testquad', frame: 'Testframe 5', parts: [{ category: 'frame', model: 'Testframe 5' }] }],
    });
    store.close();
  };

  await agent(
    [
      // 1) No motor spares registered: planner proposes fleet.chat, then twice tries a generic Misato greeting.
      '{"action":{"tool":"fleet.chat","args":{"phrase":"quanti motori di scorta mi restano?"}}}',
      '{"reply":"Ciao! Sono pronta ad aiutarti, dimmi pure."}',
      '{"reply":"Ciao! Di cosa hai bisogno oggi?"}',
      // 2) Motor spares registered: planner proposes fleet.chat, greets once (rejected), then answers from steps.
      '{"action":{"tool":"fleet.chat","args":{"phrase":"quanti motori di scorta mi restano?"}}}',
      '{"reply":"Ciao! Come posso aiutarti?"}',
      '{"reply":"Per Testmot 2207 hai 3 nuovi e 2 usati di scorta."}',
    ],
    async (runtime) => {
      const chatNone = await runtime.chat('quanti motori di scorta mi restano?');
      assert.equal(chatNone.steps[0]?.tool, 'fleet.chat');
      assert.equal(chatNone.steps[0]?.outcome, 'grant');
      const noneResult = chatNone.steps[0]?.result as { handled?: boolean; reply?: string };
      assert.equal(noneResult?.handled, true);
      assert.match(noneResult?.reply ?? '', /no motor spares registered/i);
      assert.doesNotMatch(chatNone.reply ?? '', /Ciao|aiutarti|bisogno/i);
      assert.match(
        chatNone.reply ?? '',
        /non risultano motori di scorta registrati|nessun motore di scorta registrato/i,
      );

      await runtime.act({
        request: 'sostituito motore anteriore sinistro di Testquad con Testmot 2207',
        tool: 'fleet.chat',
        args: { phrase: 'sostituito motore anteriore sinistro di Testquad con Testmot 2207' },
      });
      await runtime.act({
        request: 'ho 3 motori Testmot 2207 nuovi e 2 usati',
        tool: 'fleet.chat',
        args: { phrase: 'ho 3 motori Testmot 2207 nuovi e 2 usati' },
      });

      const chatSome = await runtime.chat('quanti motori di scorta mi restano?');
      assert.equal(chatSome.steps[0]?.tool, 'fleet.chat');
      assert.equal(chatSome.steps[0]?.outcome, 'grant');
      const someResult = chatSome.steps[0]?.result as { handled?: boolean; reply?: string };
      assert.match(someResult?.reply ?? '', /Testmot 2207.*3 new, 2 used/);
      assert.doesNotMatch(chatSome.reply ?? '', /Ciao|posso aiutarti/i);
      assert.match(chatSome.reply ?? '', /Testmot 2207/);
      assert.match(chatSome.reply ?? '', /3\s+nuov/i);
      assert.match(chatSome.reply ?? '', /2\s+usat/i);
    },
    undefined,
    undefined,
    setup,
  );

  const ask = misatoAsk(
    {
      request: 'quanti motori di scorta mi restano?',
      history: [
        {
          tool: 'fleet.chat',
          args: { phrase: 'quanti motori di scorta mi restano?' },
          outcome: 'grant',
          result: { handled: true, reply: 'No motor spares registered.' },
        },
      ],
      tools: toolDocs,
      now: '2030-01-01T08:00:00.000Z',
      timeZone: 'Europe/Rome',
      language: 'it',
    },
    'local',
  );
  assert.match(ask.system!, /"steps" holds/);
});

test('B-143: "in 2 minutes" is due 2 minutes after the owner asked, not after the step that wrote reminders.add', async () => {
  const { reconcileReminderArgs } = await import('../src/misato.ts');
  const asked = new Date('2030-01-15T18:16:25.765Z');
  const opts = { now: asked, timeZone: 'Europe/Rome', briefAt: '08:00' };
  // The model wrote the call two minutes later and anchored "in 2 minutes" to its own step time.
  for (const [text, late, want] of [
    ['Remind me to drink water in 2 minutes', '2030-01-15T18:20:28.000Z', '2030-01-15T18:18:25.765Z'],
    ['remind me to stretch in 1 hour', '2030-01-15T19:18:00.000Z', '2030-01-15T19:16:25.765Z'],
    ['ricordami di bere acqua tra 2 minuti', '2030-01-15T18:20:28.000Z', '2030-01-15T18:18:25.765Z'],
    ['ricordami di uscire fra 3 ore', '2030-01-15T21:20:00.000Z', '2030-01-15T21:16:25.765Z'],
  ] as const) {
    const out = reconcileReminderArgs(text, { title: 'Water', due: late, kind: 'at' }, opts);
    assert.equal(out.due, want, text);
    assert.equal(out.kind, 'at', text);
  }
  // A clock time is not relative: the model's due stays.
  assert.equal(
    reconcileReminderArgs(
      'remind me to call Ada at 20:30',
      { title: 'Call Ada', due: '2030-01-15T19:30:00.000Z' },
      opts,
    ).due,
    '2030-01-15T19:30:00.000Z',
  );

  // Through every process: Misato's "Now" is the request time, and the stored due is anchored to it.
  const late = new Date(Date.now() + 10 * 60_000).toISOString();
  await agent(
    [
      JSON.stringify({ action: { tool: 'reminders.add', args: { title: 'Drink water', due: late, kind: 'at' } } }),
      '{"reply":"Done."}',
    ],
    async (runtime, m) => {
      const chat = await runtime.chat('Remind me to drink water in 2 minutes');
      assert.equal(chat.steps.at(-1)?.outcome, 'grant');
      const sortie = await runtime.sortie(chat.sortieId);
      const items = await runtime.list();
      assert.equal(items.length, 1);
      assert.equal(items[0]!.due, new Date(Date.parse(sortie!.created) + 120_000).toISOString());
      const planner = m.asked.filter((a) => a.who === 'misato');
      assert.ok(planner.length >= 1);
      for (const a of planner) assert.ok(a.system.includes(`Now: ${sortie!.created}`), a.system);
    },
  );
});

// B-176: known failing until B-176-T02. One granted read whose result is larger than the step history budget
// (8,000 characters) leaves Misato with no steps at all, so she proposes the same read again and the owner reads
// only "Fatto: <tool>.". Remove `todo` with the fix.
test(
  'B-176: a granted read with a large result still reaches Misato, so she can answer from it',
  { todo: 'B-176: fix pending (B-176-T02)' },
  () => {
    const strains = Array.from({ length: 33 }, (_, n) => ({
      id: `fixture-strain-${n}`,
      name: `Fixture Strain ${n}`,
      breederId: null,
      parentIds: [],
      sativaPercent: 50,
      thcPercent: null,
      cbdPercent: null,
      floweringDays: null,
      autoflower: false,
    }));
    const result = { text: JSON.stringify(strains, null, 2) };
    assert.ok(JSON.stringify(result).length > 8000, 'the fixture must exceed the history budget');
    const ask = misatoAsk(
      {
        request: 'quali genetiche ho?',
        history: [{ tool: 'fixture.strains', args: {}, outcome: 'grant', result }],
        tools: toolDocs,
        now: '2030-01-01T08:00:00.000Z',
        timeZone: 'Europe/Rome',
      },
      'local',
    );
    const steps = (JSON.parse(ask.prompt) as { steps?: { tool: string; result?: unknown }[] }).steps ?? [];
    assert.equal(steps.length, 1, 'the granted read is missing from the planner prompt');
    assert.equal(steps[0]?.tool, 'fixture.strains');
    assert.match(JSON.stringify(steps[0]?.result), /Fixture Strain 0/);
  },
);
// B-176-T03: known failing until the fix. A repeated read ended with doneReply ("Fatto: <tool>."), which throws away
// what the owner asked for. Remove `todo` with the fix.
test(
  'B-176: a repeated read gets one last turn to answer from its result; a second repeat answers with the result, never a bare Done',
  { todo: 'B-176: fix pending (B-176-T03)' },
  async () => {
    const LIST = '{"action":{"tool":"reminders.list","args":{}}}';
    await agent([LIST, LIST, '{"reply":"Hai un promemoria: Stretch."}'], async (runtime, m) => {
      await runtime.add('Stretch', '2031-01-01T09:00:00Z');
      const chat = await runtime.chat('quali promemoria ho?');
      assert.equal(chat.reply, 'Hai un promemoria: Stretch.');
      assert.equal(m.asked.filter((a) => a.who === 'misato').length, 3, 'one last turn after the repeat');
      assert.match(chat.steps.at(-1)?.error ?? '', /already ran reminders\.list/);
      assert.equal(chat.steps.filter((s) => s.outcome === 'grant').length, 1, 'the read ran once');
    });
    for (const [request, head] of [
      ['quali promemoria ho?', /^Ecco il risultato di reminders\.list:/],
      ['what reminders do I have?', /^Here is the result of reminders\.list:/],
    ] as const)
      await agent([LIST, LIST, LIST], async (runtime) => {
        await runtime.add('Stretch', '2031-01-01T09:00:00Z');
        const chat = await runtime.chat(request);
        assert.match(chat.reply ?? '', head, request);
        assert.match(chat.reply ?? '', /Stretch/, 'the owner gets the result');
      });
  },
);
