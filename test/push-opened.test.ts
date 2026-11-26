import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Store } from '../src/store.ts';
import { makeServer } from '../src/server.ts';
import { fakePushService, until, wait } from './fixtures/delivery-fakes.ts';

// B-170: on the owner's iPhone no tap ever reached POST /api/push/opened. iOS may drop the worker's request, the
// notification's data or the click event itself; these tests play each of those and expect the tap recorded anyway.

const TOKEN = 's'.repeat(32);
type Payload = { notification: { title: string; data: Record<string, unknown> } };
type Shown = { title: string; data: Record<string, unknown> | null; tag?: string };

/** One origin's Cache Storage, shared by the worker and the page as in a browser. */
function cacheStorage() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (k: string | { url: string }) =>
    new URL(typeof k === 'string' ? k : k.url, 'https://nerv.test/dashboard/sw.js').href;
  return {
    stores,
    open: async (name: string) => {
      const m = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, m);
      return {
        put: async (k: string, v: Response) => void m.set(key(k), v),
        keys: async () => [...m.keys()].map((url) => ({ url })),
        match: async (k: string | { url: string }) => m.get(key(k))?.clone(),
        delete: async (k: string | { url: string }) => m.delete(key(k)),
      };
    },
  };
}

/** The dashboard's real worker (web/public/dashboard/sw.js) on a phone whose notification centre the test controls. */
function worker(origin: string, caches: ReturnType<typeof cacheStorage>, opts: { lists?: boolean } = {}) {
  const listeners = new Map<string, (e: unknown) => void>();
  const shown: Shown[] = [];
  const windows: string[] = [];
  let dropRequests = false;
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    skipWaiting: () => {},
    caches,
    registration: {
      showNotification: async (title: string, options: { data: Record<string, unknown> | null; tag?: string }) =>
        void shown.push({ title, data: options.data, ...(options.tag ? { tag: options.tag } : {}) }),
      // B-170 review: a phone that lists its notifications by tag, or (lists: false) one whose list comes back empty.
      getNotifications: async ({ tag }: { tag: string }) =>
        opts.lists === false ? [] : shown.filter((n) => n.tag === tag).map((n) => ({ tag: n.tag })),
    },
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async (url: string) => void windows.push(url),
    },
  };
  const sandboxFetch = (path: string, init: RequestInit) =>
    dropRequests ? Promise.reject(new TypeError('Load failed')) : fetch(origin + path, init);
  runInNewContext(readFileSync('web/public/dashboard/sw.js', 'utf8'), {
    self,
    fetch: sandboxFetch,
    URL,
    JSON,
    Response,
  });
  const fire = async (type: string, event: object) => {
    const work: Promise<unknown>[] = [];
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => work.push(p) });
    await Promise.all(work);
  };
  return {
    shown,
    windows,
    dropRequests: () => {
      dropRequests = true;
    },
    receive: (payload: Payload) => fire('push', { data: { json: () => payload, text: () => JSON.stringify(payload) } }),
    /** The owner taps it: iOS takes it out of Notification Centre, then (maybe) runs the click handler. */
    tap: async (n: Shown, opts: { event?: boolean; data?: boolean } = {}) => {
      shown.splice(shown.indexOf(n), 1);
      if (opts.event === false) return;
      await fire('notificationclick', {
        notification: { data: opts.data === false ? null : n.data, tag: n.tag ?? '', close: () => {} },
      });
    },
  };
}

/** The dashboard page's tap report (web/public/dashboard/live.js), as the app opens at `search`. */
function page(origin: string, caches: ReturnType<typeof cacheStorage>, shown: () => Shown[], search = '') {
  const src = readFileSync('web/public/dashboard/live.js', 'utf8');
  const start = src.indexOf('  // B-170: a tap');
  assert.ok(start > 0, 'live.js reports taps from the page (B-170)');
  const hook = src.slice(start, src.indexOf('  const consulted = new Set();'));
  const replaced: string[] = [];
  const listeners = new Map<string, () => void>();
  const document = {
    visibilityState: 'visible',
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
  };
  new Function('location', 'history', 'self', 'navigator', 'document', 'fetch', hook)(
    { pathname: '/dashboard/', search, hash: '' },
    { replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) },
    { caches },
    {
      serviceWorker: {
        getRegistration: async () => ({ getNotifications: async () => shown().map((n) => ({ tag: n.tag ?? '' })) }),
      },
    },
    document,
    (path: string, init: RequestInit) => fetch(origin + path, init),
  );
  return { replaced, visible: () => listeners.get('visibilitychange')?.() };
}

