import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { analyzeBlackboxVibration, type BlackboxSample } from '../src/blackbox.ts';
import { readScrolls } from '../src/config.ts';
import { builtinTools } from '../src/executors.ts';
import { Store } from '../src/store.ts';

function synthLog(
  fn: (
    tSec: number,
    throttle: number,
  ) => { gyro: [number, number, number]; motors: [number, number, number, number]; unfilt?: boolean; erpm?: boolean },
): BlackboxSample[] {
  const rate = 1000;
  const out: BlackboxSample[] = [];
  for (let i = 0; i < 600; i++) {
    const tSec = i / rate;
    const throttle = i < 300 ? 0.25 : 0.8;
    const step = fn(tSec, throttle);
    out.push({
      timeUs: Math.round(tSec * 1_000_000),
      throttle: Math.round(1000 + throttle * 1000),
      gyro: step.gyro,
      ...(step.unfilt ? { gyroUnfilt: step.gyro } : {}),
      motors: step.motors,
      ...(step.erpm ? { eRpm: [12000, 12000, 12000, 12000] } : {}),
    });
  }
  return out;
}

describe('F-100-T03: FPV blackbox vibration report', () => {
  it('ranks constant-frequency frame resonance with per-axis evidence and states missing telemetry limits', () => {
    const samples = synthLog((t) => ({
      gyro: [18 * Math.sin(2 * Math.PI * 185 * t), 2 * Math.sin(2 * Math.PI * 60 * t), 0.5],
      motors: [1350, 1355, 1348, 1352],
    }));
    const report = analyzeBlackboxVibration(samples);
    assert.equal(report.axes.length, 3);
    assert.equal(report.motors.length, 4);
    assert.equal(report.usedUnfilteredGyro, false);
    assert.equal(report.hasERpmTelemetry, false);
    assert.equal(report.candidates[0]?.cause, 'frame_resonance');
    assert.ok(report.limits.some((l) => l.includes('GYRO_SCALED')));
    assert.ok(report.limits.some((l) => l.includes('eRPM')));
  });

  it('ranks motor/bearing issue when harmonic scales with throttle and one motor has asymmetric drive/RMS', () => {
    const samples = synthLog((t, thr) => {
      const freq = thr < 0.45 ? 70 : 190;
      const m3Wave = 45 * Math.sin(2 * Math.PI * 50 * t);
      return {
        gyro: [14 * Math.sin(2 * Math.PI * freq * t), 10 * Math.sin(2 * Math.PI * freq * t), 1],
        motors: [1300, 1305, Math.round(1450 + m3Wave), 1302],
        unfilt: true,
        erpm: true,
      };
    });
    const report = analyzeBlackboxVibration(samples);
    assert.equal(report.usedUnfilteredGyro, true);
    assert.equal(report.hasERpmTelemetry, true);
    assert.equal(report.candidates[0]?.cause, 'motor_bearing');
    assert.ok(report.candidates[0]!.evidence.some((e) => e.includes('M3')));
  });

  it('exposes fpv.blackbox_report as a Green read tool accepting CSV logs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-bb-'));
    try {
      assert.ok(builtinTools.some((t) => t.name === 'fpv.blackbox_report'));
      const header = 'time (us),rcCommand[3],gyroADC[0],gyroADC[1],gyroADC[2],motor[0],motor[1],motor[2],motor[3]';
      const rows = [header];
      for (let i = 0; i < 128; i++) {
        const t = i / 1000;
        const g = (15 * Math.sin(2 * Math.PI * 180 * t)).toFixed(2);
        rows.push(`${i * 1000},${i < 64 ? 1200 : 1800},${g},0,0,1300,1300,1300,1300`);
      }
      const store = new Store(join(dir, 'nerv.sqlite'), readScrolls(dir), { home: dir });
      const sortieId = store.ledger.openSortie('owner', 'analyze blackbox', 'trusted');
      const res = await store.runAction(sortieId, {
        tool: 'fpv.blackbox_report',
        args: { csv: rows.join('\n') },
        stage: 'production',
      });
      assert.equal(res.outcome, 'grant');
      assert.equal(res.pattern, 'green');
      assert.equal((res.result as { sampleCount: number }).sampleCount, 128);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// B-109: Betaflight Blackbox Explorer's CSV export starts with a block of "key",value settings lines before the column
// header; a real export (owner log, 2026-11-23) was rejected as "missing required columns".
describe('B-109: Blackbox Explorer CSV export with a settings preamble', () => {
  it('finds the column header after the preamble and reads every data row', () => {
    const preamble = [
      '"Product","Blackbox flight data recorder"',
      '"firmware","4.5"',
      '"looptime",312',
      '"debug_mode",0',
    ];
    const header =
      '"loopIteration","time","gyroADC[0]","gyroADC[1]","gyroADC[2]","gyroUnfilt[0]","gyroUnfilt[1]","gyroUnfilt[2]","rcCommand[3]","motor[0]","motor[1]","motor[2]","motor[3]","eRPM[0]","eRPM[1]","eRPM[2]","eRPM[3]"';
    const rows: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const t = 1000000 + i * 312;
      const s = Math.round(40 * Math.sin((2 * Math.PI * 180 * t) / 1e6));
      rows.push([i, t, s, -s, 1, s, -s, 1, 1400, 1500, 1510, 1490, 1505, 120, 121, 119, 120].join(','));
    }
    const csv = [...preamble, header, ...rows].join('\n');
    const report = analyzeBlackboxVibration(csv);
    assert.equal(report.sampleCount, 4000, 'every data row is read');
    assert.equal(report.usedUnfilteredGyro, true);
    assert.equal(report.hasERpmTelemetry, true);
  });
});
