import {
  generateKeyPairSync,
  createPrivateKey,
  sign,
  createECDH,
  hkdfSync,
  randomBytes,
  createCipheriv,
} from 'node:crypto';

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

/** Apple rejects a VAPID `sub` that is not a real https URL or mailto (B-134: `mailto:nerv@agency.local` gave 403 BadJwtToken). */
export const DEFAULT_VAPID_SUBJECT = 'https://github.com/voidbrain/nerv';

/** Validates a VAPID subject: an https URL or a mailto with a dotted domain, never .local or localhost. Returns it. */
export function validateVapidSubject(value: unknown): string {
  const fail = (): never => {
    throw new Error(
      'Invalid push.subject: an https URL or mailto:name@domain.tld with a real domain (not .local or localhost).',
    );
  };
  if (typeof value !== 'string' || value.length > 256) return fail();
  let host: string;
  if (value.startsWith('https://')) {
    try {
      host = new URL(value).hostname;
    } catch {
      return fail();
    }
  } else {
    const m = /^mailto:[^\s@]+@([^\s@]+)$/.exec(value);
    if (!m) return fail();
    host = m[1]!;
  }
  host = host.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost'))
    return fail();
  return value;
}

export function buildVapidHeader(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  subject = DEFAULT_VAPID_SUBJECT,
  expSeconds = 12 * 3600,
): string {
  const origin = new URL(endpoint).origin;
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({ aud: origin, exp: now + expSeconds, sub: subject })).toString(
    'base64url',
  );
  const unsignedToken = `${header}.${claims}`;

  const signature = sign('sha256', Buffer.from(unsignedToken), {
    key: createPrivateKey(vapidPrivateKey),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');

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
): Promise<{ ok: boolean; status: number; expired?: boolean; reason?: string }> {
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
    vapid.subject ?? DEFAULT_VAPID_SUBJECT,
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
  if (res.ok) return { ok: true, status: res.status, expired };
  return { ok: false, status: res.status, expired, reason: await pushFailureReason(res) };
}

/** The push service's reason (Apple: {"reason":"BadJwtToken"}), short and printable; never the request. */
async function pushFailureReason(res: Response): Promise<string | undefined> {
  try {
    const text = (await res.text()).trim();
    if (!text) return undefined;
    try {
      const parsed = JSON.parse(text) as { reason?: unknown; error?: unknown };
      const r = parsed.reason ?? parsed.error;
      if (typeof r === 'string') return r.slice(0, 120);
    } catch {
      // not JSON: use the text
    }
    return text.replace(/[^\x20-\x7e]/g, ' ').slice(0, 120);
  } catch {
    return undefined;
  }
}
