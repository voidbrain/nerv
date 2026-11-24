import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Runtime } from '../src/runtime.ts';
import { makeServer } from '../src/server.ts';
import { addPilot } from '../src/pilots.ts';
import { Store } from '../src/store.ts';
import { browser } from './fixtures/browser.mjs';
const require = createRequire(import.meta.url);
test(
  'golden-v1/dashboard: clarification, same-sortie answer, approval, duplicate decision and topic change',
  { timeout: 90000 },
  async () => {
    const plans = [],
      asked = [];
    const model = createServer((req, res) => {
      let body = '';
      req
        .on('data', (c) => (body += c))
        .on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          if (req.method === 'GET') {
            res.end(JSON.stringify({ models: [{ name: 'fixture-model' }] }));
            return;
          }
          const request = JSON.parse(body),
            system = request.messages[0].content;
          asked.push(request);
          const content = system.startsWith('You are Casper')
            ? '{"vote":"approve","reason":"Matches the neutral request.","confidence":1}'
            : plans.shift() || '{"reply":"Fixture finished"}';
          res.end(
            JSON.stringify({ model: 'fixture-model', choices: [{ message: { content }, finish_reason: 'stop' }] }),
          );
        });
    });
    await new Promise((done) => model.listen(0, '127.0.0.1', done));
    const home = mkdtempSync(join(tmpdir(), 'nerv-evaluation-')),
      token = 'e'.repeat(32);
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        models: { local: { model: 'fixture-model', baseUrl: `http://127.0.0.1:${model.address().port}/v1` } },
      }),
    );
    writeFileSync(join(home, 'scrolls.json'), JSON.stringify({ blue: ['reminders.add'] }));
    // Neutral specialist pilots with long names and a long model name, so the pilot grid has cards to measure.
    const fixturePilots = ['printer', 'writer', 'planner'].reduce(
      (roster, id) =>
        addPilot(roster, {
          id,
          name: 'Fixture ' + id + ' long call name',
          domain: 'fixture domain for ' + id,
          keywords: [id, 'fixture'],
          model: 'fixture-model-with-a-very-long-name:30b-a3b-instruct-q4_K_M',
          stage: 'prototype',
          parent: 'generic',
        }),
      [],
    );
    const runtime = new Runtime(join(home, 'db'), undefined, home);
    let server;
    try {
      await runtime.ready();
      runtime.setPilots(() => fixturePilots);
      runtime.startResumer(100);
      let browserPolicy = { enabled: false, channels: [], targets: [] };
      server = makeServer(runtime, token, {
        webRoot: resolve('dist/web/browser'),
        readUpdatePolicy: () => browserPolicy,
        saveUpdatePolicy: (p) => {
          browserPolicy = p;
          return p;
        },
      });
      await new Promise((done) => server.listen(0, '127.0.0.1', done));
      const origin = `http://127.0.0.1:${server.address().port}`;
      const code = await (
        await fetch(origin + '/api/session/codes', { method: 'POST', headers: { authorization: 'Bearer ' + token } })
      ).json();
      await browser(async ({ page, evaluate, until, errors }) => {
        await page('Page.navigate', { url: origin + '/dashboard/#code=' + code.code });
        await until(
          `document.querySelector('.banner').textContent.includes('LIVE ·')&&!document.querySelector('.banner').textContent.includes('SIGNING IN')`,
        );
        const send = async (text) => {
          await evaluate(
            `{const input=document.querySelector('#chat-in');input.value=${JSON.stringify(text)};document.querySelector('#chat-form').requestSubmit()}`,
          );
        };
        plans.push('{"ask":"Which title should the reminder have?"}');
        await send('Set a reminder on 1 January 2031 at 09:00 UTC.');
        await until(`document.querySelector('#log').textContent.includes('Which title should the reminder have?')`);
        const first = (await runtime.sorties())[0];
        assert.equal(first.status, 'open');
        await until(`document.querySelector('.snode[data-n="apt"]').classList.contains('wait')`);
        assert.equal(
          await evaluate(`document.querySelector('.snode[data-n="debrief"]').classList.contains('done')`),
          false,
          'a question is waiting, not completed',
        );
        await evaluate(readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
        assert.deepEqual(
          await evaluate(`axe.run(document.querySelector('#p-flow')).then(r=>r.violations.map(v=>v.id))`),
          [],
          'waiting flow accessibility',
        );
        // F-021-T05: the Tools panel lists this base's tools with versions, and passes axe.
        await until(`document.querySelector('#tools-list').textContent.includes("NERV's own tools")`);
        await evaluate(`document.querySelector('#tools-list details').open=true`);
        assert.deepEqual(
          await evaluate(
            `axe.run(document.querySelector('#tools-list').closest('.panel')).then(r=>r.violations.map(v=>v.id))`,
          ),
          [],
          'tools panel accessibility',
        );
        // F-049-T09: EVA panel shows live instances per class, per machine, empty classes say so, and passes axe.
        let releaseEva;
        const heldEva = runtime.evaPool.run(
          { jobId: 'eva-browser-job', evaClass: 'eva-01', pilot: 'mail-brief', sortieId: 'S-TEST' },
          () => new Promise((r) => (releaseEva = r)),
        );
        await until(`document.querySelector('#cages').textContent.includes('eva-browser-job')`);
        assert.equal(
          await evaluate(
            `document.querySelector('#cages [data-eva-class="eva-01"]').textContent.includes('mail-brief') && document.querySelector('#cages [data-eva-class="eva-01"]').textContent.includes('RUNNING') && document.querySelector('#cages [data-eva-class="eva-00"]').textContent.includes('Empty · no active instances')`,
          ),
          true,
          'EVA panel shows live instance with pilot, job, state and empty classes',
        );
        assert.deepEqual(
          await evaluate(`axe.run(document.querySelector('#p-eva')).then(r=>r.violations.map(v=>v.id))`),
          [],
          'EVA instances panel accessibility',
        );
        releaseEva();
        await heldEva;
        // Owner 2026-11-23: pilot cards sit 2 per row, call name and second name each on their own
        // full-width line, and no select or input leaves its card (measured, not just asserted in CSS).
        await until(`document.querySelectorAll('#melons .pilot-grid .pilot-second-input').length === 3`);
        const pilotLayout = await evaluate(`(() => {
          const box = document.querySelector('#melons'), out = { escaped: [], cols: null, stacked: [] };
          const grid = box.querySelector('.pilot-grid');
          if (grid) out.cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
          for (const card of box.querySelectorAll('.card')) {
            const c = card.getBoundingClientRect();
            for (const el of card.querySelectorAll('select, input')) {
              const r = el.getBoundingClientRect();
              if (r.left < c.left - 0.5 || r.right > c.right + 0.5) out.escaped.push(el.id || el.tagName);
            }
            const name = card.querySelector('.pilot-name-input'), second = card.querySelector('.pilot-second-input');
            if (name && second) {
              const a = name.getBoundingClientRect(), b = second.getBoundingClientRect();
              out.stacked.push(b.top >= a.bottom && a.width > c.width * 0.8 && b.width > c.width * 0.8);
            }
          }
          return out;
        })()`);
        assert.deepEqual(pilotLayout.escaped, [], 'every pilot select and input stays inside its card');
        assert.equal(pilotLayout.cols, 2, 'pilot cards sit 2 per row');
        assert.equal(pilotLayout.stacked.length, 3, 'the three fixture pilots render');
        assert.ok(pilotLayout.stacked.every(Boolean), 'call name and second name each take a full-width line');
        // F-110-T03: Settings panel edits update schedule, saves via Apply, and passes axe.
        await until(`document.querySelector('#set-check-hour') && document.querySelector('#btn-save-settings')`);
        await evaluate(`{
          const ch = document.querySelector('#set-check-hour');
          const ap = document.querySelector('#set-apply-hour');
          ch.value = '21'; ch.dispatchEvent(new Event('input', { bubbles: true }));
          ap.value = '4'; ap.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('#btn-save-settings').click();
        }`);
        await until(`document.querySelector('#settings-status')?.textContent.includes('Settings saved.')`);
        const savedPolicy = await (
          await fetch(origin + '/api/update/policy', { headers: { authorization: 'Bearer ' + token } })
        ).json();
        assert.equal(savedPolicy.policy.schedule.checkHour, 21);
        assert.equal(savedPolicy.policy.schedule.applyHour, 4);
        assert.deepEqual(
          await evaluate(`axe.run(document.querySelector('#p-settings')).then(r=>r.violations.map(v=>v.id))`),
          [],
          'settings panel accessibility',
        );
        plans.push(
          '{"action":{"tool":"reminders.add","args":{"title":"Stretch","due":"2031-01-01T09:00:00Z"}}}',
          '{"reply":"Reminder added"}',
        );
        await send('Stretch');
        await until(`document.querySelector('#needs-list button[data-d="approve"]')!==null`);
        const pending = await runtime.approvals();
        assert.equal(pending.length, 1);
        assert.equal(pending[0].card.sortieId, first.id, 'clarification keeps the same sortie');
        assert.equal((await runtime.list()).length, 0, 'approval has not run the action');
        await evaluate(`document.querySelector('#needs-list button[data-d="approve"]').click()`);
        await until(`document.querySelector('#next-list').textContent.includes('Stretch')`);
        await runtime.decide(pending[0].id, 'approve', 'api');
        assert.equal(
          (await runtime.list()).filter((r) => r.title === 'Stretch').length,
          1,
          'another channel decision never repeats the effect',
        );
        plans.push('{"ask":"Which title for this second reminder?"}');
        await send('Set another reminder.');
        await until(`document.querySelector('#log').textContent.includes('Which title for this second reminder?')`);
        const waiting = (await runtime.sorties())[0].id;
        plans.push('{"newRequest":true}', '{"reply":"No new reminder was requested."}');
        await send('Forget that request. Explain what a calendar is instead.');
        await until(`document.querySelector('#log').textContent.includes('No new reminder was requested.')`);
        assert.notEqual((await runtime.sorties())[0].id, waiting, 'topic change starts a separate sortie');
        assert.equal((await runtime.list()).length, 1, 'topic change creates no extra reminder');
        assert.ok(
          (await runtime.events(waiting)).some((e) => e.kind === 'spear'),
          'old question is cancelled',
        );
        assert.ok(asked.length >= 5);
        assert.deepEqual(errors, [], 'no browser runtime exceptions');
      });
    } finally {
      if (server)
        await new Promise((done) => {
          server.close(done);
          server.closeAllConnections();
        });
      await runtime.close();
      await new Promise((done) => {
        model.close(done);
        model.closeAllConnections();
      });
      rmSync(home, { recursive: true, force: true });
    }
  },
);

