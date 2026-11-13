import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, OWNER_SOURCE } from '../src/store.ts';
import { defaultPolicy } from '../src/policy.ts';
import { formatDurationMs, formatSortieTimings, computeRoleTimingStats } from '../src/timing.ts';
import { explainRecord } from '../src/why.ts';
import { composeBrief, gatherBrief } from '../src/brief.ts';
import { Runtime } from '../src/runtime.ts';

test('F-052-T02/T03: formatting and role stats match expected output', () => {
  assert.equal(formatDurationMs(5), '5 ms');
  assert.equal(formatDurationMs(100), '0.1 s');
  assert.equal(formatDurationMs(6000), '6 s');
  assert.equal(formatDurationMs(38000), '38 s');
  assert.equal(
    formatSortieTimings([
      { role: 'misato', label: 'Misato', durationMs: 38000 },
      { role: 'casper', label: 'Casper', durationMs: 6000 },
      { role: 'seat', label: 'Tabgha', durationMs: 41000, shadow: true },
      { role: 'executor', label: 'EVA-02', durationMs: 100 },
    ]),
    'Misato 38 s · Casper 6 s · Tabgha (shadow) 41 s · EVA-02 0.1 s',
  );
  const stats = computeRoleTimingStats([
    { role: 'Misato', durationMs: 1000 },
    { role: 'Misato', durationMs: 3000 },
    { role: 'Misato', durationMs: 38000 },
    { role: 'Casper', durationMs: 6000 },
    { role: 'Casper', durationMs: 2000 },
  ]);
  assert.deepEqual(stats, [
    { role: 'Misato', count: 3, medianMs: 3000, maxMs: 38000 },
    { role: 'Casper', count: 2, medianMs: 4000, maxMs: 6000 },
  ]);
});

test('F-052-T02: Runtime records per-call duration on consultant, Misato, Casper, extra seat, and executor', async () => {
  const s = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (c) => (raw += c))
      .on('end', () => {
        setTimeout(() => {
          const r = JSON.parse(raw) as { model: string; messages: { content: string }[] };
          const sys = r.messages[0]!.content;
          let out: string;
          if (sys.startsWith('You are a consultant')) out = 'Use reminders.add.';
          else if (sys.startsWith('You are Casper')) out = '{"vote":"approve","reason":"Matches.","confidence":0.9}';
          else if (r.messages.some((m) => m.content.includes('"outcome":"grant"'))) out = '{"reply":"Done."}';
          else out = '{"action":{"tool":"reminders.add","args":{"title":"Test timing","due":"2030-01-01T09:00:00Z"}}}';
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ model: r.model, choices: [{ message: { content: out }, finish_reason: 'stop' }] }));
        }, 15);
      });
  });
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  const url = `http://127.0.0.1:${(s.address() as { port: number }).port}/v1`;
  const home = mkdtempSync(join(tmpdir(), 'nerv-f052-'));
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      models: {
        local: { baseUrl: url, model: 'm' },
        roles: { misato: { route: 'local' }, consultant: { model: 'advisor' } },
      },
    }),
  );
  // Make reminders.add Pattern Orange so Casper + extra seat are asked.
  writeFileSync(join(home, 'scrolls.json'), JSON.stringify({ ...defaultPolicy, localOnly: [] }), { mode: 0o600 });
  const rt = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
  try {
    await rt.ready();
    rt.useExtraSeat({
      seat: 'tabgha',
      effects: ['write-local'],
      shadow: false,
      ask: async () => {
        await new Promise((r) => setTimeout(r, 12));
        return { vote: 'approve', reason: 'remote ok', durationMs: 12 };
      },
    });
    const out = await rt.chat('Please remind me tomorrow', 'cli');
    const events = (await rt.events(out.sortieId, 0, 50)) as {
      kind: string;
      payload: Record<string, unknown>;
    }[];
    const consult = events.find((e) => e.kind === 'misato.consult');
    assert.ok(consult);
    assert.equal(typeof consult.payload.durationMs, 'number');
    assert.ok((consult.payload.durationMs as number) >= 10);

    const step = events.find((e) => e.kind === 'misato.step');
    assert.ok(step);
    assert.equal(typeof step.payload.durationMs, 'number');
    assert.ok((step.payload.durationMs as number) >= 10);

    const reply = events.find((e) => e.kind === 'misato.reply');
    assert.ok(reply);
    assert.equal(typeof reply.payload.durationMs, 'number');
    assert.ok((reply.payload.durationMs as number) >= 10);

    const done = events.find((e) => e.kind === 'action.done');
    assert.ok(done);
    assert.equal(typeof done.payload.durationMs, 'number');

    const ballot = events.find((e) => e.kind === 'ballot');
    assert.ok(ballot);
    const verdicts = ballot.payload.verdicts as { seat: string; durationMs?: number }[];
    const tabgha = verdicts.find((v) => v.seat === 'extra:tabgha');
    assert.ok(tabgha);
    assert.equal(tabgha.durationMs, 12);

    const detail = (await rt.sortie(out.sortieId)) as {
      timings?: { role: string; durationMs: number }[];
      detail: { durationMs?: number }[];
    } | null;
    assert.ok(detail && detail.timings && detail.timings.length >= 3);
    assert.equal(typeof detail.detail[0]!.durationMs, 'number');
  } finally {
    await rt.close();
    await new Promise<void>((d) => {
      s.close(() => d());
      s.closeAllConnections();
    });
    rmSync(home, { recursive: true, force: true });
  }
});

