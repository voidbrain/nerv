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
  recordedAt: string;
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
        'INSERT INTO battery_resistance_records(id, battery_id, values_mohm_json, recorded_at) VALUES (?, ?, ?, ?)',
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
    valuesMohm: readonly number[],
    recordedAt = new Date().toISOString(),
  ): BatteryResistanceEntry {
    const existing = this.get(batteryId);
    if (!existing) throw new Error(`Battery not found: ${batteryId}`);
    const validated = validateResistanceValues(valuesMohm, existing.cellCount);
    const id = `res-${randomUUID()}`;
    this.db
      .prepare(
        'INSERT INTO battery_resistance_records(id, battery_id, values_mohm_json, recorded_at) VALUES (?, ?, ?, ?)',
      )
      .run(id, batteryId, JSON.stringify(validated), recordedAt);
    return { id, batteryId, valuesMohm: validated, recordedAt };
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
        'SELECT id, battery_id, values_mohm_json, recorded_at FROM battery_resistance_records WHERE battery_id = ? ORDER BY recorded_at ASC',
      )
      .all(batteryId) as Array<{ id: string; battery_id: string; values_mohm_json: string; recorded_at: string }>;
    return rows.map((r) => ({
      id: r.id,
      batteryId: r.battery_id,
      valuesMohm: JSON.parse(r.values_mohm_json) as number[],
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
}
