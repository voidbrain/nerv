import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type BatteryChargeState = 'charged' | 'stored' | 'discharged';

export const BATTERY_SCHEMA = `
CREATE TABLE IF NOT EXISTS batteries(
  id TEXT PRIMARY KEY,
  pack_number INTEGER NOT NULL,
  series TEXT,
  series_color TEXT,
  label TEXT NOT NULL,
  brand TEXT NOT NULL,
  battery_type TEXT NOT NULL,
  cell_count INTEGER NOT NULL,
  capacity_mah INTEGER NOT NULL,
  purchase_date TEXT NOT NULL,
  current_state TEXT NOT NULL DEFAULT 'stored',
  cycles INTEGER NOT NULL DEFAULT 0,
  retired_at TEXT,
  resistance_prompted_record_id TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS batteries_number_series_idx
  ON batteries(pack_number, COALESCE(lower(series), ''), COALESCE(lower(series_color), ''));
CREATE TABLE IF NOT EXISTS battery_usage_records(
  id TEXT PRIMARY KEY,
  battery_id TEXT NOT NULL REFERENCES batteries(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS battery_usage_battery_idx ON battery_usage_records(battery_id, recorded_at);
CREATE TABLE IF NOT EXISTS battery_resistance_records(
  id TEXT PRIMARY KEY,
  battery_id TEXT NOT NULL REFERENCES batteries(id) ON DELETE CASCADE,
  values_mohm_json TEXT NOT NULL,
  cycles_at_record INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS battery_resistance_battery_idx ON battery_resistance_records(battery_id, recorded_at);
`;

export interface BatteryRecord {
  id: string;
  packNumber: number;
  series?: string;
  seriesColor?: string;
  label: string;
  brand: string;
  batteryType: string;
  cellCount: number;
  capacityMah: number;
  purchaseDate: string;
  currentState: BatteryChargeState;
  cycles: number;
  retiredAt?: string;
  createdAt: string;
}

export interface BatteryUsageEntry {
  id: string;
  batteryId: string;
  state: BatteryChargeState;
  recordedAt: string;
}

export interface BatteryResistanceEntry {
  id: string;
  batteryId: string;
  valuesMohm: number[];
  cyclesAtRecord: number;
  recordedAt: string;
}

export const RESISTANCE_CHECK_INTERVAL_DAYS = 90;
export const RESISTANCE_CHECK_INTERVAL_CYCLES = 30;

export interface DueResistanceCheck {
  battery: BatteryRecord;
  latestRecordId: string;
  lastRecordedAt: string;
  cyclesAtLastRecord: number;
  daysSinceLastCheck: number;
  cyclesSinceLastCheck: number;
  reasons: Array<'days' | 'cycles'>;
}

export interface RegisterBatteryInput {
  id?: string;
  packNumber: number;
  series?: string;
  seriesColor?: string;
  label?: string;
  brand: string;
  batteryType: string;
  cellCount: number;
  capacityMah: number;
  purchaseDate: string;
  initialResistanceMohm: number[];
  initialState?: BatteryChargeState;
  recordedAt?: string;
}

/** Legacy standalone `one-more-battery` export shape (F-008-T06). */
export interface OneMoreBatteryExport {
  brands?: Array<{ id: number; label: string; deleted?: number; enabled?: number }>;
  series?: Array<{ id: number; label: string; color?: string; deleted?: number; enabled?: number }>;
  batteryTypes?: Array<{ id: number; label: string; deleted?: number; enabled?: number }>;
  batteries: Array<{
    id: number;
    brandId: number;
    seriesId?: number;
    typeId: number;
    cellsNumber: number;
    date: string;
    label: string;
    mA: number;
    model?: string;
    deleted?: number;
    enabled?: number;
  }>;
  usageRecords?: Array<{
    id: number;
    idBattery: number;
    date: string;
    status: 1 | 2 | 3;
    deleted?: number;
    enabled?: number;
  }>;
  resistanceRecords?: Array<{
    id: number;
    idBattery: number;
    date: string;
    resistance_values: number[];
    deleted?: number;
    enabled?: number;
  }>;
}

