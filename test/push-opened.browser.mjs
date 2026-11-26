// @ts-check
// B-170: on the owner's iPhone no tap on a push ever reached the service. End to end in Chrome against the real service
// (makeServer) serving web/public: the dashboard's real worker receives a push (CDP delivers it), shows it and keeps its
// receipt; the page reports a receipt from ?opened= and a kept one once its notification is gone, never one still
// shown; Coming up lists the delivered reminder with Done, and Done marks it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { fakePushService } from './fixtures/delivery-fakes.ts';
import { browser } from './fixtures/browser.mjs';

test(
  'B-170: the dashboard page reports tapped pushes and marks delivered reminders done',
  { timeout: 180000 },
  async () => {
    const push = await fakePushService(201);
    const store = new Store(':memory:');
    store.savePushSubscription(push.subscription);
    // The adapters the dashboard's poll reads, as test/angular.browser.mjs sets them.
    const adapters = /** @type {any} */ (store);
    adapters.modelUsage = async (/** @type {number} */ before, /** @type {number} */ limit) =>
      store.usage.page(before, limit);
    adapters.lilith = { list: async () => store.memory.list(), episodes: async () => store.memory.episodes() };
    const token = 'o'.repeat(32);
    const server = makeServer(store, token, {
      webRoot: resolve('web/public'),
      language: 'en',
      timeZone: 'Europe/Rome',
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
    const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
    const due = async (/** @type {string} */ title) => {
      const before = push.received.length;
      store.add(title, new Date(Date.now() + 30).toISOString());
      await new Promise((d) => setTimeout(d, 50));
      store.tick();
      for (let i = 0; push.received.length === before; i++) {
        assert.ok(i < 200, 'the push never left');
        await new Promise((d) => setTimeout(d, 25));
      }
      const id = store.inboxPage(0, 20).items.find((i) => i.message.includes(title))?.id ?? '';
      return { id, payload: /** @type {{ notification: { data: Record<string, unknown> } }} */ (push.received.at(-1)) };
    };
    const state = (/** @type {string} */ id) => store.deliveryState(id).push?.state;
    const waitFor = async (/** @type {() => boolean} */ check, /** @type {string} */ what) => {
      for (let i = 0; !check(); i++) {
        assert.ok(i < 400, 'timed out: ' + what);
        await new Promise((d) => setTimeout(d, 25));
      }
    };
    try {
      await browser(async ({ page, evaluate, until, errors }) => {
        await page('Browser.grantPermissions', { origin, permissions: ['notifications'] });
        const signIn = async (/** @type {string} */ suffix) => {
          const login = await (
            await fetch(origin + '/api/session/codes', {
              method: 'POST',
              headers: { authorization: 'Bearer ' + token },
            })
          ).json();
          await page('Page.navigate', { url: origin + '/dashboard/' + suffix + '#code=' + login.code });
        };
        // 1. The tap opened /dashboard/?opened=<receipt> (the worker's request was lost): the page reports it.
        const a = await due('Bere acqua');
        await signIn('?opened=' + a.payload.notification.data.receipt);
        await waitFor(() => state(a.id) === 'opened', 'the ?opened= receipt is reported');
        await until(`location.search === ''`);

        // 2. A push the worker showed and kept (no click event ever fires): the page reports it only once its
        // notification is gone. The page plays the worker's two steps through the same registration (node tests run
        // the worker's own handler: test/push-opened.test.ts); here Chrome's Cache Storage and notification list answer.
        await evaluate(
          `navigator.serviceWorker.register('/dashboard/sw.js', { scope: '/dashboard/' }).then(() => navigator.serviceWorker.ready).then(() => true)`,
        );
        const b = await due('Bere latte');
        const receipt = b.payload.notification.data.receipt;
        await evaluate(`(async () => {
        const reg = await navigator.serviceWorker.getRegistration('/dashboard/');
        await reg.showNotification('Bere latte', { tag: 'nerv-push-${receipt}' });
        await (await caches.open('nerv-push-pending')).put('/dashboard/push-pending/${receipt}', new Response('listed'));
        return true;
      })()`);
        await page('Page.reload');
        await until(`!!document.getElementById('next-done')`);
        await new Promise((d) => setTimeout(d, 500));
        assert.equal(state(b.id), 'sent', 'a notification still shown is not reported');
        await evaluate(
          `navigator.serviceWorker.getRegistration('/dashboard/').then(r => r.getNotifications()).then(ns => { ns.forEach(n => n.close()); return true; })`,
        );
        await page('Page.reload');
        await waitFor(() => state(b.id) === 'opened', 'the kept receipt is reported once its notification is gone');
        await until(`caches.open('nerv-push-pending').then(c => c.keys()).then(k => k.length === 0)`);

        // 3. Coming up lists both delivered reminders with Done; Done marks one and it leaves the list.
        await until(`document.querySelectorAll('[data-rem-done]').length === 2`, 30000);
        await evaluate(`document.querySelector('[data-rem-done][aria-label="Done: Bere acqua"]').click()`);
        await until(`document.querySelectorAll('[data-rem-done]').length === 1`, 30000);
        assert.equal(
          store
            .dashboardHistory(new Date(0).toISOString())
            .recent.map((r) => r.title)
            .join(),
          'Bere latte',
        );
        assert.deepEqual(errors, []);
      });
    } finally {
      await new Promise((done) => server.close(() => done(undefined)));
      await push.close();
      store.close();
    }
  },
);
