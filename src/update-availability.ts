import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type UpdateChannel = 'main';
export type UpdateAvailabilityStatus = 'up-to-date' | 'update-available' | 'ahead' | 'offline' | 'unknown';

export interface UpdateAvailability {
  version: 1;
  channel: UpdateChannel;
  installedRevision: string | null;
  runningRevision: string | null;
  availableRevision: string | null;
  status: UpdateAvailabilityStatus;
  updateAvailable: boolean;
  restartRequired: boolean;
  checkedAt: string | null;
  reason?: string;
}

export type UpdateGitRunner = (args: string[], cwd: string) => Promise<{ status: number; out: string; err: string }>;

const SHA = /^[0-9a-f]{40}$/;
const CHANNELS: readonly UpdateChannel[] = ['main'];

export function parseUpdateChannel(value: unknown): UpdateChannel {
  if (value === undefined) return 'main';
  if (typeof value === 'string' && (CHANNELS as readonly string[]).includes(value)) return value as UpdateChannel;
  throw Error('Unsupported update channel; expected main.');
}

function sanitizeReason(text: string): string {
  return text
    .replace(/https?:\/\/[^/\s@]+@/gi, 'https://***@')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .trim()
    .slice(0, 200);
}

export async function runUpdateGit(args: string[], cwd: string): Promise<{ status: number; out: string; err: string }> {
  return await new Promise((resolve) => {
    const child = spawn('git', ['-C', cwd, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    let out = '';
    let err = '';
    let settled = false;
    const done = (status: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, out: out.trim(), err: err.trim() });
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      err = err || 'Update check timed out.';
      done(1);
    }, 5000);
    child.stdout.on('data', (d: Buffer) => {
      if (out.length < 4096) out += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (err.length < 4096) err += d.toString('utf8');
    });
    child.on('error', (e) => {
      err = e.message;
      done(1);
    });
    child.on('close', (code) => done(code ?? 1));
  });
}

export async function checkUpdateAvailability(
  options: {
    source?: string;
    channel?: unknown;
    runningRevision?: string | null;
    offline?: boolean;
    now?: Date;
    git?: UpdateGitRunner;
  } = {},
): Promise<UpdateAvailability> {
  const channel = parseUpdateChannel(options.channel);
  const source = options.source ?? fileURLToPath(new URL('..', import.meta.url));
  const git = options.git ?? runUpdateGit;
  const checkedAt = (options.now ?? new Date()).toISOString();
  const runningRevision =
    typeof options.runningRevision === 'string' && SHA.test(options.runningRevision) ? options.runningRevision : null;

  const head = await git(['rev-parse', 'HEAD'], source);
  const installedRevision = head.status === 0 && SHA.test(head.out) ? head.out : null;
  const restartRequired =
    runningRevision !== null && installedRevision !== null && runningRevision !== installedRevision;

  if (!installedRevision) {
    return {
      version: 1,
      channel,
      installedRevision: null,
      runningRevision,
      availableRevision: null,
      status: 'unknown',
      updateAvailable: false,
      restartRequired: false,
      checkedAt,
      reason: 'Installed revision is unknown.',
    };
  }

  if (options.offline) {
    return {
      version: 1,
      channel,
      installedRevision,
      runningRevision,
      availableRevision: null,
      status: 'offline',
      updateAvailable: false,
      restartRequired,
      checkedAt,
      reason: 'Offline check requested; remote channel was not queried.',
    };
  }

  const ref = `refs/heads/${channel}`;
  const remote = await git(['ls-remote', '--exit-code', 'origin', ref], source);
  const firstToken = remote.out.split(/\s+/)[0] ?? '';
  if (remote.status !== 0 || !SHA.test(firstToken)) {
    return {
      version: 1,
      channel,
      installedRevision,
      runningRevision,
      availableRevision: null,
      status: 'offline',
      updateAvailable: false,
      restartRequired,
      checkedAt,
      reason: sanitizeReason(remote.err || 'Remote channel is unreachable or unknown.'),
    };
  }

  const availableRevision = firstToken;
  if (availableRevision === installedRevision) {
    return {
      version: 1,
      channel,
      installedRevision,
      runningRevision,
      availableRevision,
      status: 'up-to-date',
      updateAvailable: false,
      restartRequired,
      checkedAt,
    };
  }

  const hasAvailable = await git(['cat-file', '-e', `${availableRevision}^{commit}`], source);
  if (hasAvailable.status === 0) {
    const ancestor = await git(['merge-base', '--is-ancestor', availableRevision, installedRevision], source);
    if (ancestor.status === 0) {
      return {
        version: 1,
        channel,
        installedRevision,
        runningRevision,
        availableRevision,
        status: 'ahead',
        updateAvailable: false,
        restartRequired,
        checkedAt,
        reason: 'Installed revision is ahead of the remote channel.',
      };
    }
  }

  return {
    version: 1,
    channel,
    installedRevision,
    runningRevision,
    availableRevision,
    status: 'update-available',
    updateAvailable: true,
    restartRequired,
    checkedAt,
  };
}

export function validateUpdateAvailability(value: unknown): UpdateAvailability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid update availability payload.');
  const v = value as Record<string, unknown>;
  const shaOrNull = (x: unknown) => x === null || (typeof x === 'string' && SHA.test(x));
  if (
    v.version !== 1 ||
    parseUpdateChannel(v.channel) !== v.channel ||
    !shaOrNull(v.installedRevision) ||
    !shaOrNull(v.runningRevision) ||
    !shaOrNull(v.availableRevision) ||
    !['up-to-date', 'update-available', 'ahead', 'offline', 'unknown'].includes(String(v.status)) ||
    typeof v.updateAvailable !== 'boolean' ||
    typeof v.restartRequired !== 'boolean' ||
    (v.checkedAt !== null && (typeof v.checkedAt !== 'string' || !Number.isFinite(Date.parse(v.checkedAt)))) ||
    (v.reason !== undefined && typeof v.reason !== 'string')
  )
    throw Error('Invalid update availability payload.');
  return v as unknown as UpdateAvailability;
}