export interface BatteryImportResult {
  importedBatteries: number;
  skippedDeleted: number;
  importedUsageRecords: number;
  importedResistanceRecords: number;
  batteries: BatteryRecord[];
}

function validateResistanceValues(values: readonly number[], cellCount: number): number[] {
  if (!Array.isArray(values) || values.length !== cellCount) {
    throw new Error(
      `Resistance record must supply exactly ${cellCount} per-cell value(s) in order (received ${Array.isArray(values) ? values.length : 0}).`,
    );
  }
  return values.map((v, idx) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new Error(`Invalid resistance value at cell ${idx + 1}: must be a positive finite number (mΩ).`);
    }
    return Number(v.toFixed(3));
  });
}

export function parseResistanceValues(input: string | readonly number[], expectedCells?: number): number[] {
  const values =
    typeof input === 'string'
      ? input
          .replace(/m[oωΩ]/gi, ' ')
          .split(/[\s,;]+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => Number(t))
      : [...input];
  if (expectedCells !== undefined) {
    return validateResistanceValues(values, expectedCells);
  }
  if (values.length === 0) {
    throw new Error('At least one per-cell resistance value (mΩ) is required.');
  }
  return validateResistanceValues(values, values.length);
}

function parseChargeState(status: 1 | 2 | 3): BatteryChargeState {
  if (status === 1) return 'charged';
  if (status === 2) return 'stored';
  if (status === 3) return 'discharged';
  throw new Error(`Unsupported legacy BatteryStatus: ${String(status)}`);
}

function extractPackNumber(label: string, fallbackId: number): number {
  const match = /\b(\d+)\b/.exec(label);
  return match ? Number(match[1]) : fallbackId;
}

/**
 * SQLite-backed FPV battery registry and legacy `one-more-battery` importer (F-008-T06).
 * Enforces per-cell resistance capture on registration and preserves usage/resistance history.
 */
