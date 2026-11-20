// F-083-T06: a saved recipe walked through one step at a time, in Italian and English; only saved steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookingSessions, readCookingCommand, recipeParts } from '../src/cooking-session.ts';
import { Store } from '../src/store.ts';

// An invented recipe in the shape NERV saves (F-083-T01).
const body =
  'Ingredients:\n- 200 g oat flour\n- 120 ml maple syrup\n\nSteps:\n1. Whisk the flour and syrup.\n2. Rest 10 minutes.\n3. Bake 18 min at 180 C.\n\nNotes:\nKeeps two days.';

test('F-083-T06: the saved ingredients and steps, verbatim; notes and loose text are neither', () => {
  assert.deepEqual(recipeParts(body), {
    ingredients: ['200 g oat flour', '120 ml maple syrup'],
    steps: ['Whisk the flour and syrup.', 'Rest 10 minutes.', 'Bake 18 min at 180 C.'],
  });
  assert.deepEqual(recipeParts('Ingredienti:\n- 1 uovo\nProcedimento:\n1) Sbatti.\n2) Cuoci.').steps, [
    'Sbatti.',
    'Cuoci.',
  ]);
  assert.deepEqual(recipeParts('Just some text about a cake.'), { ingredients: [], steps: [] });
});

test('F-083-T06: the words, in Italian and English; anything else is not a cooking command', () => {
  assert.deepEqual(readCookingCommand('Cuciniamo la torta di avena'), {
    kind: 'start',
    recipe: 'torta di avena',
    it: true,
  });
  assert.deepEqual(readCookingCommand("let's cook the oat cake recipe"), {
    kind: 'start',
    recipe: 'oat cake',
    it: false,
  });
  assert.deepEqual(readCookingCommand('vai col primo step'), { kind: 'first' });
  assert.deepEqual(readCookingCommand('first step'), { kind: 'first' });
  for (const [w, kind] of [
    ['avanti', 'next'],
    ['Next!', 'next'],
    ['ripeti', 'repeat'],
    ['repeat', 'repeat'],
    ['indietro', 'back'],
    ['back', 'back'],
    ['basta', 'stop'],
  ] as const)
    assert.deepEqual(readCookingCommand(w), { kind }, w);
  for (const other of ['what is on today?', 'next week remind me to call Ada', 'avanti tutta con il progetto'])
    assert.equal(readCookingCommand(other), undefined, other);
});

