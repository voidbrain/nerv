import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

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