export class BatteryRegistry {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.ensureSchemaColumns();
  }

  private ensureSchemaColumns(): void {
    const batCols = this.db.prepare('PRAGMA table_info(batteries)').all() as Array<{ name: string }>;
    if (batCols.length > 0 && !batCols.some((c) => c.name === 'resistance_prompted_record_id')) {
      this.db.exec('ALTER TABLE batteries ADD COLUMN resistance_prompted_record_id TEXT');
    }
    const resCols = this.db.prepare('PRAGMA table_info(battery_resistance_records)').all() as Array<{ name: string }>;
    if (resCols.length > 0 && !resCols.some((c) => c.name === 'cycles_at_record')) {
      this.db.exec('ALTER TABLE battery_resistance_records ADD COLUMN cycles_at_record INTEGER NOT NULL DEFAULT 0');
    }
  }

  register(input: RegisterBatteryInput): BatteryRecord {
    if (!Number.isInteger(input.packNumber) || input.packNumber < 1) {
      throw new Error('Battery packNumber must be a positive integer.');
    }
    if (!Number.isInteger(input.cellCount) || input.cellCount < 1 || input.cellCount > 12) {
      throw new Error('Battery cellCount must be an integer between 1 and 12.');
    }
    if (!Number.isInteger(input.capacityMah) || input.capacityMah < 50) {
      throw new Error('Battery capacityMah must be a positive integer (>= 50 mAh).');
    }
    if (!input.brand.trim() || !input.batteryType.trim() || !input.purchaseDate.trim()) {
      throw new Error('Battery brand, batteryType, and purchaseDate are required.');
    }

    const resistance = validateResistanceValues(input.initialResistanceMohm, input.cellCount);
    const id = input.id?.trim() || `bat-${randomUUID()}`;
    const series = input.series?.trim() || undefined;
    const seriesColor = input.seriesColor?.trim() || undefined;
    const label = input.label?.trim() || [String(input.packNumber), seriesColor ?? series].filter(Boolean).join(' ');
    const state: BatteryChargeState = input.initialState ?? 'stored';
    const createdAt = input.recordedAt?.trim() || new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO batteries(
          id, pack_number, series, series_color, label, brand, battery_type,
          cell_count, capacity_mah, purchase_date, current_state, cycles, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        id,
        input.packNumber,
        series ?? null,
        seriesColor ?? null,
        label,
        input.brand.trim(),
        input.batteryType.trim(),
        input.cellCount,
        input.capacityMah,
        input.purchaseDate.trim(),
        state,
        createdAt,
      );

    this.db
      .prepare(
        'INSERT INTO battery_resistance_records(id, battery_id, values_mohm_json, cycles_at_record, recorded_at) VALUES (?, ?, ?, 0, ?)',
      )
      .run(`res-${randomUUID()}`, id, JSON.stringify(resistance), createdAt);

    return this.get(id)!;
  }

  get(id: string): BatteryRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, pack_number, series, series_color, label, brand, battery_type,
                cell_count, capacity_mah, purchase_date, current_state, cycles, retired_at, created_at
         FROM batteries WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapBattery(row) : undefined;
  }

  list(): BatteryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, pack_number, series, series_color, label, brand, battery_type,
                cell_count, capacity_mah, purchase_date, current_state, cycles, retired_at, created_at
         FROM batteries ORDER BY pack_number ASC, COALESCE(series_color, series, '') ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapBattery(r));
  }

  findByNumberAndSeries(packNumber: number, seriesOrColor?: string): BatteryRecord[] {
    const q = seriesOrColor?.trim().toLowerCase();
    return this.list().filter((b) => {
      if (b.packNumber !== packNumber) return false;
      if (!q) return true;
      return b.series?.toLowerCase() === q || b.seriesColor?.toLowerCase() === q;
    });
  }

  recordState(batteryId: string, state: BatteryChargeState, recordedAt = new Date().toISOString()): BatteryRecord {
    const existing = this.get(batteryId);
    if (!existing) throw new Error(`Battery not found: ${batteryId}`);
    const cycleIncrement = existing.currentState === 'charged' && state === 'discharged' ? 1 : 0;

    this.db
      .prepare('INSERT INTO battery_usage_records(id, battery_id, state, recorded_at) VALUES (?, ?, ?, ?)')
      .run(`use-${randomUUID()}`, batteryId, state, recordedAt);

    this.db
      .prepare('UPDATE batteries SET current_state = ?, cycles = cycles + ? WHERE id = ?')
      .run(state, cycleIncrement, batteryId);

    return this.get(batteryId)!;
  }

  recordResistance(
    batteryId: string,
    valuesMohm: string | readonly number[],
    recordedAt = new Date().toISOString(),
  ): BatteryResistanceEntry {
    const existing = this.get(batteryId);
    if (!existing) throw new Error(`Battery not found: ${batteryId}`);
    const validated = parseResistanceValues(valuesMohm, existing.cellCount);
    const id = `res-${randomUUID()}`;
    this.db
      .prepare(
        'INSERT INTO battery_resistance_records(id, battery_id, values_mohm_json, cycles_at_record, recorded_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, batteryId, JSON.stringify(validated), existing.cycles, recordedAt);
    this.db.prepare('UPDATE batteries SET resistance_prompted_record_id = NULL WHERE id = ?').run(batteryId);
    return { id, batteryId, valuesMohm: validated, cyclesAtRecord: existing.cycles, recordedAt };
  }

  dueResistanceChecks(now = new Date()): DueResistanceCheck[] {
    const due: DueResistanceCheck[] = [];
    const nowMs = now.getTime();
    for (const battery of this.list()) {
      if (battery.retiredAt) continue;
      const latest = this.db
        .prepare(
          `SELECT id, values_mohm_json, cycles_at_record, recorded_at
           FROM battery_resistance_records
           WHERE battery_id = ?
           ORDER BY recorded_at DESC, rowid DESC
           LIMIT 1`,
        )
        .get(battery.id) as
        { id: string; values_mohm_json: string; cycles_at_record: number; recorded_at: string } | undefined;
      if (!latest) continue;
      const lastMs = Date.parse(latest.recorded_at);
      const daysSinceLastCheck = Number.isFinite(lastMs) ? Math.max(0, Math.floor((nowMs - lastMs) / 86_400_000)) : 0;
      const cyclesSinceLastCheck = Math.max(0, battery.cycles - latest.cycles_at_record);
      const reasons: Array<'days' | 'cycles'> = [];
      if (daysSinceLastCheck >= RESISTANCE_CHECK_INTERVAL_DAYS) reasons.push('days');
      if (cyclesSinceLastCheck >= RESISTANCE_CHECK_INTERVAL_CYCLES) reasons.push('cycles');
      if (reasons.length > 0) {
        due.push({
          battery,
          latestRecordId: latest.id,
          lastRecordedAt: latest.recorded_at,
          cyclesAtLastRecord: latest.cycles_at_record,
          daysSinceLastCheck,
          cyclesSinceLastCheck,
          reasons,
        });
      }
    }
    return due;
  }

  deliverDueResistancePrompts(now = new Date(), language: 'it' | 'en' = 'en'): number {
    const due = this.dueResistanceChecks(now);
    if (due.length === 0) return 0;
    let delivered = 0;
    const nowIso = now.toISOString();
    for (const check of due) {
      const row = this.db
        .prepare('SELECT resistance_prompted_record_id FROM batteries WHERE id = ?')
        .get(check.battery.id) as { resistance_prompted_record_id: string | null } | undefined;
      if (row?.resistance_prompted_record_id === check.latestRecordId) continue;
      const message = formatDueResistancePrompt([check], language);
      this.db
        .prepare(
          "INSERT INTO deliveries(id, reminder_id, kind, message, created, read_at) VALUES (?, NULL, 'battery_resistance', ?, ?, NULL)",
        )
        .run(randomUUID(), message, nowIso);
      this.db
        .prepare('UPDATE batteries SET resistance_prompted_record_id = ? WHERE id = ?')
        .run(check.latestRecordId, check.battery.id);
      delivered += 1;
    }
    return delivered;
  }

  usageHistory(batteryId: string): BatteryUsageEntry[] {
    const rows = this.db
      .prepare(
        'SELECT id, battery_id, state, recorded_at FROM battery_usage_records WHERE battery_id = ? ORDER BY recorded_at ASC',
      )
      .all(batteryId) as Array<{ id: string; battery_id: string; state: BatteryChargeState; recorded_at: string }>;
    return rows.map((r) => ({
      id: r.id,
      batteryId: r.battery_id,
      state: r.state,
      recordedAt: r.recorded_at,
    }));
  }

  resistanceHistory(batteryId: string): BatteryResistanceEntry[] {
    const rows = this.db
      .prepare(
        'SELECT id, battery_id, values_mohm_json, cycles_at_record, recorded_at FROM battery_resistance_records WHERE battery_id = ? ORDER BY recorded_at ASC',
      )
      .all(batteryId) as Array<{
      id: string;
      battery_id: string;
      values_mohm_json: string;
      cycles_at_record: number;
      recorded_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      batteryId: r.battery_id,
      valuesMohm: JSON.parse(r.values_mohm_json) as number[],
      cyclesAtRecord: r.cycles_at_record,
      recordedAt: r.recorded_at,
    }));
  }

  importOneMoreBattery(payload: OneMoreBatteryExport): BatteryImportResult {
    if (!payload || !Array.isArray(payload.batteries)) {
      throw new Error('Invalid one-more-battery export: batteries array is required.');
    }
    const brands = new Map((payload.brands ?? []).map((b) => [b.id, b]));
    const seriesMap = new Map((payload.series ?? []).map((s) => [s.id, s]));
    const types = new Map((payload.batteryTypes ?? []).map((t) => [t.id, t]));

    let skippedDeleted = 0;
    let importedUsageRecords = 0;
    let importedResistanceRecords = 0;
    const imported: BatteryRecord[] = [];

    for (const legacy of payload.batteries) {
      if (legacy.deleted === 1 || legacy.enabled === 0) {
        skippedDeleted += 1;
        continue;
      }
      const resList = (payload.resistanceRecords ?? [])
        .filter((r) => r.idBattery === legacy.id && r.deleted !== 1 && r.enabled !== 0)
        .sort((a, b) => a.date.localeCompare(b.date));

      if (resList.length === 0) {
        throw new Error(
          `Imported battery "${legacy.label}" (id=${legacy.id}) requires at least one initial per-cell resistance record.`,
        );
      }

      const brandName = brands.get(legacy.brandId)?.label ?? 'Unknown';
      const typeName = types.get(legacy.typeId)?.label ?? 'LiPo';
      const seriesObj = legacy.seriesId !== undefined ? seriesMap.get(legacy.seriesId) : undefined;
      const packNumber = extractPackNumber(legacy.label, legacy.id);

      const firstRes = resList[0]!;
      const created = this.register({
        id: `omb-${legacy.id}`,
        packNumber,
        ...(seriesObj ? { series: seriesObj.label, ...(seriesObj.color ? { seriesColor: seriesObj.color } : {}) } : {}),
        label: legacy.label,
        brand: brandName,
        batteryType: typeName,
        cellCount: legacy.cellsNumber,
        capacityMah: legacy.mA,
        purchaseDate: legacy.date,
        initialResistanceMohm: firstRes.resistance_values,
        recordedAt: firstRes.date,
      });
      importedResistanceRecords += 1;

      for (const extraRes of resList.slice(1)) {
        this.recordResistance(created.id, extraRes.resistance_values, extraRes.date);
        importedResistanceRecords += 1;
      }

      const usages = (payload.usageRecords ?? [])
        .filter((u) => u.idBattery === legacy.id && u.deleted !== 1 && u.enabled !== 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      for (const u of usages) {
        this.recordState(created.id, parseChargeState(u.status), u.date);
        importedUsageRecords += 1;
      }

      imported.push(this.get(created.id)!);
    }

    return {
      importedBatteries: imported.length,
      skippedDeleted,
      importedUsageRecords,
      importedResistanceRecords,
      batteries: imported,
    };
  }

  private mapBattery(row: Record<string, unknown>): BatteryRecord {
    return {
      id: String(row.id),
      packNumber: Number(row.pack_number),
      ...(row.series !== null && row.series !== undefined ? { series: String(row.series) } : {}),
      ...(row.series_color !== null && row.series_color !== undefined ? { seriesColor: String(row.series_color) } : {}),
      label: String(row.label),
      brand: String(row.brand),
      batteryType: String(row.battery_type),
      cellCount: Number(row.cell_count),
      capacityMah: Number(row.capacity_mah),
      purchaseDate: String(row.purchase_date),
      currentState: String(row.current_state) as BatteryChargeState,
      cycles: Number(row.cycles),
      ...(row.retired_at !== null && row.retired_at !== undefined ? { retiredAt: String(row.retired_at) } : {}),
      createdAt: String(row.created_at),
    };
  }

  /**
   * Parses and applies an Italian or English chat phrase (`F-008-T07`) to set `charged`, `discharged`, or `stored`
   * for one or more batteries. Refuses to guess when a pack number matches multiple series.
   */
  applyChatPhrase(text: string, recordedAt = new Date().toISOString()): BatteryChatResult {
    const parsed = parseBatteryChatCommand(text);
    if (!parsed) {
      return {
        status: 'unrecognized',
        language: detectBatteryLanguage(text),
        message: 'Could not recognize a battery charge-state command.',
      };
    }

    const active = this.list().filter((b) => !b.retiredAt);
    const resolved: BatteryRecord[] = [];
    for (const num of parsed.packNumbers) {
      let candidates = active.filter((b) => b.packNumber === num);
      if (parsed.seriesQuery) {
        const want = normalizeColorToken(parsed.seriesQuery);
        candidates = candidates.filter(
          (b) =>
            (b.series && normalizeColorToken(b.series) === want) ||
            (b.seriesColor && normalizeColorToken(b.seriesColor) === want),
        );
      }
      if (candidates.length === 0) {
        return {
          status: 'not_found',
          language: parsed.language,
          message:
            parsed.language === 'it'
              ? `Batteria ${num}${parsed.seriesQuery ? ` (${parsed.seriesQuery})` : ''} non trovata.`
              : `Battery ${num}${parsed.seriesQuery ? ` (${parsed.seriesQuery})` : ''} not found.`,
        };
      }
      if (candidates.length > 1) {
        const seriesList = candidates.map((c) => c.series ?? c.seriesColor ?? c.label).join(', ');
        return {
          status: 'ambiguous',
          language: parsed.language,
          matches: candidates,
          message:
            parsed.language === 'it'
              ? `La batteria ${num} è ambigua (${seriesList}). Quale serie intendi?`
              : `Battery ${num} is ambiguous (${seriesList}). Which series do you mean?`,
        };
      }
      resolved.push(candidates[0]!);
    }

    const updated = resolved.map((b) => this.recordState(b.id, parsed.state, recordedAt));
    return {
      status: 'updated',
      language: parsed.language,
      state: parsed.state,
      updated,
      message: formatBatteryStateLines(updated, parsed.language),
    };
  }
}

