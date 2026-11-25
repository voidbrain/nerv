// B-136: a local model answered a granted result in prose ("I've set a reminder…"), so the planner recorded
// "(invalid reply)" and paid a whole second prompt read. The planning turn now asks the route for structured output.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completeOpenAICompatible } from '../src/engine-provider.ts';
import { misatoAsk, parsePlan } from '../src/misato.ts';
import { toolDocs } from '../src/executors.ts';

const endpoint = { baseUrl: 'http://127.0.0.1:9/v1', model: 'local-test' };
const stream = (text: string) =>
  new Response(
    `data: ${JSON.stringify({ model: 'local-test', choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
const ask = () =>
  misatoAsk(
    {
      request: 'Remind me to water the ferns in 5 minutes',
      history: [
        {
          tool: 'reminders.add',
          args: { title: 'Water the ferns', due: '2030-01-01T09:05:00.000Z', kind: 'at' },
          outcome: 'grant',
          result: { id: 'r-1', title: 'Water the ferns', due: '2030-01-01T09:05:00.000Z' },
        },
      ],
      tools: toolDocs,
      now: '2030-01-01T09:00:00.000Z',
      timeZone: 'Europe/Rome',
    },
    'local',
  );

test('the planning turn sends its plan schema to the local route as structured output', async () => {
  const bodies: Record<string, unknown>[] = [];
  const reply = await completeOpenAICompatible(ask(), endpoint, {
    timeoutMs: 5000,
    fetch: (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return stream('{"reply":"Done: the ferns reminder is set for 10:05."}');
    }) as typeof fetch,
  });
  const format = bodies[0]?.response_format as
    { type: string; json_schema: { name: string; strict: boolean; schema: { anyOf: unknown[] } } } | undefined;
  assert.equal(format?.type, 'json_schema');
  assert.equal(format?.json_schema.name, 'misato_plan');
  assert.equal(format?.json_schema.strict, true);
  assert.deepEqual(parsePlan(reply.text), { reply: 'Done: the ferns reminder is set for 10:05.' });
});

test('a route that refuses structured output is asked once more without it', async () => {
  const bodies: Record<string, unknown>[] = [];
  const reply = await completeOpenAICompatible(ask(), endpoint, {
    timeoutMs: 5000,
    fetch: (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return bodies.length === 1 ? new Response('unsupported', { status: 400 }) : stream('{"reply":"Done."}');
    }) as typeof fetch,
  });
  assert.equal(bodies.length, 2);
  assert.equal('response_format' in bodies[1]!, false);
  assert.deepEqual(parsePlan(reply.text), { reply: 'Done.' });
});

test('every key of the plan schema is a plan parsePlan accepts, and the parser stays strict', () => {
  const schema = misatoAsk({ request: 'x', history: [], tools: [], now: 'n', timeZone: 'Europe/Rome' }, 'local').schema!
    .schema as { anyOf: { required: string[] }[] };
  const samples: Record<string, unknown> = {
    action: { tool: 'reminders.list', args: {} },
    reply: 'ok',
    ask: 'Which one?',
    script: 'return 1;',
    newRequest: true,
  };
  for (const branch of schema.anyOf) {
    const key = branch.required[0]!;
    assert.ok(parsePlan(JSON.stringify({ [key]: samples[key] })), key);
  }
  // A fenced single object is one plan; prose, two objects or two keys are never guessed at.
  assert.deepEqual(parsePlan('```json\n{"reply":"Fatto."}\n```'), { reply: 'Fatto.' });
  for (const bad of [
    "I've set a reminder for you to water the ferns at 10:05.",
    '{"reply":"a"}\n{"action":{"tool":"reminders.list","args":{}}}',
    '{"reply":"a","ask":"b"}',
  ])
    assert.equal(parsePlan(bad), undefined, bad);
});

test('the schema fallback adds at most one call, only when the server refuses the schema', async () => {
  const calls = async (
    a: Parameters<typeof completeOpenAICompatible>[0],
    answer: (n: number) => Response,
  ): Promise<{ n: number; text?: string; error?: string }> => {
    let n = 0;
    try {
      const reply = await completeOpenAICompatible(a, endpoint, {
        timeoutMs: 5000,
        fetch: (async () => answer(++n)) as unknown as typeof fetch,
      });
      return { n, text: reply.text };
    } catch (e) {
      return { n, error: (e as Error).message };
    }
  };
  // An unreadable reply is the planner's to judge: the route never asks again for it.
  const prose = await calls(ask(), () => stream("I've set the reminder."));
  assert.equal(prose.n, 1);
  assert.equal(parsePlan(prose.text!), undefined);
  // A server that refuses the field twice fails after two calls, never a third.
  const refused = await calls(ask(), () => new Response('unsupported', { status: 400 }));
  assert.deepEqual([refused.n, typeof refused.error], [2, 'string']);
  // Other errors and asks without a schema are not retried.
  assert.equal((await calls(ask(), () => new Response('down', { status: 500 }))).n, 1);
  const { schema: _schema, ...plain } = ask();
  assert.equal((await calls(plain, () => new Response('unsupported', { status: 400 }))).n, 1);
});
