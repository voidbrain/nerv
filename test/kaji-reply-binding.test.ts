import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pinKajiRoot, setBase } from '../src/config.ts';
import { registryPort } from '../src/coordinator-epoch.ts';
import { KajiLink, type RegistryPort } from '../src/kaji-link.ts';
import { Registry, baseKey, signRecord, type RegistryBody } from '../src/kaji.ts';
import { Store } from '../src/store.ts';

const free = () =>
  new Promise<number>((resolve) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = (srv.address() as { port: number }).port;
      srv.close(() => resolve(p));
    });
  });

interface Captured {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** An attacker on the path to one base: it forwards requests and keeps the answers, or answers with one it kept. */
async function pathAttacker(target: number) {
  let replay: Captured | undefined;
  const captured: Captured[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const answer = (a: Captured) => {
        res.writeHead(a.status, a.headers);
        res.end(a.body);
      };
      if (replay) return answer(replay);
      const fwd = request(
        { host: '127.0.0.1', port: target, method: req.method, path: req.url, headers: req.headers, agent: false },
        (up) => {
          const back: Buffer[] = [];
          up.on('data', (c: Buffer) => back.push(c));
          up.on('end', () => {
            const a = { status: up.statusCode ?? 0, headers: up.headers, body: Buffer.concat(back) };
            captured.push(a);
            answer(a);
          });
        },
      );
      fwd.end(Buffer.concat(chunks));
    });
  });
  const port = await free();
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
  return {
    port,
    captured,
    replayWith: (a: Captured) => (replay = a),
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

describe('B-125: a signed Kaji reply answers only the request it was signed for', () => {
  it('an epoch-push reply captured on the way to one base is refused when replayed to answer another base', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-reply-binding-'));
    const root = generateKeyPairSync('ed25519');
    const rootPub = root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const ids = ['NERV-02', 'NERV-03', 'NERV-04'] as const;
    const bases = await Promise.all(
      ids.map(async (id) => {
        const home = join(dir, id);
        mkdirSync(home, { recursive: true });
        setBase(home, { id, name: id });
        pinKajiRoot(home, rootPub, true);
        const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
        return { id, home, store, reg: new Registry(store.db, rootPub), port: await free(), key: baseKey(home) };
      }),
    );
    let serial = 0;
    const records = [
      ...bases.map((b) => ({
        kind: 'enrol',
        baseId: b.id,
        name: b.id,
        publicKey: b.key.publicKey,
        address: `127.0.0.1:${b.port}`,
      })),
      { kind: 'main', baseId: 'NERV-02', coordinatorEpoch: 3 },
    ].map((body) =>
      signRecord(root.privateKey, {
        ...body,
        serial: ++serial,
        issued: '2026-11-24T10:00:00.000Z',
      } as unknown as RegistryBody),
    );
    for (const b of bases) for (const r of records) b.reg.add(r);
    const [a, c, d] = bases as unknown as [(typeof bases)[0], (typeof bases)[0], (typeof bases)[0]];
    const attacker = await pathAttacker(d.port);
    // A and C reach D through the attacker (the owner-signed records are the same; only the route differs).
    const routedPort = (x: (typeof bases)[0]): RegistryPort => {
      const port = registryPort(x.reg);
      return {
        ...port,
        bases: async () =>
          (await port.bases()).map((b) => (b.baseId === d.id ? { ...b, address: `127.0.0.1:${attacker.port}` } : b)),
      };
    };
    let ranOrAcked = 2;
    const responder = new KajiLink({
      baseId: d.id,
      key: d.key.privateKey,
      publicKey: d.key.publicKey,
      registry: registryPort(d.reg),
      holdsStandby: () => true,
      ranOrAckedEpoch: () => ranOrAcked,
    });
    const client = (x: (typeof bases)[0]) =>
      new KajiLink({ baseId: x.id, key: x.key.privateKey, publicKey: x.key.publicKey, registry: routedPort(x) });
    await responder.start(60_000);
    try {
      // D answers A's probe genuinely; the attacker keeps that signed reply.
      assert.equal((await client(a).pushEpoch(d.id, [])).ranOrAckedEpoch, 2);
      assert.equal(attacker.captured.length, 1);
      // D then acks a lease at epoch 3. C probes D, and the attacker answers with the reply D signed for A.
      ranOrAcked = 3;
      attacker.replayWith(attacker.captured[0]!);
      await assert.rejects(client(c).pushEpoch(d.id, []), /not bound to this request|answers another request/);
    } finally {
      await responder.stop();
      await attacker.close();
      for (const x of bases) x.store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
