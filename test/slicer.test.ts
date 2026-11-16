import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { parseSlicerEstimate, sliceModelWithProfile, type SlicerProfile } from '../src/slicer.ts';

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