export interface ParsedBatteryChatCommand {
  state: BatteryChargeState;
  packNumbers: number[];
  seriesQuery?: string;
  language: 'it' | 'en';
}

export interface BatteryChatResult {
  status: 'updated' | 'ambiguous' | 'not_found' | 'unrecognized';
  language: 'it' | 'en';
  state?: BatteryChargeState;
  updated?: BatteryRecord[];
  matches?: BatteryRecord[];
  message: string;
}

const COLOR_ALIASES: Record<string, string> = {
  blu: 'blue',
  blue: 'blue',
  rosso: 'red',
  rossa: 'red',
  rossi: 'red',
  rosse: 'red',
  red: 'red',
  giallo: 'yellow',
  gialla: 'yellow',
  gialli: 'yellow',
  gialle: 'yellow',
  yellow: 'yellow',
  verde: 'green',
  verdi: 'green',
  green: 'green',
  nero: 'black',
  nera: 'black',
  neri: 'black',
  nere: 'black',
  black: 'black',
  bianco: 'white',
  bianca: 'white',
  bianchi: 'white',
  bianche: 'white',
  white: 'white',
};

function normalizeColorToken(token: string): string {
  const lower = token.trim().toLowerCase();
  return COLOR_ALIASES[lower] ?? lower;
}

