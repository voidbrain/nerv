/**
 * Local Betaflight blackbox vibration analyzer (F-100-T03).
 * Computes per-axis gyro spectrum summaries and per-motor drive/eRPM summaries,
 * ranks candidate causes (frame resonance, motor/bearing, prop, ESC/electrical) with evidence,
 * and explicitly states what the log cannot tell.
 */

export interface BlackboxSample {
  timeUs: number;
  throttle: number; // 0..1 normalized or 1000..2000 Betaflight us
  gyro: [number, number, number]; // roll, pitch, yaw (deg/s)
  gyroUnfilt?: [number, number, number];
  motors: [number, number, number, number];
  eRpm?: [number, number, number, number];
}

export interface AxisSpectrumSummary {
  axis: 'roll' | 'pitch' | 'yaw';
  peakHz: number;
  peakPower: number;
  lowThrottlePeakHz: number;
  highThrottlePeakHz: number;
  widebandFloor: number;
  constantFrequencyAcrossThrottle: boolean;
  scalesWithThrottle: boolean;
}

export interface MotorSummary {
  motor: 1 | 2 | 3 | 4;
  meanDrive: number;
  rmsVariation: number;
  eRpmDropouts: number;
}

export interface VibrationCandidate {
  cause: 'frame_resonance' | 'motor_bearing' | 'prop_imbalance' | 'esc_electrical';
  score: number;
  evidence: string[];
}

export interface VibrationReport {
  sampleCount: number;
  sampleRateHz: number;
  usedUnfilteredGyro: boolean;
  hasERpmTelemetry: boolean;
  axes: AxisSpectrumSummary[];
  motors: MotorSummary[];
  candidates: VibrationCandidate[];
  limits: string[];
}

function normalizeThrottle(raw: number): number {
  if (raw > 100) return Math.max(0, Math.min(1, (raw - 1000) / 1000));
  if (raw > 1) return Math.max(0, Math.min(1, raw / 100));
  return Math.max(0, Math.min(1, raw));
}

function computePeakSpectrum(
  values: number[],
  sampleRateHz: number,
): { peakHz: number; peakPower: number; floor: number } {
  const n = Math.min(values.length, 512);
  if (n < 16 || sampleRateHz <= 0) return { peakHz: 0, peakPower: 0, floor: 0 };
  const slice = values.slice(0, n);
  const mean = slice.reduce((a, b) => a + b, 0) / n;
  const maxBin = Math.floor(n / 2);
  let bestHz = 0;
  let bestPower = 0;
  const powers: number[] = [];

  for (let k = 1; k <= maxBin; k++) {
    let re = 0;
    let im = 0;
    const freq = (k * sampleRateHz) / n;
    if (freq < 20) continue; // ignore slow stick motion < 20 Hz
    for (let t = 0; t < n; t++) {
      const hann = 0.5 * (1 - Math.cos((2 * Math.PI * t) / (n - 1)));
      const x = (slice[t]! - mean) * hann;
      const angle = (2 * Math.PI * k * t) / n;
      re += x * Math.cos(angle);
      im -= x * Math.sin(angle);
    }
    const power = (re * re + im * im) / (n * n);
    powers.push(power);
    if (power > bestPower) {
      bestPower = power;
      bestHz = freq;
    }
  }

  powers.sort((a, b) => a - b);
  const floor = powers.length > 0 ? powers[Math.floor(powers.length * 0.5)]! : 0;
  return {
    peakHz: Math.round(bestHz * 10) / 10,
    peakPower: Math.round(bestPower * 100) / 100,
    floor: Math.round(floor * 100) / 100,
  };
}

