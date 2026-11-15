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
}
