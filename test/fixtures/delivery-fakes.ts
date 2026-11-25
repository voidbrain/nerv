/**
 * Loopback fakes for delivery tests (F-124, F-004-T09): a push service that decrypts what it receives (RFC 8291) and
 * answers a chosen status, and a Bot API that records sendMessage. Invented keys and data only.
 */
import { createServer } from 'node:http';
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

export const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
export async function until(check: () => boolean | Promise<boolean>, ms = process.platform === 'win32' ? 15000 : 8000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await wait(25);
  }
}

/** A push service with one device: every POST is decrypted with the device's keys and answered with `status`. */
export async function fakePushService(initialStatus = 201) {
  const device = createECDH('prime256v1');
  device.generateKeys();
  const auth = randomBytes(16);
  let status = initialStatus;
  const received: { notification: { title: string; data: Record<string, unknown> } }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try {
      received.push(JSON.parse(decrypt(Buffer.concat(chunks), device.getPublicKey(), device, auth)));
    } catch {
      // an undecryptable body is still answered
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(status >= 400 ? JSON.stringify({ reason: 'InvalidTestStatus' }) : '{}');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  return {
    received,
    setStatus: (next: number) => {
      status = next;
    },
    subscription: {
      endpoint: `http://127.0.0.1:${port}/push/device-1`,
      p256dh: device.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

function decrypt(body: Buffer, devicePublic: Buffer, device: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const serverPublic = body.subarray(21, 21 + idlen);
  const sealed = body.subarray(21 + idlen);
  const secret = device.computeSecret(serverPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), devicePublic, serverPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString('utf8');
}

/** A Bot API that accepts sendMessage (or fails it while `failSends(true)`) and answers getUpdates with nothing. */
export async function fakeBotApi(token: string) {
  let failing = false;
  const sent: string[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (c) => (raw += c))
      .on('end', () => {
        const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
        res.setHeader('content-type', 'application/json');
        if (!m || m[1] !== token) {
          res.statusCode = 401;
          res.end(JSON.stringify({ ok: false, description: 'Unauthorized' }));
          return;
        }
        if (m[2] === 'sendMessage') {
          if (failing) {
            res.statusCode = 503;
            res.end(JSON.stringify({ ok: false, description: 'temporary failure' }));
            return;
          }
          sent.push(String((JSON.parse(raw || '{}') as { text?: unknown }).text ?? ''));
          res.end(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
          return;
        }
        if (m[2] === 'getUpdates') {
          setTimeout(() => res.end(JSON.stringify({ ok: true, result: [] })), 50);
          return;
        }
        res.end(JSON.stringify({ ok: true, result: true }));
      });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    sent,
    failSends: (on: boolean) => {
      failing = on;
    },
    base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}
