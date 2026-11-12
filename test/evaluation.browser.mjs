import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Runtime } from '../src/runtime.ts';
import { makeServer } from '../src/server.ts';
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
    const runtime = new Runtime(join(home, 'db'), undefined, home);
    let server;
    try {
      await runtime.ready();
      runtime.startResumer(100);
      server = makeServer(runtime, token, { webRoot: resolve('dist/web/browser') });
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
