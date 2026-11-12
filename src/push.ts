import { generateKeyPairSync, createSign, createECDH, hkdfSync, randomBytes, createCipheriv } from 'node:crypto';

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
  created: string;
  userAgent?: string;
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const rawPublic = publicKey.subarray(-65);
  return {
    publicKey: rawPublic.toString('base64url'),
    privateKey,
  };
}

export function buildVapidHeader(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  subject = 'mailto:nerv@agency.local',
  expSeconds = 12 * 3600,
): string {
  const origin = new URL(endpoint).origin;
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({ aud: origin, exp: now + expSeconds, sub: subject })).toString(
    'base64url',
  );
  const unsignedToken = `${header}.${claims}`;

  const signer = createSign('SHA256');
  signer.update(unsignedToken);
  const signature = signer.sign({ key: vapidPrivateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');

  return `vapid t=${unsignedToken}.${signature}, k=${vapidPublicKey}`;
}

export function encryptPayload(payload: string | Buffer, clientPublicKey: Buffer, clientAuth: Buffer): Buffer {
  const localECDH = createECDH('prime256v1');
  localECDH.generateKeys();
  const localPublicKey = localECDH.getPublicKey();
  const sharedSecret = localECDH.computeSecret(clientPublicKey);

  // RFC 8291 Section 3.2
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientPublicKey, localPublicKey]);
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, clientAuth, keyInfo, 32));

  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const payloadBuf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const padded = Buffer.concat([payloadBuf, Buffer.from([2])]);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const recordSize = 4096;
  const rsBuf = Buffer.alloc(4);
  rsBuf.writeUInt32BE(recordSize, 0);

  return Buffer.concat([salt, rsBuf, Buffer.from([localPublicKey.length]), localPublicKey, ciphertext]);
}

export function formatReminderPushPayload(reminder: { id: string; title: string; due: string }): {
  notification: {
    title: string;
    body: string;
    icon: string;
    data: {
      id: string;
      due: string;
      onActionClick: {
        default: { operation: string; url: string };
      };
    };
  };
} {
  return {
    notification: {
      title: `⏰ ${reminder.title}`,
      body: 'NERV Agency · Promemoria',
      icon: '/icons/icon-192.png',
      data: {
        id: reminder.id,
        due: reminder.due,
        onActionClick: {
          default: { operation: 'focusLastFocusedOrOpen', url: '/' },
        },
      },
    },
  };
}

export async function sendWebPush(
  subscription: PushSubscriptionRecord,
  payload: string | object,
  vapid: { publicKey: string; privateKey: string; subject?: string },
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; expired?: boolean }> {
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const body = encryptPayload(
    payloadStr,
    Buffer.from(subscription.p256dh, 'base64url'),
    Buffer.from(subscription.auth, 'base64url'),
  );

  const authHeader = buildVapidHeader(
    subscription.endpoint,
    vapid.publicKey,
    vapid.privateKey,
    vapid.subject ?? 'mailto:nerv@agency.local',
  );

  const res = await fetchFn(subscription.endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400',
      Urgency: 'normal',
      Authorization: authHeader,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
    },
    body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength) as unknown as RequestInit['body'],
  });

  const expired = res.status === 404 || res.status === 410;
  return { ok: res.ok, status: res.status, expired };
}
