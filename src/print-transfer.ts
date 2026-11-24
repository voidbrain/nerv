import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePrintPath } from './fleet.ts';
import {
  finishPrintPart,
  MAX_PART_FILE_BYTES,
  readLibraryPart,
  sliceLibraryPartAsync,
  type PartSliceRequest,
  type PendingRemotePrint,
  type PrintPartReply,
  type SlicedPlate,
} from './print-job.ts';
import type { SliceEstimate, SlicerExecAsyncFn } from './slicer.ts';

/**
 * F-121-T04: a print request carries the part file from the base holding the library (the Mac) to the slicing base
 * (NERV-02, Tabgha) over the Kaji line (`POST /kaji/print`, signed both ways like every Kaji message). The sender asks
 * first with the part identity only; the receiver slices a cached copy with the same SHA-256 or answers that it needs
 * the content, which the sender then sends as base64. The receiver checks it accepts the sender, the declared size, the
 * path shape and the hash before writing, writes only `<home>/prints-cache/<sha256>.<ext>`, and slices with its own
 * profile allowlist (`sliceLibraryPart`).
 */

/** config.json `prints`: `slicer` (on the Mac) names the base that slices; `accept` (on it) the bases it slices for. */
export interface PrintsConfig {
  slicer?: string;
  accept?: string[];
}

const BASE_ID = /^[A-Z0-9-]{2,16}$/;
const USAGE =
  'Invalid prints: {"slicer": "NERV-02"} on the base with the part library, {"accept": ["NERV-01"]} on the slicing base.';

export function validatePrintsConfig(value: unknown): PrintsConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(USAGE);
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => k !== 'slicer' && k !== 'accept')) throw new Error(USAGE);
  const out: PrintsConfig = {};
  if ('slicer' in v) {
    if (typeof v.slicer !== 'string' || !BASE_ID.test(v.slicer)) throw new Error(USAGE);
    out.slicer = v.slicer;
  }
  if ('accept' in v) {
    const list = v.accept;
    if (
      !Array.isArray(list) ||
      list.length > 8 ||
      list.some((id) => typeof id !== 'string' || !BASE_ID.test(id)) ||
      new Set(list).size !== list.length
    )
      throw new Error(USAGE);
    out.accept = list as string[];
  }
  return out;
}

/** The message on the wire: the slice request, and the part as base64 only when the receiver asked for it. */
export interface PartTransfer {
  version: 1;
  request: PartSliceRequest;
  content?: string;
}

/** Sends one part message to a base; resolves with its signed answer or rejects with code EREFUSED or EUNREACHABLE. */
export type PartTransferSend = (base: string, message: PartTransfer) => Promise<unknown>;

export interface PartTransferAnswer {
  status: number;
  value: { need: 'content' } | { sliced: SlicedPlate } | { error: string };
}

const SHA256 = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function parseRequest(value: unknown): PartSliceRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const r = value as Record<string, unknown>;
  const part = r.part as Record<string, unknown> | undefined;
  if (
    r.version !== 1 ||
    !part ||
    typeof part !== 'object' ||
    typeof part.file !== 'string' ||
    part.file.length > 500 ||
    typeof part.sha256 !== 'string' ||
    !SHA256.test(part.sha256) ||
    !Number.isSafeInteger(part.bytes) ||
    (part.bytes as number) < 0 ||
    typeof r.profileName !== 'string' ||
    !r.profileName.trim() ||
    r.profileName.length > 200 ||
    !Number.isInteger(r.prints) ||
    (r.prints as number) < 1 ||
    (r.prints as number) > 100
  )
    return undefined;
  return {
    version: 1,
    part: { file: part.file, sha256: part.sha256, bytes: part.bytes as number },
    profileName: r.profileName,
    prints: r.prints as number,
  };
}

const sha256 = (content: Buffer) => createHash('sha256').update(content).digest('hex');

