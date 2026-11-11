import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync('web/public/dashboard/live.js', 'utf8');
const poll = src.slice(src.indexOf('  async function poll()'), src.indexOf('  // Comms: the selected'));
function harness(api: (path: string) => Promise<unknown>) {
  const banners: string[] = [],
    signins: string[] = [];
  let forgotten = 0;
  const h = new Function(
    'api',
    'setBanner',
    'signIn',
    'forgetSession',
    `
 const SESSION_ENDED='Session ended';let token='test',polling=false,pollFailures=0,lastRan=null,firstTrace=true,followNew=null;
 const detailCache={},known=new Map(),older=[],matches=[],BASES=[{name:'TEST'}],activeCage={};let shown=[];
 const state={lastVisit:Date.now(),sorties:[],selected:null};
 const loadUsage=async()=>{};const toSortie=s=>s,toApproval=a=>a;const applyBases=()=>{},healthOf=()=>{},loadModels=()=>{},loadEvents=async()=>0,renderLog=()=>{},showBuild=()=>{},renderAll=()=>{},kajiSummary=()=>'',liveBaseName=()=> 'test',esc=s=>s.replaceAll('<','&lt;');
 ${poll}
 return {poll,state,failures:()=>pollFailures,hasToken:()=>!!token};`,
  )(
    api,
    (s: string) => banners.push(s),
    (s: string) => signins.push(s),
    () => forgotten++,
  ) as { poll: () => Promise<void>; state: object; failures: () => number; hasToken: () => boolean };
  return { ...h, banners, signins, forgotten: () => forgotten };
}
const ok = (path: string) =>
  path.startsWith('dashboard/history?')
    ? { delivered: 0, pending: 0, reminders: [], brief: null }
    : path === 'doctor'
      ? {}
      : [];
test('B-008: one failed poll preserves the view; the next success recovers without a connection warning', async () => {
  let fail = true;
  const h = harness(async (path) => {
    if (path.startsWith('sorties?') && fail) throw new Error('GET /api/sorties: timed out.');
    return ok(path);
  });
  await h.poll();
  assert.deepEqual(h.banners, []);
  assert.equal(h.failures(), 1);
  fail = false;
  await h.poll();
  assert.equal(h.failures(), 0);
  assert.match(h.banners.at(-1)!, /LIVE · test/);
  assert.doesNotMatch(h.banners.join(''), /LOST|UNREACHABLE/);
});
test('B-008: repeated read failures probe status; a reachable service says refresh delayed, then recovers', async () => {
  let fail = true;
  let probes = 0;
  const h = harness(async (path) => {
    if (path === 'status') {
      probes++;
      return {};
    }
    if (path.startsWith('sorties?') && fail) throw new Error('GET /api/sorties: nervous sorties.list timed out.');
    return ok(path);
  });
  await h.poll();
  await h.poll();
  assert.equal(probes, 1);
  assert.match(h.banners.at(-1)!, /REFRESH DELAYED/);
  assert.doesNotMatch(h.banners.at(-1)!, /\.\.|restart|CONNECTION LOST/);
  fail = false;
  await h.poll();
  assert.match(h.banners.at(-1)!, /LIVE · test/);
  assert.equal(h.failures(), 0);
});
test('B-008: unreachable service retries; an expired session signs out immediately', async () => {
  const down = harness(async () => {
    throw new Error('fetch failed');
  });
  await down.poll();
  await down.poll();
  assert.match(down.banners.at(-1)!, /SERVICE UNREACHABLE/);
  const unhealthy = harness(async () => {
    throw Object.assign(new Error('HTTP 503'), { status: 503 });
  });
  await unhealthy.poll();
  await unhealthy.poll();
  assert.match(unhealthy.banners.at(-1)!, /STATUS UNAVAILABLE/);
  const expired = harness(async () => {
    throw Object.assign(new Error('GET /api/doctor: Authentication required.'), { status: 401 });
  });
  await expired.poll();
  assert.equal(expired.hasToken(), false);
  assert.equal(expired.forgotten(), 1);
  assert.equal(expired.signins.length, 1);
});
test('B-008: read errors name the endpoint and are bounded; writes have no read timeout and are never retried', async () => {
  const apiSource = src.slice(src.indexOf('  const api ='), src.indexOf('\n  const short ='));
  const calls: { path: string; init: { signal?: unknown } }[] = [];
  const signal = {};
  const api = new Function('fetch', 'AbortSignal', `let token='test';${apiSource};return api;`)(
    async (path: string, init: { signal?: unknown }) => {
      calls.push({ path, init });
      throw Object.assign(new Error('slow'), { name: 'TimeoutError' });
    },
    {
      timeout: (ms: number) => {
        assert.equal(ms, 10000);
        return signal;
      },
    },
  ) as (path: string, init?: object) => Promise<unknown>;
  await assert.rejects(api('doctor'), /GET \/api\/doctor: read timed out/);
  assert.equal(calls[0]!.init.signal, signal);
  await assert.rejects(api('chat', { method: 'POST' }), /POST \/api\/chat/);
  assert.equal(calls[1]!.init.signal, undefined);
  assert.equal(calls.length, 2);
});

