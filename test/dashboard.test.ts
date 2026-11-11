import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, OWNER_SOURCE } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { defaultPolicy } from '../src/policy.ts';
async function serve(
  store: Store,
  webRoot: string,
  work: (base: string, headers: Record<string, string>) => Promise<void>,
) {
  const token = 'e'.repeat(32);
  const server = makeServer(store, token, { webRoot });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    await work(`http://127.0.0.1:${(server.address() as { port: number }).port}`, { authorization: 'Bearer ' + token });
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}
test("the dashboard reads: sorties newest first with counts and Patterns, one sortie with each action's outcome, no grant IDs", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-dash-'));
  const store = new Store(':memory:', { policy: { ...defaultPolicy, blue: ['reminders.cancel'] }, source: 'test' });
  try {
    const done = store.ledger.openSortie(OWNER_SOURCE, 'Remind me', 'trusted', new Date('2030-01-01T00:00:00Z'));
    store.runAction(done, {
      tool: 'reminders.add',
      args: { title: 'Call Ada', due: '2031-01-01T09:00:00Z' },
      stage: 'production',
    });
    const waiting = store.ledger.openSortie(OWNER_SOURCE, 'Cancel it', 'trusted', new Date('2030-01-02T00:00:00Z'));
    store.runAction(waiting, { tool: 'reminders.cancel', args: { id: 'x' }, stage: 'production' });
    await serve(store, dir, async (base, headers) => {
      const list = (await (await fetch(base + '/api/sorties?limit=10', { headers })).json()) as {
        id: string;
        status: string;
        waiting: number;
        patterns: string[];
        actions: number;
      }[];
      assert.deepEqual(
        list.map((s) => [s.id, s.status, s.waiting, s.patterns]),
        [
          [waiting, 'open', 1, ['blue']],
          [done, 'done', 0, ['green']],
        ],
      );
      const older = (await (
        await fetch(base + '/api/sorties?before=2030-01-02T00:00:00.000Z', { headers })
      ).json()) as { id: string }[];
      assert.deepEqual(
        older.map((s) => s.id),
        [done],
      );
      const one = (await (await fetch(base + '/api/sorties/' + waiting, { headers })).json()) as {
        detail: { tool: string; status: string; ballot: { pattern: string } }[];
      };
      assert.deepEqual(
        one.detail.map((a) => [a.tool, a.status, a.ballot.pattern]),
        [['reminders.cancel', 'waiting', 'blue']],
      );
      assert.deepEqual(
        (
          (await (await fetch(base + '/api/sorties/' + done, { headers })).json()) as { detail: { status: string }[] }
        ).detail.map((a) => a.status),
        ['done'],
      );
      const everything = JSON.stringify([list, one]);
      assert.ok(!everything.includes('grantId'));
      assert.equal((await fetch(base + '/api/sorties/0000', { headers })).status, 404);
      assert.equal((await fetch(base + '/api/sorties?limit=99', { headers })).status, 400);
      assert.equal((await fetch(base + '/api/sorties?x=1', { headers })).status, 400);
      assert.equal((await fetch(base + '/api/sorties')).status, 401);
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('the service serves /dashboard from its own index.html, and every other route from the app', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-web-'));
  mkdirSync(join(dir, 'dashboard'));
  writeFileSync(join(dir, 'index.html'), '<nerv-app></nerv-app>');
  writeFileSync(join(dir, 'dashboard', 'index.html'), '<title>dash</title>');
  writeFileSync(join(dir, 'dashboard', 'live.js'), '//');
  const store = new Store(':memory:');
  try {
    await serve(store, dir, async (base) => {
      for (const p of ['/dashboard', '/dashboard/']) assert.match(await (await fetch(base + p)).text(), /<title>dash/);
      assert.match((await fetch(base + '/dashboard/live.js')).headers.get('content-type')!, /javascript/);
      assert.match(await (await fetch(base + '/reminders')).text(), /nerv-app/);
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('the shipped dashboard loads no remote script or font and has no inline script, so it runs under the service CSP', () => {
  const html = readFileSync('web/public/dashboard/index.html', 'utf8');
  assert.doesNotMatch(html, /<script>(?!<\/script>)/);
  assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)[^"' ]+\.(js|css)|fonts\.googleapis|cdn\./);
  assert.deepEqual(
    [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]),
    ['dashboard.js', 'live.js'],
  );
  assert.doesNotMatch(readFileSync('web/public/dashboard/dashboard.js', 'utf8'), /\bd3\./);
});
test('the dashboard Spear (admin, through the scheduler process) stands down a waiting card, closes the sortie and stops a resume', async () => {
  const { Runtime } = await import('../src/runtime.ts');
  const dir = mkdtempSync(join(tmpdir(), 'nerv-spear-'));
  const path = join(dir, 'nerv.sqlite');
  writeFileSync(join(dir, 'scrolls.json'), JSON.stringify({ blue: ['reminders.cancel'] }), { mode: 0o600 });
  const runtime = new Runtime(path, undefined, dir);
  const token = 'f'.repeat(32);
  const server = makeServer(runtime, token);
  try {
    await runtime.ready();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const act = await runtime.act({ request: 'Cancel it', tool: 'reminders.cancel', args: { id: 'x' } });
    assert.equal(act.outcome, 'approval');
    const spear = (id: string, headers: Record<string, string> = { authorization: 'Bearer ' + token }) =>
      fetch(base + `/api/sorties/${id}/spear`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'stop' }),
      });
    assert.equal((await spear(act.sortieId, {})).status, 401);
    const r = (await (await spear(act.sortieId)).json()) as { revoked: number; stoodDown: number; happened: unknown[] };
    assert.deepEqual(r, { revoked: 0, stoodDown: 1, happened: [] });
    assert.equal((await runtime.approvals()).length, 0);
    assert.equal((await runtime.sortie(act.sortieId))!.status, 'revoked');
    assert.equal(
      (await runtime.decide(act.approvalId!, 'approve', 'api')).decision,
      'revoked',
      'a stood-down card can no longer be approved',
    );
    assert.equal((await spear('00000000-0000-0000-0000-000000000000')).status, 404);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('the Lilith API (admin, through the scheduler process): add, edit, share, history and forget as the owner', async () => {
  const { Runtime } = await import('../src/runtime.ts');
  const dir = mkdtempSync(join(tmpdir(), 'nerv-lilith-api-'));
  const runtime = new Runtime(join(dir, 'nerv.sqlite'), undefined, dir);
  const token = 'g'.repeat(32);
  const server = makeServer(runtime, token);
  try {
    await runtime.ready();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/memory`;
    const call = (path: string, method = 'GET', body?: object, auth = true) =>
      fetch(base + path, {
        method,
        headers: { ...(auth ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    assert.equal((await call('', undefined, undefined, false)).status, 401);
    const added = (await (await call('', 'POST', { text: 'I drink coffee at 8' })).json()) as {
      id: string;
      source: string;
      shareable: boolean;
    };
    assert.equal(added.source, 'owner');
    assert.equal(added.shareable, false, 'every fact starts local-only');
    assert.equal((await call('', 'POST', { text: '' })).status, 400);
    assert.equal((await call('', 'POST', { text: 'x', extra: 1 })).status, 400);
    assert.equal(
      ((await (await call('/' + added.id, 'PUT', { text: 'I drink tea at 8' })).json()) as { text: string }).text,
      'I drink tea at 8',
    );
    assert.equal(
      ((await (await call('/' + added.id + '/share', 'POST', { shareable: true })).json()) as { shareable: boolean })
        .shareable,
      true,
    );
    assert.equal((await call('/' + added.id + '/share', 'POST', { shareable: 'yes' })).status, 400);
    assert.deepEqual(
      ((await (await call('/' + added.id + '/history')).json()) as { kind: string; source: string }[]).map((h) => [
        h.kind,
        h.source,
      ]),
      [
        ['created', 'owner'],
        ['edited', 'owner'],
        ['shared', 'owner'],
      ],
    );
    assert.equal((await call('/' + added.id + '/forget', 'POST', {})).status, 200);
    assert.deepEqual(await (await call('')).json(), []);
    assert.equal((await call('/' + added.id + '/forget', 'POST', {})).status, 404);
    assert.equal((await call('/' + added.id, 'PUT', { text: 'again' })).status, 404);
    assert.deepEqual(await (await call('/episodes')).json(), []);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('the dashboard API (admin, through the scheduler process): search sorties by title, a why per sortie, edit and cancel a reminder', async () => {
  const { Runtime } = await import('../src/runtime.ts');
  const dir = mkdtempSync(join(tmpdir(), 'nerv-practical-'));
  writeFileSync(join(dir, 'scrolls.json'), JSON.stringify({ blue: ['reminders.cancel'] }), { mode: 0o600 });
  const runtime = new Runtime(join(dir, 'nerv.sqlite'), undefined, dir);
  const token = 'h'.repeat(32);
  const server = makeServer(runtime, token);
  try {
    await runtime.ready();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    const call = (path: string, method = 'GET', body?: object, auth = true) =>
      fetch(base + path, {
        method,
        headers: { ...(auth ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const added = await runtime.act({
      request: 'Remind me to call Ada',
      tool: 'reminders.add',
      args: { title: 'Call Ada', due: '2031-01-01T09:00:00Z' },
    });
    const waiting = await runtime.act({ request: 'Cancel 100%_ of it', tool: 'reminders.cancel', args: { id: 'x' } });
    assert.equal(waiting.outcome, 'approval');
    const all = (await (await call('/sorties')).json()) as { id: string; why: string }[];
    assert.match(all.find((s) => s.id === waiting.sortieId)!.why, /^Waits for you to approve reminders\.cancel: /);
    assert.match(all.find((s) => s.id === added.sortieId)!.why, /reminders\.add/);
    const found = async (q: string) =>
      ((await (await call('/sorties?q=' + encodeURIComponent(q))).json()) as { id: string }[]).map((s) => s.id);
    assert.deepEqual(await found('ADA'), [added.sortieId], 'case-insensitive');
    assert.deepEqual(await found('100%_'), [waiting.sortieId]);
    assert.deepEqual(await found('%'), [waiting.sortieId], '% and _ are literal');
    assert.deepEqual(await found('nothing like it'), []);
    assert.equal((await found('')).length, 2, 'an empty search is no filter');
    assert.equal((await call('/sorties?q=' + 'x'.repeat(201))).status, 400);
    const reminder = (await runtime.list())[0]!;
    const edited = (await (
      await call('/reminders/' + reminder.id, 'PATCH', { title: 'Call Ada back', due: '2031-01-02T10:30:00+01:00' })
    ).json()) as { title: string; due: string };
    assert.deepEqual([edited.title, edited.due], ['Call Ada back', '2031-01-02T09:30:00.000Z']);
    assert.equal((await runtime.list())[0]!.title, 'Call Ada back', 'the scheduler stored the edit');
    assert.equal(
      (await call('/reminders/' + reminder.id, 'PATCH', { due: '2001-01-01T00:00:00Z' })).status,
      400,
      'a past time is refused',
    );
    assert.equal((await call('/reminders/' + reminder.id, 'PATCH', {})).status, 400);
    assert.equal((await call('/reminders/' + reminder.id, 'PATCH', { title: 'x', id: 'y' })).status, 400);
    assert.equal((await call('/reminders/' + reminder.id, 'PATCH', { title: 'x' }, false)).status, 401);
    assert.equal((await call('/reminders/' + reminder.id, 'DELETE')).status, 200);
    assert.equal(
      (await call('/reminders/' + reminder.id, 'PATCH', { title: 'too late' })).status,
      404,
      'a cancelled reminder cannot be edited',
    );
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('sortie times carry their day when not today, in browser local time; live mode suggests only what a live base answers (B-002, B-005)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const fn = (name: string) => new RegExp(`^function ${name}\\(.*\\}$`, 'm').exec(src)![0];
  const dayTime = new Function(`${fn('hhmm')}\n${fn('dayTime')}\nreturn dayTime;`)() as (
    t: number,
    now: number,
  ) => string;
  const now = new Date(2026, 10, 5, 15, 30).getTime(),
    at = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m, d, h, mi).getTime();
  assert.equal(dayTime(at(2026, 10, 5, 9, 7), now), '09:07');
  assert.equal(dayTime(at(2026, 10, 4, 23, 50), now), 'yesterday 23:50');
  assert.equal(dayTime(at(2026, 10, 3, 14, 5), now), '3 Nov 14:05');
  assert.equal(dayTime(at(2025, 11, 31, 8, 0), now), '31 Dec 2025 08:00');
  assert.equal(dayTime(at(2026, 0, 1, 0, 10), at(2026, 0, 1, 8, 0)), '00:10', 'midnight is still today');
  assert.equal(dayTime(at(2025, 11, 31, 22, 0), at(2026, 0, 1, 8, 0)), 'yesterday 22:00', 'yesterday across a year');
  const live = readFileSync('web/public/dashboard/live.js', 'utf8');
  const hint = /const LIVE_HINT = "([^"]+)"/.exec(live)![1]!;
  assert.match(hint, /why S-1A2B\?/);
  assert.doesNotMatch(hint, /\bstatus\b|AP-|spear/i, 'no demo-only command in live mode');
  assert.match(live, /document\.getElementById\("chat-in"\)\.placeholder = LIVE_HINT/);
});
test('every theme, mode and colour reaches WCAG AA where text sits; Eva · Dark · Orange is the original EVA Full and the stylesheet default; old choices map to the nearest (F-047)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const html = readFileSync('web/public/dashboard/index.html', 'utf8');
  const block = /\/\* palette:start[\s\S]*?\*\/([\s\S]*?)\/\* palette:end \*\//.exec(src)![1]!;
  const { palette, migrateTheme, ACCENTS } = new Function(`${block}\nreturn {palette,migrateTheme,ACCENTS};`)() as {
    palette: (t: string, m: string, a: string) => Record<string, string>;
    migrateTheme: (n: string) => string[] | undefined;
    ACCENTS: Record<string, unknown>;
  };
  const lum = (hex: string) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  };
  const fails: string[] = [];
  for (const theme of ['eva', 'simple'])
    for (const mode of ['dark', 'light'])
      for (const accent of Object.keys(ACCENTS)) {
        const p = palette(theme, mode, accent);
        const at = `${theme}·${mode}·${accent}`;
        const need = (fg: string, bg: string, min = 4.5) => {
          const r = ratio(p[fg]!, p[bg]!);
          if (r < min) fails.push(`${at}: ${fg} on ${bg} ${r.toFixed(2)}`);
        };
        for (const fg of [
          'text',
          'muted',
          'accent',
          'ok',
          'warn',
          'danger',
          'info',
          'green',
          'orange',
          'blue',
          'kanji',
          'title',
        ])
          for (const bg of ['bg', 'panel', 'panel2']) need(fg, bg);
        if (p['hdr-bg'] === 'transparent') need('hdr-fg', 'panel');
        else need('hdr-fg', 'hdr-bg');
        need('brand-fg', 'brand-bg');
        need('brand-fg', 'accent');
        need('on-danger', 'danger');
        for (const c of ['eva00', 'eva01', 'eva02', 'eva03']) need(c, 'panel2');
      }
  assert.deepEqual(fails, [], 'every pair a text or the focus ring sits on');
  const root = Object.fromEntries(
    [.../:root \{([\s\S]*?)\n\}/.exec(html)![1]!.matchAll(/--([a-z0-9-]+):([^;]+);/g)].map((m) => [m[1], m[2]!.trim()]),
  );
  for (const [k, v] of Object.entries(palette('eva', 'dark', 'orange')))
    assert.equal(root[k]?.replace(/\s/g, ''), v.replace(/\s/g, ''), `:root --${k} is Eva · Dark · Orange`);
  assert.deepEqual(palette('eva', 'dark', 'orange').text, '#ffaa66', 'the original EVA Full text colour');
  assert.deepEqual(migrateTheme('eva-full'), ['eva', 'dark', 'orange']);
  assert.deepEqual(migrateTheme('terminal'), ['simple', 'dark', 'green']);
  assert.deepEqual(migrateTheme('light'), ['simple', 'light', 'blue']);
  assert.equal(migrateTheme('eva'), undefined);
  for (const id of ['theme', 'mode', 'accent'])
    assert.match(
      html,
      new RegExp(`<label class="small muted" for="${id}">[A-Z]+</label>\\s*<select id="${id}">`),
      `${id} has its label`,
    );
  assert.doesNotMatch(html, /body\.theme-(eva-full|eva-basic|light|terminal)\b/, 'no old theme classes left');
  assert.doesNotMatch(
    html.slice(html.indexOf('* { box-sizing')),
    /rgba\(255,102,0/,
    'no fixed orange outside the default: glows follow the colour',
  );
});
test('on wide screens the page itself has nothing to scroll: the body is pinned to the window, only the columns scroll (B-014)', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync('web/public/dashboard/index.html', 'utf8');
  const wide = /@media \(min-width:1201px\) \{([\s\S]*?)\n\}/.exec(html)![1]!;
  assert.match(wide, /html \{ height:100%; overflow:hidden; \} body \{ position:fixed; inset:0; overflow:clip; \}/);
  assert.doesNotMatch(
    wide,
    /html,body \{ height:100%; \} body \{ overflow:hidden; \}/,
    'overflow hidden alone let the page stay scrolled, header cut off',
  );
});
test('the CRT effect: the original static scanlines, darker borders, a slight page flicker, two thin dark lines passing now and then; motion off when reduced (F-053)', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync('web/public/dashboard/index.html', 'utf8');
  const after = /body\.theme-eva\.crt-on::after \{([^\n]*)\}/.exec(html)![1]!;
  assert.match(
    after,
    /background:linear-gradient\(rgba\(0,0,0,0\) 50%,rgba\(0,0,0,\.22\) 50%\); background-size:100% 4px;/,
    "the owner's scanlines, unchanged",
  );
  assert.doesNotMatch(after, /animation|radial-gradient/, 'static');
  const edge = /box-shadow:inset 0 0 (\d+)px (\d+)px rgba\(0,0,0,([.0-9]+)\)/.exec(after)!;
  assert.ok(Number(edge[1]) >= 60 && Number(edge[3]) >= 0.8, 'edges strong enough to see on dark');
  const jsMotion = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  assert.match(html, /class="crt-band crt-band-a" aria-hidden="true"/);
  assert.match(html, /class="crt-band crt-band-b" aria-hidden="true"/);
  assert.match(jsMotion, /element\.animate\(plan\.frames/, 'fresh random motion pass instead of a fixed line cycle');
  for (const o of /@keyframes crt-flicker \{([^\n]*)\}/.exec(html)![1]!.matchAll(/opacity:([.0-9]+)/g))
    assert.ok(Number(o[1]) >= 0.92, 'restore the previous maximum dimming');
  assert.match(
    html,
    /@media \(prefers-reduced-motion:reduce\) \{ body\.theme-eva\.crt-on \.wrap \{ animation:none; \} body\.theme-eva\.crt-on \.crt-band, body\.theme-eva\.crt-on \.crt-noise \{ display:none; \}/,
  );
  const period = Number(/animation:crt-flicker (\d+)s /.exec(html)![1]) * 1000;
  const pulses = [.../@keyframes crt-flicker \{([^\n]*)\}/.exec(html)![1]!.matchAll(/([0-9.]+)% \{ opacity:([.0-9]+)/g)]
    .filter((m) => Number(m[2]) < 1)
    .map((m) => (Number(m[1]) * period) / 100);
  const wrapped = [...pulses, ...pulses.slice(0, 2).map((t) => t + period)];
  for (let n = 0; n < pulses.length; n++)
    assert.ok(
      wrapped[n + 2]! - wrapped[n]! > 1000,
      'at most two brightness pulses within any second, including cycle wrap',
    );

  // Two boxes (owner, 2026-11-05): pilots are the Marduk Institute, skills are Kaji's watermelons.
  assert.match(
    html,
    /<span data-l="melons">Marduk Institute · Pilots<\/span><span class="sub">proto → test → prod<\/span>/,
  );
  // Skills grow by their own stages (owner, 2026-11-05, option B): seed → sprout → ripe (Eva), create → try → use (Simple).
  assert.match(
    html,
    /<span data-l="skills">Kaji's watermelons · skills<\/span><span class="sub" data-l="skillStages">seed → sprout → ripe<\/span>/,
  );
  assert.match(
    readFileSync('web/public/dashboard/dashboard.js', 'utf8'),
    /skills:"Skills", skillStages:"create → try → use"/,
  );
  assert.match(html, /<div class="pad list" id="skills"><\/div>/, 'drawn by renderSkills, with its stage tabs (F-051)');
  const js = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  assert.match(js, /skills:"Kaji's watermelons · skills"/);
  assert.match(js, /skills:"Skills"/);
});
test('the dashboard API lists the pilot roster for the Marduk Institute panel (F-051)', async () => {
  const { makeServer } = await import('../src/server.ts');
  const roster = [
    {
      id: 'printer',
      name: 'Print Master',
      domain: '3D printing',
      keywords: ['filament'],
      model: 'gemma4:12b',
      stage: 'test' as const,
    },
  ];
  const token = 'p'.repeat(32);
  const server = makeServer({ pilotRoster: () => roster } as never, token);
  await new Promise<void>((d) => server.listen(0, '127.0.0.1', d));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    assert.equal((await fetch(base + '/pilots')).status, 401, 'admin only');
    assert.deepEqual(await (await fetch(base + '/pilots', { headers: { authorization: 'Bearer ' + token } })).json(), {
      pilots: roster,
    });
  } finally {
    await new Promise<void>((d) => server.close(() => d()));
  }
});
test('on start the dashboard shows the real state: only a running sortie is selected by itself, and let go when it ends; a click keeps it (owner, 2026-11-05)', async () => {
  const { readFileSync } = await import('node:fs');
  const live = readFileSync('web/public/dashboard/live.js', 'utf8');
  const js = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  assert.doesNotMatch(live, /state\.selected = state\.sorties\[0\]\.id/, 'never the newest sortie by default');
  assert.match(live, /const running = state\.sorties\.find\(x => x\.status === "active"\);/);
  assert.match(live, /state\.selected = running\.id; state\.autoSelected = true;/);
  assert.match(live, /state\.selected = null; state\.autoSelected = false;/);
  assert.match(
    js,
    /state\.selected = t\.dataset\.s; state\.deselected = false; state\.autoSelected = false;/,
    "a click is the owner's choice",
  );
});
test("the route colours: advice that was given is a passed step (green); Misato's apartment passed through the owner's decision takes the decision colour (owner, 2026-11-05)", async () => {
  const { readFileSync } = await import('node:fs');
  const live = readFileSync('web/public/dashboard/live.js', 'utf8');
  const js = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const html = readFileSync('web/public/dashboard/index.html', 'utf8');
  assert.match(
    live,
    /const done = \{ detect:true, intake:true, route:true, consult:consulted\.has\(s\.id\),/,
    'ADVISE is passed when the consultant advised',
  );
  assert.match(js, /if \(st === "done" && el\.dataset\.n === "apt"\) el\.classList\.add\("owner"\);/);
  assert.match(js, /el\.classList\.remove\("on", "done", "wait", "skip", "owner"\)/);
  assert.match(html, /\.snode\.done\.owner \{ border-color:var\(--warn\); \}/);
  assert.match(
    html,
    /\.tstep\.done\.owner \{ border-color:var\(--warn\); color:var\(--warn\); \}/,
    'the Simple theme timeline too',
  );
});
test('the Marduk Institute reads the generic pilot from the models API as it answers; bases read ID · name; the map leaves room for its legend (B-017, owner 2026-11-05)', async () => {
  const { readFileSync } = await import('node:fs');
  const live = readFileSync('web/public/dashboard/live.js', 'utf8');
  const html = readFileSync('web/public/dashboard/index.html', 'utf8');
  assert.match(
    live,
    /const roles = modelsData && modelsData\.models && modelsData\.models\.roles;/,
    'GET /api/models nests the roles under models',
  );
  assert.match(live, /roster === undefined\) \{ box\.innerHTML = "<div class='muted small'>Loading pilots…<\/div>"/);
  assert.match(live, /pilot-model-/);
  assert.match(live, /esc\(b\.baseId\) \+ " · " \+ esc\(b\.name\)/);
  assert.match(live, /esc\(base\.id\) \+ " · " \+ esc\(base\.name\)/);
  assert.doesNotMatch(live, /esc\(b\.name\) \+ " · " \+ esc\(b\.baseId\)/);
  assert.match(html, /<div class="maprow">\s*<div class="mapwrap">/);
  assert.match(html, /\.maplegend \{ display:flex; flex-direction:column;/);
});
test('searching sorties marks the searched text in each title, escaped and case-insensitive (F-019)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const fn = (name: string) => {
    const i = src.indexOf(`function ${name}(`);
    let depth = 0,
      j = src.indexOf('{', i);
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) break;
    }
    return src.slice(i, j + 1);
  };
  const highlight = new Function(`${fn('esc')}\n${fn('highlight')}\nreturn highlight;`)() as (
    t: string,
    q: string,
  ) => string;
  assert.equal(highlight('Remind me to call Ada', 'ada'), 'Remind me to call <mark>Ada</mark>');
  assert.equal(
    highlight('Water the plants, water more', 'WATER'),
    '<mark>Water</mark> the plants, <mark>water</mark> more',
  );
  assert.equal(highlight('a <b> & c', '<b>'), 'a <mark>&lt;b&gt;</mark> &amp; c', 'escaped first, no HTML injected');
  assert.equal(highlight('price (1.5)', '(1.5)'), 'price <mark>(1.5)</mark>', 'regex characters are literal');
  assert.equal(highlight('Plain', '  '), 'Plain');
  assert.match(src, /highlight\(s\.title, state\.search\)/, 'used on the sortie cards');
});
test('the map: labels scale with the canvas so they stay readable, this base has a larger square but equally sized status-coloured labels, other bases get a stable scattered spot (owner, 2026-11-05)', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const live = readFileSync('web/public/dashboard/live.js', 'utf8');
  assert.match(js, /const z = Math\.max\(1, W \/ \(\(cv\.clientWidth \|\| W\)\)\);/);
  assert.match(js, /ctx\.font = Math\.round\(12 \* z\)/);
  assert.doesNotMatch(js, /ctx\.arc\(x, y, s \* 1\.1/);
  assert.match(js, /ctx\.fillStyle = col; const label = b\.name/);
  assert.match(
    js,
    /const self = !!b\.self \|\| \(!anySelf && b === BASES\[0\]\); const main = !!b\.main;/,
    'main and this base have separate shape cues',
  );
  assert.match(js, /const face = cssVar\("--font"\) \|\| "monospace";/, 'the full font list, so a fallback applies');
  assert.match(live, /self:!!b\.self/);
  assert.doesNotMatch(live, /- Math\.PI \/ 2; return b === self/, 'no more column under the main base');
  const seedSrc = /const seed = id => \{[^\n]*\};/.exec(live)![0];
  const seed = new Function(`${seedSrc} return seed;`)() as (id: string) => number;
  assert.equal(seed('NERV-02'), seed('NERV-02'), 'the same spot on every reload');
  assert.notEqual(seed('NERV-02') % 3600, seed('NERV-03') % 3600);
});
test('F-051 slice 1: the running phase from the latest event, who advised, base names for extra seats, skipped steps labelled, Pattern badges in words, stage tabs in both sections', async () => {
  const { readFileSync } = await import('node:fs');
  const live = readFileSync('web/public/dashboard/live.js', 'utf8');
  const js = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const html = readFileSync('web/public/dashboard/index.html', 'utf8');
  assert.match(
    live,
    /log\(command \? "Checking command…" : main \? "Forwarded to " \+ main\.name \+ " · Misato there is planning" : "Misato is planning"/,
  );
  assert.doesNotMatch(live, /local models take 10–30 s per step/);
  assert.match(live, /status === "active" \? \(phaseOf\.get\(s\.id\) \|\| "plan"\)/, 'not always MAGI');
  assert.match(live, /"approval\.requested":"apt"/);
  assert.match(live, /advisedBy\.set\(id, \(p\.pilot && p\.pilot\.name \? p\.pilot\.name : "Generic pilot"\)/);
  assert.match(js, /"advised by " \+ s\.advisor/);
  assert.match(js, /esc\(baseName\(v\.seat\.slice\(6\)\)\)/, 'extra seats by base name');
  assert.match(html, /\.snode\.skip \.st::after \{ content:" · skipped";/);
  assert.match(js, /aria-label='Pattern " \+ a\.ballot\.pattern \+ "'/);
  assert.match(js, /stageTabs\("pilots", PTABS, counts\)/);
  assert.match(
    live,
    /stageTabs\("pilots", \[\["prototype","Proto"\],\["test","Test"\],\["production","Prod"\],\["retired","Retired"\]\], counts\)/,
  );
  assert.match(js, /\["seed","Seed"\],\["sprout","Sprout"\],\["ripe","Ripe"\],\["dropped","Dropped"\]/);
  assert.match(js, /\["seed","Create"\],\["sprout","Try"\],\["ripe","Use"\],\["dropped","Dropped"\]/);
  assert.match(js, /aria-pressed='" \+ \(k === cur\) \+ "'/, 'tabs say which is selected');
});
test('an answer without an action: Misato passed, a green route straight to Debrief, no line from EVA; animated lines only while a sortie runs (owner, 2026-11-05, S-B55C)', async () => {
  const { readFileSync } = await import('node:fs');
  const live = readFileSync('web/public/dashboard/live.js', 'utf8');
  const js = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  assert.match(
    live,
    /plan:actions\.length > 0 \|\| !!s\.question \|\| known\.has\(s\.id\),/,
    'B-021 (changed on purpose): a pending question also means Misato planned',
  );
  assert.match(js, /\["plan","debrief","answer"\]/);
  assert.match(
    js,
    /const edges = EDGES\.filter\(e => e\[2\] === "relay" \? !!\(s && s\.forwarded\) : e\[2\] !== "answer" \|\| \(s && !s\.actions\.length && !s\.forwarded\)\);/,
    'drawn only for an answer-only sortie (F-051 slice 2 added the relay route)',
  );
  assert.doesNotMatch(
    js,
    /function liveEdges\(/,
    'B-040: phase-derived animation is removed for running and finished sorties alike',
  );
  assert.match(
    js,
    /if \(e\[2\] === "answer"\) return stepState\(s, "plan"\) === "done" && stepState\(s, "debrief"\) === "done"/,
  );
});
test("the apartment's count sits in the header like every other panel's sub-line, not a red badge (owner, 2026-11-05)", async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync('web/public/dashboard/index.html', 'utf8');
  assert.match(
    html,
    /<span data-l="needs">Misato's apartment · needs you<\/span><span class="sub" id="needs-count">0<\/span>/,
  );
});
test('F-051 slice 2: a forwarded request shows as forwarded on the asking base (relay route, the steps between skipped) and as "from <base>" on the main base', async () => {
  const { readFileSync } = await import('node:fs');
  const live = readFileSync('web/public/dashboard/live.js', 'utf8');
  const js = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  assert.match(live, /if \(e\.kind === "kaji\.forwarded"\) forwardedTo\.set\(id,/);
  assert.match(live, /forwardedTo\.delete\(id\)/, 'answered here after a drop-out: not forwarded');
  assert.match(
    live,
    /originOf\.set\(id, baseName\(String\(p\.conversation\)\.slice\(5\)\.split\("-"\)\.slice\(0, 2\)\.join\("-"\)\)\)/,
    'kaji:nerv-02-dashboard is from NERV-02',
  );
  assert.match(js, /\["detect","debrief","relay"\]/);
  assert.match(js, /if \(s\.forwarded && id !== "detect" && id !== "debrief"\) return "skip";/);
  assert.match(js, /"forwarded to " \+ s\.forwarded : s && s\.origin \? "from " \+ s\.origin/);
  assert.match(js, /s\.forwarded \? "→ " \+ esc\(s\.forwarded\) : s\.origin \? "from " \+ esc\(s\.origin\)/);
});
test('the advice step is lit while the consultant works, not skipped until the advice arrives (B-020)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const i = src.indexOf('function stepState(');
  const body = src.slice(i, src.indexOf('\n}\n', i) + 2);
  const stepState = new Function(`${body}\nreturn stepState;`)() as (s: object, id: string) => string;
  const base = { actions: [], done: { detect: true, intake: true, route: true } };
  assert.equal(stepState({ ...base, consult: false, phase: 'consult', status: 'active' }, 'consult'), 'on', 'running');
  assert.equal(
    stepState({ ...base, consult: false, phase: 'plan', status: 'active' }, 'consult'),
    'skip',
    'no consultant',
  );
  assert.equal(
    stepState(
      { ...base, consult: true, phase: 'plan', status: 'active', done: { ...base.done, consult: true } },
      'consult',
    ),
    'done',
    'advised',
  );
});
test('the bases map draws: drawMap runs to the end and draws every base and its name (B-022)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const i = src.indexOf('function drawMap(');
  const body = src.slice(i, src.indexOf('\n}\n', i) + 2);
  const calls: { m: string; a: unknown[] }[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, k) =>
        k === 'measureText'
          ? () => ({ width: 40 })
          : k === 'createRadialGradient'
            ? () => ({ addColorStop: () => {} })
            : (...a: unknown[]) => {
                calls.push({ m: String(k), a });
              },
      set: () => true,
    },
  );
  const map = {
    ready: true,
    w: 540,
    h: 250,
    dpr: 1,
    proj: (p: number[]) => [p[0]!, p[1]!],
    contours: [],
    linkPaths: {
      'nerv-01|nerv-02': [
        [100, 100],
        [300, 150],
      ],
    },
  };
  const BASES = [
    { id: 'nerv-01', name: 'Neo Tokyo-3', status: 'online', self: true, main: true, lon: 100, lat: 100 },
    { id: 'nerv-02', name: 'Tabgha', status: 'offline', lon: 300, lat: 150 },
  ];
  const document = { getElementById: () => ({ getContext: () => ctx, clientWidth: 270 }) };
  const helper = src.slice(src.indexOf('const telegramObserved'), src.indexOf('/* ================= EVA heartbeats'));
  const drawMap = new Function(
    'map',
    'BASES',
    'LINKS',
    'state',
    'cssVar',
    'statusColor',
    'document',
    `${helper}\n${body}\nreturn drawMap;`,
  )(
    map,
    BASES,
    [['nerv-01', 'nerv-02']],
    { packets: [] },
    () => '#000',
    () => '#0f0',
    document,
  ) as (now: number) => void;
  drawMap(1000);
  const texts = calls.filter((c) => c.m === 'fillText').map((c) => c.a[0]);
  assert.ok(texts.includes('Neo Tokyo-3') && texts.includes('Tabgha'), 'both bases are named');
  assert.ok(texts.includes('Midori'), 'drawn to the end, including the round channel node');
  assert.equal(calls.filter((c) => c.m === 'strokeRect').length, 2, 'one square per base');
  const ring = calls.findIndex((c) => c.m === 'arc' && c.a[0] === 100 && c.a[1] === 100);
  assert.ok(ring >= 0);
  assert.equal(calls[ring + 1]!.m, 'stroke', 'this base ring is outline-only');
  assert.ok(Number(calls[ring]!.a[2]) > 11, 'ring is larger than the square');
});
test('the Sephirot are numbered 1 to 11 with Hebrew and Latin names, the crew top right; the MAGI seats name their role, Casper idle when nothing runs (owner, 2026-11-05)', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync('web/public/dashboard/index.html', 'utf8');
  const nums = [...html.matchAll(/<div class="sn"[^>]*>(\d+) · <span class="jp-only he" lang="he"/g)]
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  const magi = Number(/<span title="Beauty">(\d+) · /.exec(html)![1]);
  assert.deepEqual(
    [...nums, magi].sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'every Sephirah has its own number, Gevurah included',
  );
  assert.doesNotMatch(html, /GEVURAH · CONSULTANTS/);
  const node = (n: string) => new RegExp(`<div class="snode[^"]*" data-n="${n}">.*?</div></div>`).exec(html)![0];
  assert.doesNotMatch(node('apt'), /data-av="you"/, 'no "you" avatar on Misato\'s apartment');
  assert.doesNotMatch(node('detect'), /data-av="hyuga"/, 'no Hyuga avatar on Detection');
  assert.match(html, /\.snode \.avs \{[^}]*position:absolute; top:3px; right:4px;/);
  assert.match(html, /BALTHASAR · 1[\s\S]*?title="reversibility · budget · taint">protection</);
  assert.match(html, /CASPER · 2[\s\S]*?>intent · idle</);
  assert.match(html, /MELCHIOR · 3[\s\S]*?title="rules · Scrolls · deterministic">rules</);
  for (const file of ['web/public/dashboard/dashboard.js', 'web/public/dashboard/live.js']) {
    const src = readFileSync(file, 'utf8');
    const i = src.indexOf('seatMetric');
    const start = src.indexOf('function', i);
    const body = src.slice(
      start,
      src.indexOf('\n  }', start) > 0 && file.endsWith('live.js')
        ? src.indexOf('\n  };', start) + 4
        : src.indexOf('\n}\n', start) + 2,
    );
    const metric = new Function('isLocal', 'TOOLS', `return (${body.replace(/^function seatMetric/, 'function')});`)(
      () => true,
      {},
    ) as (seat: string, s?: object, a?: object) => string;
    assert.equal(metric('casper'), 'intent · idle', file);
    assert.equal(metric('casper', {}, { ballot: { pattern: 'green' } }), 'intent · not needed (Green)', file);
    assert.equal(metric('casper', {}, { ballot: { pattern: 'orange' } }), 'intent · read by a local model', file);
  }
});
test('the header shows the incrementing build version: the doctor reports the version and commit read at start; the button shows the commit on hover and copies it (owner, 2026-11-06)', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const store = new Store(':memory:', { policy: defaultPolicy, source: 'test' });
  const dir = mkdtempSync(join(tmpdir(), 'nerv-ver-'));
  try {
    await serve(store, dir, async (base, headers) => {
      const d = (await (await fetch(base + '/api/doctor', { headers })).json()) as {
        build: { version: string; commit: string | null; shortCommit: string | null };
      };
      const shallow =
        execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true';
      assert.equal(
        d.build.version,
        shallow
          ? (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
          : '1.' + execFileSync('git', ['rev-list', '--first-parent', '--count', 'HEAD'], { encoding: 'utf8' }).trim(),
      );
      assert.equal(
        d.build.commit,
        execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        "the checkout's commit",
      );
      assert.equal(
        d.build.shortCommit,
        execFileSync('git', ['rev-parse', '--short', d.build.commit!], { encoding: 'utf8' }).trim(),
        'HTTP metadata carries Git’s verified abbreviation',
      );
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
  const src = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const fn = (name: string) => {
    const i = src.indexOf(`function ${name}(`);
    const a = src.lastIndexOf('\n', i) + 1;
    return src.slice(a, src.indexOf('\n}\n', i) + 2);
  };
  const { showBuild, copyBuild } = new Function(
    'setTimeout',
    `${fn('showBuild')}\n${fn('copyBuild')}\nreturn {showBuild,copyBuild};`,
  )(() => 0) as {
    showBuild: (b: unknown, el: unknown) => void;
    copyBuild: (el: unknown, clip: unknown) => Promise<string>;
  };
  const attrs: Record<string, string> = {};
  const el = {
    hidden: true,
    textContent: '',
    title: '',
    dataset: {} as Record<string, string>,
    setAttribute: (k: string, v: string) => {
      attrs[k] = v;
    },
  };
  const sha = 'a'.repeat(40);
  showBuild({ version: '1.151', commit: sha, shortCommit: 'a'.repeat(12) }, el);
  assert.equal(el.hidden, false);
  assert.equal(el.textContent, 'v1.151');
  assert.equal(el.title, `Commit ${'a'.repeat(12)} · click to copy`);
  assert.match(attrs['aria-label']!, /^Version 1\.151\. Commit a{12} ·/);
  const copied: string[] = [];
  assert.equal(
    await copyBuild(el, {
      writeText: async (t: string) => {
        copied.push(t);
      },
    }),
    'copied',
  );
  assert.deepEqual(copied, ['a'.repeat(12)]);
  assert.equal(
    await copyBuild(el, {
      writeText: async () => {
        throw new Error('denied');
      },
    }),
    'copy failed',
    'a refused clipboard says so',
  );
  showBuild({ version: '0.1.0', commit: null }, el);
  assert.equal(el.textContent, 'v0.1.0', 'outside a checkout: fall back to the package version');
  assert.equal(await copyBuild(el, {}), 'none');
  showBuild(undefined, el);
  assert.equal(el.hidden, true, 'no live base: hidden');
});

test('map legend is compact, cloud caption is removed, and unavailable live costs remain explicit', () => {
  const src = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  assert.doesNotMatch(src, /cloudRouteCaption|UMBILICAL ↗ cloud/);
  const live = readFileSync('web/public/dashboard/live.js', 'utf8');
  assert.match(live, /Cost unavailable/);
  assert.match(live, /Priced subtotal on this page/);
  assert.doesNotMatch(live, /qv-budget"\)\.textContent = "\$0\.00"/);
  const html = readFileSync('web/public/dashboard/index.html', 'utf8');
  assert.doesNotMatch(html, /Map legend|Links &amp; activity/);
  assert.match(html, /■ Bases/);
  assert.match(html, />- Kaji line</);
  assert.match(html, />sync<\/span>/);
  assert.doesNotMatch(html, /Scrolls: \$1\.00 \/ day/);
});

test('B-040: an active planning step alone never renders a continuously communicating edge', () => {
  const source = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const take = (name: string) => {
    const start = source.indexOf(`function ${name}(`);
    return start < 0 ? '' : source.slice(start, source.indexOf('\n}\n', start) + 2);
  };
  const svg = { innerHTML: '', setAttribute: () => {} };
  const bounds = { left: 0, right: 100, top: 0, bottom: 40, width: 100, height: 40 };
  const document = {
    getElementById: (id: string) =>
      id === 'edges' ? svg : { getBoundingClientRect: () => ({ ...bounds, width: 400, height: 400 }) },
  };
  const draw = new Function(
    'document',
    'isEvaFull',
    'EDGES',
    'nodeEl',
    'passedEdge',
    `${take('liveEdges')}\n${take('drawEdges')}\nreturn drawEdges;`,
  )(
    document,
    () => true,
    [['route', 'plan']],
    (id: string) => ({
      getBoundingClientRect: () => ({ ...bounds, top: id === 'plan' ? 100 : 0, bottom: id === 'plan' ? 140 : 40 }),
    }),
    () => 'passed',
  ) as (s: unknown) => void;
  draw({ status: 'active', phase: 'plan', current: 0, done: { route: true }, actions: [], note: '' });
  assert.match(svg.innerHTML, /class='passed'/, 'the observed route can remain visible');
  assert.doesNotMatch(
    svg.innerHTML,
    /class='[^']*\b(?:live|wait|reject)\b/,
    'a phase is not evidence of an in-flight communication',
  );
});

test('F-053: randomized band passes ease through bounded trajectories with variable durations, pauses and reversals', () => {
  const source = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const a = source.indexOf('function crtBandPass(');
  const body = source.slice(a, source.indexOf('\n}\n', a) + 2);
  type Pass = { frames: { transform: string; offset: number; easing: string }[]; duration: number; wait: number };
  const plan = new Function(body + ';return crtBandPass;')() as (index: number, random: () => number) => Pass;
  const gentle = plan(0, () => 0),
    other = plan(0, () => 0.99),
    up = plan(1, () => 0.99);
  assert.notDeepEqual(gentle, other, 'each pass can differ in trajectory and timing');
  for (const p of [gentle, other, up]) {
    assert.equal(p.frames[0]!.offset, 0);
    assert.equal(p.frames.at(-1)!.offset, 1);
    for (let n = 1; n < p.frames.length; n++)
      assert.ok(p.frames[n]!.offset > p.frames[n - 1]!.offset, 'positive time between waypoints');
    assert.ok(p.duration >= 4500 && p.duration <= 10000);
    assert.ok(p.wait >= 4500 && p.wait <= 14000);
    for (const frame of p.frames)
      assert.equal(frame.easing, 'cubic-bezier(.4,0,.6,1)', 'zero velocity at both ends keeps joins smooth');
  }
  const ys = gentle.frames.map((f) => Number(/\((-?[.0-9]+)vh\)/.exec(f.transform)![1]));
  assert.ok(
    ys.some((y, n) => n && y === ys[n - 1]),
    'a sustained pause can occur',
  );
  assert.ok(
    ys.some((y, n) => n && y < ys[n - 1]!),
    'a short reversal can occur',
  );
  assert.match(up.frames[0]!.transform, /103vh/);
  assert.match(up.frames.at(-1)!.transform, /-3vh/);
});

test('F-053: dynamic noise clears each frame, paints only sparse pixels, and bounds repaint work', () => {
  const source = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const a = source.indexOf('function drawCrtNoise(');
  const body = source.slice(a, source.indexOf('\n}\n', a) + 2);
  const dots: number[][][] = [],
    clears: number[][] = [];
  let frame: number[][] = [];
  const context = {
    globalAlpha: 1,
    fillStyle: '',
    clearRect: (...args: number[]) => {
      clears.push(args);
      frame = [];
      dots.push(frame);
    },
    fillRect: (...args: number[]) => frame.push([...args, context.globalAlpha]),
  };
  const canvas = { width: 0, height: 0, getContext: () => context },
    size = { innerWidth: 200, innerHeight: 100 };
  let value = 0.1;
  const random = Object.create(Math) as Math;
  random.random = () => value;
  const api = new Function(
    'document',
    'window',
    'cssVar',
    'Math',
    'let crtMotionActive=true,crtNoiseAt=0;' + body + ';return {draw:drawCrtNoise,off:()=>{crtMotionActive=false}};',
  )({ querySelector: () => canvas }, size, () => '#fff', random) as { draw: (time: number) => void; off: () => void };
  api.draw(100);
  assert.equal(clears.length, 1);
  assert.equal(canvas.width, 200);
  assert.equal(canvas.height, 100);
  assert.equal(dots[0]!.length, 9);
  api.draw(120);
  assert.equal(clears.length, 1, 'repaints are rate-limited');
  value = 0.9;
  api.draw(200);
  assert.equal(clears.length, 2, 'previous pixels clear before the next frame');
  assert.notDeepEqual(dots[0], dots[1], 'noise changes over time');
  for (const set of dots)
    for (const dot of set) {
      assert.equal(dot[2], 1);
      assert.equal(dot[3], 1);
      assert.ok(dot[0]! >= 0 && dot[0]! < 200 && dot[1]! >= 0 && dot[1]! < 100);
      assert.ok(dot[4]! >= 0.12 && dot[4]! <= 0.4);
    }
  size.innerWidth = 8000;
  size.innerHeight = 8000;
  api.draw(300);
  assert.equal(dots.at(-1)!.length, 1800, 'large screens retain a fixed drawing budget');
  api.off();
  api.draw(400);
  assert.equal(clears.length, 3, 'disabled noise schedules no paints');
});

test('F-057: clicking the running version copies and shows Git’s supplied unique commit ID', async () => {
  const source = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const take = (name: string) => {
    const i = source.indexOf(`function ${name}(`),
      start = source.lastIndexOf('\n', i) + 1;
    return source.slice(start, source.indexOf('\n}\n', i) + 2);
  };
  const api = new Function(
    'setTimeout',
    take('showBuild') + '\n' + take('copyBuild') + '\nreturn {showBuild,copyBuild};',
  )(() => 0) as {
    showBuild: (build: unknown, element: unknown) => void;
    copyBuild: (element: unknown, clipboard: unknown) => Promise<string>;
  };
  const element = {
    hidden: true,
    textContent: '',
    title: '',
    dataset: {} as Record<string, string>,
    setAttribute: () => {},
  };
  const commit = '39903fb47cb3a9becb565b65a7a42fbb6d17e69a';
  api.showBuild({ version: '1.205', commit, shortCommit: '39903fb4' }, element);
  const copied: string[] = [];
  await api.copyBuild(element, {
    writeText: async (value: string) => {
      copied.push(value);
    },
  });
  assert.deepEqual(copied, ['39903fb4']);
  assert.equal(element.title, 'Commit 39903fb4 · click to copy');
  api.showBuild({ version: '1.205', commit }, element);
  copied.length = 0;
  await api.copyBuild(element, {
    writeText: async (value: string) => {
      copied.push(value);
    },
  });
  assert.deepEqual(copied, [commit], 'older metadata falls back to the full valid ID, never a fabricated abbreviation');
  assert.equal(element.dataset.commit, commit, 'copy formatting does not change running-build identity');
});

test('B-044: completed advice marks the Advise → Misato route passed without coloring unused replanning loops', () => {
  const source = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
  const take = (name: string) => {
    const a = source.indexOf(`function ${name}(`);
    return source.slice(a, source.indexOf('\n}\n', a) + 2);
  };
  const passed = new Function(take('stepState') + '\n' + take('passedEdge') + '\nreturn passedEdge;')() as (
    sortie: object,
    edge: string[],
  ) => string;
  const sortie = {
    status: 'active',
    phase: 'plan',
    consult: true,
    done: { detect: true, intake: true, route: true, consult: true },
    actions: [],
  };
  assert.equal(passed(sortie, ['consult', 'plan', 'loop']), 'passed');
  assert.equal(
    passed({ ...sortie, status: 'done', phase: 'debrief', done: { ...sortie.done, plan: true, debrief: true } }, [
      'consult',
      'plan',
      'loop',
    ]),
    'passed',
  );
  assert.equal(
    passed({ ...sortie, consult: false, done: { route: true } }, ['consult', 'plan', 'loop']),
    'skip',
    'unused advice stays skipped',
  );
  assert.equal(passed(sortie, ['eva', 'plan', 'loop']), '', 'do not invent an execution/replanning loop');
  assert.equal(
    passed({ ...sortie, phase: 'consult', done: { route: true } }, ['consult', 'plan', 'loop']),
    '',
    'advice still in progress is not passed',
  );
});
