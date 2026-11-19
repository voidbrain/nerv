import type { BatteryRecord, BatteryResistanceEntry } from './batteries.ts';

export type BatteryHealthSeverity = 'warning' | 'strong_warning' | 'retire';

export interface BatteryModelProfile {
  id: string;
  name: string;
  agingWarningMohm: number;
  strongWarningMohm: number;
  retireMohm: number;
  retireSpreadPct?: number;
}

export interface BatteryCellFinding {
  cellIndex: number;
  cellNumber: number;
  severity: BatteryHealthSeverity;
  reason: 'growth_vs_first' | 'spread_vs_pack' | 'absolute_threshold' | 'retirement';
  currentMohm: number;
  firstMohm: number;
  otherCellsMedianMohm?: number;
  growthPct: number;
  spreadPct?: number;
  thresholdLabel: string;
}

export interface BatteryHealthReport {
  battery: BatteryRecord;
  status: 'no_records' | 'healthy' | 'warning' | 'strong_warning' | 'retire';
  profile?: BatteryModelProfile;
  firstRecord?: BatteryResistanceEntry;
  latestRecord?: BatteryResistanceEntry;
  findings: BatteryCellFinding[];
  lines: string[];
}

export const GROWTH_WARNING_PCT = 50;
export const GROWTH_STRONG_WARNING_PCT = 100;
export const PACK_SPREAD_WARNING_PCT = 30;
export const PACK_SPREAD_STRONG_WARNING_PCT = 50;

export const TATTU_RLINE_V6_1480_6S_PROFILE: BatteryModelProfile = {
  id: 'tattu-rline-v6-1480-6s',
  name: 'Tattu R-Line V6 1480 mAh 6S 160C',
  agingWarningMohm: 4.5,
  strongWarningMohm: 7,
  retireMohm: 8,
  retireSpreadPct: 30,
};

/** Matches a battery against known provisional model profiles (F-008-T05). */
export function matchBatteryModelProfile(battery: BatteryRecord): BatteryModelProfile | undefined {
  const text = `${battery.brand} ${battery.label} ${battery.batteryType}`.toLowerCase();
  if (
    text.includes('tattu') &&
    (text.includes('r-line') || text.includes('rline')) &&
    battery.cellCount === 6 &&
    battery.capacityMah === 1480
  ) {
    return TATTU_RLINE_V6_1480_6S_PROFILE;
  }
  return undefined;
}

