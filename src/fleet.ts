import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { BatteryRegistry } from './batteries.ts';
import { transaction } from './sqlite-transaction.ts';

export const FLEET_SCHEMA = `
CREATE TABLE IF NOT EXISTS drones(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  frame TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drone_parts(
  id TEXT PRIMARY KEY,
  drone_id TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  position TEXT NOT NULL,
  component_model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'installed',
  installed_at TEXT NOT NULL,
  UNIQUE(drone_id, category, position)
);
CREATE INDEX IF NOT EXISTS drone_parts_drone_idx ON drone_parts(drone_id);
CREATE TABLE IF NOT EXISTS spares(
  id TEXT PRIMARY KEY,
  component_model TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  new_count INTEGER NOT NULL DEFAULT 0,
  used_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drone_crashes(
  id TEXT PRIMARY KEY,
  drone_id TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
  part_id TEXT REFERENCES drone_parts(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  position TEXT NOT NULL,
  component_model TEXT,
  damage TEXT NOT NULL,
  spare_used TEXT CHECK (spare_used IN ('new', 'used') OR spare_used IS NULL),
  crashed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS drone_crashes_time_idx ON drone_crashes(crashed_at DESC);
`;

export type PartStatus = 'installed' | 'damaged' | 'removed';

export interface DroneRecord {
  id: string;
  name: string;
  frame?: string;
  notes?: string;
  createdAt: string;
}

export interface DronePartRecord {
  id: string;
  droneId: string;
  category: string;
  position: string;
  componentModel: string;
  status: PartStatus;
  installedAt: string;
}

export interface SpareRecord {
  id: string;
  componentModel: string;
  category: string;
  newCount: number;
  usedCount: number;
  notes?: string;
  updatedAt: string;
}

export interface CrashRecord {
  id: string;
  droneId: string;
  partId?: string;
  category: string;
  position: string;
  componentModel?: string;
  damage: string;
  spareUsed?: 'new' | 'used';
  crashedAt: string;
}

/**
 * F-098-T01: Local FPV fleet & spares store (drones by name, parts by position + component model,
 * and spares inventory with separate new and used counts).
 */