function detectBatteryLanguage(text: string): 'it' | 'en' {
  return /\b(carica(?:re|to|te|ti)?|scarica(?:re|to|te|ti)?|batteri[ae]|usat[aeio]|ripon[ei]|ripost[aeio]|conserva(?:re|to|te|ti)?|blu|ross[aeio]|giall[aeio]|verd[ei]|ner[aeio]|bianc[aeioh]+)\b/i.test(
    text,
  )
    ? 'it'
    : 'en';
}

export function parseBatteryChatCommand(text: string): ParsedBatteryChatCommand | undefined {
  const lower = text.trim().toLowerCase();
  let state: BatteryChargeState | undefined;
  if (
    /\b(storage|stor(?:e|ed)|ripon[ei]|ripost[aeio]|conserva(?:re|to|te|ti)?|immagazzina(?:re|to|te|ti)?)\b/.test(lower)
  ) {
    state = 'stored';
  } else if (/\b(scarica(?:re|to|te|ti)?|usat[aeio]|discharged?|used)\b/.test(lower)) {
    state = 'discharged';
  } else if (/\b(carica(?:re|to|te|ti)?|charged?)\b/.test(lower)) {
    state = 'charged';
  }
  if (!state) return undefined;

  const packNumbers = Array.from(lower.matchAll(/\b(\d{1,4})\b/g), (m) => Number(m[1]));
  if (packNumbers.length === 0) return undefined;

  let seriesQuery: string | undefined;
  const seriesExplicit = /\b(?:serie|series)\s+([a-z0-9_-]+)/i.exec(lower);
  if (seriesExplicit) {
    seriesQuery = seriesExplicit[1];
  } else {
    for (const token of lower.split(/[^a-z0-9_-]+/)) {
      if (token in COLOR_ALIASES) {
        seriesQuery = token;
        break;
      }
    }
  }

  return {
    state,
    packNumbers: [...new Set(packNumbers)],
    ...(seriesQuery ? { seriesQuery } : {}),
    language: detectBatteryLanguage(text),
  };
}