test('F-083-T06: ingredients first, then each saved step on "first", "next", "repeat", "back"; the end closes it', () => {
  const s = new CookingSessions();
  assert.equal(s.move('chat-1', 'next'), undefined, 'no session: not for cooking');
  const start = s.start('chat-1', 'Oat Cake', body, true);
  assert.match(start, /Oat Cake — ingredienti:\n• 200 g oat flour\n• 120 ml maple syrup/);
  assert.match(start, /3 passaggi\. Di' "vai col primo step"/);
  assert.equal(s.move('chat-1', 'first'), 'Passaggio 1/3: Whisk the flour and syrup.');
  assert.equal(
    s.move('chat-1', 'next'),
    'Passaggio 2/3: Rest 10 minutes.\n\ndimmi quando pronto che avvio il timer (10 minuti).',
  );
  assert.equal(
    s.move('chat-1', 'repeat'),
    'Passaggio 2/3: Rest 10 minutes.\n\ndimmi quando pronto che avvio il timer (10 minuti).',
  );
  assert.equal(s.move('chat-1', 'back'), 'Passaggio 1/3: Whisk the flour and syrup.');
  assert.equal(s.move('chat-1', 'back'), 'Passaggio 1/3: Whisk the flour and syrup.', 'never before the first');
  s.move('chat-1', 'next');
  assert.equal(
    s.move('chat-1', 'next'),
    'Passaggio 3/3: Bake 18 min at 180 C.\n\ndimmi quando pronto che avvio il timer (18 minuti).',
  );
  assert.match(s.move('chat-1', 'next')!, /ultimo passaggio di Oat Cake/);
  assert.equal(s.has('chat-1'), false, 'the last step ends the session');
  assert.equal(s.move('chat-2', 'first'), undefined, 'sessions are per conversation');
  assert.match(s.start('chat-3', 'Notes only', 'Just some text.', false), /has no saved steps as a list/);
  assert.equal(s.has('chat-3'), false);
});

test('F-083-T06: through chat: a saved recipe is walked step by step with no model; an unknown recipe is ordinary chat', async () => {
  const { Runtime } = await import('../src/runtime.ts');
  const home = mkdtempSync(join(tmpdir(), 'nerv-cooking-'));
  const dbPath = join(home, 'nerv.sqlite');
  const seed = new Store(dbPath);
  seed.documents.save({ title: 'Oat Cake', category: 'desserts', body });
  seed.close();
  // No model is configured: every answer below comes from the saved recipe alone.
  const rt = new Runtime(dbPath, undefined, home);
  try {
    await rt.ready();
    const start = await rt.chat('Cuciniamo oat cake', 'tg:1');
    assert.equal(start.command, true);
    assert.match(start.reply!, /Oat Cake — ingredienti:/);
    assert.equal((await rt.chat('vai col primo step', 'tg:1')).reply, 'Passaggio 1/3: Whisk the flour and syrup.');
    assert.equal(
      (await rt.chat('avanti', 'tg:1')).reply,
      'Passaggio 2/3: Rest 10 minutes.\n\ndimmi quando pronto che avvio il timer (10 minuti).',
    );
    assert.equal((await rt.chat('indietro', 'tg:1')).reply, 'Passaggio 1/3: Whisk the flour and syrup.');
    const unknown = await rt.chat('cook the lemon pie', 'tg:1');
    assert.notEqual(unknown.command, true, 'no saved recipe by that name: it goes to Misato like any request');
  } finally {
    await rt.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('F-083-T07: timers in a cooking session — set, stop, step prompt, and expiry line', () => {
  assert.deepEqual(readCookingCommand('imposta un timer di 10 minuti'), {
    kind: 'timer-set',
    seconds: 600,
    it: true,
  });
  assert.deepEqual(readCookingCommand('set a timer for 5 minutes'), {
    kind: 'timer-set',
    seconds: 300,
    it: false,
  });
  assert.deepEqual(readCookingCommand('stoppa il timer'), { kind: 'timer-stop', it: true });
  assert.deepEqual(readCookingCommand('stop the timer'), { kind: 'timer-stop', it: false });

  const scheduled: { fn: () => void; ms: number; cancelled?: boolean }[] = [];
  const s = new CookingSessions({
    schedule: (fn, ms) => {
      const entry = { fn, ms, cancelled: false };
      scheduled.push(entry);
      return entry;
    },
    cancel: (handle) => {
      (handle as { cancelled: boolean }).cancelled = true;
    },
  });

  const timedBody = [
    'Ingredienti:',
    '- 100 g farina',
    'Procedimento:',
    '1. Mescola tutto',
    '2. Cuoci per 10 minuti',
  ].join('\n');
  s.start('tg:1', 'Torta veloce', timedBody, true);
  assert.equal(s.move('tg:1', 'first'), 'Passaggio 1/2: Mescola tutto');
  const step2 = s.move('tg:1', 'next');
  assert.ok(step2?.includes('Cuoci per 10 minuti'));
  assert.ok(step2?.includes('dimmi quando pronto che avvio il timer'));

  const fired: string[] = [];
  const confirmed = s.confirmTimer('tg:1', (line) => fired.push(line));
  assert.equal(confirmed, 'Timer impostato: 10 minuti.');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]!.ms, 600_000);

  // Stopping cancels the scheduled timer.
  assert.equal(s.stopTimer('tg:1'), 'Timer fermato.');
  assert.equal(scheduled[0]!.cancelled, true);

  // Explicit timer set fires its own announcement line on expiry.
  assert.equal(
    s.setTimer('tg:1', 600, (line) => fired.push(line)),
    'Timer impostato: 10 minuti.',
  );
  assert.equal(scheduled.length, 2);
  scheduled[1]!.fn();
  assert.deepEqual(fired, ['Timer scaduto (10 minuti) — Torta veloce.']);
});

test('F-083-T07: Runtime.chat sets/stops cooking timers and delivers expiry line to inbox', async () => {
  const { Runtime } = await import('../src/runtime.ts');
  const home = mkdtempSync(join(tmpdir(), 'nerv-cook-timer-'));
  const dbPath = join(home, 'nerv.sqlite');
  const seed = new Store(dbPath);
  seed.documents.save({
    title: 'Zuppa rapida',
    category: 'recipes',
    body: ['Ingredienti:', '- 500 ml brodo', 'Procedimento:', '1. Bolli per 1 secondo'].join('\n'),
  });
  seed.close();
  const rt = new Runtime(dbPath, undefined, home);
  try {
    await rt.ready();

    const start = await rt.chat('cuciniamo Zuppa rapida', 'tg:2');
    assert.equal(start.command, true);

    const step1 = await rt.chat('vai col primo step', 'tg:2');
    assert.ok(step1.reply?.includes('dimmi quando pronto che avvio il timer'));

    const set = await rt.chat('imposta un timer di 10 minuti', 'tg:2');
    assert.equal(set.command, true);
    assert.equal(set.reply, 'Timer impostato: 10 minuti.');

    const stopped = await rt.chat('stoppa il timer', 'tg:2');
    assert.equal(stopped.command, true);
    assert.equal(stopped.reply, 'Timer fermato.');

    // Repeat the step to re-arm its 1-second pending timer, then confirm with "pronto".
    await rt.chat('ripeti', 'tg:2');
    const quick = await rt.chat('pronto', 'tg:2');
    assert.equal(quick.command, true);
    assert.equal(quick.reply, 'Timer impostato: 1 secondo.');

    await new Promise((r) => setTimeout(r, 1150));
    const inbox = (await rt.nervous.call('inbox.list', {})) as Record<string, unknown>[];
    assert.ok(
      inbox.some((m) => JSON.stringify(m).includes('Timer scaduto (1 secondo) — Zuppa rapida.')),
      `expected timer expiry notice in inbox, got ${JSON.stringify(inbox)}`,
    );
  } finally {
    await rt.close();
    rmSync(home, { recursive: true, force: true });
  }
});