test(
  'B-050: until retries through evaluated expression exceptions and resolves when condition holds',
  { timeout: 30000 },
  async () => {
    await browser(async ({ evaluate, until }) => {
      setTimeout(async () => {
        try {
          await evaluate(
            `{const el=document.createElement('div');el.className='late-banner';el.textContent='LIVE · ready';document.body.appendChild(el);}`,
          );
        } catch {}
      }, 150);
      await until(`document.querySelector('.late-banner').textContent.includes('LIVE ·')`);
    });
  },
);

test('B-050: until still fails with timeout when throwing condition never holds', { timeout: 30000 }, async () => {
  await browser(async ({ until }) => {
    await assert.rejects(
      until(`document.querySelector('.nonexistent-banner').textContent.includes('NEVER')`, 300),
      /Browser condition timed out: document\.querySelector\('\.nonexistent-banner'\)\.textContent\.includes\('NEVER'\)/,
    );
  });
});

// F-118-T02: across the join, the real pairing endpoint (makeServer, DeviceBook, PairingCodes) and the production build's
// sign-in boxes. Installed (navigator.standalone, as iOS reports a Home Screen app), a typed pairing code pairs, the
// credential is kept in localStorage and a reload signs in by itself; a revoke signs it out and forgets it. In a browser
// tab nothing goes to localStorage: the dashboard keeps it like a session, the workspace in memory only.
test(
  'F-118-T02: the installed app pairs with a typed code and stays signed in; a browser tab refuses the code',
  { timeout: 120000 },
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-pairing-browser-')),
      token = 'f'.repeat(32);
    const store = new Store(':memory:');
    const server = makeServer(store, token, {
      webRoot: resolve('dist/web/browser'),
      deviceFile: join(home, 'devices.json'),
      language: 'en',
      timeZone: 'Europe/Rome',
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const admin = { authorization: 'Bearer ' + token };
    const mint = async () =>
      (await (await fetch(origin + '/api/device/codes', { method: 'POST', headers: admin })).json()).code;
    const devices = async () => (await (await fetch(origin + '/api/devices', { headers: admin })).json()).devices;
    const revokeAll = async () => {
      for (const d of await devices())
        await fetch(origin + '/api/devices/' + d.id, { method: 'DELETE', headers: admin });
    };
    const kept = `(()=>{try{return localStorage.getItem('nerv.device')||''}catch{return ''}})()`;
    const banner = `document.querySelector('.banner').textContent`;
    const signedIn = `${banner}.includes('LIVE ·')&&!${banner}.includes('NOT SIGNED IN')&&!${banner}.includes('SIGNING IN')`;
    const typeCode = (selector, form, code) =>
      `{const i=document.querySelector(${JSON.stringify(selector)});i.value=${JSON.stringify(code)};document.querySelector(${JSON.stringify(form)}).requestSubmit()}`;
    try {
      // Installed app.
      await browser(async ({ page, evaluate, until, errors }) => {
        await page('Page.addScriptToEvaluateOnNewDocument', {
          source: `Object.defineProperty(Navigator.prototype,'standalone',{configurable:true,get:()=>true})`,
        });
        // Dashboard: type the code into the sign-in bar.
        await page('Page.navigate', { url: origin + '/dashboard/' });
        await until(`${banner}.includes('NOT SIGNED IN')&&${banner}.includes('nerv open --phone')`);
        await evaluate(typeCode('#live-token', '#live-signin', (await mint()).toLowerCase()));
        await until(signedIn);
        const paired = await devices();
        assert.equal(paired.length, 1, 'the typed code paired one device');
        assert.match(paired[0].name, / · dashboard app$/, 'named after the kind of device and the installed app');
        const credential = await evaluate(kept);
        assert.match(credential, /^.{24,}$/, 'the device credential is kept in the installed app');
        assert.equal(await evaluate(`sessionStorage.getItem('nerv.dashboard.session')`), null, 'not as a tab session');
        await page('Page.reload');
        await until(signedIn);
        assert.equal(await evaluate(kept), credential, 'a relaunch signs in with the kept credential');
        // Revoked: the next launch is refused, forgets the credential and says why.
        await revokeAll();
        await page('Page.reload');
        await until(`${banner}.includes('NOT SIGNED IN')&&${banner}.includes('pairing ended')`);
        assert.equal(await evaluate(kept), '', 'a refused credential is forgotten');

        // Workspace: the same sign-in box takes the code.
        await page('Page.navigate', { url: origin + '/' });
        await until(`document.querySelector('.connect input[name=signin]')!==null`);
        await evaluate(typeCode('.connect input[name=signin]', '.connect form', await mint()));
        await until(
          `document.querySelector('.connect')===null&&document.querySelector('nerv-surface-renderer')!==null`,
        );
        assert.match((await devices())[0].name, / · workspace app$/);
        assert.notEqual(await evaluate(kept), '', 'kept in the installed workspace');
        await page('Page.reload');
        await until(
          `document.querySelector('.connect')===null&&document.querySelector('nerv-surface-renderer')!==null`,
        );
        await revokeAll();
        await page('Page.reload');
        await until(
          `document.querySelector('.connect')!==null&&document.querySelector('[role=alert]')?.textContent.includes('pairing ended')`,
        );
        // A wrong code says so and pairs nothing.
        await evaluate(typeCode('.connect input[name=signin]', '.connect form', 'AAAA-AAAA'));
        await until(`document.querySelector('[role=alert]')?.textContent.includes('Pairing code invalid')`);
        assert.equal((await devices()).length, 0);
        assert.equal(await evaluate(kept), '', 'the workspace forgets a refused credential');
        assert.deepEqual(errors, [], 'no browser runtime exceptions');
      });
      // Browser tab (review of #707): a pairing code is refused without calling the pairing endpoint, so a tab never
      // holds a 90-day device; the code stays usable for the installed app.
      await browser(async ({ page, evaluate, until, errors, network }) => {
        const code = await mint();
        await page('Network.enable');
        await page('Page.navigate', { url: origin + '/dashboard/' });
        await until(`${banner}.includes('NOT SIGNED IN')`);
        await evaluate(typeCode('#live-token', '#live-signin', code));
        await until(`${banner}.includes('NOT SIGNED IN')&&${banner}.includes('works only in the installed')`);
        await page('Page.navigate', { url: origin + '/' });
        await until(`document.querySelector('.connect input[name=signin]')!==null`);
        await evaluate(typeCode('.connect input[name=signin]', '.connect form', code));
        await until(`document.querySelector('[role=alert]')?.textContent.includes('works only in the installed')`);
        assert.equal(await evaluate(kept), '', 'a tab keeps no device credential');
        assert.equal(
          await evaluate(`sessionStorage.getItem('nerv.dashboard.session')`),
          null,
          'nor a session from a pairing code',
        );
        assert.equal((await devices()).length, 0, 'no device paired from a tab');
        assert.ok(!network.some((r) => r.url.includes('/api/device/pair')), 'the pairing endpoint is never called');
        assert.equal(
          (
            await fetch(origin + '/api/device/pair', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ code, name: 'Fixture phone' }),
            })
          ).status,
          200,
          'the refused code is still usable',
        );
        assert.deepEqual(errors, [], 'no browser runtime exceptions');
      });
    } finally {
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      store.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);

