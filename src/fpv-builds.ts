import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './sqlite-transaction.ts';

export const FPV_BUILDS_SCHEMA = `
CREATE TABLE IF NOT EXISTS fpv_builds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  source_ref TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  shareable INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fpv_build_components (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES fpv_builds(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  model TEXT NOT NULL,
  normalized_model TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS fpv_build_wiring (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES fpv_builds(id) ON DELETE CASCADE,
  from_component TEXT NOT NULL,
  from_pad TEXT NOT NULL,
  to_component TEXT NOT NULL,
  to_pad TEXT NOT NULL,
  uart TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS fpv_manufacturer_docs (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  normalized_model TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  pinout_json TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
`;

export interface BuildComponentInput {
  role: string;
  model: string;
  sourceRef?: string;
  notes?: string;
}

export interface BuildWiringInput {
  fromComponent: string;
  fromPad: string;
  toComponent: string;
  toPad: string;
  uart?: string;
  sourceRef?: string;
  verified?: boolean;
  notes?: string;
}

export interface PinoutEntry {
  pad: string;
  signal: 'tx' | 'rx' | 'power_5v' | 'power_vbat' | 'gnd' | 'boot' | 'sbus' | 'video' | 'other';
  uart?: string;
  notes?: string;
}

export interface WiringAnswer {
  known: boolean;
  connections: {
    fromComponent: string;
    fromPad: string;
    toComponent: string;
    toPad: string;
    uart?: string;
    citation: string;
  }[];
  citations: string[];
  reason: string;
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Local FPV build notes, component lists, and cited manufacturer pinout documents (F-099-T03).
 * Every wiring answer cites its saved build note or manufacturer document; unknown or illegible wiring refuses to guess.
 */
export class FpvBuildStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  importBuild(
    input: {
      name: string;
      sourceRef: string;
      notes?: string;
      components: BuildComponentInput[];
      wiring?: BuildWiringInput[];
    },
    now = new Date(),
  ): { buildId: string; name: string; shareable: false; componentCount: number; wiringCount: number } {
    const cleanName = input.name.trim();
    const cleanSource = input.sourceRef.trim();
    if (!cleanName) throw new Error('Build name is required.');
    if (!cleanSource) throw new Error('Build sourceRef is required.');
    if (!Array.isArray(input.components) || input.components.length === 0) {
      throw new Error('At least one build component is required.');
    }
    const nowIso = now.toISOString();
    const nName = norm(cleanName);

    return transaction(this.db, () => {
      const existing = this.db.prepare('SELECT id FROM fpv_builds WHERE normalized_name = ?').get(nName) as
        { id: string } | undefined;
      const buildId = existing?.id ?? `bld_${randomUUID()}`;
      if (existing) {
        this.db
          .prepare('UPDATE fpv_builds SET name = ?, source_ref = ?, notes = ?, updated = ? WHERE id = ?')
          .run(cleanName, cleanSource, (input.notes ?? '').trim(), nowIso, buildId);
        this.db.prepare('DELETE FROM fpv_build_components WHERE build_id = ?').run(buildId);
        this.db.prepare('DELETE FROM fpv_build_wiring WHERE build_id = ?').run(buildId);
      } else {
        this.db
          .prepare(
            'INSERT INTO fpv_builds (id, name, normalized_name, source_ref, notes, shareable, created, updated) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
          )
          .run(buildId, cleanName, nName, cleanSource, (input.notes ?? '').trim(), nowIso, nowIso);
      }

      for (const comp of input.components) {
        const model = comp.model.trim();
        const role = comp.role.trim();
        if (!model || !role) throw new Error('Component role and model are required.');
        this.db
          .prepare(
            'INSERT INTO fpv_build_components (id, build_id, role, model, normalized_model, source_ref, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            `cmp_${randomUUID()}`,
            buildId,
            role,
            model,
            norm(model),
            (comp.sourceRef ?? cleanSource).trim(),
            (comp.notes ?? '').trim(),
          );
      }

      const wiring = input.wiring ?? [];
      for (const w of wiring) {
        this.db
          .prepare(
            'INSERT INTO fpv_build_wiring (id, build_id, from_component, from_pad, to_component, to_pad, uart, source_ref, verified, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            `wir_${randomUUID()}`,
            buildId,
            w.fromComponent.trim(),
            w.fromPad.trim(),
            w.toComponent.trim(),
            w.toPad.trim(),
            (w.uart ?? '').trim(),
            (w.sourceRef ?? cleanSource).trim(),
            w.verified === false ? 0 : 1,
            (w.notes ?? '').trim(),
          );
      }

      return {
        buildId,
        name: cleanName,
        shareable: false,
        componentCount: input.components.length,
        wiringCount: wiring.length,
      };
    });
  }

