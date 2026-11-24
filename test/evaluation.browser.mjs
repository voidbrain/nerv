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
  'F-118-T02: the installed app pairs with a typed code and stays signed in; a browser tab keeps session behaviour',
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
        assert.equal(await evaluate(kept), '', 'the workspace forgets a refused credential');
        assert.deepEqual(errors, [], 'no browser runtime exceptions');
      });
      // Browser tab: nothing reaches localStorage.
      await browser(async ({ page, evaluate, until, errors }) => {
        await page('Page.navigate', { url: origin + '/dashboard/' });
        await until(`${banner}.includes('NOT SIGNED IN')`);
        await evaluate(typeCode('#live-token', '#live-signin', await mint()));
        await until(signedIn);
        assert.equal(await evaluate(kept), '', 'a tab keeps no device credential in localStorage');
        assert.notEqual(
          await evaluate(`sessionStorage.getItem('nerv.dashboard.session')`),
          null,
          'it keeps it like a session',
        );
        await page('Page.reload');
        await until(signedIn);
        await page('Page.navigate', { url: origin + '/' });
        await until(`document.querySelector('.connect input[name=signin]')!==null`);
        await evaluate(typeCode('.connect input[name=signin]', '.connect form', await mint()));
        await until(`document.querySelector('.connect')===null`);
        assert.equal(await evaluate(kept), '', 'the workspace tab keeps it in memory only');
        await page('Page.reload');
        await until(`document.querySelector('.connect input[name=signin]')!==null`);
        // A wrong code says so and pairs nothing.
        const before = (await devices()).length;
        await evaluate(typeCode('.connect input[name=signin]', '.connect form', 'AAAA-AAAA'));
        await until(`document.querySelector('[role=alert]')?.textContent.includes('Pairing code invalid')`);
        assert.equal((await devices()).length, before);
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