/** Parses a Betaflight decoded CSV string into BlackboxSample records. */
export function parseBlackboxCsv(csv: string): BlackboxSample[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const idx = (names: string[]) => names.map((n) => headers.indexOf(n)).find((i) => i >= 0) ?? -1;

  const iTime = idx(['time (us)', 'time', 'timeUs']);
  const iThr = idx(['rcCommand[3]', 'throttle', 'setpoint[3]']);
  const iG0 = idx(['gyroADC[0]', 'gyro[0]']);
  const iG1 = idx(['gyroADC[1]', 'gyro[1]']);
  const iG2 = idx(['gyroADC[2]', 'gyro[2]']);
  const iU0 = idx(['gyroUnfilt[0]', 'debug[0]']);
  const iU1 = idx(['gyroUnfilt[1]', 'debug[1]']);
  const iU2 = idx(['gyroUnfilt[2]', 'debug[2]']);
  const iM = [0, 1, 2, 3].map((m) => idx([`motor[${m}]`]));
  const iE = [0, 1, 2, 3].map((m) => idx([`eRPM[${m}]`, `erpm[${m}]`]));

  if (iTime < 0 || iG0 < 0 || iG1 < 0 || iG2 < 0 || iM.some((i) => i < 0)) {
    throw new Error('Blackbox CSV missing required time, gyroADC[0..2], or motor[0..3] columns.');
  }

  const samples: BlackboxSample[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r]!.split(',').map((c) => Number(c.trim()));
    if (cols.length < headers.length || cols.some((n, k) => k === iTime && !Number.isFinite(n))) continue;
    const sample: BlackboxSample = {
      timeUs: cols[iTime]!,
      throttle: iThr >= 0 ? cols[iThr]! : 1200,
      gyro: [cols[iG0]!, cols[iG1]!, cols[iG2]!],
      motors: [cols[iM[0]!]!, cols[iM[1]!]!, cols[iM[2]!]!, cols[iM[3]!]!],
    };
    if (iU0 >= 0 && iU1 >= 0 && iU2 >= 0) {
      sample.gyroUnfilt = [cols[iU0]!, cols[iU1]!, cols[iU2]!];
    }
    if (iE.every((i) => i >= 0)) {
      sample.eRpm = [cols[iE[0]!]!, cols[iE[1]!]!, cols[iE[2]!]!, cols[iE[3]!]!];
    }
    samples.push(sample);
  }
  return samples;
}

