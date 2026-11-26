/**
 * F-086-T05: the Gmail connector's private credential flow (decision: docs/decisions/gmail-connector.md, F-066).
 *
 * The OAuth client and refresh token live in one mode-0600 file in the data home, never in config.json, Git, logs or
 * an error message. Access tokens are refreshed in memory only. The owner connects with `nerv gmail connect`
 * (read-only), and opts into drafting and sending with `nerv gmail connect --compose`; drafts stay Orange and sending
 * stays Blue at the gate whatever the scope.
 */
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { privateEnough } from './config.ts';
import { GMAIL_SCOPE_COMPOSE, GMAIL_SCOPE_READONLY } from './gmail.ts';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GMAIL_CREDENTIALS_FILE = 'gmail-credentials.json';
/** What every Gmail tool answers, and what `nerv gmail status` prints, when no account is connected. */
export const GMAIL_NOT_CONNECTED = 'Gmail not connected. The owner connects it on this Mac with: nerv gmail connect';
const ALLOWED_SCOPES: readonly string[] = [GMAIL_SCOPE_READONLY, GMAIL_SCOPE_COMPOSE];
const REAUTHORIZE = 'run nerv gmail connect again';

export interface GmailCredentials {
  readonly version: 1;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly scopes: readonly string[];
  readonly connected: string;
}

export const gmailCredentialsPath = (home: string) => join(home, GMAIL_CREDENTIALS_FILE);

const cleanToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 8 && value.length <= 2048 && !/\s/.test(value);

/** The scopes Google granted, refused when they miss one requested or add one NERV never asks for. */
export function grantedScopes(requested: readonly string[], granted: string | undefined): string[] {
  const list = (granted ?? '').split(/\s+/).filter(Boolean);
  if (requested.some((s) => !list.includes(s)))
    throw new Error('Google did not grant the requested Gmail access: nothing was saved.');
  if (list.some((s) => !requested.includes(s)))
    throw new Error('Google granted more Gmail access than requested: nothing was saved.');
  return [...new Set(list)];
}

function validateCredentials(value: unknown): GmailCredentials {
  const v = value as Record<string, unknown>;
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    v.version !== 1 ||
    !cleanToken(v.clientId) ||
    !cleanToken(v.clientSecret) ||
    !cleanToken(v.refreshToken) ||
    !Array.isArray(v.scopes) ||
    !v.scopes.includes(GMAIL_SCOPE_READONLY) ||
    v.scopes.some((s) => typeof s !== 'string' || !ALLOWED_SCOPES.includes(s)) ||
    typeof v.connected !== 'string'
  )
    throw new Error(`Invalid ${GMAIL_CREDENTIALS_FILE}: ${REAUTHORIZE}.`);
  return {
    version: 1,
    clientId: v.clientId,
    clientSecret: v.clientSecret,
    refreshToken: v.refreshToken,
    scopes: v.scopes as string[],
    connected: v.connected,
  };
}

