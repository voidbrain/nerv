// B-175 stage 1 (owner decision 2026-11-26): an isolation refusal is explained in plain words, and the dashboard
// chat can start a new conversation, whose id the server accepts and whose context starts clean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolationRefusalReply } from '../src/policy.ts';
import { channelFromConversation, validChatConversation } from '../src/request-queue.ts';
import { Runtime } from '../src/runtime.ts';
import { makeServer } from '../src/server.ts';

test('B-175: the isolation refusal reply names the tool and the way out, in Italian and English', () => {
  const it = isolationRefusalReply('it', 'fixture.read');
  assert.match(it, /fixture\.read/);
  assert.match(it, /nuova conversazione/);
  assert.match(it, /30 minuti/);
  const en = isolationRefusalReply('en', 'fixture.read');
  assert.match(en, /fixture\.read/);
  assert.match(en, /new conversation/);
  assert.match(en, /30 minutes/);
});

test('B-175: a chat conversation is a short lowercase name or a dashboard conversation id; nothing else', () => {
  for (const ok of ['dashboard', 'cli', 'dashboard:k3x9a2b7', 'dashboard:' + 'a'.repeat(30)])
    assert.equal(validChatConversation(ok), true, ok);
  for (const bad of [
    undefined,
    7,
    '',
    'Dashboard',
    'a'.repeat(21),
    'dashboard:',
    'dashboard:' + 'a'.repeat(31),
    'dashboard:Abc',
    'dashboard:a b',
    'telegram:12345',
    'kaji:nerv-02-x',
  ])
    assert.equal(validChatConversation(bad), false, String(bad));
  assert.equal(channelFromConversation('dashboard:k3x9a2b7'), 'dashboard');
  assert.equal(channelFromConversation('dashboard'), 'dashboard');
});

test('B-175: the dashboard new-conversation id reaches the server and is accepted; a foreign one is refused', async () => {
  const source = readFileSync('web/public/dashboard/live.js', 'utf8');
  const start = source.indexOf('  function newConversationId(');
  const end = source.indexOf('\n  }\n', start);
  assert.ok(start > 0 && end > start, 'live.js defines newConversationId');
  const make = new Function(`${source.slice(start, end + 4)}; return newConversationId;`) as () => () => string;
  const ids = Array.from({ length: 20 }, () => make()());
  assert.ok(
    ids.every((id) => validChatConversation(id) && id.startsWith('dashboard:')),
    ids.join(', '),
  );
  assert.equal(new Set(ids).size, ids.length, 'each new conversation has its own id');
  assert.match(readFileSync('web/public/dashboard/index.html', 'utf8'), /id="chat-new"/);

  const runtime = new Runtime(':memory:');
  const token = 'c'.repeat(32);
  const server = makeServer(runtime, token);
  try {
    await runtime.ready();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/chat`;
    const send = (conversation: string) =>
      fetch(url, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ message: '/help', conversation }),
      });
    const accepted = await send(ids[0]!);
    assert.equal(accepted.status, 200);
    assert.equal(((await accepted.json()) as { command: boolean }).command, true);
    const refused = await send('telegram:12345');
    assert.equal(refused.status, 400);
    await refused.body?.cancel();
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await runtime.close();
  }
});
