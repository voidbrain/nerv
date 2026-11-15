import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ftsQuery } from './memory.ts';
import { transaction } from './sqlite-transaction.ts';

/**
 * Saved documents with categories (F-083-T01): recipes and other owner documents persist by category,
 * local-only by default (`shareable = 0`), with verbatim body preservation and append-only edit/forget history.
 */
export const DOCUMENTS_SCHEMA = `
 CREATE TABLE IF NOT EXISTS saved_documents(
   id TEXT PRIMARY KEY,
   title TEXT NOT NULL,
   category TEXT NOT NULL,
   body TEXT NOT NULL,
   status TEXT NOT NULL,
   source TEXT NOT NULL,
   sortie_id TEXT,
   tainted INTEGER NOT NULL DEFAULT 0,
   shareable INTEGER NOT NULL DEFAULT 0,
   created TEXT NOT NULL,
   updated TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS saved_documents_category_status ON saved_documents(category, status);
 CREATE TABLE IF NOT EXISTS saved_document_history(
   sequence INTEGER PRIMARY KEY AUTOINCREMENT,
   document_id TEXT NOT NULL,
   kind TEXT NOT NULL,
   title TEXT NOT NULL,
   category TEXT NOT NULL,
   body TEXT NOT NULL,
   source TEXT NOT NULL,
   created TEXT NOT NULL
 );
 CREATE TRIGGER IF NOT EXISTS saved_document_history_no_update BEFORE UPDATE ON saved_document_history BEGIN SELECT RAISE(ABORT,'saved document history is append-only'); END;
 CREATE TRIGGER IF NOT EXISTS saved_document_history_no_delete BEFORE DELETE ON saved_document_history BEGIN SELECT RAISE(ABORT,'saved document history is append-only'); END;
 CREATE VIRTUAL TABLE IF NOT EXISTS saved_documents_fts USING fts5(title, category, body, document_id UNINDEXED);`;

export interface SavedDocument {
  id: string;
  title: string;
  category: string;
  body: string;
  status: 'active' | 'forgotten';
  source: string;
  sortieId: string | null;
  tainted: boolean;
  shareable: boolean;
  created: string;
  updated: string;
}

export interface DocumentHistoryEntry {
  sequence: number;
  documentId: string;
  kind: string;
  title: string;
  category: string;
  body: string;
  source: string;
  created: string;
}

const MAX_LABEL_CHARS = 120;
const MAX_BODY_CHARS = 50_000;

const cleanLabel = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_LABEL_CHARS) {
    throw new Error(`Document ${field} must be 1–${MAX_LABEL_CHARS} characters.`);
  }
  return value.trim().replace(/\s+/g, ' ');
};

const validateBody = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_BODY_CHARS) {
    throw new Error(`Document body must be 1–${MAX_BODY_CHARS} characters.`);
  }
  return value;
};

type DocumentRow = {
  id: string;
  title: string;
  category: string;
  body: string;
  status: SavedDocument['status'];
  source: string;
  sortie_id: string | null;
  tainted: number;
  shareable: number;
  created: string;
  updated: string;
};

const toDocument = (row: DocumentRow): SavedDocument => ({
  id: row.id,
  title: row.title,
  category: row.category,
  body: row.body,
  status: row.status,
  source: row.source,
  sortieId: row.sortie_id,
  tainted: row.tainted === 1,
  shareable: row.shareable === 1,
  created: row.created,
  updated: row.updated,
});

export class DocumentStore {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private tx<T>(fn: () => T): T {
    return transaction(this.db, fn);
  }

  private recordHistory(
    id: string,
    kind: string,
    title: string,
    category: string,
    body: string,
    source: string,
    now: string,
  ): void {
    this.db
      .prepare(
        'INSERT INTO saved_document_history(document_id,kind,title,category,body,source,created) VALUES(?,?,?,?,?,?,?)',
      )
      .run(id, kind, title, category, body, source, now);
  }