test('F-052-T03: explainRecord and Ledger.explain include timings line in EN and IT', () => {
  const store = new Store(':memory:', { policy: defaultPolicy, source: 'test' });
  try {
    const id = store.ledger.openSortie(OWNER_SOURCE, 'Check timings', 'trusted');
    store.ledger.note(id, 'misato.step', { step: { outcome: 'grant', tool: 'reminders.cancel' }, durationMs: 38000 });
    const p = store.ledger.propose(id, {
      tool: 'reminders.cancel',
      args: { id: 'rem-1' },
      stage: 'production',
      casper: { seat: 'casper', vote: 'approve', reason: 'ok', durationMs: 6000 },
      extras: [{ seat: 'tabgha', vote: 'approve', reason: 'ok', shadow: true, durationMs: 41000 }],
    });
    store.ledger.authorize(p.grantId!, 'reminders.cancel', { id: 'rem-1' });
    store.ledger.finished(id, p.actionId, 'reminders.cancel', { result: { cancelled: true } }, new Date(), 100);
    store.ledger.close(id, 'done');

    const explained = store.ledger.explain(id.slice(0, 8));
    assert.equal(explained.found, 'one');
    if (explained.found === 'one') {
      const en = explainRecord(explained, id.slice(0, 8), 'en', 'Europe/Rome');
      assert.match(en, /Timings: Misato 38 s · Casper 6 s · Tabgha \(shadow\) 41 s · EVA-02 0\.1 s\./);
      const it = explainRecord(explained, id.slice(0, 8), 'it', 'Europe/Rome');
      assert.match(it, /Tempi: Misato 38 s · Casper 6 s · Tabgha \(ombra\) 41 s · EVA-02 0\.1 s\./);
    }
  } finally {
    store.close();
  }
});

test('F-052-T03/T04: dashboard renders sortie detail timings and live/finished Sephirot node times without false communicating', () => {
  const js = readFileSync('web/public/dashboard/dashboard.js', 'utf8');

  const startIdx = js.indexOf('function formatDurationMs(');
  const endIdx = js.indexOf('\nfunction ', js.indexOf('function formatTimingsLine(') + 1);
  const fn = new Function(
    'document',
    'window',
    `${js.slice(startIdx, endIdx)}
     return { formatDurationMs, formatTimingsLine };`,
  ) as (
    d: unknown,
    w: unknown,
  ) => {
    formatDurationMs: (ms: number) => string;
    formatTimingsLine: (t: { label: string; durationMs: number; shadow?: boolean }[]) => string;
  };
  const helpers = fn({}, {});
  assert.equal(
    helpers.formatTimingsLine([
      { label: 'Misato', durationMs: 38000 },
      { label: 'Casper', durationMs: 6000 },
      { label: 'Tabgha', durationMs: 41000, shadow: true },
      { label: 'EVA-02', durationMs: 100 },
    ]),
    'Misato 38 s · Casper 6 s · Tabgha (shadow) 41 s · EVA-02 0.1 s',
  );
  // Ensure no false "communicating" claim is introduced in dashboard.js or live.js
  const liveJs = readFileSync('web/public/dashboard/live.js', 'utf8');
  assert.equal(/communicating/i.test(js), false);
  assert.equal(/communicating/i.test(liveJs), false);
});

test('F-052-T05: Ledger.timingSummary and brief include median and slowest per role', async () => {
  const store = new Store(':memory:', { policy: defaultPolicy, source: 'test' });
  try {
    const t0 = new Date('2030-01-01T08:00:00Z');
    const s1 = store.ledger.openSortie(OWNER_SOURCE, 'S1', 'trusted', t0);
    store.ledger.note(s1, 'misato.step', { step: { outcome: 'grant', tool: 'reminders.add' }, durationMs: 2000 }, t0);
    store.ledger.note(s1, 'misato.step', { step: { outcome: 'grant', tool: 'reminders.add' }, durationMs: 38000 }, t0);
    store.ledger.note(s1, 'misato.step', { step: { outcome: 'grant', tool: 'reminders.add' }, durationMs: 4000 }, t0);
    store.ledger.note(
      s1,
      'kaji.answered',
      { base: { id: 'tabgha', name: 'Tabgha' }, sortieId: 'x', transferMs: 1200 },
      t0,
    );

    const facts = await gatherBrief(store, new Date('2030-01-01T00:00:00Z'));
    assert.ok(facts.timings && facts.timings.length >= 2);
    const misato = facts.timings!.find((r) => r.role === 'Misato');
    assert.deepEqual(misato, { role: 'Misato', count: 3, medianMs: 4000, maxMs: 38000 });

    const briefEn = composeBrief({ now: t0, timeZone: 'Europe/Rome', language: 'en', ...facts });
    assert.match(briefEn, /Timings \(median \/ slowest\):/);
    assert.match(briefEn, /Misato: 4 s \/ 38 s \(3\)/);

    const briefIt = composeBrief({ now: t0, timeZone: 'Europe/Rome', language: 'it', ...facts });
    assert.match(briefIt, /Tempi \(mediana \/ più lento\):/);
  } finally {
    store.close();
  }
});