/** Default retirement threshold in mΩ when no model profile applies (F-008-T05). */
export function defaultRetirementMohm(battery: BatteryRecord): number {
  const type = battery.batteryType.toLowerCase();
  if (type.includes('lihv')) return 10;
  return 12;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function batteryDisplayName(battery: BatteryRecord): string {
  const series = battery.series ? ` (${battery.series})` : battery.seriesColor ? ` (${battery.seriesColor})` : '';
  return `#${battery.packNumber}${series} ${battery.label}`;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function severityRank(s: BatteryHealthSeverity): number {
  if (s === 'retire') return 3;
  if (s === 'strong_warning') return 2;
  return 1;
}

function formatFindingLine(battery: BatteryRecord, f: BatteryCellFinding, language: 'it' | 'en'): string {
  const name = batteryDisplayName(battery);
  const cur = formatNumber(f.currentMohm);
  const first = formatNumber(f.firstMohm);
  const growth = formatNumber(f.growthPct);

  if (language === 'it') {
    const tag = f.severity === 'retire' ? 'RITIRA' : f.severity === 'strong_warning' ? 'ALLERTA FORTE' : 'ATTENZIONE';
    if (f.reason === 'retirement') {
      return `${tag}: ${name}, cella ${f.cellNumber} a ${cur} mΩ (${f.thresholdLabel}; iniziale ${first} mΩ).`;
    }
    if (f.reason === 'absolute_threshold') {
      return `${tag}: ${name}, cella ${f.cellNumber} a ${cur} mΩ (${f.thresholdLabel}; iniziale ${first} mΩ).`;
    }
    if (f.reason === 'growth_vs_first') {
      return `${tag}: ${name}, cella ${f.cellNumber} cresciuta del +${growth}% rispetto al primo record (${first} -> ${cur} mΩ, limite ${f.thresholdLabel}).`;
    }
    const base = formatNumber(f.otherCellsMedianMohm ?? 0);
    const spread = formatNumber(f.spreadPct ?? 0);
    return `${tag}: ${name}, cella ${f.cellNumber} a ${cur} mΩ (+${spread}% rispetto alle altre celle ${base} mΩ, limite ${f.thresholdLabel}).`;
  }

  const tag = f.severity === 'retire' ? 'RETIRE' : f.severity === 'strong_warning' ? 'STRONG WARNING' : 'WARNING';
  if (f.reason === 'retirement' || f.reason === 'absolute_threshold') {
    return `${tag}: ${name}, cell ${f.cellNumber} at ${cur} mΩ (${f.thresholdLabel}; first ${first} mΩ).`;
  }
  if (f.reason === 'growth_vs_first') {
    return `${tag}: ${name}, cell ${f.cellNumber} grew +${growth}% over first record (${first} -> ${cur} mΩ, limit ${f.thresholdLabel}).`;
  }
  const base = formatNumber(f.otherCellsMedianMohm ?? 0);
  const spread = formatNumber(f.spreadPct ?? 0);
  return `${tag}: ${name}, cell ${f.cellNumber} at ${cur} mΩ (+${spread}% over other cells ${base} mΩ, limit ${f.thresholdLabel}).`;
}

/**
 * Evaluates per-cell resistance trends against the first record, the pack's other cells,
 * and decided retirement/profile thresholds (`F-008-T10`). Returns no advice when no records exist.
 */
export function evaluateBatteryHealth(
  battery: BatteryRecord,
  records: readonly BatteryResistanceEntry[],
  options: { language?: 'it' | 'en'; profile?: BatteryModelProfile } = {},
): BatteryHealthReport {
  const language = options.language ?? 'en';
  const profile = options.profile ?? matchBatteryModelProfile(battery);
  if (records.length === 0) {
    return { battery, status: 'no_records', ...(profile ? { profile } : {}), findings: [], lines: [] };
  }

  const firstRecord = records[0]!;
  const latestRecord = records[records.length - 1]!;
  const retireLimit = profile ? profile.retireMohm : defaultRetirementMohm(battery);
  const findings: BatteryCellFinding[] = [];

  for (let i = 0; i < latestRecord.valuesMohm.length; i += 1) {
    const currentMohm = latestRecord.valuesMohm[i]!;
    const firstMohm = firstRecord.valuesMohm[i] ?? currentMohm;
    const growthPct = firstMohm > 0 ? ((currentMohm - firstMohm) / firstMohm) * 100 : 0;

    const otherCells = latestRecord.valuesMohm.filter((_, idx) => idx !== i);
    const otherMedian = otherCells.length > 0 ? median(otherCells) : undefined;
    const spreadPct =
      otherMedian !== undefined && otherMedian > 0 ? ((currentMohm - otherMedian) / otherMedian) * 100 : undefined;

    if (currentMohm >= retireLimit) {
      findings.push({
        cellIndex: i,
        cellNumber: i + 1,
        severity: 'retire',
        reason: 'retirement',
        currentMohm,
        firstMohm,
        ...(otherMedian !== undefined ? { otherCellsMedianMohm: otherMedian } : {}),
        growthPct,
        ...(spreadPct !== undefined ? { spreadPct } : {}),
        thresholdLabel: `>= ${formatNumber(retireLimit)} mΩ`,
      });
    } else if (
      profile &&
      profile.retireSpreadPct !== undefined &&
      spreadPct !== undefined &&
      spreadPct > profile.retireSpreadPct
    ) {
      findings.push({
        cellIndex: i,
        cellNumber: i + 1,
        severity: 'retire',
        reason: 'retirement',
        currentMohm,
        firstMohm,
        ...(otherMedian !== undefined ? { otherCellsMedianMohm: otherMedian } : {}),
        growthPct,
        spreadPct,
        thresholdLabel: `spread > ${profile.retireSpreadPct}% (${formatNumber(spreadPct)}%)`,
      });
    } else if (profile && currentMohm >= profile.strongWarningMohm) {
      findings.push({
        cellIndex: i,
        cellNumber: i + 1,
        severity: 'strong_warning',
        reason: 'absolute_threshold',
        currentMohm,
        firstMohm,
        ...(otherMedian !== undefined ? { otherCellsMedianMohm: otherMedian } : {}),
        growthPct,
        ...(spreadPct !== undefined ? { spreadPct } : {}),
        thresholdLabel: `>= ${formatNumber(profile.strongWarningMohm)} mΩ`,
      });
    } else if (profile && currentMohm >= profile.agingWarningMohm) {
      findings.push({
        cellIndex: i,
        cellNumber: i + 1,
        severity: 'warning',
        reason: 'absolute_threshold',
        currentMohm,
        firstMohm,
        ...(otherMedian !== undefined ? { otherCellsMedianMohm: otherMedian } : {}),
        growthPct,
        ...(spreadPct !== undefined ? { spreadPct } : {}),
        thresholdLabel: `>= ${formatNumber(profile.agingWarningMohm)} mΩ`,
      });
    }

    if (growthPct >= GROWTH_STRONG_WARNING_PCT) {
      findings.push({
        cellIndex: i,
        cellNumber: i + 1,
        severity: 'strong_warning',
        reason: 'growth_vs_first',
        currentMohm,
        firstMohm,
        ...(otherMedian !== undefined ? { otherCellsMedianMohm: otherMedian } : {}),
        growthPct,
        ...(spreadPct !== undefined ? { spreadPct } : {}),
        thresholdLabel: `+${GROWTH_STRONG_WARNING_PCT}%`,
      });
    } else if (growthPct >= GROWTH_WARNING_PCT) {
      findings.push({
        cellIndex: i,
        cellNumber: i + 1,
        severity: 'warning',
        reason: 'growth_vs_first',
        currentMohm,
        firstMohm,
        ...(otherMedian !== undefined ? { otherCellsMedianMohm: otherMedian } : {}),
        growthPct,
        ...(spreadPct !== undefined ? { spreadPct } : {}),
        thresholdLabel: `+${GROWTH_WARNING_PCT}%`,
      });
    }

    if (spreadPct !== undefined && spreadPct >= PACK_SPREAD_STRONG_WARNING_PCT) {
      findings.push({
        cellIndex: i,
        cellNumber: i + 1,
        severity: 'strong_warning',
        reason: 'spread_vs_pack',
        currentMohm,
        firstMohm,
        ...(otherMedian !== undefined ? { otherCellsMedianMohm: otherMedian } : {}),
        growthPct,
        spreadPct,
        thresholdLabel: `+${PACK_SPREAD_STRONG_WARNING_PCT}%`,
      });
    } else if (spreadPct !== undefined && spreadPct >= PACK_SPREAD_WARNING_PCT) {
      findings.push({
        cellIndex: i,
        cellNumber: i + 1,
        severity: 'warning',
        reason: 'spread_vs_pack',
        currentMohm,
        firstMohm,
        ...(otherMedian !== undefined ? { otherCellsMedianMohm: otherMedian } : {}),
        growthPct,
        spreadPct,
        thresholdLabel: `+${PACK_SPREAD_WARNING_PCT}%`,
      });
    }
  }

  let status: BatteryHealthReport['status'] = 'healthy';
  for (const f of findings) {
    if (status === 'healthy' || severityRank(f.severity) > severityRank(status)) {
      status = f.severity;
    }
  }

  const lines = findings.map((f) => formatFindingLine(battery, f, language));
  return {
    battery,
    status,
    ...(profile ? { profile } : {}),
    firstRecord,
    latestRecord,
    findings,
    lines,
  };
}
