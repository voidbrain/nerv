import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  handOffToBambuConnect,
  parseSlicerEstimate,
  sliceModelWithProfile,
  type BambuHandoffResult,
  type SlicerProfile,
} from '../src/slicer.ts';
import { Store } from '../src/store.ts';

const dirs: string[] = [];
const makeDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-slicer-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const ALLOWLIST: SlicerProfile[] = [
  {
    name: 'PLA-Basic',
    machineProfile: 'C:/profiles/Bambu_Lab_A1_0.4.json',
    materialProfile: 'C:/profiles/Generic_PLA_Basic.json',
  },
  {
    name: 'PETG-HF',
    machineProfile: 'C:/profiles/Bambu_Lab_A1_0.4.json',
    materialProfile: 'C:/profiles/Generic_PETG_HF.json',
  },
];

describe('F-087-T02 slice with a material profile', () => {
  it('applies an allowlisted material profile, produces .gcode.3mf, and reports time and material', () => {
    const dir = makeDir();
    const inputPath = join(dir, 'bracket.stl');
    const outputPath = join(dir, 'bracket.gcode.3mf');
    writeFileSync(inputPath, 'solid bracket\nendsolid bracket\n', 'utf8');

    let capturedCommand: string[] = [];
    const result = sliceModelWithProfile(
      { inputPath, outputPath, profileName: 'pla-basic' },
      ALLOWLIST,
      (bin, args) => {
        capturedCommand = [bin, ...args];
        writeFileSync(outputPath, 'PK_MOCK_3MF', 'utf8');
        return [
          '; estimated printing time (normal mode) = 1h 24m 10s',
          '; total filament used [g] = 34.5',
          '; total filament used [mm] = 11520',
        ].join('\n');
      },
    );

    assert.equal(result.outputPath, outputPath);
    assert.equal(result.profile.name, 'PLA-Basic');
    assert.deepEqual(capturedCommand, [
      'bambu-studio',
      '--slice',
      '0',
      '--load-settings',
      'C:/profiles/Bambu_Lab_A1_0.4.json',
      '--load-filaments',
      'C:/profiles/Generic_PLA_Basic.json',
      '--export-3mf',
      outputPath,
      inputPath,
    ]);
    assert.equal(result.estimate.printTimeText, '1h 24m 10s');
    assert.equal(result.estimate.filamentGrams, 34.5);
    assert.equal(result.estimate.filamentMeters, 11.52);
  });

  it('refuses an unknown material profile before invoking the slicer', () => {
    const dir = makeDir();
    const inputPath = join(dir, 'bracket.stl');
    const outputPath = join(dir, 'bracket.gcode.3mf');
    let called = false;

    assert.throws(
      () =>
        sliceModelWithProfile({ inputPath, outputPath, profileName: 'ABS-Unknown' }, ALLOWLIST, () => {
          called = true;
          return '';
        }),
      /Unknown slicer profile "ABS-Unknown"/,
    );
    assert.equal(called, false);
  });

  it('parses meter-based filament output cleanly', () => {
    const estimate = parseSlicerEstimate(
      'estimated printing time: 42m\ntotal filament used [g] = 12.2\ntotal filament used [m] = 4.1',
    );
    assert.equal(estimate.printTimeText, '42m');
    assert.equal(estimate.filamentGrams, 12.2);
    assert.equal(estimate.filamentMeters, 4.1);
  });
});

describe('F-087-T03 hand off to Bambu Connect with the owner checklist', () => {
  it('requires Orange approval, opens Bambu Connect import link, returns owner checklist, and never says print started', () => {
    const dir = makeDir();
    const gcodePath = join(dir, 'bracket.gcode.3mf');
    writeFileSync(gcodePath, 'PK_MOCK_3MF', 'utf8');

    const store = new Store(join(dir, 'nerv.db'));
    let launchedUrl = '';
    store.bambuLauncher = (url) => {
      launchedUrl = url;
      return { opened: true };
    };

    const sortie = store.ledger.openSortie('owner', 'Print bracket in PLA', 'trusted');
    const proposal = store.runAction(sortie, {
      tool: 'bambu.handoff',
      stage: 'production',
      args: {
        gcode3mfPath: gcodePath,
        profileName: 'PLA-Basic',
        printTimeText: '1h 24m 10s',
        filamentGrams: 34.5,
        printerName: 'Bambu A1',
        plateType: 'Textured PEI',
        nozzleSize: '0.4mm',
        amsMapping: 'Slot 1 (PLA Basic)',
      },
    });
    assert.equal(proposal.outcome, 'approval');
    assert.equal(proposal.pattern, 'orange');
    assert.equal(launchedUrl, '');

    const decided = store.decide(proposal.approvalId!, 'approve', 'owner');
    assert.equal(decided.decision, 'approve');
    const handoff = decided.result as BambuHandoffResult;
    assert.equal(handoff.status, 'handed-off');
    assert.equal(handoff.opened, true);
    assert.equal(handoff.printStarted, false);
    assert.match(launchedUrl, /^bambu-connect:\/\/import-file\?path=/);
    assert.equal(handoff.importLink, launchedUrl);
    assert.ok(handoff.checklist.some((item) => /Bambu A1/.test(item)));
    assert.ok(handoff.checklist.some((item) => /Textured PEI/.test(item)));
    assert.ok(handoff.checklist.some((item) => /0\.4mm/.test(item)));
    assert.ok(handoff.checklist.some((item) => /Slot 1 \(PLA Basic\)/.test(item)));
    assert.ok(handoff.checklist.some((item) => /Clear plate/i.test(item)));
    assert.ok(handoff.checklist.some((item) => /first layer/i.test(item)));
    assert.match(handoff.message, /has not started/i);
    store.close();
  });

  it('stages the import link when no desktop session is active without pretending Bambu Connect opened', () => {
    const dir = makeDir();
    const gcodePath = join(dir, 'bracket.gcode.3mf');
    writeFileSync(gcodePath, 'PK_MOCK_3MF', 'utf8');

    const result = handOffToBambuConnect({ gcode3mfPath: gcodePath, profileName: 'PLA-Basic' }, () => ({
      opened: false,
      reason: 'no-active-desktop-session',
    }));
    assert.equal(result.status, 'staged-waiting-login');
    assert.equal(result.opened, false);
    assert.equal(result.printStarted, false);
    assert.equal(result.reason, 'no-active-desktop-session');
    assert.match(result.importLink, /^bambu-connect:\/\/import-file\?path=/);
    assert.match(result.message, /waiting for an active desktop login/i);
  });
});