/**
 * F-121-T04: one slicer at a time per data home, and at most one request waiting behind it. The request stays a
 * plain signed request and reply (no 202 and later result): the slicer is killed at its 120 s timeout, so the longest
 * wait (one running, one queued, plus the transfer) stays inside the sender's 5 min timeout; a third request is told
 * the base is busy (503) instead of waiting longer.
 */
const MAX_WAITING = 1;
const lanes = new Map<string, { tail: Promise<unknown>; waiting: number }>();

const laneFull = (home: string) => (lanes.get(home)?.waiting ?? 0) > MAX_WAITING;

function inLane<T>(home: string, work: () => Promise<T>): Promise<T> | undefined {
  if (laneFull(home)) return undefined;
  const lane = lanes.get(home) ?? { tail: Promise.resolve(), waiting: 0 };
  lane.waiting += 1;
  lanes.set(home, lane);
  const run = lane.tail.then(work, work);
  lane.tail = run.then(
    () => undefined,
    () => undefined,
  );
  void lane.tail.then(() => {
    lane.waiting -= 1;
    if (lane.waiting === 0 && lanes.get(home) === lane) lanes.delete(home);
  });
  return run;
}

/**
 * The slicing base's side of `POST /kaji/print`. Nothing is written unless the sender is accepted and the content
 * matches the declared size and hash; a cached copy with the same hash is sliced without the content being sent.
 */
export async function receivePartTransfer(
  home: string,
  accept: readonly string[],
  from: string,
  body: unknown,
  options: { exec?: SlicerExecAsyncFn; maxBytes?: number } = {},
): Promise<PartTransferAnswer> {
  if (!accept.includes(from)) return { status: 403, value: { error: `this base does not slice parts for ${from}` } };
  const message = body as Partial<PartTransfer> | null;
  const request =
    message && typeof message === 'object' && message.version === 1 ? parseRequest(message.request) : undefined;
  if (
    !request ||
    (message!.content !== undefined && (typeof message!.content !== 'string' || !BASE64.test(message!.content)))
  ) {
    return { status: 400, value: { error: 'invalid part transfer' } };
  }
  let file: string;
  try {
    file = validatePrintPath(request.part.file);
  } catch (error) {
    return { status: 400, value: { error: (error as Error).message.slice(0, 300) } };
  }
  const maxBytes = options.maxBytes ?? MAX_PART_FILE_BYTES;
  if (request.part.bytes > maxBytes) {
    return { status: 413, value: { error: `Part file is larger than ${formatBytes(maxBytes)}; nothing was written.` } };
  }
  let content: Buffer;
  if (message!.content === undefined) {
    // Only a cached copy is sliced without the file; asking is answered at once, never queued behind a slicer.
    const cached = join(
      home,
      'prints-cache',
      `${request.part.sha256}${file.slice(file.lastIndexOf('.')).toLowerCase()}`,
    );
    const copy = existsSync(cached) ? readFileSync(cached) : undefined;
    if (!copy || sha256(copy) !== request.part.sha256) return { status: 200, value: { need: 'content' } };
    content = copy;
  } else {
    // A full lane refuses before the content is decoded or hashed.
    if (laneFull(home)) return BUSY;
    content = Buffer.from(message!.content, 'base64');
    if (content.length > maxBytes) {
      return {
        status: 413,
        value: { error: `Part file is larger than ${formatBytes(maxBytes)}; nothing was written.` },
      };
    }
    if (content.length !== request.part.bytes || sha256(content) !== request.part.sha256) {
      return {
        status: 422,
        value: { error: `Part file prints/${file} does not match its SHA-256; nothing was written.` },
      };
    }
  }
  const sliceIt = content;
  const queued = inLane(home, async (): Promise<PartTransferAnswer> => {
    try {
      const result = await sliceLibraryPartAsync(home, request, sliceIt, options.exec);
      return {
        status: 200,
        value: {
          sliced: { outputPath: result.outputPath, profileName: result.profile.name, estimate: result.estimate },
        },
      };
    } catch (error) {
      return { status: 422, value: { error: (error as Error).message.slice(0, 500) } };
    }
  });
  return queued ?? BUSY;
}