  save(input: {
    title: string;
    category: string;
    body: string;
    source?: string;
    sortieId?: string | null;
    tainted?: boolean;
    shareable?: boolean;
  }): SavedDocument {
    const title = cleanLabel(input.title, 'title');
    const category = cleanLabel(input.category, 'category');
    const body = validateBody(input.body);
    const source = input.source ?? 'owner';
    const tainted = input.tainted ? 1 : 0;
    const shareable = input.shareable ? 1 : 0;
    const now = new Date().toISOString();
    const id = randomUUID();

    return this.tx(() => {
      this.db
        .prepare(
          'INSERT INTO saved_documents(id,title,category,body,status,source,sortie_id,tainted,shareable,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(id, title, category, body, 'active', source, input.sortieId ?? null, tainted, shareable, now, now);
      this.db
        .prepare('INSERT INTO saved_documents_fts(title,category,body,document_id) VALUES(?,?,?,?)')
        .run(title, category, body, id);
      this.recordHistory(id, 'saved', title, category, body, source, now);
      return toDocument(this.db.prepare('SELECT * FROM saved_documents WHERE id=?').get(id) as DocumentRow);
    });
  }

  list(category?: string): SavedDocument[] {
    if (category !== undefined && category.trim()) {
      const cat = cleanLabel(category, 'category');
      const rows = this.db
        .prepare(
          "SELECT * FROM saved_documents WHERE status='active' AND LOWER(category)=LOWER(?) ORDER BY updated DESC, created DESC",
        )
        .all(cat) as DocumentRow[];
      return rows.map(toDocument);
    }
    const rows = this.db
      .prepare("SELECT * FROM saved_documents WHERE status='active' ORDER BY category ASC, updated DESC, created DESC")
      .all() as DocumentRow[];
    return rows.map(toDocument);
  }

  categories(): Array<{ category: string; count: number }> {
    return this.db
      .prepare(
        "SELECT category, COUNT(*) AS count FROM saved_documents WHERE status='active' GROUP BY LOWER(category) ORDER BY category ASC",
      )
      .all() as Array<{ category: string; count: number }>;
  }

  get(idOrTitle: string, category?: string): SavedDocument | undefined {
    const query = typeof idOrTitle === 'string' ? idOrTitle.trim() : '';
    if (!query) return undefined;
    const byId = this.db.prepare("SELECT * FROM saved_documents WHERE id=? AND status='active'").get(query) as
      DocumentRow | undefined;
    if (byId) return toDocument(byId);

    const title = cleanLabel(query, 'title');
    if (category !== undefined && category.trim()) {
      const cat = cleanLabel(category, 'category');
      const row = this.db
        .prepare(
          "SELECT * FROM saved_documents WHERE LOWER(title)=LOWER(?) AND LOWER(category)=LOWER(?) AND status='active' ORDER BY updated DESC LIMIT 1",
        )
        .get(title, cat) as DocumentRow | undefined;
      return row ? toDocument(row) : undefined;
    }
    const row = this.db
      .prepare(
        "SELECT * FROM saved_documents WHERE LOWER(title)=LOWER(?) AND status='active' ORDER BY updated DESC LIMIT 1",
      )
      .get(title) as DocumentRow | undefined;
    return row ? toDocument(row) : undefined;
  }

  recall(query: string, category?: string): SavedDocument[] {
    const fts = ftsQuery(query);
    if (!fts) return [];
    if (category !== undefined && category.trim()) {
      const cat = cleanLabel(category, 'category');
      const rows = this.db
        .prepare(
          `SELECT d.* FROM saved_documents_fts f
           JOIN saved_documents d ON d.id = f.document_id
           WHERE saved_documents_fts MATCH ? AND d.status = 'active' AND LOWER(d.category) = LOWER(?)
           ORDER BY bm25(saved_documents_fts), d.updated DESC
           LIMIT 20`,
        )
        .all(fts, cat) as DocumentRow[];
      return rows.map(toDocument);
    }
    const rows = this.db
      .prepare(
        `SELECT d.* FROM saved_documents_fts f
         JOIN saved_documents d ON d.id = f.document_id
         WHERE saved_documents_fts MATCH ? AND d.status = 'active'
         ORDER BY bm25(saved_documents_fts), d.updated DESC
         LIMIT 20`,
      )
      .all(fts) as DocumentRow[];
    return rows.map(toDocument);
  }

  edit(
    id: string,
    patch: { title?: string; category?: string; body?: string },
    source = 'owner',
  ): SavedDocument | undefined {
    const now = new Date().toISOString();
    return this.tx(() => {
      const existing = this.db.prepare("SELECT * FROM saved_documents WHERE id=? AND status='active'").get(id) as
        DocumentRow | undefined;
      if (!existing) return undefined;
      const title = patch.title !== undefined ? cleanLabel(patch.title, 'title') : existing.title;
      const category = patch.category !== undefined ? cleanLabel(patch.category, 'category') : existing.category;
      const body = patch.body !== undefined ? validateBody(patch.body) : existing.body;

      this.db
        .prepare('UPDATE saved_documents SET title=?, category=?, body=?, updated=? WHERE id=?')
        .run(title, category, body, now, id);
      this.db.prepare('DELETE FROM saved_documents_fts WHERE document_id=?').run(id);
      this.db
        .prepare('INSERT INTO saved_documents_fts(title,category,body,document_id) VALUES(?,?,?,?)')
        .run(title, category, body, id);
      this.recordHistory(id, 'edited', title, category, body, source, now);
      return toDocument(this.db.prepare('SELECT * FROM saved_documents WHERE id=?').get(id) as DocumentRow);
    });
  }

  forget(id: string, source = 'owner'): boolean {
    const now = new Date().toISOString();
    return this.tx(() => {
      const existing = this.db.prepare("SELECT * FROM saved_documents WHERE id=? AND status='active'").get(id) as
        DocumentRow | undefined;
      if (!existing) return false;
      this.db.prepare("UPDATE saved_documents SET status='forgotten', updated=? WHERE id=?").run(now, id);
      this.db.prepare('DELETE FROM saved_documents_fts WHERE document_id=?').run(id);
      this.recordHistory(id, 'forgotten', existing.title, existing.category, existing.body, source, now);
      return true;
    });
  }

  history(id: string): DocumentHistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM saved_document_history WHERE document_id=? ORDER BY sequence ASC')
      .all(id) as Array<{
      sequence: number;
      document_id: string;
      kind: string;
      title: string;
      category: string;
      body: string;
      source: string;
      created: string;
    }>;
    return rows.map((r) => ({
      sequence: r.sequence,
      documentId: r.document_id,
      kind: r.kind,
      title: r.title,
      category: r.category,
      body: r.body,
      source: r.source,
      created: r.created,
    }));
  }

