import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { BatteryRegistry } from './batteries.ts';
import { transaction } from './sqlite-transaction.ts';

/**
 * F-098-T06: one installed (or damaged) part per slot; replaced parts stay as `removed` rows, so the
 * slot is unique only among parts that are not removed (partial index, not a table constraint).
 */
function dronePartsTable(name: string): string {
  return `CREATE TABLE IF NOT EXISTS ${name}(
  id TEXT PRIMARY KEY,
  drone_id TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  position TEXT NOT NULL,
  component_model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'installed',
  installed_at TEXT NOT NULL
);`;
}

export const FLEET_SCHEMA = `
CREATE TABLE IF NOT EXISTS drones(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  frame TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
${dronePartsTable('drone_parts')}
CREATE INDEX IF NOT EXISTS drone_parts_drone_idx ON drone_parts(drone_id);
CREATE UNIQUE INDEX IF NOT EXISTS drone_parts_slot_idx ON drone_parts(drone_id, category, position) WHERE status <> 'removed';
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

/** F-098-T05: one part line of a fleet import file; `positions` expands to one slot each, else "main". */
export interface FleetImportPart {
  category: string;
  model: string;
  positions?: string[];
}

export interface FleetImportDrone {
  name: string;
  frame?: string;
  notes?: string;
  parts: FleetImportPart[];
}

/** F-098-T05: `{ "version": 1, "drones": [ { name, frame?, notes?, parts: [ { category, model, positions? } ] } ] }`. */
export interface FleetImportFile {
  version: 1;
  drones: FleetImportDrone[];
}

export interface FleetImportReport {
  drones: { created: string[]; present: string[] };
  parts: { created: number; present: number };
  spares: { created: string[]; present: string[] };
}

const DEFAULT_PART_POSITION = 'main';

/** F-098-T06: part categories the fleet knows, after normalisation (Italian and English words map onto these). */
export const PART_CATEGORIES: readonly string[] = [
  'frame',
  'motor',
  'prop',
  'arm',
  'fc',
  'esc',
  'vtx',
  'camera',
  'rx',
  'antenna',
  'gps',
];

const QUAD_POSITIONS: readonly string[] = ['front-left', 'front-right', 'rear-left', 'rear-right'];

/** F-098-T06: the slots a category fills on a quad: motors, props and arms at the four corners, the rest once. */
export function defaultPartPositions(category: string): readonly string[] {
  const normalized = normalizePartCategory(category);
  return normalized === 'motor' || normalized === 'prop' || normalized === 'arm'
    ? QUAD_POSITIONS
    : [DEFAULT_PART_POSITION];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${where}: unknown field "${key}".`);
  }
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${where} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${where} must be a string when present.`);
  return value.trim() || undefined;
}

/**
 * F-098-T05: validate a fleet import file strictly. Every error names the offending field
 * (for example `drones[0].parts[1].model`); unknown fields are rejected.
 */
export function parseFleetImport(raw: unknown): FleetImportFile {
  if (!isPlainObject(raw)) throw new Error('The fleet file must be a JSON object.');
  rejectUnknownFields(raw, ['version', 'drones'], 'fleet file');
  if (raw.version !== 1) throw new Error('version must be 1.');
  if (!Array.isArray(raw.drones)) throw new Error('drones must be an array.');
  const seenNames = new Set<string>();
  const drones = raw.drones.map((rawDrone, d): FleetImportDrone => {
    const where = `drones[${d}]`;
    if (!isPlainObject(rawDrone)) throw new Error(`${where} must be an object.`);
    rejectUnknownFields(rawDrone, ['name', 'frame', 'notes', 'parts'], where);
    const name = requiredString(rawDrone.name, `${where}.name`);
    if (seenNames.has(name.toLowerCase())) throw new Error(`${where}.name: duplicate drone "${name}".`);
    seenNames.add(name.toLowerCase());
    const frame = optionalString(rawDrone.frame, `${where}.frame`);
    const notes = optionalString(rawDrone.notes, `${where}.notes`);
    if (!Array.isArray(rawDrone.parts)) throw new Error(`${where}.parts must be an array.`);
    const slots = new Set<string>();
    const parts = rawDrone.parts.map((rawPart, p): FleetImportPart => {
      const partWhere = `${where}.parts[${p}]`;
      if (!isPlainObject(rawPart)) throw new Error(`${partWhere} must be an object.`);
      rejectUnknownFields(rawPart, ['category', 'model', 'positions'], partWhere);
      const category = requiredString(rawPart.category, `${partWhere}.category`);
      const model = requiredString(rawPart.model, `${partWhere}.model`);
      let positions: string[] | undefined;
      if (rawPart.positions !== undefined) {
        if (!Array.isArray(rawPart.positions) || rawPart.positions.length === 0) {
          throw new Error(`${partWhere}.positions must be a non-empty array of strings.`);
        }
        positions = rawPart.positions.map((position, i) => requiredString(position, `${partWhere}.positions[${i}]`));
      }
      for (const position of positions ?? [DEFAULT_PART_POSITION]) {
        const slot = `${normalizePartCategory(category)}/${normalizePosition(position)}`;
        if (slots.has(slot)) throw new Error(`${partWhere}: duplicate slot ${slot}.`);
        slots.add(slot);
      }
      return { category, model, ...(positions ? { positions } : {}) };
    });
    return { name, ...(frame ? { frame } : {}), ...(notes ? { notes } : {}), parts };
  });
  return { version: 1, drones };
}

/**
 * F-098-T01: Local FPV fleet & spares store (drones by name, parts by position + component model,
 * and spares inventory with separate new and used counts).
 */
export class FleetStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.migrateSlotConstraint();
    this.db.exec(FLEET_SCHEMA);
  }

  /**
   * F-098-T06: databases created before part replacement had UNIQUE(drone_id, category, position) on the
   * table, which forbids keeping a removed part in its old slot. Rebuild the table once, keeping every
   * row and id (crash links stay), and rewrite stored categories and positions through the shared
   * normalisers so old raw values ("motors", "front left") meet the canonical slot. Foreign keys must be
   * off while the old table is dropped, or ON DELETE SET NULL would clear crash links; SQLite ignores that
   * pragma inside a transaction, so the rebuild refuses to run in one and checks the switch took.
   */
  private migrateSlotConstraint(): void {
    const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'drone_parts'").get() as
      { sql: string } | undefined;
    if (!row || !/UNIQUE\s*\(\s*drone_id\s*,\s*category\s*,\s*position\s*\)/i.test(row.sql)) return;
    if (this.db.isTransaction) {
      throw new Error('The drone_parts rebuild cannot run inside an open transaction (foreign keys stay on there).');
    }
    const foreignKeysOn = () =>
      (this.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys === 1;
    const restore = foreignKeysOn();
    this.db.exec('PRAGMA foreign_keys = OFF');
    try {
      if (foreignKeysOn())
        throw new Error('Foreign keys could not be switched off; the drone_parts rebuild did not run.');
      transaction(this.db, () => {
        this.db.exec(`DROP TABLE IF EXISTS drone_parts_next;