// F-118-T03: across the join, the dashboard's Settings (production build) lists the paired devices from the real
// server and DeviceBook, with name, pairing day and last use, marks this one and revokes: a stale device revoked there
// is refused on its next request, and this app revoking itself shows "pairing ended" and forgets its credential.
test(
  'F-118-T03: Settings lists paired devices and revokes one; revoking this device ends its pairing',
  { timeout: 120000 },
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-devices-browser-')),
      token = 'f'.repeat(32);
    const store = new Store(':memory:');
    const server = makeServer(store, token, {
      webRoot: resolve('dist/web/browser'),
      deviceFile: join(home, 'devices.json'),
      language: 'en',
      timeZone: 'Europe/Rome',
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const admin = { authorization: 'Bearer ' + token };
    const mint = async () =>
      (await (await fetch(origin + '/api/device/codes', { method: 'POST', headers: admin })).json()).code;
    const devices = async () => (await (await fetch(origin + '/api/devices', { headers: admin })).json()).devices;
    const status = async (bearer) =>
      (await fetch(origin + '/api/status', { headers: { authorization: 'Bearer ' + bearer } })).status;
    const banner = `document.querySelector('.banner').textContent`;
    const signedIn = `${banner}.includes('LIVE ·')&&!${banner}.includes('NOT SIGNED IN')&&!${banner}.includes('SIGNING IN')`;
    const rows = `[...document.querySelectorAll('#settings-devices [data-device]')]`;
    try {
      // A stale device paired from a browser tab before the fix of #707.
      const stale = await (
        await fetch(origin + '/api/device/pair', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: await mint(), name: 'Mac · dashboard app' }),
        })
      ).json();
      await browser(async ({ page, evaluate, until, errors }) => {
        await page('Page.addScriptToEvaluateOnNewDocument', {
          source: `Object.defineProperty(Navigator.prototype,'standalone',{configurable:true,get:()=>true});window.confirm=()=>true`,
        });
        await page('Page.navigate', { url: origin + '/dashboard/' });
        await until(`${banner}.includes('NOT SIGNED IN')`);
        await evaluate(
          `{const i=document.querySelector('#live-token');i.value=${JSON.stringify(await mint())};document.querySelector('#live-signin').requestSubmit()}`,
        );
        await until(signedIn);
        await until(`${rows}.length===2`);
        const shown = await evaluate(`${rows}.map(r=>r.textContent)`);
        assert.match(shown[0], /Mac · dashboard app/);
        assert.match(shown[0], /paired .*last used/);
        assert.doesNotMatch(shown[0], /this device/);
        assert.match(shown[1], / · dashboard app.*this device/);
        // Revoke the stale device: gone from the list, refused on its next request.
        assert.equal(await status(stale.token), 200);
        await evaluate(`document.querySelector('[data-device="${stale.device.id}"] button[data-revoke]').click()`);
        await until(`${rows}.length===1`);
        assert.equal(await status(stale.token), 401, 'the revoked device is refused');
        assert.equal((await devices()).length, 1);
        // Revoke this device: the app says the pairing ended and forgets its credential.
        await evaluate(`document.querySelector('#settings-devices button[data-revoke]').click()`);
        await until(`${banner}.includes('NOT SIGNED IN')&&${banner}.includes('pairing ended')`);
        assert.equal(await evaluate(`localStorage.getItem('nerv.device')`), null);
        assert.equal((await devices()).length, 0);
        assert.deepEqual(errors, [], 'no browser runtime exceptions');
      });
    } finally {
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      store.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);

