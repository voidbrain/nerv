import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { validatePrintPath, type FleetStore, type ModelPrintedPart } from './fleet.ts';
import { printLibraryRoot, resolvePrintFile } from './print-library.ts';
import {
  readSlicerProfiles,
  resolveAllowedSlicerProfile,
  sliceModelWithProfile,
  sliceModelWithProfileAsync,
  type SliceResult,
  type SlicerExecAsyncFn,
  type SlicerExecFn,
  type SlicerProfile,
} from './slicer.ts';

/**
 * F-121-T02: "stampa i piedini di Smoke" / "print the Kite feet". The phrase resolves a drone or a model, then
 * one of its printed parts (F-121-T01), the print count and the part's profile; the library file is resolved
 * again and read once at the point of use, and the slice request carries its identity (relative path and
 * SHA-256) with the content, so the base that slices checks the hash and its own profile allowlist before the slicer
 * runs. With `prints.slicer` naming another base (NERV-02), the coordinator sends it there over the Kaji line
 * (F-121-T04, print-transfer.ts). The Bambu Connect hand-off is `bambu.handoff`, always the owner's card.
 */

/** Largest part file read for slicing; the Kaji transfer (F-121-T04) refuses a larger one on both sides. */
export const MAX_PART_FILE_BYTES = 64 * 1024 * 1024;

export interface PrintPartPhrase {
  part?: string;
  target?: string;
  /** No "di/of/for" and no possessive: the target and the part are split against the fleet's names. */
  words?: string;
  /** Pieces the owner named; the part's own count is used otherwise. */
  count?: number;
}

/** What the slicing base receives: the part identity and the job, never a path outside its own cache. */
export interface PartSliceRequest {
  version: 1;
  part: { file: string; sha256: string; bytes: number };
  profileName: string;
  /** Times the sliced plate is printed. */
  prints: number;
}

export type PartSlicer = (request: PartSliceRequest, content: Buffer) => SliceResult;

export interface PrintPartReply {
  handled: boolean;
  reply: string;
  needsAnswer?: true;
  sliced?: boolean;
  request?: PartSliceRequest;
  estimate?: SliceResult['estimate'];
  /** The `bambu.handoff` arguments to propose next (Blue: the owner's approval card). */
  handoff?: Record<string, string | number>;
  /** F-121-T04: the base that sliced it, and where `bambu.handoff` must run (through `kaji.run`). */
  slicedOn?: string;
  handoffBase?: string;
  /** F-121-T04: set only between the fleet.print executor and the coordinator that sends the part. */
  remote?: PendingRemotePrint;
}

const VERB = /^(?:per\s+favore\s+|please\s+)?(?:stampa(?:mi|re)?|print)\s+(.+?)[\s.!?]*$/iu;
const LEADING_COUNT = /^(\d{1,3})\s+(.+)$/u;
const TRAILING_COUNT = /^(.+?)\s+(?:x\s*(\d{1,3})|(\d{1,3})\s*x|(\d{1,3})\s+(?:pezzi|copie|pieces|copies))$/iu;
const CONNECTOR =
  /^(.+)\s+(?:di|del|della|dello|dei|degli|delle|per|for|of)\s+(?:(?:il|lo|la|the)\s+)?(?:(?:drone|modello|model)\s+)?(.+)$/iu;