${dronePartsTable('drone_parts_next')}
INSERT INTO drone_parts_next(id, drone_id, category, position, component_model, status, installed_at)
  SELECT id, drone_id, category, position, component_model, status, installed_at FROM drone_parts;`);
        const rows = this.db.prepare('SELECT id, category, position FROM drone_parts_next').all() as Array<{
          id: string;
          category: string;
          position: string;
        }>;
        const update = this.db.prepare('UPDATE drone_parts_next SET category = ?, position = ? WHERE id = ?');
        for (const part of rows) {
          update.run(normalizePartCategory(part.category), normalizePosition(part.position), part.id);
        }
        const clash = this.db
          .prepare(
            `SELECT d.name AS drone, p.category, p.position FROM drone_parts_next p JOIN drones d ON d.id = p.drone_id
             WHERE p.status <> 'removed' GROUP BY p.drone_id, p.category, p.position HAVING count(*) > 1 LIMIT 1`,
          )
          .get() as { drone: string; category: string; position: string } | undefined;
        if (clash) {
          throw new Error(
            `The drone_parts rebuild stopped: ${clash.drone} has two current ${clash.category} parts at ${clash.position} once positions are normalised. Mark one removed, then restart.`,
          );
        }
        this.db.exec(`DROP TABLE drone_parts;