test(
  'B-008: dashboard reads keep answering while a relayed chat is waiting on the main base',
  { timeout: 15000 },
  async () => {
    const { Runtime } = await import('../src/runtime.ts');
    const { makeServer } = await import('../src/server.ts');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'nerv-poll-relay-'));
    const r = new Runtime(join(dir, 'nerv.sqlite'));
    let release = () => {},
      started = () => {};
    const waiting = new Promise<void>((d) => {
        release = d;
      }),
      sent = new Promise<void>((d) => {
        started = d;
      });
    r.setDispatch(async (_message, _conversation, forwarding) => {
      await forwarding({ id: 'NERV-02', name: 'Test main' });
      started();
      await waiting;
      return { sortieId: 'remote', reply: 'Done', steps: [], waiting: [] };
    });
    const server = makeServer(r, 't'.repeat(32));
    await new Promise<void>((d) => server.listen(0, '127.0.0.1', d));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const headers = { Authorization: 'Bearer ' + 't'.repeat(32), 'Content-Type': 'application/json' };
    let chat: Promise<Response> | undefined;
    try {
      await r.ready();
      chat = fetch(base + '/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: 'A neutral test question' }),
      });
      await sent;
      for (let i = 0; i < 2; i++)
        for (const path of [
          'sorties?limit=20',
          'approvals?limit=20',
          'doctor',
          'reminders',
          'inbox',
          'memory',
          'memory/episodes',
          'bases',
          'pilots',
        ]) {
          const res = await fetch(base + '/api/' + path, { headers });
          assert.equal(res.status, 200, path);
          await res.json();
        }
      release();
      assert.equal(((await (await chat).json()) as { reply: string }).reply, 'Done');
    } finally {
      release();
      await chat?.catch(() => {});
      await new Promise<void>((d) => server.close(() => d()));
      await r.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test('F-013: dashboard delivery aggregates stay scoped to the last-visit cursor, including an in-flight mark read', async () => {
  let release: () => void = () => {};
  const waiting = new Promise<void>((done) => {
    release = done;
  });
  const h = harness(async (path) => {
    if (path.startsWith('dashboard/history?')) {
      await waiting;
      return { delivered: 37, pending: 12, reminders: [], brief: null };
    }
    return ok(path);
  });
  const state = h.state as { lastVisit: number; deliveredCount?: number; deliveredSince?: number };
  const old = state.lastVisit;
  const poll = h.poll();
  state.lastVisit = old + 1000;
  release();
  await poll;
  assert.equal(h.failures(), 0);
  assert.equal(state.deliveredSince, old);
  const away = src.slice(
    src.indexOf('  window.renderAway ='),
    src.indexOf('  // The panel redraws', src.indexOf('  window.renderAway =')),
  );
  const box = { innerHTML: '', textContent: '' };
  const render = new Function(
    'state',
    'document',
    `const window={},dayTime=()=>'',esc=s=>s;${away};return window.renderAway;`,
  )(state, { getElementById: () => box }) as () => void;
  render();
  assert.match(
    box.innerHTML,
    /delivered <b>0<\/b> reminders/,
    'a response for the prior visit never repopulates its count',
  );
  state.deliveredSince = state.lastVisit;
  render();
  assert.match(box.innerHTML, /delivered <b>37<\/b> reminders/, 'the current cursor shows its exact SQL count');
});