  compute(idOrTitle: string, request: DocumentComputeRequest, category?: string): DocumentComputeResult {
    const doc = this.get(idOrTitle, category);
    if (!doc) {
      return {
        ok: false,
        status: 'missing',
        citedDocument: null,
        missing: [`document:${idOrTitle}`],
        question: `I could not find a saved document matching "${idOrTitle}". Which saved document should I use?`,
        results: [],
        working: [],
        answer: '',
      };
    }
    return computeFromSavedDocument(doc, request);
  }
}

export interface DocumentComputeRequest {
  baseIngredient?: string;
  targetQuantity?: number;
  targetUnit?: string;
  ingredient?: string;
  setting?: string;
}

export interface ComputedQuantity {
  name: string;
  savedQuantity: number;
  savedUnit: string;
  scaledQuantity: number;
  unit: string;
  arithmetic: string;
}

export interface DocumentComputeResult {
  ok: boolean;
  status: 'computed' | 'missing';
  citedDocument: { id: string; title: string; category: string } | null;
  missing: string[];
  question: string | null;
  results: ComputedQuantity[];
  working: string[];
  answer: string;
}

interface ParsedQuantityLine {
  name: string;
  quantity: number;
  unit: string;
}

interface ParsedSettingLine {
  key: string;
  value: string;
  raw: string;
}