// F-118-T05 (owner 2026-11-24): across the join, the real server's QR pairing codes and the production dashboard. A
// scanned link opens the dashboard in a browser tab with the code in the fragment: the page clears the fragment (so Add to
// Home Screen saves the clean address and keeps no code), shows the code with the steps while it is valid, makes no
// request carrying it and never pairs; the code stays usable for the installed app. Settings → Pair a device shows the
// QR (from a test double for the encoder) and the same code.
test(
  'F-118-T05: a scanned pairing link shows the code in Safari without pairing; Settings shows the QR',
  { timeout: 120000 },
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-pairing-qr-browser-')),
      token = 'f'.repeat(32);
    const texts = [];
    const qrEncoder = (text) => {
      texts.push(text);
      return Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => (x * y + x) % 3 === 0));
    };
    const store = new Store(':memory:');
    const server = makeServer(store, token, {
      webRoot: resolve('dist/web/browser'),
      deviceFile: join(home, 'devices.json'),
      language: 'en',
      timeZone: 'Europe/Rome',
      qrEncoder,
    });
    const seen = [];
    server.on('request', (req) => seen.push({ url: req.url, referer: req.headers.referer ?? '' }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const admin = { authorization: 'Bearer ' + token };
    const mintQr = async () =>
      (
        await fetch(origin + '/api/device/codes', {
          method: 'POST',
          headers: { ...admin, 'content-type': 'application/json' },
          body: JSON.stringify({ base: origin }),
        })
      ).json();
    const devices = async () => (await (await fetch(origin + '/api/devices', { headers: admin })).json()).devices;
    const pairWith = async (code) =>
      (
        await fetch(origin + '/api/device/pair', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, name: 'Fixture phone' }),
        })
      ).status;
    const banner = `document.querySelector('.banner').textContent`;
    try {
      const manifest = await (await fetch(origin + '/manifest.webmanifest')).json();
      assert.ok(!String(manifest.start_url).includes('#'), 'the installed app starts without a fragment');
      await browser(async ({ page, evaluate, until, errors }) => {
        // A browser tab (Safari after a scan).
        const minted = await mintQr();
        assert.equal(minted.link, `${origin}/dashboard/#pair=${minted.code}&until=${minted.expiresAt}`);
        assert.equal(minted.expiresInMs, 10 * 60_000);
        seen.length = 0;
        await page('Page.navigate', { url: minted.link });
        await until(`${banner}.includes(${JSON.stringify(minted.code)})&&${banner}.includes('Add to Home Screen')`);
        const shown = await evaluate(banner);
        assert.match(shown, /Open NERV from the Home Screen/);
        assert.match(shown, /valid until \d{1,2}[:.]\d{2}/);
        assert.equal(await evaluate('location.hash'), '', 'the fragment is cleared after reading');
        assert.equal(
          await evaluate('location.href'),
          origin + '/dashboard/',
          'Add to Home Screen saves the clean address',
        );
        assert.equal(await evaluate(`localStorage.getItem('nerv.device')`), null, 'no device credential');
        assert.ok(
          !seen.some((r) => r.url.includes(minted.code) || r.referer.includes(minted.code)),
          'no request carries the code',
        );
        assert.ok(!seen.some((r) => r.url.startsWith('/api/device/pair')), 'the page never pairs');
        assert.equal((await devices()).length, 0);
        // Expiry: a code past its time is not shown; one that runs out while open disappears.
        await page('Page.navigate', { url: `${origin}/dashboard/#pair=ABCD-EFGH&until=${Date.now() - 1000}` });
        await until(`${banner}.includes('expired')`);
        assert.ok(!(await evaluate(banner)).includes('ABCD-EFGH'), 'an expired code is not shown');
        await page('Page.navigate', { url: `${origin}/dashboard/#pair=ABCD-EFGH&until=${Date.now() + 1500}` });
        await until(`${banner}.includes('ABCD-EFGH')`);
        await until(`${banner}.includes('expired')&&!${banner}.includes('ABCD-EFGH')`, 10000);
        // The code was never spent: the installed app pairs with it.
        assert.equal(await pairWith(minted.code), 200, 'the code shown in Safari still pairs');
        assert.deepEqual(errors, [], 'no browser runtime exceptions');
      });
      // Settings → Pair a device, from a dashboard session (nerv open dashboard).
      await browser(async ({ page, evaluate, until, errors }) => {
        const login = await (await fetch(origin + '/api/session/codes', { method: 'POST', headers: admin })).json();
        await page('Page.addScriptToEvaluateOnNewDocument', { source: `window.confirm=()=>true` });
        await page('Page.navigate', { url: `${origin}/dashboard/#code=${login.code}` });
        await until(`document.querySelector('#btn-pair-device')!==null&&!${banner}.includes('SIGNING IN')`);
        await evaluate(`document.querySelector('#btn-pair-device').click()`);
        await until(`document.querySelector('#settings-pair svg.pair-qr')!==null`);
        const link = texts.at(-1);
        const code = /#pair=([A-Z2-9]{4}-[A-Z2-9]{4})&until=\d+$/.exec(link)?.[1];
        assert.ok(code && link.startsWith(origin + '/dashboard/#pair='), link);
        const box = await evaluate(`document.querySelector('#settings-pair').textContent`);
        assert.ok(box.includes(code), 'Settings shows the code next to the QR');
        assert.match(box, /valid until/);
        assert.match(box, /127\.0\.0\.1/, 'says a phone cannot open this loopback address');
        // B-128: no configured address and no Tailscale here, so the hint says how to set one.
        assert.match(box, /tailscale serve/, 'says how to give the phone an address');
        const modules = await evaluate(`document.querySelector('#settings-pair svg.pair-qr path').getAttribute('d')`);
        assert.equal((modules.match(/M/g) ?? []).length, 245, 'the QR draws every dark module of the encoder rows');
        assert.equal(await pairWith(code), 200, 'the Settings code pairs the installed app');
        assert.deepEqual(errors, [], 'no browser runtime exceptions');
      });
    } finally {
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      store.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);