async function setup() {
  const push = await fakePushService(201);
  const store = new Store(':memory:');
  store.savePushSubscription(push.subscription);
  const server = makeServer(store, TOKEN);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    store,
    push,
    origin,
    caches: cacheStorage(),
    /** A reminder falls due and is pushed; returns its inbox item id and the payload the phone gets. */
    async due(title: string) {
      const before = push.received.length;
      store.add(title, new Date(Date.now() + 30).toISOString());
      await wait(50);
      store.tick();
      await until(() => push.received.length === before + 1);
      const id = store.inboxPage(0, 20).items.find((i) => i.message.includes(title))!.id;
      return { id, payload: push.received.at(-1)! };
    },
    state: (id: string) => store.deliveryState(id).push?.state,
    async close() {
      await new Promise<void>((done) => server.close(() => done()));
      await push.close();
      store.close();
    },
  };
}

test('B-170: iOS drops the worker request: the page the tap opened reports the receipt, once', async () => {
  const t = await setup();
  try {
    const { id, payload } = await t.due('Bere acqua');
    const phone = worker(t.origin, t.caches);
    await phone.receive(payload);
    phone.dropRequests();
    await phone.tap(phone.shown[0]!);
    assert.equal(t.state(id), 'sent', 'the worker request never arrived');
    const receipt = payload.notification.data.receipt as string;
    assert.deepEqual(phone.windows, ['/dashboard/?opened=' + receipt], 'the tap opens the page with its receipt');
    const opened = page(t.origin, t.caches, () => phone.shown, '?opened=' + receipt);
    assert.deepEqual(opened.replaced, ['/dashboard/'], 'the receipt leaves the address at once');
    await until(() => t.state(id) === 'opened');
  } finally {
    await t.close();
  }
});

test('B-170: iOS loses the notification data: the tag still carries the receipt', async () => {
  const t = await setup();
  try {
    const { id, payload } = await t.due('Bere latte');
    const phone = worker(t.origin, t.caches);
    await phone.receive(payload);
    assert.match(phone.shown[0]!.tag ?? '', /^nerv-push-[A-Za-z0-9_-]{24}$/);
    await phone.tap(phone.shown[0]!, { data: false });
    assert.equal(t.state(id), 'opened');
  } finally {
    await t.close();
  }
});

test('B-170: no click event at all: the opened app reports a kept receipt once its notification is gone, never one still shown', async () => {
  const t = await setup();
  try {
    const first = await t.due('Chiamare Ada');
    const second = await t.due('Annaffiare le piante');
    const phone = worker(t.origin, t.caches);
    await phone.receive(first.payload);
    await phone.receive(second.payload);
    await phone.tap(phone.shown[0]!, { event: false });
    const app = page(t.origin, t.caches, () => phone.shown);
    await until(() => t.state(first.id) === 'opened');
    await wait(150);
    assert.equal(t.state(second.id), 'sent', 'a notification still in Notification Centre is not seen');
    await phone.tap(phone.shown[0]!, { event: false });
    app.visible();
    await until(() => t.state(second.id) === 'opened');
    assert.equal([...t.caches.stores.get('nerv-push-pending')!.keys()].length, 0, 'reported receipts are dropped');
  } finally {
    await t.close();
  }
});

test('B-170 review: a phone that cannot list its notifications never confirms one by its absence', async () => {
  const t = await setup();
  try {
    const { id, payload } = await t.due('Bere acqua');
    const phone = worker(t.origin, t.caches, { lists: false });
    await phone.receive(payload);
    // getNotifications comes back empty: the owner opens the app with the notification still in Notification Centre.
    page(t.origin, t.caches, () => []);
    await wait(300);
    assert.equal(t.state(id), 'sent', 'not seen: Telegram still sends it at the deadline');
  } finally {
    await t.close();
  }
});

