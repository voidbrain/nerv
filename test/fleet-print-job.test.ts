import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { execute } from '../src/executors.ts';
import { parsePrintPartPhrase, sliceLibraryPart, type PrintPartReply } from '../src/print-job.ts';
import type { BambuHandoffResult, SlicerExecFn } from '../src/slicer.ts';
import { Store } from '../src/store.ts';

// Invented models, parts, paths and profiles only: the owner's real list stays in private fleet data.
const PROFILES = [
  { name: 'Test TPU 0.4', machineProfile: 'test-machine.json', materialProfile: 'test-tpu.json' },
  { name: 'Test PLA 0.4', machineProfile: 'test-machine.json', materialProfile: 'test-pla.json' },
];
const FOOT = 'solid foot\nendsolid foot\n';
const BANDS = 'PK-test-bands';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

interface FakeSlicer {
  exec: SlicerExecFn;
  calls: string[][];
  inputs: string[];
}

/** A fake slicer: writes the output it is told to and prints Bambu Studio's estimate lines. */
function fakeSlicer(): FakeSlicer {
  const calls: string[][] = [];
  const inputs: string[] = [];
  return {
    calls,
    inputs,
    exec: (bin, args) => {
      calls.push([bin, ...args]);
      const input = args.at(-1)!;
      inputs.push(readFileSync(input, 'utf8'));
      writeFileSync(args[args.indexOf('--export-3mf') + 1]!, 'PK-sliced');
      return 'estimated printing time: 42m\ntotal filament used [g] = 7.5\ntotal filament used [m] = 2.5\n';
    },
  };
}

function withPrintFleet(work: (store: Store, home: string, slicer: FakeSlicer) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'nerv-print-job-'));
  const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
  const slicer = fakeSlicer();
  store.slicerExec = slicer.exec;
  try {
    writeFileSync(join(home, 'slicer-profiles.json'), JSON.stringify(PROFILES));
    mkdirSync(join(home, 'prints', 'kite-5'), { recursive: true });
    writeFileSync(join(home, 'prints', 'kite-5', 'foot.stl'), FOOT);
    writeFileSync(join(home, 'prints', 'kite-5', 'bands.3mf'), BANDS);
    store.fleet.importFleet(
      {
        version: 1,
        models: [
          {
            name: 'Kite 5.1',
            parts: [
              { name: 'motor foot', aliases: ['piedini', 'feet'], file: 'kite-5/foot.stl', count: 4 },
              { name: 'camera band', aliases: ['fasce'], file: 'kite-5/bands.3mf', count: 1, objectsPerPrint: 2 },
              { name: 'camera mount', file: 'kite-5/mount.stl', count: 1, profile: 'Test PLA 0.4' },
            ],
          },
          { name: 'Moth 2', parts: [] },
        ],
        drones: [
          { name: 'Wisp', model: 'Kite 5.1', parts: [] },
          { name: 'Gnat', model: 'Moth 2', parts: [] },
        ],
      },
      undefined,
      { slicerProfiles: PROFILES.map((p) => p.name) },
    );
    work(store, home, slicer);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
}

const print = (store: Store, phrase: string) => execute(store, 'fleet.print', { phrase }) as PrintPartReply;

describe('F-121-T02: print phrases', () => {
  for (const [phrase, expected] of [
    ['stampa i piedini di Wisp', { part: 'piedini', target: 'Wisp' }],
    ['Stampami 2 fasce per Wisp.', { part: 'fasce', target: 'Wisp', count: 2 }],
    ['stampa le fasce del modello Kite 5.1', { part: 'fasce', target: 'Kite 5.1' }],
    ["print Wisp's feet", { part: 'feet', target: 'Wisp' }],
    ['print the feet for Wisp x3', { part: 'feet', target: 'Wisp', count: 3 }],
    ['print the Kite feet', { words: 'Kite feet' }],
  ] as const) {
    it(`parses "${phrase}"`, () => assert.deepEqual(parsePrintPartPhrase(phrase), expected));
  }
  it('leaves other phrases alone', () => {
    assert.equal(parsePrintPartPhrase('print my reminders'), undefined);
    assert.equal(parsePrintPartPhrase('stampa'), undefined);
  });
});