const POSSESSIVE = /^(.+?)['’]s\s+(.+)$/u;
const ARTICLE = /^(?:(?:il|lo|la|i|gli|le|un|una|uno|the|a|an)\s+|l['’]\s*)/iu;

const stripArticle = (text: string) => text.trim().replace(ARTICLE, '').trim();

/** Parse a print request; undefined when the phrase is not one. */
export function parsePrintPartPhrase(phrase: string): PrintPartPhrase | undefined {
  const verb = VERB.exec(phrase.trim());
  if (!verb) return undefined;
  let rest = verb[1]!.trim();
  let count: number | undefined;
  const leading = LEADING_COUNT.exec(rest);
  if (leading) {
    count = Number(leading[1]);
    rest = leading[2]!;
  }
  const trailing = TRAILING_COUNT.exec(rest);
  if (trailing) {
    count = Number(trailing[2] ?? trailing[3] ?? trailing[4]);
    rest = trailing[1]!;
  }
  const withCount = count ? { count } : {};
  const connected = CONNECTOR.exec(rest);
  if (connected) return { part: stripArticle(connected[1]!), target: stripArticle(connected[2]!), ...withCount };
  const possessive = POSSESSIVE.exec(stripArticle(rest));
  if (possessive) return { part: stripArticle(possessive[2]!), target: possessive[1]!.trim(), ...withCount };
  const words = stripArticle(rest);
  // A single word names neither a target nor a part with it: not a print request for a part.
  if (!/\s/.test(words)) return undefined;
  return { words, ...withCount };
}

type TargetResolution =
  { status: 'ok'; model: string; drone?: string } | { status: 'ask'; question: string } | { status: 'none' };

const key = (text: string) => text.normalize('NFC').toLocaleLowerCase().trim();

function resolveTarget(fleet: FleetStore, name: string): TargetResolution {
  const drone = fleet.getDroneByName(name);
  if (drone) {
    const model = fleet.droneModel(drone.name);
    if (!model) {
      return {
        status: 'ask',
        question: `${drone.name} has no drone model, so it has no printed parts. Which model is it? Say "il drone ${drone.name} è un <model>".`,
      };
    }
    return { status: 'ok', model: model.name, drone: drone.name };
  }
  const exact = fleet.getDroneModel(name);
  if (exact) return { status: 'ok', model: exact.name };
  const wanted = key(name);
  const prefixed = fleet.listDroneModels().filter((model) => key(model.name).startsWith(`${wanted} `));
  if (prefixed.length === 1) return { status: 'ok', model: prefixed[0]!.name };
  if (prefixed.length > 1) {
    return {
      status: 'ask',
      question: `"${name}" matches several drone models: ${prefixed.map((model) => model.name).join(', ')}. Which one?`,
    };
  }
  return { status: 'none' };
}

/** Italian and English plurals: "piedini"/"piedino", "bands"/"band". */
const stem = (word: string) => (word.length > 3 ? word.replace(/(?:es|s|i|e|o|a)$/u, '') : word);
const stems = (text: string) => key(text).split(/\s+/u).map(stem);

function matchParts(parts: readonly ModelPrintedPart[], name: string): ModelPrintedPart[] {
  const wanted = key(name);
  const names = (part: ModelPrintedPart) => [part.name, ...part.aliases];
  const exact = parts.filter((part) => names(part).some((candidate) => key(candidate) === wanted));
  if (exact.length) return exact;
  const wantedStems = stems(name);
  const same = parts.filter((part) =>
    names(part).some((candidate) => stems(candidate).join(' ') === wantedStems.join(' ')),
  );
  if (same.length) return same;
  return parts.filter((part) =>
    names(part).some((candidate) => {
      const have = stems(candidate);
      return wantedStems.every((word) => have.includes(word));
    }),
  );
}

type PartResolution =
  { status: 'ok'; part: ModelPrintedPart; model: string; drone?: string } | { status: 'ask'; question: string };

function resolvePart(fleet: FleetStore, request: PrintPartPhrase): PartResolution {
  const attempts: Array<{ target: string; part: string }> = [];
  if (request.target && request.part) attempts.push({ target: request.target, part: request.part });
  else if (request.words) {
    const words = request.words.split(/\s+/u);
    for (let split = words.length - 1; split >= 1; split -= 1) {
      attempts.push({ target: words.slice(0, split).join(' '), part: words.slice(split).join(' ') });
    }
  }
  let firstQuestion: string | undefined;
  for (const attempt of attempts) {
    const target = resolveTarget(fleet, attempt.target);
    if (target.status === 'none') continue;
    if (target.status === 'ask') {
      firstQuestion ??= target.question;
      continue;
    }
    const parts = fleet.printedPartsForModel(target.model);
    const who = target.drone ? `${target.drone} (${target.model})` : target.model;
    if (!parts.length) {
      return {
        status: 'ask',
        question: `${who} has no printed parts yet. Add one with "parte stampata per ${target.model}: …".`,
      };
    }
    const matches = matchParts(parts, attempt.part);
    if (matches.length === 1) {
      return { status: 'ok', part: matches[0]!, model: target.model, ...(target.drone ? { drone: target.drone } : {}) };
    }
    const listed = (matches.length ? matches : parts).map((part) => part.name).join(', ');
    return {
      status: 'ask',
      question: matches.length
        ? `"${attempt.part}" matches several printed parts of ${who}: ${listed}. Which one?`
        : `${who} has no printed part "${attempt.part}". Its printed parts: ${listed}. Which one?`,
    };
  }
  if (firstQuestion) return { status: 'ask', question: firstQuestion };
  const known = [
    ...fleet.listDrones().map((drone) => drone.name),
    ...fleet.listDroneModels().map((model) => model.name),
  ];
  const named = request.target ?? request.words ?? '';
  return {
    status: 'ask',
    question: `I don't know a drone or drone model in "${named}"${known.length ? ` (known: ${known.join(', ')})` : ''}. Which one should I print for?`,
  };
}

export type LibraryRead =
  { status: 'ok'; content: Buffer; sha256: string } | { status: 'missing' | 'refused'; reason: string };

/**
 * Resolve the part file again at the point of use and read it once: no link is followed on the last step,
 * the open file must be the one the library path names after the read, and the hash is of the bytes read.
 */
export function readLibraryPart(home: string, file: string): LibraryRead {
  const root = printLibraryRoot(home);
  const resolved = resolvePrintFile(root, file);
  if (resolved.status !== 'ok') {
    return { status: resolved.status, reason: resolved.reason.replace(` (print library ${root})`, '') };
  }
  const relative = `prints/${validatePrintPath(file)}`;
  let fd: number;
  try {
    fd = openSync(resolved.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    return {
      status: 'refused',
      reason: `Part file ${relative} could not be opened: ${(error as NodeJS.ErrnoException).code ?? 'error'}.`,
    };
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) return { status: 'refused', reason: `Part file ${relative} is not a file.` };
    if (opened.size > MAX_PART_FILE_BYTES) {
      return {
        status: 'refused',
        reason: `Part file ${relative} is larger than ${MAX_PART_FILE_BYTES / 1024 / 1024} MB.`,
      };
    }
    const content = readFileSync(fd);
    const again = resolvePrintFile(root, file);
    const still = again.status === 'ok' ? statSync(again.path) : undefined;
    if (!still || still.ino !== opened.ino || still.dev !== opened.dev) {
      return { status: 'refused', reason: `Part file ${relative} changed while it was read; nothing was sliced.` };
    }
    return { status: 'ok', content, sha256: createHash('sha256').update(content).digest('hex') };
  } finally {
    closeSync(fd);
  }
}

const profileSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'profile';

/**
 * The slicing base's side: check the content against the request hash and this base's own profile allowlist,
 * keep the content in its cache under the hash (never the sender's path), and slice the cached copy.
 * It runs on the slicing base: NERV-02 after the Kaji transfer (F-121-T04), or the library's own base without `prints.slicer`.
 */
export function sliceLibraryPart(
  home: string,
  request: PartSliceRequest,
  content: Buffer,
  exec?: SlicerExecFn,
): SliceResult {
  const staged = stageLibraryPart(home, request, content);
  return sliceModelWithProfile(staged.slice, staged.allowlist, exec);
}

/** F-121-T04: `sliceLibraryPart` with the slicer run asynchronously, as the slicing base serving other bases does. */
export async function sliceLibraryPartAsync(
  home: string,
  request: PartSliceRequest,
  content: Buffer,
  exec?: SlicerExecAsyncFn,
): Promise<SliceResult> {
  const staged = stageLibraryPart(home, request, content);
  return sliceModelWithProfileAsync(staged.slice, staged.allowlist, exec);
}

/** Check hash and allowlist, put the content in the cache under its hash, and clear a stale output. */
function stageLibraryPart(
  home: string,
  request: PartSliceRequest,
  content: Buffer,
): { allowlist: SlicerProfile[]; slice: { inputPath: string; outputPath: string; profileName: string } } {
  const file = validatePrintPath(request.part.file);
  const digest = createHash('sha256').update(content).digest('hex');
  if (
    !/^[0-9a-f]{64}$/.test(request.part.sha256) ||
    digest !== request.part.sha256 ||
    content.length !== request.part.bytes
  ) {
    throw new Error(`Part file prints/${file} does not match its SHA-256; nothing was sliced.`);
  }
  const allowlist = readSlicerProfiles(home);
  const profile = resolveAllowedSlicerProfile(request.profileName, allowlist);
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  const cache = join(home, 'prints-cache');
  const out = join(home, 'prints-out');
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const input = join(cache, `${digest}${ext}`);
  if (cachedHash(input) !== digest) {
    // A unique temporary name, then a rename: two writers of one hash write the same bytes, and a reader never sees
    // a half-written file. On Windows a rename onto a file another process holds open can fail; the copy already
    // there is then used when it has the right hash.
    const temp = `${input}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, content, { mode: 0o600 });
      renameSync(temp, input);
    } catch (error) {
      if (existsSync(temp)) unlinkSync(temp);
      if (cachedHash(input) !== digest) throw error;
    }
  }
  const output = join(out, `${digest.slice(0, 16)}-${profileSlug(profile.name)}.gcode.3mf`);
  // A stale output would pass for a slice that never ran.
  if (existsSync(output)) unlinkSync(output);
  return { allowlist, slice: { inputPath: input, outputPath: output, profileName: profile.name } };
}

const cachedHash = (path: string) =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : undefined;

/** "1h 24m 10s" → seconds; undefined when the slicer's time text has another shape. */
function seconds(text: string): number | undefined {
  const parts = [...text.matchAll(/(\d+)\s*([dhms])/gi)];
  if (!parts.length || text.replace(/(\d+)\s*([dhms])/gi, '').trim()) return undefined;
  const unit: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };
  return parts.reduce((sum, [, value, u]) => sum + Number(value) * unit[u!.toLowerCase()]!, 0);
}

function duration(total: number): string {
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ') || '0s';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A resolved, read and hashed print request, before any slicer runs. */
export interface PreparedPrint {
  /** "motor foot for Wisp (Kite 5.1): file …, 4 prints, profile … (TPU, external spool, …)". */
  plan: string;
  request: PartSliceRequest;
  material: string;
  externalSpool: boolean;
}

/** What a slicer reports back, wherever it ran. */
export interface SlicedPlate {
  outputPath: string;
  profileName: string;
  estimate: SliceResult['estimate'];
}

/** F-121-T04: a slice waiting to be sent to the slicing base; the coordinator sends it over the Kaji line. */
export interface PendingRemotePrint {
  base: string;
  prepared: PreparedPrint;
}

export function isPendingRemotePrint(value: unknown): value is PrintPartReply & { remote: PendingRemotePrint } {
  if (!value || typeof value !== 'object') return false;
  const remote = (value as { remote?: unknown }).remote;
  return Boolean(remote && typeof remote === 'object' && typeof (remote as PendingRemotePrint).base === 'string');
}

type Preparation = { reply: PrintPartReply } | { prepared: PreparedPrint; content: Buffer };

/** Resolve a print phrase and read the part once: either a reply already (ask, missing file) or the prepared request. */
export function preparePrintPart(fleet: FleetStore, home: string | undefined, phrase: string): Preparation {
  if (!phrase.trim() || phrase.trim().length > 500) throw new Error('Print phrase must contain 1–500 characters.');
  const parsed = parsePrintPartPhrase(phrase);
  if (!parsed) {
    return {
      reply: {
        handled: false,
        reply:
          'Not a print request for a printed part. Say "stampa i piedini di <drone>" or "print the <part> for <model>".',
      },
    };
  }
  const resolved = resolvePart(fleet, parsed);
  if (resolved.status === 'ask') return { reply: { handled: true, needsAnswer: true, reply: resolved.question } };
  const { part } = resolved;
  const per = part.objectsPerPrint;
  const prints = parsed.count ? Math.ceil(parsed.count / per) : part.count;
  const pieces = prints * per;
  const who = resolved.drone ? `${resolved.drone} (${resolved.model})` : resolved.model;
  const spool = part.externalSpool ? 'external spool' : 'AMS';
  const plan =
    `${part.name} for ${who}: file ${part.file}, ${plural(prints, 'print')}` +
    (per > 1 ? ` of ${per} objects (${pieces} pieces)` : '') +
    (parsed.count && parsed.count !== pieces ? `, ${parsed.count} asked` : '') +
    `, profile ${part.slicerProfile} (${part.material}, ${spool}, temperatures from the profile)`;
  if (!home) {
    return { reply: { handled: true, sliced: false, reply: `${plan}. Printing is not available here: no NERV home.` } };
  }
  const read = readLibraryPart(home, part.file);
  if (read.status !== 'ok')
    return { reply: { handled: true, sliced: false, reply: `${plan}. Not sliced: ${read.reason}` } };
  return {
    prepared: {
      plan,
      request: {
        version: 1,
        part: { file: part.file, sha256: read.sha256, bytes: read.content.length },
        profileName: part.slicerProfile,
        prints,
      },
      material: part.material,
      externalSpool: part.externalSpool,
    },
    content: read.content,
  };
}

/** The reply for a prepared print once its slicer answered (`slicedOn`: the base that sliced, when not this one). */
export function finishPrintPart(
  prepared: PreparedPrint,
  outcome: SlicedPlate | Error,
  slicedOn?: string,
): PrintPartReply {
  const { plan, request } = prepared;
  if (outcome instanceof Error) {
    return { handled: true, sliced: false, request, reply: `${plan}. Not sliced: ${outcome.message}` };
  }
  const { estimate } = outcome;
  const { prints } = request;
  const perPrint = [
    estimate.printTimeText,
    estimate.filamentGrams !== undefined ? `${estimate.filamentGrams} g` : undefined,
  ]
    .filter(Boolean)
    .join(' and ');
  const time = seconds(estimate.printTimeText);
  const totalGrams =
    estimate.filamentGrams !== undefined ? Math.round(estimate.filamentGrams * prints * 10) / 10 : undefined;
  const total =
    prints > 1
      ? `, ${[
          time !== undefined ? duration(time * prints) : undefined,
          totalGrams !== undefined ? `${totalGrams} g` : undefined,
        ]
          .filter(Boolean)
          .join(' and ')} for all ${prints}`
      : '';
  const handoff: Record<string, string | number> = {
    gcode3mfPath: outcome.outputPath,
    profileName: outcome.profileName,
    printTimeText: estimate.printTimeText,
    ...(estimate.filamentGrams !== undefined ? { filamentGrams: estimate.filamentGrams } : {}),
    amsMapping: `${prepared.externalSpool ? 'External spool' : 'AMS'} (${prepared.material})`,
    sourceFile: request.part.file,
    repeats: prints,
  };
  const where = slicedOn ? ` on ${slicedOn}` : '';
  const card = slicedOn
    ? `Opening it in Bambu Connect on ${slicedOn} waits for your approval card (kaji.run on ${slicedOn} with tool bambu.handoff and the handoff arguments); NERV does not start the print.`
    : 'Opening it in Bambu Connect waits for your approval card (bambu.handoff with the handoff arguments); NERV does not start the print.';
  return {
    handled: true,
    sliced: true,
    request,
    estimate,
    handoff,
    ...(slicedOn ? { slicedOn, handoffBase: slicedOn } : {}),
    reply: `Sliced${where} ${plan}: ${perPrint || 'no estimate'} per print${total}. ${card}`,
  };
}

/** Resolve a print phrase, read the part once, slice it (`slice`, normally the local base) and propose the hand-off. */
export function printPartByChat(
  fleet: FleetStore,
  home: string | undefined,
  phrase: string,
  slice: PartSlicer,
): PrintPartReply {
  const ready = preparePrintPart(fleet, home, phrase);
  if ('reply' in ready) return ready.reply;
  let result: SliceResult;
  try {
    result = slice(ready.prepared.request, ready.content);
  } catch (error) {
    return finishPrintPart(ready.prepared, error as Error);
  }
  return finishPrintPart(ready.prepared, {
    outputPath: result.outputPath,
    profileName: result.profile.name,
    estimate: result.estimate,
  });
}

/**
 * F-121-T04: the part is sliced on another base (`prints.slicer`). The library file is read and hashed here; the
 * coordinator reads it again, checks the hash and sends it over the Kaji line (`completeRemotePrint`).
 */
export function preparePrintPartFor(
  fleet: FleetStore,
  home: string | undefined,
  phrase: string,
  base: string,
): PrintPartReply {
  const ready = preparePrintPart(fleet, home, phrase);
  if ('reply' in ready) return ready.reply;
  return {
    handled: true,
    sliced: false,
    request: ready.prepared.request,
    remote: { base, prepared: ready.prepared },
    reply: `${ready.prepared.plan}. Sending it to ${base} to slice.`,
  };
}