ALTER TABLE drone_parts_next RENAME TO drone_parts;`);
        // Scoped to the tables the swap touches, so an unrelated table's old violation cannot block it.
        const broken = [
          ...this.db.prepare('PRAGMA foreign_key_check(drone_parts)').all(),
          ...(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'drone_crashes'").get()
            ? this.db.prepare('PRAGMA foreign_key_check(drone_crashes)').all()
            : []),
        ];
        if (broken.length) {
          throw new Error(`The drone_parts rebuild stopped: ${broken.length} foreign key violation(s) after the swap.`);
        }
      });
    } finally {
      if (restore) this.db.exec('PRAGMA foreign_keys = ON');
    }
  }

  /** The part currently in a slot (installed or damaged); removed parts are history. */
  private currentPart(droneId: string, category: string, position: string): DronePartRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM drone_parts WHERE drone_id = ? AND category = ? AND position = ? AND status <> 'removed'")
      .get(droneId, category, position) as Record<string, unknown> | undefined;
    return row ? mapPart(row) : undefined;
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
    const category = normalizePartCategory(input.category);
    const position = normalizePosition(input.position);
    const componentModel = input.componentModel.trim();
    if (!category || !position || !componentModel) {
      throw new Error('Part category, position, and componentModel are required.');
    }
    const status: PartStatus = input.status ?? 'installed';
    const installedAt = input.installedAt ?? new Date().toISOString();
    const existing = this.currentPart(drone.id, category, position);

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
    const category = normalizePartCategory(input.category);
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

  /**
   * F-098-T06: spares a chat phrase names, e.g. "XING2" for "XING2 2207 1750KV". An exact model wins;
   * otherwise every model containing the words, in that category when one is given. More than one is
   * ambiguous: the caller asks which.
   */
  findSpares(query: string, category?: string): SpareRecord[] {
    const needle = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!needle) return [];
    const wanted = category ? normalizePartCategory(category) : undefined;
    const candidates = this.listSpares().filter((spare) => !wanted || normalizePartCategory(spare.category) === wanted);
    const exact = candidates.filter((spare) => spare.componentModel.toLowerCase() === needle);
    if (exact.length) return exact;
    return candidates.filter((spare) => spare.componentModel.toLowerCase().includes(needle));
  }

  /** F-098-T06: set the new and/or used count of an existing spares record; the other count and notes stay. */
  setSpareCounts(
    componentModel: string,
    counts: { newCount?: number; usedCount?: number },
    updatedAt?: string,
  ): SpareRecord {
    const existing = this.getSpare(componentModel);
    if (!existing) throw new Error(`Spare not found: ${componentModel}`);
    return this.upsertSpare({
      componentModel: existing.componentModel,
      category: existing.category,
      newCount: counts.newCount ?? existing.newCount,
      usedCount: counts.usedCount ?? existing.usedCount,
      notes: existing.notes,
      updatedAt,
    });
  }

  /**
   * F-098-T06: replace the part in a slot: the current one (if any) is marked removed and kept as
   * history, the new one is installed, and a spares record at 0 new and 0 used is added for a new model.
   * Spare counts are not changed.
   */
  replacePart(input: {
    droneName: string;
    category: string;
    position: string;
    componentModel: string;
    replacedAt?: string;
  }): { removed?: DronePartRecord; installed: DronePartRecord; spareCreated: boolean } {
    const drone = this.getDroneByName(input.droneName);
    if (!drone) throw new Error(`Drone not found: ${input.droneName}`);
    const category = normalizePartCategory(input.category);
    const position = normalizePosition(input.position);
    const componentModel = input.componentModel.trim();
    if (!category || !position || !componentModel) {
      throw new Error('Part category, position, and componentModel are required.');
    }
    const replacedAt = input.replacedAt ?? new Date().toISOString();
    return transaction(this.db, () => {
      const current = this.currentPart(drone.id, category, position);
      if (current) this.db.prepare("UPDATE drone_parts SET status = 'removed' WHERE id = ?").run(current.id);
      const id = `part-${randomUUID()}`;
      this.db
        .prepare(
          'INSERT INTO drone_parts(id, drone_id, category, position, component_model, status, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, drone.id, category, position, componentModel, 'installed', replacedAt);
      const spareCreated = !this.getSpare(componentModel);
      if (spareCreated) {
        this.upsertSpare({ componentModel, category, newCount: 0, usedCount: 0, updatedAt: replacedAt });
      }
      return {
        ...(current ? { removed: this.getPart(current.id)! } : {}),
        installed: this.getPart(id)!,
        spareCreated,
      };
    });
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

    const part = this.currentPart(drone.id, category, position);
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

  /**
   * F-098-T05: load a whole fleet in one transaction. Missing drones and part slots are created;
   * an existing drone (by name) keeps its row and its parts; every distinct component model gets a
   * spares record at 0 new and 0 used unless one exists, whose counts are kept.
   */
  importFleet(file: FleetImportFile, now = new Date().toISOString()): FleetImportReport {
    const report: FleetImportReport = {
      drones: { created: [], present: [] },
      parts: { created: 0, present: 0 },
      spares: { created: [], present: [] },
    };
    // First occurrence of each model (case-insensitive, as getSpare matches) sets its spares category.
    const spareModels = new Map<string, { model: string; category: string }>();
    return transaction(this.db, () => {
      for (const input of file.drones) {
        let drone = this.getDroneByName(input.name);
        if (drone) {
          report.drones.present.push(drone.name);
        } else {
          drone = this.addDrone({ name: input.name, frame: input.frame, notes: input.notes, createdAt: now });
          report.drones.created.push(drone.name);
        }
        for (const part of input.parts) {
          const category = normalizePartCategory(part.category);
          const model = part.model.trim();
          if (!spareModels.has(model.toLowerCase())) spareModels.set(model.toLowerCase(), { model, category });
          for (const rawPosition of part.positions ?? [DEFAULT_PART_POSITION]) {
            const position = normalizePosition(rawPosition);
            if (this.currentPart(drone.id, category, position)) {
              report.parts.present += 1;
              continue;
            }
            this.db
              .prepare(
                'INSERT INTO drone_parts(id, drone_id, category, position, component_model, status, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              )
              .run(`part-${randomUUID()}`, drone.id, category, position, model, 'installed', now);
            report.parts.created += 1;
          }
        }
      }
      for (const { model, category } of spareModels.values()) {
        const existing = this.getSpare(model);
        if (existing) {
          report.spares.present.push(existing.componentModel);
        } else {
          this.upsertSpare({ componentModel: model, category, newCount: 0, usedCount: 0, updatedAt: now });
          report.spares.created.push(model);
        }
      }
      return report;
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

const CATEGORY_WORDS: Readonly<Record<string, string>> = {
  motore: 'motor',
  motori: 'motor',
  motors: 'motor',
  braccio: 'arm',
  bracci: 'arm',
  arms: 'arm',
  elica: 'prop',
  eliche: 'prop',
  props: 'prop',
  propeller: 'prop',
  propellers: 'prop',
  telaio: 'frame',
  telecamera: 'camera',
  ricevitore: 'rx',
  receiver: 'rx',
};

/** Italian and English part words (singular or plural) to one category; shared by the crash log, import and chat. */
export function normalizePartCategory(raw: string): string {
  const token = raw.trim().toLowerCase();
  return CATEGORY_WORDS[token] ?? token;
}

/** Italian and English corner words to front-left, front-right, rear-left, rear-right; shared by the crash log, import and chat. */
export function normalizePosition(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/sinistr[oa]\s+(?:inferiore|posteriore)|posteriore\s+sinistr[oa]|rear[- ]?left|bottom[- ]?left/.test(value)) {
    return 'rear-left';
  }
  if (/destr[oa]\s+(?:inferiore|posteriore)|posteriore\s+destr[oa]|rear[- ]?right|bottom[- ]?right/.test(value)) {
    return 'rear-right';
  }
  if (/sinistr[oa]\s+(?:superiore|anteriore)|anteriore\s+sinistr[oa]|front[- ]?left|top[- ]?left/.test(value)) {
    return 'front-left';
  }
  if (/destr[oa]\s+(?:superiore|anteriore)|anteriore\s+destr[oa]|front[- ]?right|top[- ]?right/.test(value)) {
    return 'front-right';
  }
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
