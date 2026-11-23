import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Runtime } from '../src/runtime.ts';
import { misatoAsk, formatToolDoc, type Step } from '../src/misato.ts';
import { BUILTIN_TOOL_SUBJECTS, execute, toolDocs, type ReminderBackend } from '../src/executors.ts';
import { measureMisatoPrompt } from '../src/prompt-samples.ts';
import {
  MAX_FREE_SUBJECT_READS,
  TOOL_INDEX_READ,
  TOOL_SUBJECT_SUMMARIES,
  compactToolCatalogue,
  formatSubjectLine,
  freeReadTurns,
  readSubjects,
} from '../src/tool-index.ts';

const NOW = '2030-02-02T09:00:00.000Z';
const fullDoc = (name: string) => formatToolDoc(toolDocs.find((d) => d.name === name)!);

test('F-113-T02: the planner prompt lists every subject on one line and no full built-in doc', () => {
  const { tools, index } = compactToolCatalogue(toolDocs, []);
  const subjects = new Set(Object.values(BUILTIN_TOOL_SUBJECTS));
  assert.deepEqual(new Set(index.map((e) => e.subject)), subjects);
  assert.deepEqual(
    tools.map((t) => t.name),
    [TOOL_INDEX_READ],
  );
  for (const entry of index) assert.ok(TOOL_SUBJECT_SUMMARIES[entry.subject], `summary for ${entry.subject}`);
  const ask = misatoAsk(
    {
      request: 'Remind me to water the plants tomorrow',
      history: [],
      tools,
      subjects: index,
      now: NOW,
      timeZone: 'UTC',
    },
    'local',
  );
  for (const entry of index) {
    const line = formatSubjectLine(entry);
    assert.ok(!line.includes('\n'));
    assert.equal(ask.system!.split('\n').filter((l) => l === line).length, 1, `one line for ${entry.subject}`);
  }
  assert.ok(ask.system!.includes(fullDoc(TOOL_INDEX_READ)));
  assert.ok(!ask.system!.includes(fullDoc('reminders.add')));
  // The duplicate check rules still apply: reminders.add is offered through the index.
  assert.match(ask.system!, /Before proposing reminders\.add or memory\.remember/);
  const full = measureMisatoPrompt(
    misatoAsk({ request: 'Hello', history: [], tools: toolDocs, now: NOW, timeZone: 'UTC' }, 'local'),
    toolDocs,
  );
  const compact = measureMisatoPrompt(
    misatoAsk({ request: 'Hello', history: [], tools, subjects: index, now: NOW, timeZone: 'UTC' }, 'local'),
    tools,
    index,
  );
  assert.ok(
    compact.toolSchemaTokens < full.toolSchemaTokens / 3,
    `${compact.toolSchemaTokens} vs ${full.toolSchemaTokens}`,
  );
  assert.ok(compact.promptTokens < full.promptTokens);
});

test('F-113-T02: a read subject, or one whose tool was already proposed, is shown in full', () => {
  const history: Step[] = [
    {
      tool: TOOL_INDEX_READ,
      args: { subject: 'reminders' },
      outcome: 'grant',
      result: { subject: 'reminders', tools: [] },
    },
    { tool: 'lists.show', args: {}, outcome: 'reject', reason: 'No.' },
    { tool: TOOL_INDEX_READ, args: { subject: 'gmail' }, outcome: 'invalid', error: 'refused' },
  ];
  assert.deepEqual([...readSubjects(history, toolDocs)].sort(), ['lists', 'reminders']);
  const { tools, index } = compactToolCatalogue(toolDocs, history);
  assert.ok(tools.some((t) => t.name === 'reminders.add'));
  assert.ok(tools.some((t) => t.name === 'lists.add_items'));
  assert.ok(!index.some((e) => e.subject === 'reminders' || e.subject === 'lists'));
  assert.ok(index.some((e) => e.subject === 'gmail'));
  // Tools without a subject (granted MCP tools) always stay in full; without the read tool nothing is compacted.
  const external = { name: 'weather.today', effect: 'read', about: 'Weather.', args: '{}' };
  assert.ok(compactToolCatalogue([...toolDocs, external], []).tools.includes(external));
  assert.equal(compactToolCatalogue([external, toolDocs[0]!], []).index.length, 0);
  assert.equal(freeReadTurns(history), 1);
  assert.equal(freeReadTurns(Array.from({ length: 5 }, () => history[0]!)), MAX_FREE_SUBJECT_READS);
});

test('F-113-T02: tools.read returns one subject’s full tool docs and validates its argument', () => {
  const backend = {} as ReminderBackend;
  const out = execute(backend, TOOL_INDEX_READ, { subject: 'reminders' }) as {
    subject: string;
    tools: { name: string; effect: string; about: string; args: string; returns?: string }[];
  };
  assert.equal(out.subject, 'reminders');
  assert.deepEqual(
    out.tools.map((t) => t.name),
    toolDocs.filter((d) => d.subject === 'reminders').map((d) => d.name),
  );
  const add = out.tools.find((t) => t.name === 'reminders.add')!;
  const doc = toolDocs.find((d) => d.name === 'reminders.add')!;
  assert.equal(add.args, doc.args);
  assert.equal(add.about, doc.about);
  assert.equal(out.tools.find((t) => t.name === 'reminders.list')!.returns, 'array');
  assert.throws(() => execute(backend, TOOL_INDEX_READ, { subject: 'weather' }), /subject must be one of/);
  assert.throws(() => execute(backend, TOOL_INDEX_READ, { subject: 'docs', extra: 1 }), /Arguments allowed/);
});

