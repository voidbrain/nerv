import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SavedDocument } from './documents.ts';
import { transaction } from './sqlite-transaction.ts';

export const PANTRY_SCHEMA = `
CREATE TABLE IF NOT EXISTS pantry_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  shelf_life_days INTEGER,
  shelf_life_confirmed INTEGER NOT NULL DEFAULT 0,
  updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pantry_purchases (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES pantry_items(id),
  purchased_at TEXT NOT NULL,
  source TEXT NOT NULL,
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pantry_purchases_item ON pantry_purchases(item_id, purchased_at DESC);
`;

export interface PantryItem {
  readonly id: string;
  readonly name: string;
  readonly shelfLifeDays: number | null;
  readonly shelfLifeConfirmed: boolean;
  readonly updated: string;
}

export interface PantryPurchase {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly purchasedAt: string;
  readonly source: string;
  readonly created: string;
}

export interface IngredientShelfCheck {
  readonly ingredient: string;
  readonly known: boolean;
  readonly purchasedAt?: string;
  readonly shelfLifeDays?: number | null;
  readonly shelfLifeConfirmed?: boolean;
  readonly status: 'unknown' | 'unconfirmed-shelf-life' | 'fresh' | 'might-be-expired';
  readonly notice?: string;
}

interface PantryItemRow {
  id: string;
  name: string;
  shelf_life_days: number | null;
  shelf_life_confirmed: number;
  updated: string;
}