test('B-170: /api/push/opened takes the route it came by and logs each outcome without the receipt', async () => {
  const t = await setup();
  const logged = mock.method(console, 'log', () => {});
  try {
    const { id, payload } = await t.due('Portare il pane');
    const receipt = payload.notification.data.receipt as string;
    const post = (value: object) =>
      fetch(t.origin + '/api/push/opened', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
    assert.equal((await post({ receipt, via: 'sms' })).status, 400, 'an unknown route is refused');
    assert.equal((await post({ receipt, via: 'page' })).status, 200);
    assert.equal(t.state(id), 'opened');
    assert.equal((await post({ receipt, via: 'worker' })).status, 200, 'a repeat is harmless');
    assert.equal((await post({ receipt: 'x'.repeat(24), via: 'page' })).status, 404);
    const lines = logged.mock.calls.map((c) => String(c.arguments[0]));
    assert.ok(lines.includes('push: opened via page: recorded'), lines.join('\n'));
    assert.ok(lines.includes('push: opened via worker: recorded'));
    assert.ok(lines.includes('push: opened via page: unknown receipt'));
    assert.ok(!lines.some((l) => l.includes(receipt)), 'the receipt is never logged');
  } finally {
    logged.mock.restore();
    await t.close();
  }
});

const call = (origin: string, path: string, bearer: string | undefined, method = 'POST', value?: unknown) =>
  fetch(origin + path, {
    method,
    headers: {
      ...(bearer ? { authorization: 'Bearer ' + bearer } : {}),
      ...(value ? { 'content-type': 'application/json' } : {}),
    },
    body: value ? JSON.stringify(value) : undefined,
  });

test('B-170: a paired device keeps one push subscription; revoking the device removes it', async () => {
  const t = await setup();
  try {
    const pairDevice = async (name: string) => {
      const { code } = (await (await call(t.origin, '/api/device/codes', TOKEN)).json()) as { code: string };
      return (await (await call(t.origin, '/api/device/pair', undefined, 'POST', { code, name })).json()) as {
        token: string;
        device: { id: string };
      };
    };
    const subscribe = (bearer: string, endpoint: string) =>
      call(t.origin, '/api/push/subscribe', bearer, 'POST', {
        endpoint,
        keys: { p256dh: t.push.subscription.p256dh, auth: t.push.subscription.auth },
      });
    const phone = await pairDevice('Phone');
    const tablet = await pairDevice('Tablet');
    const endpoints = () =>
      t.store
        .listPushSubscriptions()
        .map((s) => s.endpoint)
        .sort();
    assert.equal((await subscribe(phone.token, 'https://push.example.test/phone-1')).status, 201);
    assert.equal((await subscribe(tablet.token, 'https://push.example.test/tablet-1')).status, 201);
    assert.equal((await subscribe(phone.token, 'https://push.example.test/phone-2')).status, 201);
    assert.deepEqual(
      endpoints(),
      [t.push.subscription.endpoint, 'https://push.example.test/phone-2', 'https://push.example.test/tablet-1'],
      "the phone's new subscription replaces its old one; others stay",
    );
    assert.equal((await call(t.origin, '/api/devices/' + phone.device.id, TOKEN, 'DELETE')).status, 200);
    assert.deepEqual(
      endpoints(),
      [t.push.subscription.endpoint, 'https://push.example.test/tablet-1'],
      'a revoked device gets no more pushes',
    );
  } finally {
    await t.close();
  }
});

test('B-170: a delivered reminder can be marked done; it leaves the dashboard list and never reaches Telegram', async () => {
  const t = await setup();
  try {
    const { id } = await t.due('Prendere le medicine');
    const reminder = t.store.db.prepare('SELECT reminder_id FROM deliveries WHERE id=?').get(id) as {
      reminder_id: string;
    };
    const recent = () =>
      (t.store.dashboardHistory(new Date(0).toISOString()) as { recent: { id: string; title: string }[] }).recent;
    assert.deepEqual(
      recent().map((r) => r.title),
      ['Prendere le medicine'],
      'Coming up lists the delivered reminder',
    );
    const pending = t.store.add('Più tardi', new Date(Date.now() + 3_600_000).toISOString());
    const done = (rid: string, bearer: string | undefined = TOKEN) =>
      call(t.origin, `/api/reminders/${rid}/done`, bearer, 'POST');
    assert.equal((await done(reminder.reminder_id, '')).status, 401, 'needs sign-in');
    assert.equal((await done(pending.id)).status, 404, 'a reminder not delivered yet cannot be done');
    assert.equal((await done(reminder.reminder_id)).status, 200);
    assert.equal((await done(reminder.reminder_id)).status, 200, 'done twice is harmless');
    assert.deepEqual(recent(), [], 'done reminders leave the list');
    assert.deepEqual(t.store.pushFallback(0), [], 'done is seen: Telegram never sends it');
  } finally {
    await t.close();
  }
});

test('B-170: the dashboard shows delivered reminders with Done and posts it', async () => {
  const src = readFileSync('web/public/dashboard/live.js', 'utf8');
  assert.match(src, /state\.recent = history\.recent/, 'the poll keeps the delivered reminders');
  assert.match(src, /data-rem-done=/, 'each delivered reminder has a Done button');
  assert.match(src, /"reminders\/" \+ r\.id \+ "\/done"/, 'Done posts to the done endpoint');
  assert.match(readFileSync('web/public/dashboard/index.html', 'utf8'), /id="next-done"/);
});