const QTY_FIRST_RE = /^(?:[-*•]|\d+[.)])?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z%]+)?\s+([a-zA-Z0-9][a-zA-Z0-9\s-]{0,60})$/;
const NAME_FIRST_RE = /^(?:[-*•]|\d+[.)])?\s*([a-zA-Z0-9][a-zA-Z0-9\s-]{0,60}?)\s*:\s*(\d+(?:\.\d+)?)\s*([a-zA-Z%]+)?$/;
const SETTING_RE = /^(?:[-*•]|\d+[.)])?\s*([a-zA-Z0-9][a-zA-Z0-9\s-]{0,60}?)\s*:\s*(.+)$/;
const SETTING_UNITS = new Set([
  'c',
  'f',
  'min',
  'mins',
  'minute',
  'minutes',
  'h',
  'hr',
  'hrs',
  'hour',
  'hours',
  's',
  'sec',
  'secs',
]);
const SETTING_KEYS = new Set([
  'oven',
  'bake',
  'temp',
  'temperature',
  'time',
  'timer',
  'preheat',
  'speed',
  'power',
  'setting',
]);

const normalizeKey = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');
const roundClean = (value: number): number => Math.round(value * 1000) / 1000;

function parseDocumentQuantities(body: string): {
  quantities: ParsedQuantityLine[];
  settings: ParsedSettingLine[];
} {
  const quantities: ParsedQuantityLine[] = [];
  const settings: ParsedSettingLine[] = [];

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const nameFirst = NAME_FIRST_RE.exec(line);
    if (nameFirst) {
      const name = nameFirst[1].trim();
      const unit = (nameFirst[3] ?? '').trim();
      if (SETTING_UNITS.has(unit.toLowerCase()) || SETTING_KEYS.has(normalizeKey(name))) {
        settings.push({
          key: name,
          value: `${nameFirst[2]}${unit ? ` ${unit}` : ''}`,
          raw: line,
        });
      } else {
        quantities.push({
          name,
          quantity: Number(nameFirst[2]),
          unit,
        });
      }
      continue;
    }

    const qtyFirst = QTY_FIRST_RE.exec(line);
    if (qtyFirst) {
      quantities.push({
        name: qtyFirst[3].trim(),
        quantity: Number(qtyFirst[1]),
        unit: (qtyFirst[2] ?? '').trim(),
      });
      continue;
    }

    const settingMatch = SETTING_RE.exec(line);
    if (settingMatch) {
      settings.push({
        key: settingMatch[1].trim(),
        value: settingMatch[2].trim(),
        raw: line,
      });
    }
  }

  return { quantities, settings };
}

function findMatchingItem<T extends { name: string }>(items: T[], query: string): T | undefined {
  const needle = normalizeKey(query);
  return (
    items.find((item) => normalizeKey(item.name) === needle) ??
    items.find((item) => normalizeKey(item.name).includes(needle))
  );
}

/**
 * Computes scaled quantities or setting lookups strictly from a saved document's body (F-083-T02).
 * Cites saved values and arithmetic; asks instead of guessing when any required ratio or setting is missing.
 */