/** Generates a per-axis & per-motor vibration report with ranked candidate causes and explicit limits. */
export function analyzeBlackboxVibration(input: string | BlackboxSample[]): VibrationReport {
  const samples = typeof input === 'string' ? parseBlackboxCsv(input) : input;
  if (samples.length < 32) {
    throw new Error('At least 32 blackbox samples are required for spectral analysis.');
  }

  const dtUs = (samples[samples.length - 1]!.timeUs - samples[0]!.timeUs) / (samples.length - 1);
  const sampleRateHz = dtUs > 0 ? Math.round(1_000_000 / dtUs) : 1000;
  const usedUnfilteredGyro = samples.every((s) => Array.isArray(s.gyroUnfilt));
  const hasERpmTelemetry = samples.every((s) => Array.isArray(s.eRpm));

  const lowSamples = samples.filter((s) => normalizeThrottle(s.throttle) < 0.45);
  const highSamples = samples.filter((s) => normalizeThrottle(s.throttle) >= 0.45);
  const axisNames: ('roll' | 'pitch' | 'yaw')[] = ['roll', 'pitch', 'yaw'];

  const axes: AxisSpectrumSummary[] = axisNames.map((axis, axIdx) => {
    const series = samples.map((s) => (usedUnfilteredGyro ? s.gyroUnfilt![axIdx]! : s.gyro[axIdx]!));
    const overall = computePeakSpectrum(series, sampleRateHz);
    const lowSpec =
      lowSamples.length >= 16
        ? computePeakSpectrum(
            lowSamples.map((s) => (usedUnfilteredGyro ? s.gyroUnfilt![axIdx]! : s.gyro[axIdx]!)),
            sampleRateHz,
          )
        : overall;
    const highSpec =
      highSamples.length >= 16
        ? computePeakSpectrum(
            highSamples.map((s) => (usedUnfilteredGyro ? s.gyroUnfilt![axIdx]! : s.gyro[axIdx]!)),
            sampleRateHz,
          )
        : overall;

    const hasThrottleSplit = lowSamples.length >= 16 && highSamples.length >= 16;
    const constantFreq =
      hasThrottleSplit &&
      lowSpec.peakHz > 0 &&
      highSpec.peakHz > 0 &&
      Math.abs(highSpec.peakHz - lowSpec.peakHz) <= 15 &&
      overall.peakPower > 2;
    const scalesWithThrottle =
      hasThrottleSplit && lowSpec.peakHz > 0 && highSpec.peakHz > lowSpec.peakHz + 25 && overall.peakPower > 2;

    return {
      axis,
      peakHz: overall.peakHz,
      peakPower: overall.peakPower,
      lowThrottlePeakHz: lowSpec.peakHz,
      highThrottlePeakHz: highSpec.peakHz,
      widebandFloor: overall.floor,
      constantFrequencyAcrossThrottle: constantFreq,
      scalesWithThrottle,
    };
  });

  const motors: MotorSummary[] = ([0, 1, 2, 3] as const).map((mIdx) => {
    const vals = samples.map((s) => s.motors[mIdx]!);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
    const eRpmDropouts = hasERpmTelemetry
      ? samples.filter((s, idx) => idx > 0 && s.motors[mIdx]! > 1100 && s.eRpm![mIdx]! === 0).length
      : 0;
    return {
      motor: (mIdx + 1) as 1 | 2 | 3 | 4,
      meanDrive: Math.round(mean * 10) / 10,
      rmsVariation: Math.round(Math.sqrt(variance) * 10) / 10,
      eRpmDropouts,
    };
  });

  const candidates: VibrationCandidate[] = [];

  // 1. Frame resonance: constant frequency across throttle
  const constAxes = axes.filter((a) => a.constantFrequencyAcrossThrottle);
  if (constAxes.length > 0) {
    candidates.push({
      cause: 'frame_resonance',
      score: Math.min(1, 0.5 + constAxes.length * 0.2),
      evidence: constAxes.map(
        (a) =>
          `${a.axis} shows a constant-frequency peak around ${a.peakHz} Hz (low ${a.lowThrottlePeakHz} Hz, high ${a.highThrottlePeakHz} Hz) with power ${a.peakPower}.`,
      ),
    });
  }

  // 2. Motor / bearing: slanted harmonic with throttle + asymmetric motor drive/RMS
  const maxMean = Math.max(...motors.map((m) => m.meanDrive));
  const minMean = Math.min(...motors.map((m) => m.meanDrive));
  const maxRms = Math.max(...motors.map((m) => m.rmsVariation));
  const minRms = Math.min(...motors.map((m) => m.rmsVariation));
  const scaledAxes = axes.filter((a) => a.scalesWithThrottle);
  if (scaledAxes.length > 0 || maxMean - minMean >= 60 || maxRms - minRms >= 20) {
    const ev: string[] = [];
    for (const a of scaledAxes) {
      ev.push(
        `${a.axis} peak frequency rises with throttle (${a.lowThrottlePeakHz} Hz -> ${a.highThrottlePeakHz} Hz).`,
      );
    }
    if (maxMean - minMean >= 60 || maxRms - minRms >= 20) {
      const outlier = motors.reduce((best, m) => (m.rmsVariation > best.rmsVariation ? m : best), motors[0]!);
      ev.push(
        `Motor M${outlier.motor} shows elevated asymmetry (mean ${outlier.meanDrive}, RMS ${outlier.rmsVariation} vs min ${minRms}).`,
      );
    }
    candidates.push({
      cause: 'motor_bearing',
      score: Math.min(1, 0.4 + (scaledAxes.length > 0 ? 0.3 : 0) + (maxMean - minMean >= 60 ? 0.25 : 0)),
      evidence: ev,
    });
  }

  // 3. Prop imbalance: throttle-tracking low/mid frequency vibration
  if (scaledAxes.some((a) => a.peakHz >= 30 && a.peakHz <= 180)) {
    const a = scaledAxes.find((x) => x.peakHz >= 30 && x.peakHz <= 180)!;
    candidates.push({
      cause: 'prop_imbalance',
      score: 0.45,
      evidence: [
        `${a.axis} tracks throttle in the 30-180 Hz prop-pass band (${a.lowThrottlePeakHz} -> ${a.highThrottlePeakHz} Hz).`,
      ],
    });
  }

  // 4. ESC / electrical noise: elevated wideband floor or eRPM dropouts
  const noisyAxes = axes.filter((a) => a.widebandFloor >= 0.5);
  const dropouts = motors.filter((m) => m.eRpmDropouts > 0);
  if (noisyAxes.length > 0 || dropouts.length > 0) {
    const ev: string[] = [];
    for (const a of noisyAxes) {
      ev.push(`${a.axis} has elevated wideband noise floor (${a.widebandFloor}).`);
    }
    for (const m of dropouts) {
      ev.push(`Motor M${m.motor} recorded ${m.eRpmDropouts} eRPM dropout(s) under throttle.`);
    }
    candidates.push({
      cause: 'esc_electrical',
      score: Math.min(1, 0.4 + noisyAxes.length * 0.15 + dropouts.length * 0.25),
      evidence: ev,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const limits: string[] = [
    'A blackbox log cannot identify which physical screw, arm, or mount is loose—only spectral and motor drive signatures.',
  ];
  if (!usedUnfilteredGyro) {
    limits.push(
      'GYRO_SCALED (unfiltered gyro) was not present; post-filter gyroADC hides high-frequency noise attenuated by Betaflight filters.',
    );
  }
  if (!hasERpmTelemetry) {
    limits.push(
      'Bidirectional DShot eRPM telemetry was absent; motor harmonics cannot be separated from prop blade-pass by RPM alone.',
    );
  }

  return {
    sampleCount: samples.length,
    sampleRateHz,
    usedUnfilteredGyro,
    hasERpmTelemetry,
    axes,
    motors,
    candidates,
    limits,
  };
}