/** The stored Gmail credential, or undefined when none is connected. Never returns a file others can read. */
export function readGmailCredentials(home: string): GmailCredentials | undefined {
  const file = gmailCredentialsPath(home);
  if (!existsSync(file)) return undefined;
  if (!privateEnough(file, 0o077)) throw new Error(`${GMAIL_CREDENTIALS_FILE} must be private: chmod 600.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`Invalid ${GMAIL_CREDENTIALS_FILE}: ${REAUTHORIZE}.`);
  }
  return validateCredentials(parsed);
}

/** Atomically replaces the stored credential (mode 0600, data home 0700), like F-066 rotation. */
export function writeGmailCredentials(home: string, credentials: GmailCredentials): void {
  const valid = validateCredentials(credentials);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const target = gmailCredentialsPath(home);
  const temporary = join(home, `.credential-gmail-${randomBytes(8).toString('hex')}`);
  try {
    writeFileSync(temporary, JSON.stringify(valid, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, target);
    chmodSync(target, 0o600);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** The connection as the owner may see it: whether, which access and since when; never a value. */
export function gmailStatus(home: string): string {
  const credentials = readGmailCredentials(home);
  if (!credentials) return GMAIL_NOT_CONNECTED;
  const access = credentials.scopes.includes(GMAIL_SCOPE_COMPOSE)
    ? 'read, draft and send (drafts need an Orange approval, sending a Blue one)'
    : 'read-only';
  return `Gmail connected: ${access}, since ${credentials.connected}.`;
}

/** Reads a Google error code from a token response, from a fixed list only (never the response text). */
async function googleError(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === 'string' && /^[a-z_]{1,40}$/.test(body.error) ? body.error : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Access tokens for the stored credential, refreshed in memory and reused until a minute before they expire. A new
 * credential on disk (a reconnect) drops the cached token. Nothing here writes a token anywhere.
 */
export class GmailTokenSource {
  private cached?: { refreshToken: string; token: string; expires: number };
  private readonly read: () => GmailCredentials | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  constructor(read: () => GmailCredentials | undefined, fetchFn: typeof fetch = fetch, now: () => number = Date.now) {
    this.read = read;
    this.fetchFn = fetchFn;
    this.now = now;
  }

  async accessToken(): Promise<string> {
    const credentials = this.read();
    if (!credentials) throw new Error(GMAIL_NOT_CONNECTED);
    const c = this.cached;
    if (c && c.refreshToken === credentials.refreshToken && c.expires - 60_000 > this.now()) return c.token;
    const res = await this.fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) {
      const code = await googleError(res);
      if (code === 'invalid_grant' || code === 'invalid_client' || code === 'unauthorized_client')
        throw new Error(`Gmail access was revoked or has expired: ${REAUTHORIZE}.`);
      throw new Error(`Gmail token refresh failed with status ${res.status}.`);
    }
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown; scope?: unknown };
    if (!cleanToken(body.access_token)) throw new Error('Gmail token refresh returned no access token.');
    if (typeof body.scope === 'string' && body.scope.split(/\s+/).some((s) => s && !ALLOWED_SCOPES.includes(s)))
      throw new Error(`Gmail token carries access NERV never asked for: ${REAUTHORIZE}.`);
    const seconds = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600;
    this.cached = {
      refreshToken: credentials.refreshToken,
      token: body.access_token,
      expires: this.now() + seconds * 1000,
    };
    return body.access_token;
  }

  /** Forgets the cached access token (after disconnect). */
  clear(): void {
    this.cached = undefined;
  }
}

/** Reads Google's downloaded Desktop-app client file ({"installed": {client_id, client_secret}}). */
export function readClientFile(path: string): { clientId: string; clientSecret: string } {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('The client file must be the JSON Google Cloud Console downloads for a Desktop app OAuth client.');
  }
  const installed = value?.installed as Record<string, unknown> | undefined;
  if (!installed || !cleanToken(installed.client_id) || !cleanToken(installed.client_secret))
    throw new Error(
      'The client file has no "installed" client: create an OAuth client of type Desktop app and download its JSON.',
    );
  return { clientId: installed.client_id, clientSecret: installed.client_secret };
}

export interface ConnectOptions {
  readonly home: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Owner opt-in to drafting and sending (gmail.compose); read-only otherwise. */
  readonly compose: boolean;
  /** Prints one line for the owner (the consent URL, then the outcome). Never given a secret. */
  readonly print: (line: string) => void;
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

const page = (message: string) => `<!doctype html><meta charset="utf-8"><title>NERV Gmail</title><p>${message}</p>`;

/**
 * The installed-app OAuth flow with PKCE and a loopback redirect: a one-use listener on 127.0.0.1, a random state,
 * the consent URL printed for the owner, then the code exchanged for a refresh token that is stored privately.
 */
export async function connectGmail(options: ConnectOptions): Promise<{ scopes: string[] }> {
  const fetchFn = options.fetchFn ?? fetch;
  const requested = options.compose ? [GMAIL_SCOPE_READONLY, GMAIL_SCOPE_COMPOSE] : [GMAIL_SCOPE_READONLY];
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let settle!: (outcome: { code: string } | { error: string }) => void;
  const outcome = new Promise<{ code: string } | { error: string }>((done) => (settle = done));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname !== '/oauth2callback' || url.searchParams.get('state') !== state) {
      res.writeHead(404).end(page('Not a NERV Gmail sign-in.'));
      return;
    }
    const code = url.searchParams.get('code');
    if (code && cleanToken(code)) {
      res.end(page('Gmail is connecting to NERV. You can close this tab and return to the Terminal.'));
      settle({ code });
    } else {
      res.end(page('Gmail was not connected. Return to the Terminal.'));
      settle({ error: url.searchParams.get('error') === 'access_denied' ? 'declined' : 'failed' });
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const consent = new URL(GOOGLE_AUTH_URL);
  for (const [k, v] of Object.entries({
    client_id: options.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: requested.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }))
    consent.searchParams.set(k, v);
  options.print(
    `Open this address in the browser on this Mac and allow ${options.compose ? 'read, draft and send' : 'read-only'} access:`,
  );
  options.print(consent.toString());
  const timer = setTimeout(() => settle({ error: 'timeout' }), options.timeoutMs ?? 5 * 60_000);
  let result: { code: string } | { error: string };
  try {
    result = await outcome;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
  if ('error' in result)
    throw new Error(
      result.error === 'declined'
        ? 'Google consent was declined: nothing was saved.'
        : result.error === 'timeout'
          ? 'No answer from Google within 5 minutes: nothing was saved. Run nerv gmail connect again.'
          : 'Google returned no authorization code: nothing was saved.',
    );
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: result.code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) {
    const code = await googleError(res);
    throw new Error(
      `Google refused the authorization code (status ${res.status}${code ? `, ${code}` : ''}): nothing was saved.`,
    );
  }
  const body = (await res.json()) as { refresh_token?: unknown; scope?: unknown };
  if (!cleanToken(body.refresh_token))
    throw new Error('Google returned no refresh token: nothing was saved. Run nerv gmail connect again.');
  const scopes = grantedScopes(requested, typeof body.scope === 'string' ? body.scope : undefined);
  writeGmailCredentials(options.home, {
    version: 1,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    refreshToken: body.refresh_token,
    scopes,
    connected: (options.now?.() ?? new Date()).toISOString(),
  });
  return { scopes };
}

/**
 * Removes the stored credential and asks Google to revoke the refresh token. The local file goes even when Google
 * cannot be reached; the answer says which.
 */
export async function disconnectGmail(home: string, fetchFn: typeof fetch = fetch): Promise<string> {
  let credentials: GmailCredentials | undefined;
  try {
    credentials = readGmailCredentials(home);
  } catch {
    credentials = undefined;
  }
  const existed = existsSync(gmailCredentialsPath(home));
  rmSync(gmailCredentialsPath(home), { force: true });
  if (!existed) return GMAIL_NOT_CONNECTED;
  if (!credentials)
    return 'Gmail disconnected: the unreadable credential file was removed (revoke access in your Google account).';
  try {
    const res = await fetchFn(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: credentials.refreshToken }).toString(),
    });
    return res.ok
      ? 'Gmail disconnected: the credential was removed and Google revoked it.'
      : `Gmail disconnected: the credential was removed; Google answered ${res.status} to the revocation (check your Google account).`;
  } catch {
    return 'Gmail disconnected: the credential was removed; Google could not be reached to revoke it (check your Google account).';
  }
}