  registerManufacturerDoc(
    input: { model: string; title: string; sourceRef: string; pinouts: PinoutEntry[] },
    now = new Date(),
  ): { docId: string; model: string; sourceRef: string } {
    const model = input.model.trim();
    const title = input.title.trim();
    const sourceRef = input.sourceRef.trim();
    if (!model || !title || !sourceRef) throw new Error('model, title, and sourceRef are required.');
    const nowIso = now.toISOString();
    const nModel = norm(model);
    const pinoutJson = JSON.stringify(input.pinouts);
    return transaction(this.db, () => {
      const existing = this.db
        .prepare('SELECT id FROM fpv_manufacturer_docs WHERE normalized_model = ?')
        .get(nModel) as { id: string } | undefined;
      const docId = existing?.id ?? `doc_${randomUUID()}`;
      if (existing) {
        this.db
          .prepare(
            'UPDATE fpv_manufacturer_docs SET model = ?, title = ?, source_ref = ?, pinout_json = ?, updated = ? WHERE id = ?',
          )
          .run(model, title, sourceRef, pinoutJson, nowIso, docId);
      } else {
        this.db
          .prepare(
            'INSERT INTO fpv_manufacturer_docs (id, model, normalized_model, title, source_ref, pinout_json, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(docId, model, nModel, title, sourceRef, pinoutJson, nowIso, nowIso);
      }
      return { docId, model, sourceRef };
    });
  }

  listBuilds(): { id: string; name: string; sourceRef: string; shareable: boolean }[] {
    const rows = this.db
      .prepare('SELECT id, name, source_ref, shareable FROM fpv_builds ORDER BY updated DESC, name ASC')
      .all() as { id: string; name: string; source_ref: string; shareable: number }[];
    return rows.map((r) => ({ id: r.id, name: r.name, sourceRef: r.source_ref, shareable: r.shareable === 1 }));
  }

  answerWiring(query: { buildName?: string; fromModel: string; toModel: string }): WiringAnswer {
    const fromNorm = norm(query.fromModel);
    const toNorm = norm(query.toModel);
    if (!fromNorm || !toNorm) {
      return { known: false, connections: [], citations: [], reason: 'Unknown: both component models are required.' };
    }

    if (query.buildName) {
      const build = this.db
        .prepare('SELECT id, name, source_ref FROM fpv_builds WHERE normalized_name = ?')
        .get(norm(query.buildName)) as { id: string; name: string; source_ref: string } | undefined;
      if (build) {
        const rows = this.db
          .prepare(
            'SELECT from_component, from_pad, to_component, to_pad, uart, source_ref, verified FROM fpv_build_wiring WHERE build_id = ?',
          )
          .all(build.id) as {
          from_component: string;
          from_pad: string;
          to_component: string;
          to_pad: string;
          uart: string;
          source_ref: string;
          verified: number;
        }[];
        const matching = rows.filter(
          (r) =>
            (norm(r.from_component).includes(fromNorm) && norm(r.to_component).includes(toNorm)) ||
            (norm(r.from_component).includes(toNorm) && norm(r.to_component).includes(fromNorm)),
        );
        if (matching.length > 0) {
          if (matching.some((m) => m.verified === 0)) {
            const cites = [...new Set(matching.map((m) => m.source_ref))];
            return {
              known: false,
              connections: [],
              citations: cites,
              reason: `Unknown: wiring in ${build.name} is marked unverified/illegible (${cites.join(', ')}); confirm pad labels before connecting.`,
            };
          }
          const citations = [...new Set(matching.map((m) => m.source_ref))];
          return {
            known: true,
            connections: matching.map((m) => ({
              fromComponent: m.from_component,
              fromPad: m.from_pad,
              toComponent: m.to_component,
              toPad: m.to_pad,
              ...(m.uart ? { uart: m.uart } : {}),
              citation: m.source_ref,
            })),
            citations,
            reason: `Answered from saved build ${build.name} (${citations.join(', ')}).`,
          };
        }
      }
    }

    const fromDoc = this.db
      .prepare('SELECT model, title, source_ref, pinout_json FROM fpv_manufacturer_docs WHERE normalized_model = ?')
      .get(fromNorm) as { model: string; title: string; source_ref: string; pinout_json: string } | undefined;
    const toDoc = this.db
      .prepare('SELECT model, title, source_ref, pinout_json FROM fpv_manufacturer_docs WHERE normalized_model = ?')
      .get(toNorm) as { model: string; title: string; source_ref: string; pinout_json: string } | undefined;

    if (!fromDoc || !toDoc) {
      const present = [fromDoc?.source_ref, toDoc?.source_ref].filter((x): x is string => Boolean(x));
      const missing = [!fromDoc ? query.fromModel : null, !toDoc ? query.toModel : null].filter(Boolean);
      return {
        known: false,
        connections: [],
        citations: present,
        reason: `Unknown: missing cited build wiring or manufacturer documentation for ${missing.join(', ')}.`,
      };
    }

    const fromPins = JSON.parse(fromDoc.pinout_json) as PinoutEntry[];
    const toPins = JSON.parse(toDoc.pinout_json) as PinoutEntry[];
    const citations = [fromDoc.source_ref, toDoc.source_ref];
    const connections: WiringAnswer['connections'] = [];

    const pair = (fromSignal: PinoutEntry['signal'], toSignal: PinoutEntry['signal']) => {
      const a = fromPins.find((p) => p.signal === fromSignal);
      const b = toPins.find((p) => p.signal === toSignal);
      if (a && b) {
        connections.push({
          fromComponent: fromDoc.model,
          fromPad: a.pad,
          toComponent: toDoc.model,
          toPad: b.pad,
          ...(a.uart || b.uart ? { uart: a.uart ?? b.uart } : {}),
          citation: `${fromDoc.source_ref} + ${toDoc.source_ref}`,
        });
      }
    };

    pair('tx', 'rx');
    pair('rx', 'tx');
    pair('power_5v', 'power_5v');
    pair('gnd', 'gnd');

    if (connections.length === 0) {
      return {
        known: false,
        connections: [],
        citations,
        reason: `Unknown: cited manufacturer docs (${citations.join(', ')}) do not establish matching UART/power pads.`,
      };
    }

    return {
      known: true,
      connections,
      citations,
      reason: `Answered from cited manufacturer documents (${citations.join(', ')}).`,
    };
  }
}
