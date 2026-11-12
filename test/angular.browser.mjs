import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
const require = createRequire(import.meta.url);
const chrome =
  process.env.CHROME_BIN ||
  ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(
    existsSync,
  );

test(
  'F-002/F-010: reliable bilingual reminder flows, local dates and responsive accessible controls',
  { timeout: 120000 },
  async (t) => {
    assert.equal(
      JSON.parse(readFileSync('angular.json', 'utf8')).projects.nerv.architect.serve.options.port,
      4318,
      'dedicated development port',
    );
    assert.ok(chrome, 'Install Chrome/Chromium or set CHROME_BIN. Run npm run build first.');
    const profile = mkdtempSync(join(tmpdir(), 'nerv-browser-'));
    const artifacts = process.env.NERV_BROWSER_ARTIFACTS;
    if (artifacts) mkdirSync(artifacts, { recursive: true });
    const store = new Store(':memory:');
    store.modelUsage = async (before, limit) => store.usage.page(before, limit);
    store.lilith = { list: async () => store.memory.list(), episodes: async () => store.memory.episodes() };
    const token = 'e'.repeat(32);
    const server = makeServer(store, token, {
      webRoot: resolve('dist/web/browser'),
      language: 'en',
      timeZone: 'Europe/Rome',
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const child = spawn(
      chrome,
      [
        '--headless',
        '--no-first-run',
        '--no-default-browser-check',
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let ws;
    const pending = new Map();
    let serial = 0;
    const errors = [];
    try {
      const endpoint = await new Promise((done, fail) => {
        let output = '';
        const timer = setTimeout(() => fail(new Error('Chrome startup timed out: ' + output)), 20000);
        child.once('error', (e) => {
          clearTimeout(timer);
          fail(e);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          fail(new Error('Chrome exited: ' + code));
        });
        child.stderr.on('data', (chunk) => {
          output = (output + chunk).slice(-4000);
          const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
          if (match) {
            clearTimeout(timer);
            done(match[1]);
          }
        });
      });
      ws = new WebSocket(endpoint);
      await new Promise((done, fail) => {
        ws.once('open', done);
        ws.once('error', fail);
      });
      ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.id) {
          const p = pending.get(m.id);
          if (p) {
            pending.delete(m.id);
            clearTimeout(p.timer);
            if (m.error) p.fail(new Error(JSON.stringify(m.error)));
            else p.done(m.result);
          }
        }
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
        if (m.method === 'Log.entryAdded' && m.params.entry.source === 'security') errors.push(m.params.entry.text);
      });
      const call = (method, params = {}, sessionId) =>
        new Promise((done, fail) => {
          const id = ++serial;
          const timer = setTimeout(() => {
            pending.delete(id);
            fail(new Error('CDP timed out: ' + method));
          }, 20000);
          pending.set(id, { done, fail, timer });
          ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
      const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
      const page = (method, params = {}) => call(method, params, sessionId);
      const evaluate = async (expression) => {
        const r = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        assert.equal(r.exceptionDetails, undefined, JSON.stringify(r.exceptionDetails));
        return r.result.value;
      };
      const until = async (expression) => {
        const end = Date.now() + 10000;
        while (!(await evaluate(expression))) {
          assert.ok(Date.now() < end, 'Browser condition timed out: ' + expression);
          await new Promise((d) => setTimeout(d, 50));
        }
      };
      const viewport = async (width, height) => {
        await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      };
      const language = async (lang) => {
        await evaluate(
          `{const s=document.querySelector('select');s.value=${JSON.stringify(lang)};s.dispatchEvent(new Event('change',{bubbles:true}));}`,
        );
        await until(`document.documentElement.lang===${JSON.stringify(lang)}`);
      };
      const screenshot = async (name) => {
        if (!artifacts) return;
        const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        writeFileSync(join(artifacts, name + '.png'), Buffer.from(data, 'base64'));
      };
      await page('Page.enable');
      await page('Page.bringToFront');
      await page('Runtime.enable');
      await page('Log.enable');
      await page('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Rome' });
      await viewport(1440, 1000);
      await page('Page.navigate', { url: origin });
      await until(`document.querySelector('h1')?.textContent.includes('Your world.')`);
      await evaluate(readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
      const audit = async (name) => {
        const result = await evaluate(
          `axe.run().then(r=>({violations:r.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})),incomplete:r.incomplete.map(v=>v.id)}))`,
        );
        await screenshot(name);
        assert.deepEqual(result.violations, [], name);
        assert.ok(
          result.incomplete.every((id) => id === 'label-content-name-mismatch'),
          name + ': unexpected manual review required: ' + JSON.stringify(result.incomplete),
        );
        t.diagnostic(name + ': axe passed; manual-review categories ' + result.incomplete.join(', '));
      };
      assert.equal(await evaluate('document.documentElement.lang'), 'en');
      assert.equal(
        await evaluate(`getComputedStyle(document.querySelector('.shell')).display`),
        'grid',
        'full stylesheet must load under the service CSP',
      );
      assert.equal(
        await evaluate(`getComputedStyle(document.querySelector('.shell')).gridTemplateColumns.split(' ').length`),
        2,
      );
      await audit('english-disconnected-desktop');
      // Verify keyboard focus separately from the platform-specific native select popup.
      await evaluate(`document.querySelectorAll('nav button')[2].focus()`);
      await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      assert.equal(
        await evaluate('document.activeElement.tagName'),
        'SELECT',
        'language selector is reachable by keyboard',
      );
      await language('it');
      await audit('italian-disconnected-desktop');
      assert.ok(await evaluate(`document.querySelector('h1').textContent.includes('Il tuo mondo.')`));
      await language('en');
      // A refused sign-in must not reveal protected reminders or enable writes.
      await evaluate(
        `document.querySelector('input[type=password]').value='wrong-token';[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Connect').click()`,
      );
      await until(
        `document.querySelector('[role=alert]')?.textContent==='Connection failed. Check the service and token.'`,
      );
      assert.equal(await evaluate(`document.querySelector('input[type="datetime-local"]')===null`), true);
      assert.equal(
        await evaluate(`document.querySelector('input[type=password]').value`),
        '',
        'credentials cleared from the control',
      );
      assert.deepEqual(
        await evaluate(
          `Promise.all(['/api/reminders','/api/inbox','/api/doctor'].map(path=>fetch(path).then(r=>r.status)))`,
        ),
        [401, 401, 401],
      );
      assert.equal(
        await evaluate(
          `fetch('/api/reminders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Unauthorized',due:'2031-04-12T09:30:00Z'})}).then(r=>r.status)`,
        ),
        401,
      );
      assert.equal(store.list().length, 0, 'unauthenticated requests cannot create reminders');
      await audit('english-refused-sign-in');
      await evaluate(
        `document.querySelector('input[type=password]').value='${token}';[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Connect').click()`,
      );
      await until(`document.querySelector('input[type="datetime-local"]')!==null`);
      await evaluate(
        `document.querySelector('input[maxlength]').value='Practice sketching / Disegno';document.querySelector('input[type="datetime-local"]').value='2031-04-12T09:30';[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save reminder').click()`,
      );
      await until(`document.querySelector('article.reminder strong')?.textContent==='Practice sketching / Disegno'`);
      const reminder = store.list()[0];
      assert.equal(reminder.title, 'Practice sketching / Disegno');
      assert.equal(reminder.due, '2031-04-12T07:30:00.000Z', 'browser-local input converted to UTC');
      for (const lang of ['en', 'it']) {
        await language(lang);
        assert.equal(await evaluate(`document.querySelector('article.reminder strong').textContent`), reminder.title);
        assert.equal(
          await evaluate(`document.querySelector('article.reminder button').getAttribute('aria-label')`),
          (lang === 'it' ? 'Annulla' : 'Cancel') + ' ' + reminder.title,
          'graphical cancel control has its localized action and reminder name',
        );
        assert.equal(
          await evaluate(`document.querySelector('article.reminder .edit-btn').getAttribute('aria-label')`),
          (lang === 'it' ? 'Modifica' : 'Edit') + ' ' + reminder.title,
          'graphical edit control has its localized action and reminder name',
        );
        assert.equal(
          await evaluate(`document.querySelector('article.reminder .edit-btn').textContent.trim()`),
          lang === 'it' ? 'Modifica' : 'Edit',
          'visible edit button text',
        );
        assert.equal(
          await evaluate(`document.querySelector('article.reminder p').textContent`),
          await evaluate(`new Date('${reminder.due}').toLocaleString('${lang === 'it' ? 'it-IT' : 'en-GB'}')`),
        );
        assert.equal(
          await evaluate(`document.querySelector('label:has(input[type="datetime-local"]) small').textContent`),
          lang === 'it' ? 'Ora locale del browser' : 'Browser local time',
        );
        for (const [width, height] of [
          [1440, 1000],
          [390, 844],
          [320, 740],
        ]) {
          await viewport(width, height);
          await screenshot(lang + '-layout-' + width);
          assert.equal(
            await evaluate('document.documentElement.scrollWidth<=innerWidth'),
            true,
            lang +
              ' layout at ' +
              width +
              ': ' +
              JSON.stringify(
                await evaluate(
                  `[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))`,
                ),
              ),
          );
          await audit(lang + '-reminders-' + width);
        }
        await evaluate(`document.querySelectorAll('nav button')[2].click()`);
        await until(`document.querySelector('nerv-doctor-view')!==null`);
        await until(`document.querySelector('main pre')!==null`);
        assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, lang + ' doctor layout');
        assert.equal(
          await evaluate(`document.querySelector('.doctor-overall-badge').textContent.trim()`),
          lang === 'it' ? 'Tutti i controlli superati' : 'All checks passing',
        );
        assert.ok(
          (await evaluate(`document.querySelectorAll('.doctor-check').length`)) >= 4,
          'structured doctor checks rendered',
        );
        assert.equal(
          await evaluate(`document.querySelector('.doctor-check strong').textContent.trim()`),
          lang === 'it' ? 'Central Dogma (database SQLite)' : 'Central Dogma (SQLite database)',
        );
        await evaluate(`document.querySelector('pre').focus()`);
        assert.equal(await evaluate('document.activeElement.tagName'), 'PRE');
        await audit(lang + '-doctor-mobile');

        // F-004-T03: doctor results with severity, issues and fix hints
        await evaluate(`{
          const original = window.fetch;
          window.fetch = (input, init) => String(input).includes('/api/doctor')
            ? Promise.resolve(new Response(JSON.stringify({
                database: { quick_check: 'failed' },
                processes: { nervous: 0, brain: 1234, brainAlive: false },
                routes: { local: { state: 'down', error: 'ECONNREFUSED' } },
                degraded: ['test degraded notice']
              }), { status: 200, headers: { 'Content-Type': 'application/json', 'ngsw-bypass': '1' } }))
            : original(input, init);
          window.restoreDoctorFetch = () => { window.fetch = original; delete window.restoreDoctorFetch; };
        }`);
        await evaluate(`document.querySelector('header button').click()`);
        await until(`document.querySelector('.doctor-check.check-error')!==null`);
        assert.equal(
          await evaluate(`document.querySelector('.doctor-overall-badge').textContent.trim()`),
          lang === 'it' ? 'Rilevati problemi' : 'Issues detected',
        );
        assert.ok(
          await evaluate(
            `document.querySelector('.doctor-fix')?.textContent.includes(${JSON.stringify(lang === 'it' ? 'Esegui il controllo' : 'Run database')})`,
          ),
          'database fix hint rendered',
        );
        assert.ok(
          (await evaluate(`document.querySelectorAll('.doctor-fix').length`)) >= 3,
          'multiple fix hints rendered for issues and degraded items',
        );
        await audit(lang + '-doctor-issues');
        await evaluate('window.restoreDoctorFetch()');
        await evaluate(`document.querySelector('header button').click()`);
        await until(`document.querySelector('.doctor-check.check-error')===null`);

        await evaluate(`document.querySelectorAll('nav button')[0].click()`);
        await until(`document.querySelector('article.reminder')!==null`);
      }
      assert.equal(store.list()[0].due, reminder.due, 'language changes do not reinterpret stored time');
      // Exercise UI -> authenticated HTTP -> SQLite, not a mocked success response.
      const save = (title, due) =>
        evaluate(
          `{document.querySelector('input[maxlength]').value=${JSON.stringify(title)};document.querySelector('input[type="datetime-local"]').value=${JSON.stringify(due)};document.querySelector('.grid .panel button').click();}`,
        );
      for (const lang of ['en', 'it']) {
        await language(lang);
        await viewport(390, 844);
        const saveError =
          lang === 'it'
            ? 'Impossibile salvare: verifica titolo e data futura.'
            : 'Could not save: check the title and future date.';
        for (const [title, due] of [
          ['', '2031-04-12T09:30'],
          ['Missing date', ''],
          ['Past date', '2020-01-01T09:30'],
        ]) {
          await evaluate(`document.querySelector('header button').click()`);
          await until(`document.querySelector('[role=alert]')===null`);
          const before = store.list().length;
          await save(title, due);
          await until(`document.querySelector('[role=alert]')?.textContent===${JSON.stringify(saveError)}`);
          assert.equal(store.list().length, before, 'invalid input never writes: ' + lang + ' ' + title);
          await audit(lang + '-invalid-' + (title || 'blank-title').replaceAll(' ', '-'));
        }
        const title = lang === 'it' ? 'Annullare questa prova' : 'Cancel this test';
        await save(title, '2031-04-13T10:00');
        await until(
          `[...document.querySelectorAll('article.reminder strong')].some(e=>e.textContent===${JSON.stringify(title)})`,
        );
        const added = store.list().find((r) => r.title === title);
        assert.ok(added);
        // A failed cancellation stays visible and retryable; it is not shown as completed.
        await evaluate(
          `{const original=window.fetch;window.fetch=(input,init)=>init?.method==='DELETE'?Promise.resolve(new Response(JSON.stringify({error:'Temporary test failure'}),{status:503,headers:{'Content-Type':'application/json'}})):original(input,init);window.restoreCoreFetch=()=>{window.fetch=original;delete window.restoreCoreFetch;};}`,
        );
        const cancel = () =>
          evaluate(
            `[...document.querySelectorAll('article.reminder')].find(e=>e.querySelector('strong').textContent===${JSON.stringify(title)}).querySelector('button').click()`,
          );
        await cancel();
        await until(
          `document.querySelector('[role=alert]')?.textContent===${JSON.stringify(lang === 'it' ? 'Impossibile annullare il promemoria.' : 'Could not cancel the reminder.')}`,
        );
        assert.equal(store.list().find((r) => r.id === added.id).cancelled, null);
        await audit(lang + '-cancel-failed');
        await evaluate('window.restoreCoreFetch()');
        await cancel();
        await until(
          `[...document.querySelectorAll('article.reminder')].some(e=>e.querySelector('strong').textContent===${JSON.stringify(title)}&&e.querySelector('small').textContent===${JSON.stringify(lang === 'it' ? 'Annullato' : 'Cancelled')}&&e.querySelector('button')===null)`,
        );
        assert.ok(store.list().find((r) => r.id === added.id).cancelled, 'browser cancellation reaches storage');
        await audit(lang + '-cancelled');

        // F-004-T02: edit reminder flow (inline form, validation, keep-as-is, error handling, successful patch, axe).
        const editTargetTitle = lang === 'it' ? 'Modificare questa voce' : 'Edit this item';
        await save(editTargetTitle, '2031-05-01T12:00');
        await until(
          `[...document.querySelectorAll('article.reminder strong')].some(e=>e.textContent===${JSON.stringify(editTargetTitle)})`,
        );
        const target = store.list().find((r) => r.title === editTargetTitle);
        assert.ok(target);

        const editBtn = () =>
          evaluate(
            `[...document.querySelectorAll('article.reminder')].find(e=>e.querySelector('strong')?.textContent===${JSON.stringify(editTargetTitle)}).querySelector('.edit-btn').click()`,
          );
        await editBtn();
        await until(`document.querySelector('article.reminder.editing')!==null`);
        assert.equal(
          await evaluate(`document.querySelector('.rem-edit input[type=text]').value`),
          editTargetTitle,
          'prefilled title in edit form',
        );
        assert.equal(
          await evaluate(`document.querySelector('.rem-edit input[type=datetime-local]').value`),
          '2031-05-01T12:00',
          'prefilled local time in edit form',
        );
        await audit(lang + '-reminder-editing');

        // Cancel edit ("Keep as is") restores normal view and focus
        await evaluate(`document.querySelector('.rem-edit .keep-btn').click()`);
        await until(`document.querySelector('article.reminder.editing')===null`);
        const editLabel = (lang === 'it' ? 'Modifica ' : 'Edit ') + editTargetTitle;
        await until(`document.activeElement?.getAttribute('aria-label')===${JSON.stringify(editLabel)}`);
        assert.equal(
          await evaluate(`document.activeElement?.getAttribute('aria-label')`),
          editLabel,
          'focus restored to edit button after keep as is',
        );

        // Edit with invalid input shows error and does not update store
        await editBtn();
        await until(`document.querySelector('article.reminder.editing')!==null`);
        await evaluate(
          `{const input=document.querySelector('.rem-edit input[type=text]');input.value='';input.dispatchEvent(new Event('input'));document.querySelector('.rem-edit .save-btn').click();}`,
        );
        await until(`document.querySelector('[role=alert]')?.textContent===${JSON.stringify(saveError)}`);
        assert.equal(store.list().find((r) => r.id === target.id).title, editTargetTitle, 'blank edit title rejected');

        // Failed PATCH (e.g. 500) shows editError
        await evaluate(
          `{const original=window.fetch;window.fetch=(input,init)=>init?.method==='PATCH'?Promise.resolve(new Response(JSON.stringify({error:'Server error'}),{status:500,headers:{'Content-Type':'application/json'}})):original(input,init);window.restorePatchFetch=()=>{window.fetch=original;delete window.restorePatchFetch;};}`,
        );
        const updatedTitle = editTargetTitle + ' (updated)';
        await evaluate(
          `{const input=document.querySelector('.rem-edit input[type=text]');input.value=${JSON.stringify(updatedTitle)};input.dispatchEvent(new Event('input'));document.querySelector('.rem-edit .save-btn').click();}`,
        );
        const editError = lang === 'it' ? 'Impossibile aggiornare il promemoria.' : 'Could not update the reminder.';
        await until(`document.querySelector('[role=alert]')?.textContent===${JSON.stringify(editError)}`);
        assert.equal(
          store.list().find((r) => r.id === target.id).title,
          editTargetTitle,
          'failed PATCH does not update storage',
        );
        await evaluate('window.restorePatchFetch()');

        // Successful edit
        await evaluate(`document.querySelector('.rem-edit .save-btn').click()`);
        await until(`document.querySelector('article.reminder.editing')===null`);
        await until(
          `[...document.querySelectorAll('article.reminder strong')].some(e=>e.textContent===${JSON.stringify(updatedTitle)})`,
        );
        assert.equal(
          store.list().find((r) => r.id === target.id).title,
          updatedTitle,
          'storage reflects updated title',
        );
        await audit(lang + '-reminder-edited');

        // Clean up the edited reminder with cancel
        const cancelEdited = () =>
          evaluate(
            `[...document.querySelectorAll('article.reminder')].find(e=>e.querySelector('strong')?.textContent===${JSON.stringify(updatedTitle)}).querySelector('button').click()`,
          );
        await cancelEdited();
        await until(
          `[...document.querySelectorAll('article.reminder')].some(e=>e.querySelector('strong')?.textContent===${JSON.stringify(updatedTitle)}&&e.querySelector('small')?.textContent===${JSON.stringify(lang === 'it' ? 'Annullato' : 'Cancelled')}&&e.querySelector('button')===null)`,
        );
      }
      // Cancel the original example too, then advance only the test store clock.
      await evaluate(`document.querySelector('article.reminder button').click()`);
      await until(`document.querySelectorAll('article.reminder button').length===0`);
      assert.equal(store.tick(new Date('2031-04-14T00:00:00Z')), 0, 'cancelled reminders never enter the inbox');
      assert.equal(store.inbox().length, 0);
      const deliveredTitle = '<img src=x onerror="throw new Error(1)"> Inbox test';
      const delivered = store.add(deliveredTitle, '2031-04-15T08:00:00Z', new Date('2031-04-14T00:00:00Z'));
      assert.equal(store.tick(new Date('2031-04-16T00:00:00Z')), 1);
      assert.equal(store.tick(new Date('2031-04-16T00:00:00Z')), 0);
      for (const lang of ['en', 'it']) {
        await language(lang);
        await evaluate(`document.querySelector('header button').click()`);
        await until(`document.querySelector('.inbox').textContent.includes(${JSON.stringify(deliveredTitle)})`);
        assert.equal(await evaluate(`document.querySelectorAll('.inbox p').length`), 1, 'one local delivery shown');
        assert.equal(await evaluate(`document.querySelector('.inbox img')===null`), true, 'owner content remains text');
        assert.equal(
          await evaluate(
            `[...document.querySelectorAll('article.reminder')].find(e=>e.querySelector('strong').textContent===${JSON.stringify(deliveredTitle)}).querySelector('small').textContent`,
          ),
          lang === 'it' ? 'Nella casella' : 'In your inbox',
        );
        await audit(lang + '-local-inbox');
      }
      assert.ok(store.list().find((r) => r.id === delivered.id).delivered);

      // Real paged UI -> HTTP -> SQLite traversal, including controls and focus in both languages.
      for (let n = 0; n < 25; n++) {
        store.add('Page reminder ' + n, '2035-01-01T00:00:00Z');
        store.addBrief('Page brief ' + n);
      }
      for (const lang of ['en', 'it']) {
        await language(lang);
        await evaluate(`document.querySelector('header button').click()`);
        await until(
          `document.querySelectorAll('article.reminder').length===20&&document.querySelectorAll('.inbox p').length===20`,
        );
        const groups =
          lang === 'en' ? ['Reminder pages', 'Inbox pages'] : ['Pagine dei promemoria', 'Pagine della posta'];
        for (const [index, group] of groups.entries()) {
          const selector = `[role=group][aria-label="${group}"]`;
          const first = await evaluate(
            index === 0
              ? `document.querySelector('article.reminder strong').textContent`
              : `document.querySelector('.inbox p').textContent`,
          );
          // Existing rows can still be visible while the shared paging guard is busy after Refresh/language change.
          await until(
            `document.querySelector('${selector} button:last-child').getAttribute('aria-disabled')==='false'`,
          );
          await evaluate(
            `document.querySelector('${selector} button:last-child').focus();document.activeElement.click()`,
          );
          await until(
            `!document.querySelector('${selector} button:first-child').disabled&&document.querySelector('${selector} button:first-child').getAttribute('aria-disabled')==='false'`,
          );
          assert.equal(
            await evaluate(`document.activeElement.closest('[role=group]')?.getAttribute('aria-label')`),
            group,
            'keyboard focus stays in the active pager',
          );
          assert.notEqual(
            await evaluate(
              index === 0
                ? `document.querySelector('article.reminder strong').textContent`
                : `document.querySelector('.inbox p').textContent`,
            ),
            first,
          );
          await evaluate(`document.querySelector('${selector} button:first-child').click()`);
          await until(
            `document.querySelector('${selector} button:first-child').disabled&&document.querySelector('${selector} button:last-child').getAttribute('aria-disabled')==='false'`,
          );
          assert.equal(
            await evaluate(
              index === 0
                ? `document.querySelector('article.reminder strong').textContent`
                : `document.querySelector('.inbox p').textContent`,
            ),
            first,
          );
        }
        await audit(lang + '-history-pages');
      }
      // F-019: shipped /dashboard accounting, keyboard pager, mobile layout and actual change notifications.
      const price = {
        route: 'cloud',
        model: 'actual-model',
        currency: 'USD',
        source: 'https://provider.example/pricing',
        asOf: '2026-11-07',
        input: 2,
        output: 10,
        cacheRead: 1,
        cacheWrite: 3,
      };
      for (let n = 0; n < 7; n++) {
        const id = store.usage.begin('misato.step');
        if (n !== 6)
          store.usage.finish(
            id,
            {
              route: 'cloud',
              requestedModel: 'requested-model',
              returnedModel: 'actual-model',
              inputTokens: 100,
              outputTokens: 20,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              durationMs: 30,
              outcome: 'success',
            },
            [price],
          );
      }
      store.memory.add('accounting-lilith fact', 'owner');
      const advised = store.ledger.openSortie('misato', 'Advice route fixture', 'trusted');
      store.ledger.note(advised, 'misato.request', { text: 'Advice route fixture', conversation: 'dashboard' });
      store.ledger.note(advised, 'misato.consult', {
        advice: 'Use the requested local reminder tool only.',
        model: 'fixture-adviser',
      });
      const login = await (
        await fetch(origin + '/api/session/codes', { method: 'POST', headers: { authorization: 'Bearer ' + token } })
      ).json();
      await viewport(1440, 1000);
      await page('Page.navigate', { url: origin + '/dashboard/#code=' + login.code });
      await until(
        `document.querySelector('.banner')?.textContent.includes('LIVE ·')&&!document.querySelector('.banner')?.textContent.includes('SIGNING IN')`,
      );
      await until(
        `document.querySelector('.snode[data-n="consult"]').classList.contains('done')&&document.querySelector('#edges path.loop.passed')`,
      );
      assert.equal(
        await evaluate(
          `(()=>{const probe=document.createElement('i');probe.style.color='var(--ok)';document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return getComputedStyle(document.querySelector('#edges path.loop.passed')).stroke===expected})()`,
        ),
        true,
        'completed advice route is painted as passed',
      );
      await screenshot('dashboard-advise-route');
      // F-057: exercise the actual header button and browser clipboard, not only the helper.
      await until(`document.querySelector('#build').dataset.commit.length>=7`);
      const reportedBuild = await (
        await fetch(origin + '/api/doctor', { headers: { authorization: 'Bearer ' + token } })
      ).json();
      const runningCommit = reportedBuild.build.shortCommit;
      assert.match(runningCommit, /^[0-9a-f]{4,40}$/);
      assert.equal(
        await evaluate(`document.querySelector('#build').dataset.copyCommit`),
        runningCommit,
        'button uses the server’s Git-verified ID',
      );
      await call('Browser.grantPermissions', {
        origin,
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
      });
      await evaluate(`document.querySelector('#build').click()`);
      assert.equal(
        await evaluate(`navigator.clipboard.readText()`),
        runningCommit,
        'header copies Git’s unique running commit',
      );
      assert.equal(
        await evaluate(`document.querySelector('#build').title`),
        'Commit ' + runningCommit + ' · click to copy',
        'hover and clipboard use the same identifier',
      );
      // F-053: sparse dynamic noise is decorative and opt-in; reduced motion stops and clears it.
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.crt-noise')).display`), 'none');
      await evaluate(`document.querySelector('#btn-crt').click()`);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.crt-noise')).display`), 'block');
      assert.equal(await evaluate(`document.querySelector('.crt-noise').getAttribute('aria-hidden')`), 'true');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.wrap')).animationDuration`), '31s');
      assert.equal(
        await evaluate(
          `(()=>{const probe=document.createElement('i');probe.style.color='var(--eva01)';document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return getComputedStyle(document.querySelector('#magi-big')).borderTopColor===expected})()`,
        ),
        true,
        'MAGI has its violet identity',
      );
      await evaluate(readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
      await evaluate(
        `{const flicker=document.querySelector('.wrap').getAnimations().find(a=>a.animationName==='crt-flicker');flicker.pause();flicker.currentTime=21100}`,
      );
      assert.deepEqual(
        await evaluate(
          `axe.run(document.querySelector('.s-magi')).then(r=>r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})))`,
        ),
        [],
        'MAGI axe with CRT',
      );
      await until(`document.querySelector('.crt-band-a').getAnimations().length===1`);
      assert.ok(
        await evaluate(`document.querySelector('.crt-band-a').getAnimations()[0].effect.getTiming().duration>=4500`),
        'randomized band motion is running',
      );
      await until(`document.querySelector('.crt-noise').width===innerWidth`);
      await evaluate(`window.crtNoiseFrameForTest=document.querySelector('.crt-noise').toDataURL()`);
      await until(`document.querySelector('.crt-noise').toDataURL()!==window.crtNoiseFrameForTest`);
      const density = await evaluate(
        `(()=>{const c=document.querySelector('.crt-noise'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=3;i<data.length;i+=4)if(data[i])count++;return count/(c.width*c.height)})()`,
      );
      assert.ok(density > 0 && density <= 0.001, 'dynamic specks cover under 0.1% of the canvas; no matte field');
      await screenshot('dashboard-crt-on');
      await evaluate(`document.querySelector('.wrap').getAnimations().find(a=>a.animationName==='crt-flicker').play()`);
      await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.wrap')).animationName`), 'none');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.crt-band')).display`), 'none');
      await until(
        `crtMotionPreference.matches&&!crtMotionActive&&document.querySelector('.crt-band-a').getAnimations().length===0`,
      );
      assert.equal(
        await evaluate(`document.querySelector('.crt-band-b').getAnimations().length`),
        0,
        'reduced motion cancels both JavaScript animations',
      );
      assert.equal(
        await evaluate(
          `(()=>{const c=document.querySelector('.crt-noise');return c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)})()`,
        ),
        false,
        'reduced motion clears all noise pixels',
      );
      await screenshot('dashboard-crt-reduced-motion');
      await page('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
      });
      try {
        await until(`!crtMotionPreference.matches&&document.querySelector('.crt-band-a').getAnimations().length===1`);
      } catch (error) {
        t.diagnostic(
          JSON.stringify(
            await evaluate(
              `({reduced:crtMotionPreference.matches,on:state.crt,theme:state.theme,hidden:document.hidden,generation:crtGeneration,bands:crtMotion.map(b=>({timer:b.timer,animation:!!b.animation})),lastFrame,now:performance.now(),animations:document.querySelector('.crt-band-a').getAnimations().map(a=>a.playState)})`,
            ),
          ),
        );
        t.diagnostic(JSON.stringify(errors));
        throw error;
      }
      await evaluate(
        `{const select=document.querySelector('#theme');select.value='simple';select.dispatchEvent(new Event('change',{bubbles:true}))}`,
      );
      assert.equal(
        await evaluate(`document.querySelector('.crt-band-a').getAnimations().length`),
        0,
        'Simple theme cancels band motion',
      );
      await evaluate(
        `{const select=document.querySelector('#theme');select.value='eva';select.dispatchEvent(new Event('change',{bubbles:true}))}`,
      );
      await until(`document.querySelector('.crt-band-a').getAnimations().length===1`);
      await evaluate(`document.querySelector('#btn-crt').click()`);
      assert.equal(
        await evaluate(`document.querySelector('.crt-band-a').getAnimations().length`),
        0,
        'turning CRT off cancels bands',
      );
      await evaluate(`document.querySelector('#tab-battery').click()`);
      await until(`document.querySelector('#budget-sub')?.textContent.includes('5 calls')`);
      assert.equal(await evaluate(`location.hash`), '', 'login code removed');
      assert.match(await evaluate(`document.querySelector('#budget').textContent`), /actual-model/);
      assert.match(await evaluate(`document.querySelector('#budget').textContent`), /requested-model/);
      assert.match(await evaluate(`document.querySelector('#budget').textContent`), /Outcome and usage unknown/);
      assert.match(await evaluate(`document.querySelector('#budget').textContent`), /price as of 2026-11-07/);
      assert.doesNotMatch(
        await evaluate(`document.querySelector('#budget').textContent`),
        /S² free|Cost tracking planned/,
      );
      await evaluate(`document.querySelector('[data-usage-page="older"]').focus();document.activeElement.click()`);
      await until(`document.querySelector('#budget-sub')?.textContent.includes('2 calls')`);
      assert.equal(await evaluate(`document.activeElement.dataset.usagePage`), 'newer');
      await evaluate(`document.querySelector('[data-usage-page="newer"]').click()`);
      await until(`document.querySelector('#budget-sub')?.textContent.includes('5 calls')`);
      await evaluate(`document.querySelector('#p-budget').focus()`);
      await evaluate(readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
      for (const width of [1440, 390]) {
        await viewport(width, 1000);
        const violations = await evaluate(
          `axe.run(document.querySelector('#p-budget')).then(r=>r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})))`,
        );
        assert.deepEqual(violations, [], 'Battery axe ' + width);
        assert.equal(
          await evaluate(`document.documentElement.scrollWidth<=innerWidth`),
          true,
          'dashboard accounting width ' + width,
        );
        await screenshot('dashboard-accounting-' + width);
      }
      await evaluate(
        `{state.log.push({t:Date.now(),msg:'accounting-lilith trace',who:'maya',s:null,cls:''});const search=document.querySelector('#sortie-q');search.value='accounting-lilith';search.dispatchEvent(new Event('input',{bubbles:true}))}`,
      );
      assert.match(await evaluate(`document.querySelector('#lilith mark')?.textContent||''`), /accounting-lilith/);
      assert.match(await evaluate(`document.querySelector('#log mark')?.textContent||''`), /accounting-lilith/);
      await evaluate(
        `{const search=document.querySelector('#sortie-q');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#p-budget').focus()}`,
      );
      // Disable recovery intervals to prove the fetch stream, rather than the 3-second poll, refreshes a changed record.
      await evaluate(`for(let id=1;id<10000;id++)clearInterval(id)`);
      const pushed = store.usage.begin('casper.verdict');
      store.usage.finish(pushed, {
        route: 'local',
        requestedModel: 'new-request',
        returnedModel: 'pushed-model',
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 10,
        outcome: 'success',
      });
      await until(`document.querySelector('#budget')?.textContent.includes('pushed-model')`);
      // Navigate away and Back: a restored tab must resume authenticated reads/notifications.
      await page('Page.navigate', { url: origin });
      await until(`document.querySelector('h1')?.textContent.includes('Your world.')`);
      const navigation = await page('Page.getNavigationHistory');
      await page('Page.navigateToHistoryEntry', { entryId: navigation.entries[navigation.currentIndex - 1].id });
      await until(`document.querySelector('#tab-battery')!==null`);
      await evaluate(`document.querySelector('#tab-battery').click()`);
      await until(`document.querySelector('#budget')?.textContent.includes('pushed-model')`);
      const restored = store.usage.begin('model.complete');
      store.usage.finish(restored, {
        route: 'local',
        requestedModel: 'restored-request',
        returnedModel: 'restored-model',
        inputTokens: 2,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 4,
        outcome: 'success',
      });
      await until(`document.querySelector('#budget')?.textContent.includes('restored-model')`);
      assert.deepEqual(errors, [], 'no runtime exceptions or CSP violations');
    } finally {
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.fail(new Error('Browser closed'));
      }
      pending.clear();
      ws?.terminate();
      if (child.exitCode === null) {
        await new Promise((done) => {
          const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
          child.once('exit', () => {
            clearTimeout(timer);
            done();
          });
          child.kill();
        });
      }
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      store.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
);