interface PantryPurchaseRow {
  id: string;
  item_id: string;
  purchased_at: string;
  source: string;
  created: string;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapItem(row: PantryItemRow): PantryItem {
  return {
    id: row.id,
    name: row.name,
    shelfLifeDays: row.shelf_life_days,
    shelfLifeConfirmed: row.shelf_life_confirmed === 1,
    updated: row.updated,
  };
}

const ARTICLE_PREFIX = /^(?:il|lo|la|i|gli|le|un|una|uno|del|dello|della|dei|degli|delle|the|some|an|a)\s+|^l['’]/i;

/** Parses Italian/English purchase statements such as "ho comprato la farina" or "bought flour". */
export function parsePurchasePhrase(phrase: string): { itemName: string } | null {
  const trimmed = phrase.trim().replace(/[.!?]+$/, '');
  const m = /^(?:ho\s+comprat[oaie]|comprat[oaie]|ho\s+preso|i\s+bought|bought|i\s+purchased|purchased)\s+(.+)$/i.exec(
    trimmed,
  );
  if (!m?.[1]) return null;
  let itemName = m[1].trim();
  while (ARTICLE_PREFIX.test(itemName)) {
    itemName = itemName.replace(ARTICLE_PREFIX, '').trim();
  }
  if (!itemName || itemName.length > 120) return null;
  return { itemName };
}

export class PantryStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private ensureItem(name: string, nowIso: string): PantryItem {
    const clean = name.trim();
    if (!clean) throw new Error('Ingredient name cannot be empty.');
    const norm = normalizeName(clean);
    const existing = this.db
      .prepare(
        'SELECT id, name, shelf_life_days, shelf_life_confirmed, updated FROM pantry_items WHERE normalized_name = ?',
      )
      .get(norm) as PantryItemRow | undefined;
    if (existing) return mapItem(existing);
    const id = `pi_${randomUUID()}`;
    this.db
      .prepare(
        'INSERT INTO pantry_items (id, name, normalized_name, shelf_life_days, shelf_life_confirmed, updated) VALUES (?, ?, ?, NULL, 0, ?)',
      )
      .run(id, clean, norm, nowIso);
    return { id, name: clean, shelfLifeDays: null, shelfLifeConfirmed: false, updated: nowIso };
  }

  logPurchase(itemName: string, purchasedAt = new Date(), source = 'chat'): PantryPurchase {
    const purchasedIso = purchasedAt.toISOString();
    const createdIso = new Date().toISOString();
    return transaction(this.db, () => {
      const item = this.ensureItem(itemName, createdIso);
      const id = `pp_${randomUUID()}`;
      this.db
        .prepare('INSERT INTO pantry_purchases (id, item_id, purchased_at, source, created) VALUES (?, ?, ?, ?, ?)')
        .run(id, item.id, purchasedIso, source, createdIso);
      return {
        id,
        itemId: item.id,
        itemName: item.name,
        purchasedAt: purchasedIso,
        source,
        created: createdIso,
      };
    });
  }

  confirmShelfLife(itemName: string, shelfLifeDays: number, now = new Date()): PantryItem {
    if (!Number.isInteger(shelfLifeDays) || shelfLifeDays < 1 || shelfLifeDays > 3650) {
      throw new Error('Shelf life days must be an integer between 1 and 3650.');
    }
    const nowIso = now.toISOString();
    return transaction(this.db, () => {
      const item = this.ensureItem(itemName, nowIso);
      this.db
        .prepare('UPDATE pantry_items SET shelf_life_days = ?, shelf_life_confirmed = 1, updated = ? WHERE id = ?')
        .run(shelfLifeDays, nowIso, item.id);
      return {
        ...item,
        shelfLifeDays,
        shelfLifeConfirmed: true,
        updated: nowIso,
      };
    });
  }

  applyChatPhrase(phrase: string, now = new Date()): { matched: true; purchase: PantryPurchase } | { matched: false } {
    const parsed = parsePurchasePhrase(phrase);
    if (!parsed) return { matched: false };
    return { matched: true, purchase: this.logPurchase(parsed.itemName, now, 'chat') };
  }

  checkIngredient(ingredient: string, now = new Date()): IngredientShelfCheck {
    const norm = normalizeName(ingredient);
    const row = this.db
      .prepare(
        'SELECT id, name, shelf_life_days, shelf_life_confirmed, updated FROM pantry_items WHERE normalized_name = ?',
      )
      .get(norm) as PantryItemRow | undefined;
    if (!row) return { ingredient, known: false, status: 'unknown' };
    const latest = this.db
      .prepare(
        'SELECT id, item_id, purchased_at, source, created FROM pantry_purchases WHERE item_id = ? ORDER BY purchased_at DESC, created DESC LIMIT 1',
      )
      .get(row.id) as PantryPurchaseRow | undefined;
    if (!latest) return { ingredient: row.name, known: true, status: 'unknown' };
    if (row.shelf_life_confirmed !== 1 || row.shelf_life_days === null) {
      return {
        ingredient: row.name,
        known: true,
        purchasedAt: latest.purchased_at,
        shelfLifeDays: null,
        shelfLifeConfirmed: false,
        status: 'unconfirmed-shelf-life',
      };
    }
    const ageDays = (now.getTime() - Date.parse(latest.purchased_at)) / 86_400_000;
    if (ageDays > row.shelf_life_days) {
      return {
        ingredient: row.name,
        known: true,
        purchasedAt: latest.purchased_at,
        shelfLifeDays: row.shelf_life_days,
        shelfLifeConfirmed: true,
        status: 'might-be-expired',
        notice: `${row.name} might be expired (bought ${latest.purchased_at.slice(0, 10)}, confirmed shelf life ${row.shelf_life_days}d).`,
      };
    }
    return {
      ingredient: row.name,
      known: true,
      purchasedAt: latest.purchased_at,
      shelfLifeDays: row.shelf_life_days,
      shelfLifeConfirmed: true,
      status: 'fresh',
    };
  }

  recallDocumentWarnings(doc: SavedDocument, now = new Date()): IngredientShelfCheck[] {
    const items = this.db
      .prepare('SELECT id, name, shelf_life_days, shelf_life_confirmed, updated FROM pantry_items')
      .all() as unknown as PantryItemRow[];
    const lowerBody = doc.body.toLowerCase();
    const warnings: IngredientShelfCheck[] = [];
    for (const row of items) {
      if (lowerBody.includes(row.name.toLowerCase())) {
        const check = this.checkIngredient(row.name, now);
        if (check.status === 'might-be-expired') warnings.push(check);
      }
    }
    return warnings;
  }
}