export class FleetStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(FLEET_SCHEMA);
  }

  addDrone(input: { id?: string; name: string; frame?: string; notes?: string; createdAt?: string }): DroneRecord {
    const name = input.name.trim();
    if (!name) throw new Error('Drone name is required.');
    const id = input.id ?? `drone-${randomUUID()}`;
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db
      .prepare('INSERT INTO drones(id, name, frame, notes, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, input.frame?.trim() ?? null, input.notes?.trim() ?? null, createdAt);
    return this.getDrone(id)!;
  }

  getDrone(id: string): DroneRecord | undefined {
    const row = this.db.prepare('SELECT * FROM drones WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? mapDrone(row) : undefined;
  }

  getDroneByName(name: string): DroneRecord | undefined {
    const row = this.db.prepare('SELECT * FROM drones WHERE lower(name) = lower(?)').get(name.trim()) as
      Record<string, unknown> | undefined;
    return row ? mapDrone(row) : undefined;
  }

  listDrones(): DroneRecord[] {
    const rows = this.db.prepare('SELECT * FROM drones ORDER BY lower(name) ASC').all() as Array<
      Record<string, unknown>
    >;
    return rows.map(mapDrone);
  }

  setPart(input: {
    droneIdOrName: string;
    category: string;
    position: string;
    componentModel: string;
    status?: PartStatus;
    installedAt?: string;
  }): DronePartRecord {
    const drone = this.getDrone(input.droneIdOrName) ?? this.getDroneByName(input.droneIdOrName);
    if (!drone) throw new Error(`Drone not found: ${input.droneIdOrName}`);
    const category = input.category.trim().toLowerCase();
    const position = input.position.trim().toLowerCase();
    const componentModel = input.componentModel.trim();
    if (!category || !position || !componentModel) {
      throw new Error('Part category, position, and componentModel are required.');
    }
    const status: PartStatus = input.status ?? 'installed';
    const installedAt = input.installedAt ?? new Date().toISOString();
    const existing = this.db
      .prepare('SELECT id FROM drone_parts WHERE drone_id = ? AND category = ? AND position = ?')
      .get(drone.id, category, position) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare('UPDATE drone_parts SET component_model = ?, status = ?, installed_at = ? WHERE id = ?')
        .run(componentModel, status, installedAt, existing.id);
      return this.getPart(existing.id)!;
    }

    const id = `part-${randomUUID()}`;
    this.db
      .prepare(
        'INSERT INTO drone_parts(id, drone_id, category, position, component_model, status, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, drone.id, category, position, componentModel, status, installedAt);
    return this.getPart(id)!;
  }

  getPart(id: string): DronePartRecord | undefined {
    const row = this.db.prepare('SELECT * FROM drone_parts WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return row ? mapPart(row) : undefined;
  }

  listParts(droneIdOrName: string): DronePartRecord[] {
    const drone = this.getDrone(droneIdOrName) ?? this.getDroneByName(droneIdOrName);
    if (!drone) return [];
    const rows = this.db
      .prepare('SELECT * FROM drone_parts WHERE drone_id = ? ORDER BY category ASC, position ASC')
      .all(drone.id) as Array<Record<string, unknown>>;
    return rows.map(mapPart);
  }

  upsertSpare(input: {
    componentModel: string;
    category: string;
    newCount: number;
    usedCount: number;
    notes?: string;
    updatedAt?: string;
  }): SpareRecord {
    const model = input.componentModel.trim();
    const category = input.category.trim().toLowerCase();
    if (!model || !category) throw new Error('componentModel and category are required.');
    if (!Number.isInteger(input.newCount) || input.newCount < 0) {
      throw new Error('newCount must be a non-negative integer.');
    }
    if (!Number.isInteger(input.usedCount) || input.usedCount < 0) {
      throw new Error('usedCount must be a non-negative integer.');
    }
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const existing = this.getSpare(model);
    if (existing) {
      this.db
        .prepare(
          'UPDATE spares SET category = ?, new_count = ?, used_count = ?, notes = ?, updated_at = ? WHERE id = ?',
        )
        .run(category, input.newCount, input.usedCount, input.notes?.trim() ?? null, updatedAt, existing.id);
      return this.getSpare(model)!;
    }
    const id = `spare-${randomUUID()}`;
    this.db
      .prepare(
        'INSERT INTO spares(id, component_model, category, new_count, used_count, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, model, category, input.newCount, input.usedCount, input.notes?.trim() ?? null, updatedAt);
    return this.getSpare(model)!;
  }

  adjustSpare(
    componentModel: string,
    delta: { newDelta?: number; usedDelta?: number },
    updatedAt = new Date().toISOString(),
  ): SpareRecord {
    const existing = this.getSpare(componentModel);
    if (!existing) throw new Error(`Spare not found: ${componentModel}`);
    const nextNew = existing.newCount + (delta.newDelta ?? 0);
    const nextUsed = existing.usedCount + (delta.usedDelta ?? 0);
    if (nextNew < 0 || nextUsed < 0) {
      throw new Error(`Spare count for "${componentModel}" cannot go below zero.`);
    }
    this.db
      .prepare('UPDATE spares SET new_count = ?, used_count = ?, updated_at = ? WHERE id = ?')
      .run(nextNew, nextUsed, updatedAt, existing.id);
    return this.getSpare(componentModel)!;
  }

  getSpare(componentModel: string): SpareRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM spares WHERE lower(component_model) = lower(?)')
      .get(componentModel.trim()) as Record<string, unknown> | undefined;
    return row ? mapSpare(row) : undefined;
  }

  listSpares(category?: string): SpareRecord[] {
    const rows = (
      category
        ? this.db
            .prepare('SELECT * FROM spares WHERE lower(category) = lower(?) ORDER BY component_model ASC')
            .all(category.trim())
        : this.db.prepare('SELECT * FROM spares ORDER BY category ASC, component_model ASC').all()
    ) as Array<Record<string, unknown>>;
    return rows.map(mapSpare);
  }

  recordCrash(input: {
    droneName: string;
    category: string;
    position: string;
    damage: string;
    spareUsed?: 'new' | 'used';
    crashedAt?: string;
  }): CrashRecord {
    const drone = this.getDroneByName(input.droneName);
    if (!drone) throw new Error(`Drone not found: ${input.droneName}`);
    const category = normalizePartCategory(input.category);
    const position = normalizePosition(input.position);
    const damage = input.damage.trim();
    const crashedAt = input.crashedAt ?? new Date().toISOString();
    if (!category || !position || !damage || damage.length > 500) {
      throw new Error('Crash category, position, and damage (up to 500 characters) are required.');
    }
    if (!Number.isFinite(Date.parse(crashedAt))) throw new Error('crashedAt must be a valid timestamp.');
    if (input.spareUsed !== undefined && input.spareUsed !== 'new' && input.spareUsed !== 'used') {
      throw new Error('spareUsed must be "new" or "used".');
    }

    const part = this.listParts(drone.id).find(
      (candidate) => candidate.category === category && candidate.position === position,
    );
    if (input.spareUsed !== undefined) {
      if (!part) throw new Error(`Part not found for ${drone.name}: ${category} (${position}); no spare was counted.`);
      if (!this.getSpare(part.componentModel)) {
        throw new Error(`Spare not found for ${part.componentModel}; no crash was recorded.`);
      }
    }

    const id = `crash-${randomUUID()}`;
    return transaction(this.db, () => {
      if (part) this.db.prepare('UPDATE drone_parts SET status = ? WHERE id = ?').run('damaged', part.id);
      if (part && input.spareUsed) {
        this.adjustSpare(
          part.componentModel,
          input.spareUsed === 'new' ? { newDelta: -1 } : { usedDelta: -1 },
          crashedAt,
        );
      }
      this.db
        .prepare(
          `INSERT INTO drone_crashes(
            id, drone_id, part_id, category, position, component_model, damage, spare_used, crashed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          drone.id,
          part?.id ?? null,
          category,
          position,
          part?.componentModel ?? null,
          damage,
          input.spareUsed ?? null,
          crashedAt,
        );
      const row = this.db.prepare('SELECT * FROM drone_crashes WHERE id = ?').get(id) as
        Record<string, unknown> | undefined;
      if (!row) throw new Error('Crash record was not persisted.');
      return mapCrash(row);
    });
  }

  getCrash(id: string): CrashRecord | undefined {
    const row = this.db.prepare('SELECT * FROM drone_crashes WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return row ? mapCrash(row) : undefined;
  }

  listCrashes(filter: { droneName?: string; category?: string; position?: string } = {}): CrashRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.droneName) {
      const drone = this.getDroneByName(filter.droneName);
      if (!drone) return [];
      clauses.push('drone_id = ?');
      params.push(drone.id);
    }
    if (filter.category) {
      clauses.push('lower(category) = lower(?)');
      params.push(normalizePartCategory(filter.category));
    }
    if (filter.position) {
      clauses.push('lower(position) = lower(?)');
      params.push(normalizePosition(filter.position));
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM drone_crashes ${where} ORDER BY crashed_at DESC, rowid DESC`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map(mapCrash);
  }

  lastCrashForPart(category?: string, position?: string, droneName?: string): CrashRecord | undefined {
    return this.listCrashes({ category, position, droneName })[0];
  }
}

function mapCrash(row: Record<string, unknown>): CrashRecord {
  return {
    id: String(row.id),
    droneId: String(row.drone_id),
    ...(row.part_id !== null && row.part_id !== undefined ? { partId: String(row.part_id) } : {}),
    category: String(row.category),
    position: String(row.position),
    ...(row.component_model !== null && row.component_model !== undefined
      ? { componentModel: String(row.component_model) }
      : {}),
    damage: String(row.damage),
    ...(row.spare_used !== null && row.spare_used !== undefined
      ? { spareUsed: String(row.spare_used) as 'new' | 'used' }
      : {}),
    crashedAt: String(row.crashed_at),
  };
}

function normalizePartCategory(raw: string): string {
  const token = raw.trim().toLowerCase();
  if (token === 'motore' || token === 'motor') return 'motor';
  if (token === 'braccio' || token === 'arm') return 'arm';
  if (token === 'elica' || token === 'prop' || token === 'propeller') return 'prop';
  return token;
}

function normalizePosition(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/sinistr[oa]\s+inferiore|posteriore\s+sinistr[oa]|rear[- ]?left|bottom[- ]?left/.test(value)) return 'rear-left';
  if (/destr[oa]\s+inferiore|posteriore\s+destr[oa]|rear[- ]?right|bottom[- ]?right/.test(value)) return 'rear-right';
  if (/sinistr[oa]\s+superiore|anteriore\s+sinistr[oa]|front[- ]?left|top[- ]?left/.test(value)) return 'front-left';
  if (/destr[oa]\s+superiore|anteriore\s+destr[oa]|front[- ]?right|top[- ]?right/.test(value)) return 'front-right';
  return value;
}

export function handleFleetChat(
  fleet: FleetStore,
  batteries: BatteryRegistry,
  phrase: string,
  now = new Date().toISOString(),
): { handled: boolean; reply?: string } {
  const trimmed = phrase.trim();
  if (!trimmed || trimmed.length > 500) throw new Error('Fleet chat phrase must contain 1–500 characters.');

  const crashMatch =
    trimmed.match(
      /^(?:ho\s+crashato|crashed)\s+([a-zA-Z0-9_-]+)\s*[,:-]\s*(motore|motor|braccio|arm|elica|prop|fc|esc|vtx|camera)\s+(.+?)\s+(rotto|rotta|broken|damaged)(?:[,\s]*\(?\s*(?:scorta|spare)\s+(nuova|usata|new|used)\)?)?[.!?]*$/i,
    ) ??
    trimmed.match(
      /^(?:ho\s+crashato|crashed)\s+([a-zA-Z0-9_-]+)\s*[,:-]\s*(rear[- ]?left|rear[- ]?right|front[- ]?left|front[- ]?right|bottom[- ]?left|bottom[- ]?right|top[- ]?left|top[- ]?right)\s+(motore|motor|braccio|arm|elica|prop|fc|esc|vtx|camera)\s+(rotto|rotta|broken|damaged)(?:[,\s]*\(?\s*(?:scorta|spare)\s+(nuova|usata|new|used)\)?)?[.!?]*$/i,
    );
  if (crashMatch) {
    const positionFirst = /^(rear|front|bottom|top)/i.test(crashMatch[2]!);
    const droneName = crashMatch[1]!;
    const category = normalizePartCategory(positionFirst ? crashMatch[3]! : crashMatch[2]!);
    const position = normalizePosition(positionFirst ? crashMatch[2]! : crashMatch[3]!);
    const damage = crashMatch[4]!.toLowerCase();
    const rawSpare = crashMatch[5]?.toLowerCase();
    const spareUsed = rawSpare === 'nuova' || rawSpare === 'new' ? 'new' : rawSpare ? 'used' : undefined;
    const crash = fleet.recordCrash({ droneName, category, position, damage, spareUsed, crashedAt: now });
    return {
      handled: true,
      reply: `Recorded crash for ${droneName}: ${crash.category} (${crash.position}) ${crash.damage}${crash.componentModel ? ` [${crash.componentModel}]` : ''}${spareUsed ? `, used ${spareUsed} spare` : ''}.`,
    };
  }

  if (/(ultima\s+volta|last\s+time).*(rotto|rotta|broke|broken)|quale\s+avevo\s+rotto/i.test(trimmed)) {
    const last = fleet.lastCrashForPart();
    if (!last) return { handled: true, reply: 'No previous crashes recorded.' };
    const drone = fleet.getDrone(last.droneId)?.name ?? last.droneId;
    return {
      handled: true,
      reply: `Last crash: ${drone} ${last.category} (${last.position})${last.componentModel ? ` [${last.componentModel}]` : ''} on ${last.crashedAt}.`,
    };
  }

  if (/(scorta|scorte|spares?\s+left|rimasti|remaining\s+spares)/i.test(trimmed)) {
    const spares = fleet.listSpares();
    if (spares.length === 0) return { handled: true, reply: 'No spares recorded.' };
    const lines = spares.map(
      (spare) => `${spare.componentModel} (${spare.category}): ${spare.newCount} new, ${spare.usedCount} used`,
    );
    return { handled: true, reply: `Spares left: ${lines.join('; ')}.` };
  }

  const batteryMatch = trimmed.match(
    /^(?:la\s+)?(?:batteria|battery)\s+(\d+)(?:\s+([\p{L}-]+))?\s+(?:presenta\s+danni|ha\s+danni|has\s+damage|damaged)(.*)$/iu,
  );
  if (batteryMatch) {
    const packNumber = Number(batteryMatch[1]);
    const series = batteryMatch[2];
    const matches = batteries.findByNumberAndSeries(packNumber, series);
    if (matches.length === 0) {
      return { handled: true, reply: `Battery #${packNumber}${series ? ` (${series})` : ''} not found.` };
    }
    if (matches.length > 1) {
      return { handled: true, reply: `Battery #${packNumber} is ambiguous; specify its series or colour.` };
    }
    const battery = matches[0];
    if (!battery) throw new Error('Battery lookup returned no result.');
    const saved = batteries.addNote(battery.id, trimmed, now);
    return { handled: true, reply: `Recorded damage note on ${battery.label}: "${saved.note}".` };
  }

  return { handled: false };
}

function mapDrone(row: Record<string, unknown>): DroneRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    ...(row.frame !== null && row.frame !== undefined ? { frame: String(row.frame) } : {}),
    ...(row.notes !== null && row.notes !== undefined ? { notes: String(row.notes) } : {}),
    createdAt: String(row.created_at),
  };
}

function mapPart(row: Record<string, unknown>): DronePartRecord {
  return {
    id: String(row.id),
    droneId: String(row.drone_id),
    category: String(row.category),
    position: String(row.position),
    componentModel: String(row.component_model),
    status: String(row.status) as PartStatus,
    installedAt: String(row.installed_at),
  };
}

function mapSpare(row: Record<string, unknown>): SpareRecord {
  return {
    id: String(row.id),
    componentModel: String(row.component_model),
    category: String(row.category),
    newCount: Number(row.new_count),
    usedCount: Number(row.used_count),
    ...(row.notes !== null && row.notes !== undefined ? { notes: String(row.notes) } : {}),
    updatedAt: String(row.updated_at),
  };
}
