import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_CATALOG, helpText, readCommand, statusText } from '../src/chat-command.ts';
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
    for (const message of [
      '/status',
      '/help',
      '/cards',
      '/reminders',
      '/why S-1A2B',
      '/brief',
      '/pilots',
      '/bases',
      '/spear',
      '/log steps',
      '/unknown',
      'Ask Tabgha his /status',
    ]) {
      const reply = await send(message);
      assert.equal(reply.command, true);
      assert.ok(reply.reply);
      assert.equal(reply.sortieId, '');
    }
    assert.equal(COMMAND_CATALOG.length, 10);
    assert.match(helpText('en'), /\/cards/);
    assert.equal(dispatched, 0);
    assert.deepEqual(await runtime.sorties(), []);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await runtime.close();
  }
});

test('F-056-T02: read-only commands (/cards, /reminders, /why, /brief, /pilots, /bases) return live local records without model calls or new sorties', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Store } = await import('../src/store.ts');
  const home = mkdtempSync(join(tmpdir(), 'nerv-f056-t02-'));
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      base: { id: 'NERV-01', name: 'Tokyo-3' },
      brief: { at: '07:30' },
      timeZone: 'Europe/Rome',
      pilots: [{ id: 'pilot-1', name: 'Rei', domain: 'ops', keywords: ['ops'], stage: 'production', model: 'qwen' }],
    }),
  );
  const dbPath = join(home, 'nerv.sqlite');
  let runtime: Runtime | undefined;
  let server: ReturnType<typeof makeServer> | undefined;
  try {
    const seed = new Store(dbPath);
    try {
      seed.add('Check battery storage', '2030-01-01T09:00:00.000Z');
      seed.addBrief('Daily brief: 1 pending reminder.');
      const sortie = seed.ledger.openSortie('misato', 'Test sortie for /why', 'trusted');
      const proposed = await seed.ledger.propose(sortie, {
        tool: 'memory.remember',
        args: { text: 'Owner prefers tea' },
        stage: 'production',
      });
      assert.ok(proposed.approvalId);

      runtime = new Runtime(dbPath, undefined, home);
      let modelCalls = 0;
      runtime.setDispatch(async () => {
        modelCalls++;
        return undefined;
      });
      (runtime as unknown as { bases: () => Promise<unknown[]> }).bases = async () => [
        { baseId: 'NERV-01', name: 'Tokyo-3', online: true, self: true },
        { baseId: 'NERV-02', name: 'Tabgha', online: false },
      ];
      const token = 'd'.repeat(32);
      server = makeServer(runtime, token);
      await runtime.ready();
      await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/chat`;
      const send = async (message: string) =>
        (await (
          await fetch(url, {
            method: 'POST',
            headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
            body: JSON.stringify({ message, conversation: 'dashboard' }),
          })
        ).json()) as { command: boolean; reply: string; sortieId: string };

      const cardsReply = await send('/cards');
      assert.equal(cardsReply.command, true);
      assert.equal(cardsReply.sortieId, '');
      assert.match(cardsReply.reply, /memory\.remember/);

      const remindersReply = await send('/reminders');
      assert.match(remindersReply.reply, /Check battery storage/);

      const whyReply = await send(`/why S-${sortie.slice(0, 4).toUpperCase()}`);
      assert.match(whyReply.reply, /Test sortie for \/why/);

      const briefReply = await send('/brief');
      assert.match(briefReply.reply, /07:30/);
      assert.match(briefReply.reply, /Daily brief: 1 pending reminder\./);

      const pilotsReply = await send('/pilots');
      assert.match(pilotsReply.reply, /pilot-1 · Rei/);

      const basesReply = await send('/bases');
      assert.match(basesReply.reply, /NERV-01 · Tokyo-3 \(online, self\)/);
      assert.match(basesReply.reply, /NERV-02 · Tabgha \(offline\)/);

      assert.equal(modelCalls, 0);
      assert.equal((await runtime.sorties()).length, 1);
    } finally {
      seed.close();
    }
  } finally {
    if (server?.listening) await new Promise<void>((done) => server!.close(() => done()));
    await runtime?.close();
    rmSync(home, { recursive: true, force: true });
  }
});