describe('F-121-T02: print a part by chat, across the join', () => {
  it('chat phrase → fleet.print → slice request → Orange bambu.handoff card → Bambu Connect link', () => {
    withPrintFleet((store, home, slicer) => {
      const sortie = store.ledger.openSortie('owner', 'stampa i piedini di Wisp', 'trusted');
      const sliced = store.runAction(sortie, {
        tool: 'fleet.print',
        stage: 'production',
        args: { phrase: 'stampa i piedini di Wisp' },
      });
      assert.equal(sliced.outcome, 'grant');
      const result = (sliced as { result: PrintPartReply }).result;
      assert.equal(result.sliced, true);
      // The slice request carries the part identity, and the slicer reads the hash-named cache copy.
      assert.deepEqual(result.request!.part, { file: 'kite-5/foot.stl', sha256: sha(FOOT), bytes: FOOT.length });
      assert.equal(result.request!.prints, 4);
      assert.equal(slicer.calls.length, 1);
      assert.equal(slicer.calls[0]!.at(-1), join(home, 'prints-cache', `${sha(FOOT)}.stl`));
      assert.deepEqual(slicer.calls[0]!.slice(3, 7), [
        '--load-settings',
        'test-machine.json',
        '--load-filaments',
        'test-tpu.json',
      ]);
      assert.deepEqual(slicer.inputs, [FOOT]);
      // The reply names file, count, profile, material, time and grams.
      for (const text of [
        'kite-5/foot.stl',
        '4 prints',
        'Test TPU 0.4',
        'TPU',
        'external spool',
        'temperatures from the profile',
        '42m',
        '7.5 g',
        '2h 48m',
        '30 g',
      ]) {
        assert.ok(result.reply.includes(text), `${text} in: ${result.reply}`);
      }

      let launched = '';
      store.bambuLauncher = (url) => {
        launched = url;
        return { opened: true };
      };
      const card = store.runAction(sortie, { tool: 'bambu.handoff', stage: 'production', args: result.handoff! });
      assert.equal(card.outcome, 'approval');
      assert.equal(card.pattern, 'orange');
      assert.equal(launched, '');
      const decided = store.decide(card.approvalId!, 'approve', 'owner');
      const handoff = decided.result as BambuHandoffResult;
      assert.equal(handoff.printStarted, false);
      assert.equal(launched, handoff.importLink);
      assert.match(decodeURIComponent(launched), /prints-out/);
      assert.ok(handoff.checklist.some((line) => line.includes('kite-5/foot.stl')));
      assert.ok(handoff.checklist.some((line) => /4 times/.test(line)));
      assert.ok(handoff.checklist.some((line) => /External spool \(TPU\)/.test(line)));
    });
  });

  it('a model name or its prefix resolves; an owner count is pieces, and one file may hold several objects', () => {
    withPrintFleet((store, _home, slicer) => {
      const feet = print(store, 'print the Kite feet');
      assert.equal(feet.sliced, true);
      assert.equal(feet.request!.prints, 4);
      const bands = print(store, 'stampa 2 fasce di Wisp');
      assert.equal(bands.sliced, true);
      assert.equal(bands.request!.prints, 1);
      assert.match(bands.reply, /1 print of 2 objects/);
      const three = print(store, 'stampa 3 fasce di Wisp');
      assert.equal(three.request!.prints, 2);
      assert.match(three.reply, /2 prints of 2 objects \(4 pieces\)/);
      assert.equal(slicer.calls.length, 3);
    });
  });

  it('an ambiguous or unknown part asks and slices nothing', () => {
    withPrintFleet((store, _home, slicer) => {
      const ambiguous = print(store, 'stampa le camera di Wisp');
      assert.equal(ambiguous.needsAnswer, true);
      assert.match(ambiguous.reply, /camera band/);
      assert.match(ambiguous.reply, /camera mount/);
      const unknown = print(store, 'print the canopy for Wisp');
      assert.equal(unknown.needsAnswer, true);
      assert.match(unknown.reply, /motor foot/);
      const noParts = print(store, 'print the feet for Gnat');
      assert.equal(noParts.needsAnswer, true);
      const noDrone = print(store, 'print the feet for Nobody');
      assert.equal(noDrone.needsAnswer, true);
      assert.equal(slicer.calls.length, 0);
    });
  });

  it('a missing library file is reported with its relative path and nothing is sliced', () => {
    withPrintFleet((store, home, slicer) => {
      const reply = print(store, 'print the camera mount for Wisp');
      assert.equal(reply.sliced, false);
      assert.match(reply.reply, /prints\/kite-5\/mount\.stl/);
      assert.ok(!reply.reply.includes(home), 'the reply names the relative path, not the home folder');
      assert.equal(reply.handoff, undefined);
      assert.equal(slicer.calls.length, 0);
      assert.equal(existsSync(join(home, 'prints-cache')), false);
    });
  });

  it('a file swapped for a link outside the library after it was recorded is refused at point of use', () => {
    withPrintFleet((store, home, slicer) => {
      const outside = join(home, 'outside.stl');
      writeFileSync(outside, 'secret');
      rmSync(join(home, 'prints', 'kite-5', 'foot.stl'));
      symlinkSync(outside, join(home, 'prints', 'kite-5', 'foot.stl'));
      const reply = print(store, 'stampa i piedini di Wisp');
      assert.equal(reply.sliced, false);
      assert.match(reply.reply, /outside the print library/);
      assert.equal(slicer.calls.length, 0);
    });
  });

  it('the profile allowlist is checked on the slicing base: a profile dropped since the part was recorded is refused', () => {
    withPrintFleet((store, home, slicer) => {
      writeFileSync(join(home, 'slicer-profiles.json'), JSON.stringify([PROFILES[1]]));
      const reply = print(store, 'stampa i piedini di Wisp');
      assert.equal(reply.sliced, false);
      assert.match(reply.reply, /Unknown slicer profile "Test TPU 0\.4"/);
      assert.equal(slicer.calls.length, 0);
    });
  });

  it('the slicing base refuses content that does not match the request hash', () => {
    withPrintFleet((_store, home, slicer) => {
      const request = {
        version: 1 as const,
        part: { file: 'kite-5/foot.stl', sha256: sha(FOOT), bytes: FOOT.length },
        profileName: 'Test TPU 0.4',
        prints: 1,
      };
      assert.throws(
        () => sliceLibraryPart(home, request, Buffer.from('tampered'), slicer.exec),
        /does not match/,
      );
      assert.equal(slicer.calls.length, 0);
      const result = sliceLibraryPart(home, request, Buffer.from(FOOT), slicer.exec);
      assert.equal(result.estimate.filamentGrams, 7.5);
    });
  });
});