const BUSY: PartTransferAnswer = {
  status: 503,
  value: { error: 'This base is busy slicing other parts; ask again in a few minutes.' },
};

/** A message larger than this carries the file; a smaller one only asks (the request alone is under 2 KB). */
const ASKING_BYTES = 64 * 1024;

/**
 * Before the body is read (`/kaji/print`): refuse a sender this base does not slice for, and a file while the lane is
 * full. The sender id here is the unverified header; the signed check after the body still decides everything else.
 */
export function admitPartTransfer(
  home: string,
  accept: readonly string[],
  claimedFrom: string,
  declaredBytes: number,
): { status: number; error: string } | undefined {
  if (!accept.includes(claimedFrom)) return { status: 403, error: 'this base does not slice parts for that base' };
  if (declaredBytes > ASKING_BYTES && laneFull(home))
    return { status: 503, error: (BUSY.value as { error: string }).error };
  return undefined;
}

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${bytes} bytes`;

function parseEstimate(value: unknown): SliceEstimate | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const e = value as Record<string, unknown>;
  if (typeof e.printTimeText !== 'string' || e.printTimeText.length > 100) return undefined;
  const number = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined);
  const grams = number(e.filamentGrams),
    meters = number(e.filamentMeters);
  return {
    printTimeText: e.printTimeText,
    ...(grams !== undefined ? { filamentGrams: grams } : {}),
    ...(meters !== undefined ? { filamentMeters: meters } : {}),
  };
}

/** The slicing base's answer, checked: the sliced file is only ever named back to that base, in the hand-off. */
function parseAnswer(value: unknown): { need: 'content' } | { sliced: SlicedPlate } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (v.need === 'content') return { need: 'content' };
  const s = v.sliced as Record<string, unknown> | undefined;
  const estimate = s ? parseEstimate(s.estimate) : undefined;
  if (
    !s ||
    !estimate ||
    typeof s.outputPath !== 'string' ||
    s.outputPath.length > 1000 ||
    !s.outputPath.endsWith('.gcode.3mf') ||
    typeof s.profileName !== 'string' ||
    s.profileName.length > 200
  )
    return undefined;
  return { sliced: { outputPath: s.outputPath, profileName: s.profileName, estimate } };
}

/** Why a print did not reach the slicer: one sentence, nothing sliced and no hand-off proposed. */
function notSliced(pending: PendingRemotePrint, why: string): PrintPartReply {
  return finishPrintPart(pending.prepared, new Error(why));
}

/**
 * The sending side, in the coordinator: read the library part again, check it is still the file the request hashed,
 * ask the slicing base, send the content only when it does not have it, and build the reply from its answer.
 */
export async function completeRemotePrint(
  home: string,
  pending: PendingRemotePrint,
  send: PartTransferSend | undefined,
): Promise<PrintPartReply> {
  const { base, prepared } = pending;
  const { request } = prepared;
  const read = readLibraryPart(home, request.part.file);
  if (read.status !== 'ok') return notSliced(pending, read.reason);
  if (read.sha256 !== request.part.sha256 || read.content.length !== request.part.bytes) {
    return notSliced(
      pending,
      `prints/${request.part.file} changed since it was read; ask again to slice the new file.`,
    );
  }
  if (!send) return notSliced(pending, `${base} slices parts, and the Kaji line is not running here.`);
  try {
    let answer = parseAnswer(await send(base, { version: 1, request }));
    if (answer && 'need' in answer) {
      answer = parseAnswer(await send(base, { version: 1, request, content: read.content.toString('base64') }));
    }
    if (!answer || !('sliced' in answer)) return notSliced(pending, `${base} gave an answer NERV does not understand.`);
    return finishPrintPart(prepared, answer.sliced, base);
  } catch (error) {
    const e = error as { code?: string; message?: string };
    if (e.code === 'EREFUSED') return notSliced(pending, `${base} refused the part: ${e.message ?? 'refused'}`);
    return notSliced(
      pending,
      `${base} could not be reached; nothing was sliced and nothing goes to Bambu Connect. Ask again when ${base} is online.`,
    );
  }
}