// B-128 (owner 2026-11-24): across the join, Settings → Pair a device on a dashboard opened at 127.0.0.1 (nerv open
// dashboard) gets a QR of the tailnet address the server resolves (a test double here; Tailscale never runs in tests),
// and no loopback warning.
test(
  'B-128: Settings on a 127.0.0.1 page shows a QR of the tailnet address, not the loopback one',
  { timeout: 120000 },
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-pairing-tailnet-browser-')),
      token = 'f'.repeat(32);
    const texts = [];
    const qrEncoder = (text) => {
      texts.push(text);
      return Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => (x * y + x) % 3 === 0));
    };
    const store = new Store(':memory:');
    const server = makeServer(store, token, {
      webRoot: resolve('dist/web/browser'),
      deviceFile: join(home, 'devices.json'),
      language: 'en',
      timeZone: 'Europe/Rome',
      qrEncoder,
      phoneBase: async () => 'https://base.tailnet-fixture.ts.net',
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const admin = { authorization: 'Bearer ' + token };
    const banner = `document.querySelector('.banner').textContent`;
    try {
      await browser(async ({ page, evaluate, until, errors }) => {
        const login = await (await fetch(origin + '/api/session/codes', { method: 'POST', headers: admin })).json();
        await page('Page.navigate', { url: `${origin}/dashboard/#code=${login.code}` });
        await until(`document.querySelector('#btn-pair-device')!==null&&!${banner}.includes('SIGNING IN')`);
        await evaluate(`document.querySelector('#btn-pair-device').click()`);
        await until(`document.querySelector('#settings-pair svg.pair-qr')!==null`);
        const link = texts.at(-1);
        assert.match(
          link,
          /^https:\/\/base\.tailnet-fixture\.ts\.net\/dashboard\/#pair=[A-Z2-9]{4}-[A-Z2-9]{4}&until=\d+$/,
        );
        const box = await evaluate(`document.querySelector('#settings-pair').textContent`);
        assert.ok(!box.includes('which a phone cannot open'), 'no loopback warning: ' + box);
        assert.match(box, /base\.tailnet-fixture\.ts\.net/, 'says which address the QR opens');
        assert.deepEqual(errors, [], 'no browser runtime exceptions');
      });
    } finally {
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      store.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);