export function computeFromSavedDocument(doc: SavedDocument, request: DocumentComputeRequest): DocumentComputeResult {
  const citedDocument = { id: doc.id, title: doc.title, category: doc.category };
  const { quantities, settings } = parseDocumentQuantities(doc.body);

  if (request.setting !== undefined) {
    const needle = normalizeKey(request.setting);
    const matched = settings.find((s) => normalizeKey(s.key) === needle || normalizeKey(s.key).includes(needle));
    if (!matched) {
      return {
        ok: false,
        status: 'missing',
        citedDocument,
        missing: [`setting:${request.setting}`],
        question: `Saved document "${doc.title}" (${doc.category}) does not specify "${request.setting}". What value should I use?`,
        results: [],
        working: [],
        answer: '',
      };
    }
    const working = [`From "${doc.title}" (${doc.category}): ${matched.raw}`];
    return {
      ok: true,
      status: 'computed',
      citedDocument,
      missing: [],
      question: null,
      results: [],
      working,
      answer: `${doc.title} (${doc.category}): ${matched.key} = ${matched.value}`,
    };
  }

  if (
    !request.baseIngredient ||
    typeof request.targetQuantity !== 'number' ||
    !Number.isFinite(request.targetQuantity) ||
    request.targetQuantity <= 0
  ) {
    return {
      ok: false,
      status: 'missing',
      citedDocument,
      missing: ['baseIngredient/targetQuantity'],
      question: `Which base ingredient and positive target quantity should I scale "${doc.title}" (${doc.category}) by?`,
      results: [],
      working: [],
      answer: '',
    };
  }

  const base = findMatchingItem(quantities, request.baseIngredient);
  if (!base || base.quantity <= 0) {
    return {
      ok: false,
      status: 'missing',
      citedDocument,
      missing: [`base:${request.baseIngredient}`],
      question: `Saved document "${doc.title}" (${doc.category}) has no saved quantity for "${request.baseIngredient}". What saved ratio should I use?`,
      results: [],
      working: [],
      answer: '',
    };
  }

  if (request.targetUnit !== undefined && base.unit && normalizeKey(request.targetUnit) !== normalizeKey(base.unit)) {
    return {
      ok: false,
      status: 'missing',
      citedDocument,
      missing: [`unit:${request.targetUnit}->${base.unit}`],
      question: `Saved document "${doc.title}" gives ${base.name} in "${base.unit}", not "${request.targetUnit}". What conversion or quantity in ${base.unit} should I use?`,
      results: [],
      working: [],
      answer: '',
    };
  }

  const targets =
    request.ingredient !== undefined
      ? (() => {
          const found = findMatchingItem(quantities, request.ingredient);
          return found ? [found] : null;
        })()
      : quantities.filter((q) => normalizeKey(q.name) !== normalizeKey(base.name));

  if (targets === null || targets.length === 0) {
    const missingName = request.ingredient ?? 'ingredients';
    return {
      ok: false,
      status: 'missing',
      citedDocument,
      missing: [`ingredient:${missingName}`],
      question: `Saved document "${doc.title}" (${doc.category}) has no saved quantity for "${missingName}". What saved value should I use?`,
      results: [],
      working: [],
      answer: '',
    };
  }

  const scale = request.targetQuantity / base.quantity;
  const baseUnitLabel = base.unit ? ` ${base.unit}` : '';
  const results: ComputedQuantity[] = targets.map((item) => {
    const scaled = roundClean(item.quantity * scale);
    const itemUnitLabel = item.unit ? ` ${item.unit}` : '';
    const arithmetic = `${item.name}: ${item.quantity}${itemUnitLabel} × (${request.targetQuantity}${baseUnitLabel} / ${base.quantity}${baseUnitLabel}) = ${scaled}${itemUnitLabel}`;
    return {
      name: item.name,
      savedQuantity: item.quantity,
      savedUnit: item.unit,
      scaledQuantity: scaled,
      unit: item.unit,
      arithmetic,
    };
  });

  const working = [
    `Saved "${doc.title}" (${doc.category}): ${base.name} = ${base.quantity}${baseUnitLabel}`,
    ...results.map((r) => r.arithmetic),
  ];
  const answer = working.join('\n');

  return {
    ok: true,
    status: 'computed',
    citedDocument,
    missing: [],
    question: null,
    results,
    working,
    answer,
  };
}