/** Formats battery charge states and cycle counts for Telegram and dashboard summaries (F-008-T07). */
export function formatBatteryStateLines(batteries: readonly BatteryRecord[], language: 'it' | 'en' = 'en'): string {
  if (batteries.length === 0) {
    return language === 'it' ? 'Nessuna batteria registrata.' : 'No batteries registered.';
  }
  return batteries
    .map((b) => {
      const series = b.series ? ` (${b.series})` : b.seriesColor ? ` (${b.seriesColor})` : '';
      const cycleWord = language === 'it' ? (b.cycles === 1 ? 'ciclo' : 'cicli') : b.cycles === 1 ? 'cycle' : 'cycles';
      return `#${b.packNumber}${series}: ${b.currentState} · ${b.cycles} ${cycleWord}`;
    })
    .join('\n');
}

/** Formats due per-cell resistance check prompts asking for ordered cell values in mΩ (F-008-T08). */
export function formatDueResistancePrompt(checks: readonly DueResistanceCheck[], language: 'it' | 'en' = 'en'): string {
  if (checks.length === 0) {
    return language === 'it' ? 'Nessun controllo resistenza dovuto.' : 'No battery resistance checks due.';
  }
  return checks
    .map((c) => {
      const series = c.battery.series
        ? ` (${c.battery.series})`
        : c.battery.seriesColor
          ? ` (${c.battery.seriesColor})`
          : '';
      const why =
        language === 'it'
          ? [
              c.reasons.includes('days') ? `${c.daysSinceLastCheck} giorni` : null,
              c.reasons.includes('cycles') ? `${c.cyclesSinceLastCheck} cicli` : null,
            ]
              .filter(Boolean)
              .join(' / ')
          : [
              c.reasons.includes('days') ? `${c.daysSinceLastCheck} days` : null,
              c.reasons.includes('cycles') ? `${c.cyclesSinceLastCheck} cycles` : null,
            ]
              .filter(Boolean)
              .join(' / ');
      return language === 'it'
        ? `Controllo resistenza dovuto per #${c.battery.packNumber}${series} (${c.battery.batteryType}, ${c.battery.cellCount} celle; ${why} dall'ultimo controllo). Inserisci ${c.battery.cellCount} valori in mΩ in ordine (es. 3.1, 3.2, ...).`
        : `Resistance check due for #${c.battery.packNumber}${series} (${c.battery.batteryType}, ${c.battery.cellCount} cells; ${why} since last check). Please enter ${c.battery.cellCount} per-cell values in mΩ in order (e.g. 3.1, 3.2, ...).`;
    })
    .join('\n');
}
