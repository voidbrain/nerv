// Worker link heartbeats (B-046, B-066): stalls, grace budgets and busy request slots keep or end sessions correctly.
// The fixture is test/fixtures/worker-link.ts; B-118 split the file so its tests run in parallel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { fixture, item, rawReady, until, wait } from './fixtures/worker-link.ts';
test(
  'F-014: an asleep peer missing signed heartbeats is disconnected without inferring that work stopped',
  { timeout: 30000 },
  async () => {
    const f = await fixture(50);
    try {
      f.main.start();
      await rawReady(f);
      await until(() => !f.main.connected('NERV-02'));
      await assert.rejects(f.main.run('NERV-02', item(105), 100));
      assert.equal((await f.rb.list()).length, 0);
    } finally {
      await f.close();
    }
  },
);
// B-046 review: the late-timeout grace is granted once. A peer that never answers still loses its session after a stall:
// within the stall plus the grace budget, not kept alive by repeated deferrals.
test(
  'B-046: after a stall, a peer that never answers is still disconnected after one grace budget',
  { timeout: 30000 },
  async () => {
    // Budget 400 ms against a 600 ms stall: one grace ends the session near 1,000 ms, a second deferral near 1,400 ms.
    const f = await fixture(400);
    const send = WebSocket.prototype.send;
    let pingAt = 0;
    WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      const sent = (send as (...args: unknown[]) => void).call(this, data, ...rest);
      if (!pingAt && String(data).includes('worker.ping')) {
        pingAt = performance.now();
        setImmediate(() => {
          const end = Date.now() + 600;
          while (Date.now() < end) {
            /* busy on purpose */
          }
        });
      }
      return sent;
    } as typeof send;
    try {
      f.main.start();
      await rawReady(f);
      await until(() => pingAt > 0);
      await until(() => !f.main.connected('NERV-02'));
      const elapsed = performance.now() - pingAt;
      // Stall (600 ms) plus one fresh budget (400 ms), with 300 ms scheduling slack. Heartbeats sent after the stall also
      // end the session near this time, so the once-only grace itself is checked on a single request below.
      assert.ok(elapsed >= 600, `disconnected after ${Math.round(elapsed)} ms, before the stall ended`);
      assert.ok(elapsed < 600 + 400 + 300, `disconnected only after ${Math.round(elapsed)} ms`);
    } finally {
      WebSocket.prototype.send = send;
      await f.close();
    }
  },
);
// B-046 review of #278: the grace is granted once per request. With no heartbeat traffic, a request the peer never
// answers is rejected after the stall plus one fresh budget (about 1,000 ms), not after a second one (about 1,400 ms).
test('B-046: a stalled request the peer never answers gets one grace budget, not two', { timeout: 30000 }, async () => {
  const f = await fixture(60000);
  const send = WebSocket.prototype.send;
  let sentAt = 0;
  WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
    const sent = (send as (...args: unknown[]) => void).call(this, data, ...rest);
    if (!sentAt && String(data).includes('worker.run')) {
      sentAt = performance.now();
      setImmediate(() => {
        const end = Date.now() + 600;
        while (Date.now() < end) {
          /* busy on purpose */
        }
      });
    }
    return sent;
  } as typeof send;
  try {
    f.main.start();
    await rawReady(f);
    await assert.rejects(f.main.run('NERV-02', item(108), 400), /Worker result unknown after timeout/);
    const elapsed = performance.now() - sentAt;
    // Timers run on the loop's millisecond clock and can fire a fraction of a millisecond before performance.now() says
    // the budget is over (#278 CI run 43106952492: 1000 ms rounded, failing an exact bound); 50 ms of slack still
    // separates "rejected when the stall ended" (about 600 ms) from "after one grace budget" (about 1,000 ms).
    assert.ok(
      elapsed >= 600 + 400 - 50,
      `rejected after ${Math.round(elapsed)} ms, before stall plus one grace budget`,
    );
    assert.ok(elapsed < 600 + 400 + 300, `rejected only after ${Math.round(elapsed)} ms: more than one grace budget`);
  } finally {
    WebSocket.prototype.send = send;
    await f.close();
  }
});
// B-046 (#275 Windows run 43084555427): the grace budget's own timer can fire late too. A second stall that starts
// after the peer answered the stalled ping leaves the answer unread in the socket when that timer fires; the verdict
// must read it first, not end a healthy session.
test(
  'B-046: an answer that arrives during a second stall is read before the grace budget ends the session',
  { timeout: 30000 },
  async () => {
    // Only the coordinator heartbeat runs: both peers share this process, so the stalls would also freeze the peer
    // that answers a reverse-direction ping, which a real remote peer would not (measured 3 of 15 failures from that).
    const f = await fixture(150, 60000);
    const send = WebSocket.prototype.send;
    let hellos = 0,
      armed = false,
      stalledId = '',
      done = false;
    const stall = (ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        /* busy on purpose */
      }
    };
    const rpcOf = (data: unknown) => {
      try {
        return JSON.parse(JSON.parse(String(data)).body).rpc as { id?: string; method?: string; result?: unknown };
      } catch {
        return {};
      }
    };
    WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      const sent = (send as (...args: unknown[]) => void).call(this, data, ...rest);
      if (String(data).includes('worker.hello')) hellos++;
      const rpc = rpcOf(data);
      if (armed && rpc.method === 'worker.ping' && rpc.id) {
        armed = false;
        stalledId = rpc.id;
        setImmediate(() => stall(200));
      } else if (stalledId && rpc.id === stalledId && 'result' in rpc) {
        stalledId = '';
        // The answer is written; stall again past the grace budget before this process reads it.
        setImmediate(() => {
          stall(200);
          done = true;
        });
      }
      return sent;
    } as typeof send;
    try {
      await f.start();
      const negotiated = hellos;
      armed = true;
      await until(() => done);
      // Sample the session directly, so a lost session that reconnects slowly cannot pass as a kept one.
      for (let i = 0; i < 40; i++) {
        assert.ok(f.main.connected('NERV-02'), 'an answer already received must not be judged a timeout');
        await wait(10);
      }
      assert.equal(hellos - negotiated, 0, 'an answer already received must not be judged a timeout');
    } finally {
      WebSocket.prototype.send = send;
      await f.close();
    }
  },
);
// B-046 mechanism (3), PR #280: every frame a link receives is verified against its registry, calls to the receiving
// side's nervous process, so the worker answers a ping only after its nervous process has served what was queued ahead.
// Linux coverage run 43121587426 lost a session this way: the worker's `kaji.bases` for the ping waited 225 ms behind a
// 271 ms `usage.finish` write, with this process's loop on time. Under remedy (a) test fixtures have a 500 ms ping
// budget (above measured store latency of 50–270 ms); here the worker's store answers 300 ms late while the loop stays
// free, and the healthy session survives.
test(
  'B-046: a ping waiting on a slow store on the worker does not end a healthy session',
  { timeout: 30000 },
  async () => {
    const f = await fixture(undefined, 60000);
    const send = WebSocket.prototype.send;
    let hellos = 0;
    WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      if (String(data).includes('worker.hello')) hellos++;
      return (send as (...args: unknown[]) => void).call(this, data, ...rest);
    } as typeof send;
    try {
      await f.start();
      const negotiated = hellos,
        call = f.rb.nervous.call.bind(f.rb.nervous);
      let slowed = 0;
      f.rb.nervous.call = async (method, params = {}, timeout) => {
        // The next registry read waits as if a durable write were ahead of it; no event-loop stall.
        if (method === 'kaji.bases' && !slowed++) await wait(300);
        return call(method, params, timeout);
      };
      void f.rb.kaji.bases();
      await until(() => slowed > 0);
      for (let i = 0; i < 60; i++) {
        assert.ok(f.main.connected('NERV-02'), 'a slow store on the worker is not a lost peer');
        await wait(10);
      }
      assert.equal(hellos - negotiated, 0, 'a slow store on the worker is not a lost peer');
    } finally {
      WebSocket.prototype.send = send;
      await f.close();
    }
  },
);
test(
  'B-066-T02: worker-link heartbeats survive slow registry IPC without dropping live sessions',
  { timeout: 30000 },
  async () => {
    // B-066-T03: registry IPC 1,200 ms late against a 500 ms budget (more than twice the budget, as 300 against 120 was),
    // so a frame that waited for the registry would still end the session, while Windows scheduling stays inside it.
    const f = await fixture(500, 500);
    const send = WebSocket.prototype.send;
    let hellos = 0;
    WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      if (String(data).includes('worker.hello')) hellos++;
      return (send as (...args: unknown[]) => void).call(this, data, ...rest);
    } as typeof send;
    try {
      await f.start();
      const negotiated = hellos;
      for (const rt of [f.ra, f.rb]) {
        const call = rt.nervous.call.bind(rt.nervous);
        rt.nervous.call = async (method, params = {}, timeout) => {
          if (method === 'kaji.bases' || method === 'kaji.main') await wait(1200);
          return call(method, params, timeout);
        };
      }
      for (let i = 0; i < 130; i++) {
        assert.ok(f.main.connected('NERV-02'), 'live session must not drop while registry IPC is slow');
        await wait(12);
      }
      assert.equal(hellos - negotiated, 0, 'session must not reconnect while registry IPC is slow');
      assert.equal(((await f.main.run('NERV-02', item(200), 2000)) as { outcome: string }).outcome, 'grant');
    } finally {
      WebSocket.prototype.send = send;
      await f.close();
    }
  },
);
test('F-014: concurrent replay and overload execute the same durable request once', { timeout: 30000 }, async () => {
  // Keep heartbeat traffic out of this deliberate four-slot saturation; heartbeat expiry has its own case.
  const f = await fixture(10000);
  try {
    await f.start();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => f.main.run('NERV-02', item(106), 5000)));
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal((await f.rb.list()).length, 1);
    assert.equal(((await f.main.run('NERV-02', item(107), 5000)) as { outcome: string }).outcome, 'grant');
    assert.equal((await f.rb.list()).length, 2);
  } finally {
    await f.close();
  }
});
// B-046 review of #278: a peer on earlier code pings on every tick, so a second ping can arrive while the first is still
// handled. It takes a work slot, as before the heartbeat got its own slot, and the session stays up.
test(
  'B-046: an overlapping ping from a peer on earlier code is answered, not refused',
  { timeout: 30000 },
  async () => {
    const f = await fixture(60000);
    try {
      f.main.start();
      const raw = await rawReady(f);
      // Hold the first ping in its handler (the coordinator records presence) until the second one has arrived.
      const seen = f.ra.kaji.seen.bind(f.ra.kaji);
      let release = () => {};
      const gate = new Promise<void>((done) => (release = done));
      let calls = 0;
      (f.ra.kaji as unknown as { seen: (u: Record<string, string>) => unknown }).seen = async (updates) => {
        if (++calls === 1) await gate;
        return seen(updates);
      };
      const answers: unknown[] = [];
      raw.socket.on('message', (data) => answers.push(JSON.parse(JSON.parse(data.toString()).body).rpc));
      raw.socket.send(raw.frame(2, 'worker.ping', { offers: [] }));
      raw.socket.send(raw.frame(3, 'worker.ping', { offers: [] }));
      await until(() => calls >= 2 || !f.main.connected('NERV-02'));
      assert.ok(f.main.connected('NERV-02'), 'an overlapping ping does not end the session');
      release();
      await until(() => answers.length >= 2);
      for (const a of answers) assert.ok(a && typeof a === 'object' && 'result' in a, 'both pings are answered');
      assert.ok(f.main.connected('NERV-02'), 'an overlapping ping does not end the session');
    } finally {
      await f.close();
    }
  },
);
// B-046 (diagnosis 2026-11-11, "Worker pending request bound reached" under load): a heartbeat counted against the
// work in-flight bound, so a link whose four request slots are busy (deferred approvals, slow runs) refused its own
// heartbeat and ended a healthy session; a fifth incoming request (the ping) did the same on the receiving side.
test(
  'B-046: a link whose request slots are all busy keeps its heartbeat and its session',
  { timeout: 30000 },
  async () => {
    const f = await fixture(400, 60000);
    const original = f.adapter;
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    f.setAdapter({
      ...original,
      run: async (o, i, c) => {
        await held;
        return original.run(o, i, c);
      },
    });
    const send = WebSocket.prototype.send;
    let hellos = 0;
    WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      if (String(data).includes('worker.hello')) hellos++;
      return (send as (...args: unknown[]) => void).call(this, data, ...rest);
    } as typeof send;
    try {
      await f.start();
      const negotiated = hellos;
      const busy = [12, 13, 14, 15].map((n) => f.main.run('NERV-02', item(n), 10000).catch((e: unknown) => e));
      // Several heartbeat ticks while every request slot is taken.
      for (let i = 0; i < 60; i++) {
        assert.ok(f.main.connected('NERV-02'), 'a busy link must keep its session');
        await wait(20);
      }
      assert.equal(hellos - negotiated, 0, 'a busy link must not reconnect');
      release();
      await Promise.all(busy);
    } finally {
      release();
      WebSocket.prototype.send = send;
      await f.close();
    }
  },
);
// B-046 reproduction (timing reassessment 2026-11-11), committed as todo before the fix; the fix removed the todo.
// The peer is healthy throughout: only this process's event loop is busy.
test(
  'B-046: a healthy session survives an event-loop stall longer than the heartbeat budget',
  { timeout: 30000 },
  async () => {
    // Each ping/pong verifies through the nervous process; under machine load (Windows CI or parallel local runs) 150 ms
    // is tighter than nervous IPC (50-270 ms), and both peers share this process so only the coordinator heartbeat runs.
    const hb = 400;
    const stallMs = Math.ceil(hb * 1.5);
    const f = await fixture(hb, 60000);
    const send = WebSocket.prototype.send;
    let pings = 0,
      hellos = 0,
      armed = false;
    const stall = (ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        /* busy on purpose */
      }
    };
    WebSocket.prototype.send = function (this: WebSocket, data: unknown, ...rest: unknown[]) {
      const sent = (send as (...args: unknown[]) => void).call(this, data, ...rest);
      if (String(data).includes('worker.hello')) hellos++;
      if (armed && String(data).includes('worker.ping')) {
        pings++;
        armed = false;
        setImmediate(() => stall(stallMs));
      }
      return sent;
    } as typeof send;
    try {
      await f.start();
      const negotiated = hellos;
      for (let i = 0; i < 4; i++) {
        const before = pings;
        armed = true;
        await until(() => pings > before);
        await wait(stallMs + 60);
      }
      assert.equal(hellos - negotiated, 0, 'a reply that arrived during the stall must not end the session');
    } finally {
      WebSocket.prototype.send = send;
      await f.close();
    }
  },
);