interface Asked {
  who: 'misato' | 'casper';
  system: string;
}

async function withRuntime(
  plan: (asked: Asked, n: number) => string,
  fn: (runtime: Runtime, asked: Asked[]) => Promise<void>,
  scrolls?: Record<string, unknown>,
) {
  const asked: Asked[] = [];
  let misatoCalls = 0;
  const model = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (c) => (raw += c))
      .on('end', () => {
        const body = JSON.parse(raw) as { messages: { content: string }[] };
        const system = body.messages[0]?.content ?? '';
        const who = system.startsWith('You are Casper') ? 'casper' : 'misato';
        const entry: Asked = { who, system };
        asked.push(entry);
        const content =
          who === 'casper'
            ? '{"vote":"approve","reason":"Matches the owner request.","confidence":0.95}'
            : plan(entry, misatoCalls++);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
      });
  });
  await new Promise<void>((done) => model.listen(0, '127.0.0.1', done));
  const home = mkdtempSync(join(tmpdir(), 'nerv-f113-'));
  const port = (model.address() as { port: number }).port;
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      timeZone: 'UTC',
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

test('F-113-T02 join: the planner reads a subject through the gate, then calls its tool with the full docs', async () => {
  const remindersLine = formatSubjectLine(
    compactToolCatalogue(toolDocs, []).index.find((e) => e.subject === 'reminders')!,
  );
  const script = [
    `{"action":{"tool":"${TOOL_INDEX_READ}","args":{"subject":"reminders"}}}`,
    '{"action":{"tool":"reminders.add","args":{"title":"Water the plants","due":"2030-02-03T10:00:00+00:00"}}}',
    '{"reply":"Reminder set: Water the plants on 3 February at 10:00."}',
  ];
  await withRuntime(
    () => script.shift() ?? '{"reply":"ok"}',
    async (runtime, asked) => {
      const chat = await runtime.chat('Remind me to water the plants on 3 February 2030 at 10');
      assert.deepEqual(
        chat.steps.map((s) => [s.tool, s.outcome]),
        [
          [TOOL_INDEX_READ, 'grant'],
          ['reminders.add', 'grant'],
        ],
      );
      const read = chat.steps[0]!.result as { subject: string; tools: { name: string }[] };
      assert.equal(read.subject, 'reminders');
      assert.ok(read.tools.some((t) => t.name === 'reminders.add'));
      const misato = asked.filter((a) => a.who === 'misato');
      assert.equal(misato.length, 3);
      // Before the read: one index line, no full doc. After it: the subject's full docs, no index line.
      assert.ok(misato[0]!.system.split('\n').includes(remindersLine));
      assert.ok(!misato[0]!.system.includes(fullDoc('reminders.add')));
      assert.ok(misato[1]!.system.includes(fullDoc('reminders.add')));
      assert.ok(!misato[1]!.system.split('\n').includes(remindersLine));
      assert.match(chat.reply!, /Reminder set/);
      assert.equal((await runtime.list()).length, 1);
    },
  );
});

test('F-113-T02 join: a call to a tool whose subject was never read still goes through the gate', async () => {
  const script = [
    '{"action":{"tool":"reminders.add","args":{"title":"Water the plants","due":"2030-02-03T10:00:00+00:00"}}}',
  ];
  await withRuntime(
    () => script.shift() ?? '{"reply":"ok"}',
    async (runtime, asked) => {
      const chat = await runtime.chat('Remind me to water the plants on 3 February 2030 at 10');
      assert.equal(chat.steps[0]!.tool, 'reminders.add');
      assert.equal(chat.steps[0]!.outcome, 'approval');
      assert.equal(chat.waiting.length, 1);
      assert.equal(chat.waiting[0]!.tool, 'reminders.add');
      assert.equal((await runtime.list()).length, 0, 'nothing runs before the owner decides');
      assert.ok(!asked[0]!.system.includes(fullDoc('reminders.add')));
    },
    { blue: ['reminders.add'] },
  );
});

test('F-113-T02 join: reading the same subject twice is refused back to the planner, not a finished job', async () => {
  const read = `{"action":{"tool":"${TOOL_INDEX_READ}","args":{"subject":"lists"}}}`;
  const script = [read, read, '{"reply":"Your lists are empty."}'];
  await withRuntime(
    () => script.shift() ?? '{"reply":"ok"}',
    async (runtime) => {
      const chat = await runtime.chat('What is on my lists?');
      assert.deepEqual(
        chat.steps.map((s) => s.outcome),
        ['grant', 'invalid'],
      );
      assert.match(chat.steps[1]!.error!, /already read this subject/);
      assert.match(chat.reply!, /empty/);
    },
  );
});
