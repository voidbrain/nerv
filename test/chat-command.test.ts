import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCommand, statusText } from '../src/chat-command.ts';
import { Runtime } from '../src/runtime.ts';
import { makeServer } from '../src/server.ts';
test('status commands and the reported prose alias resolve only registered identities, with no model interpretation', () => {
  assert.deepEqual(readCommand('Ask Tabgha his /status'), { name: 'status', target: 'Tabgha' });
  assert.deepEqual(readCommand('/status@ExampleBot NERV-02'), { name: 'status', target: 'NERV-02' });
  assert.equal(readCommand('tell me a story'), undefined);
  assert.equal(readCommand('/command')?.name, 'unknown');
  const bases = [
    {
      baseId: 'NERV-02',
      name: 'Tabgha',
      online: true,
      health: { state: 'degraded', reasons: ['local route unavailable'] },
    },
  ];
  assert.match(statusText(bases, 'Tabgha', 'en'), /NERV-02 · Tabgha\nState: degraded/);
  assert.match(statusText(bases, 'NERV-02', 'it'), /Stato: degraded/);
  assert.match(statusText(bases, 'Unknown', 'en'), /Base not found/);
});
test('authenticated status/help/unknown commands answer before dispatch and planning, without creating sorties', async () => {
  const runtime = new Runtime(':memory:');
  let dispatched = 0;
  runtime.setDispatch(async () => {
    dispatched++;
    return undefined;
  });
  const token = 'c'.repeat(32);
  const server = makeServer(runtime, token);
  try {
    await runtime.ready();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/chat`;
    const send = async (message: string) =>
      (await (
        await fetch(url, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({ message, conversation: 'dashboard' }),
        })
      ).json()) as { command: boolean; reply: string; sortieId: string };
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: '/status' }),
        })
      ).status,
      401,
    );
    for (const message of ['/status', '/help', '/unknown', 'Ask Tabgha his /status']) {
      const reply = await send(message);
      assert.equal(reply.command, true);
      assert.ok(reply.reply);
      assert.equal(reply.sortieId, '');
    }
    assert.equal(dispatched, 0);
    assert.deepEqual(await runtime.sorties(), []);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await runtime.close();
  }
});
