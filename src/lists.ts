import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ChecklistSurface } from '../shared/surface.ts';
import { transaction } from './sqlite-transaction.ts';

export const LISTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id),
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  UNIQUE(list_id, normalized_text)
);
CREATE INDEX IF NOT EXISTS idx_list_items_list_pos ON list_items(list_id, position);
`;

export interface OwnerList {
  readonly id: string;
  readonly name: string;
  readonly created: string;
  readonly updated: string;
}

export interface ListItem {
  readonly id: string;
  readonly listId: string;
  readonly text: string;
  readonly done: boolean;
  readonly position: number;
  readonly created: string;
  readonly updated: string;
}

export interface ListView {
  readonly list: OwnerList;
  readonly items: ListItem[];
}

export interface AddListItemsResult {
  readonly list: OwnerList;
  readonly added: ListItem[];
  readonly duplicates: string[];
  readonly items: ListItem[];
}

interface ListRow {
  id: string;
  name: string;
  created: string;
  updated: string;
}

interface ItemRow {
  id: string;
  list_id: string;
  text: string;
  done: number;
  position: number;
  created: string;
  updated: string;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapList(row: ListRow): OwnerList {
  return { id: row.id, name: row.name, created: row.created, updated: row.updated };
}

function mapItem(row: ItemRow): ListItem {
  return {
    id: row.id,
    listId: row.list_id,
    text: row.text,
    done: row.done === 1,
    position: row.position,
    created: row.created,
    updated: row.updated,
  };
}

export class ListStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private findList(name: string): OwnerList | null {
    const norm = normalizeKey(name);
    if (!norm) throw new Error('List name is required.');
    const row = this.db.prepare('SELECT id, name, created, updated FROM lists WHERE normalized_name = ?').get(norm) as
      ListRow | undefined;
    return row ? mapList(row) : null;
  }

  private getOrCreateList(name: string, nowIso: string): OwnerList {
    const existing = this.findList(name);
    if (existing) return existing;
    const clean = name.trim();
    const norm = normalizeKey(clean);
    const id = `lst_${randomUUID()}`;
    this.db
      .prepare('INSERT INTO lists (id, name, normalized_name, created, updated) VALUES (?, ?, ?, ?, ?)')
      .run(id, clean, norm, nowIso, nowIso);
    return { id, name: clean, created: nowIso, updated: nowIso };
  }

  private itemsForList(listId: string): ListItem[] {
    const rows = this.db
      .prepare(
        'SELECT id, list_id, text, done, position, created, updated FROM list_items WHERE list_id = ? ORDER BY position ASC, created ASC',
      )
      .all(listId) as unknown as ItemRow[];
    return rows.map(mapItem);
  }

  addItems(listName: string, rawItems: string[], now = new Date()): AddListItemsResult {
    const cleanItems = rawItems.map((s) => s.trim()).filter((s) => s.length > 0);
    if (cleanItems.length === 0) throw new Error('Provide at least one non-empty item.');
    const nowIso = now.toISOString();
    return transaction(this.db, () => {
      const list = this.getOrCreateList(listName, nowIso);
      const maxRow = this.db
        .prepare('SELECT COALESCE(MAX(position), 0) AS max_pos FROM list_items WHERE list_id = ?')
        .get(list.id) as { max_pos: number };
      let pos = maxRow.max_pos;
      const added: ListItem[] = [];
      const duplicates: string[] = [];

      for (const itemText of cleanItems) {
        const normItem = normalizeKey(itemText);
        const existing = this.db
          .prepare('SELECT text FROM list_items WHERE list_id = ? AND normalized_text = ?')
          .get(list.id, normItem) as { text: string } | undefined;
        if (existing) {
          duplicates.push(existing.text);
          continue;
        }
        pos += 1;
        const itemId = `li_${randomUUID()}`;
        this.db
          .prepare(
            'INSERT INTO list_items (id, list_id, text, normalized_text, done, position, created, updated) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
          )
          .run(itemId, list.id, itemText, normItem, pos, nowIso, nowIso);
        added.push({
          id: itemId,
          listId: list.id,
          text: itemText,
          done: false,
          position: pos,
          created: nowIso,
          updated: nowIso,
        });
      }

      if (added.length > 0) {
        this.db.prepare('UPDATE lists SET updated = ? WHERE id = ?').run(nowIso, list.id);
      }

      const updatedList = this.findList(list.name) ?? list;
      return {
        list: updatedList,
        added,
        duplicates,
        items: this.itemsForList(list.id),
      };
    });
  }

  show(listName: string): ListView | null {
    const list = this.findList(listName);
    if (!list) return null;
    return { list, items: this.itemsForList(list.id) };
  }

  listAll(): (OwnerList & { itemCount: number; doneCount: number })[] {
    const rows = this.db
      .prepare(
        `SELECT l.id, l.name, l.created, l.updated,
                COUNT(i.id) AS item_count,
                COALESCE(SUM(i.done), 0) AS done_count
         FROM lists l
         LEFT JOIN list_items i ON i.list_id = l.id
         GROUP BY l.id
         ORDER BY l.updated DESC, l.name ASC`,
      )
      .all() as unknown as (ListRow & { item_count: number; done_count: number })[];
    return rows.map((r) => ({
      ...mapList(r),
      itemCount: Number(r.item_count),
      doneCount: Number(r.done_count),
    }));
  }

  private findItem(listId: string, itemRef: string): ListItem | null {
    const trimmed = itemRef.trim();
    if (!trimmed) return null;
    const byId = this.db
      .prepare(
        'SELECT id, list_id, text, done, position, created, updated FROM list_items WHERE list_id = ? AND id = ?',
      )
      .get(listId, trimmed) as ItemRow | undefined;
    if (byId) return mapItem(byId);
    const byNorm = this.db
      .prepare(
        'SELECT id, list_id, text, done, position, created, updated FROM list_items WHERE list_id = ? AND normalized_text = ?',
      )
      .get(listId, normalizeKey(trimmed)) as ItemRow | undefined;
    return byNorm ? mapItem(byNorm) : null;
  }

  setDone(listName: string, itemRef: string, done: boolean, now = new Date()): { list: OwnerList; item: ListItem } {
    const list = this.findList(listName);
    if (!list) throw new Error(`List "${listName}" not found.`);
    const item = this.findItem(list.id, itemRef);
    if (!item) throw new Error(`Item "${itemRef}" not found in list "${list.name}".`);
    const nowIso = now.toISOString();
    transaction(this.db, () => {
      this.db.prepare('UPDATE list_items SET done = ?, updated = ? WHERE id = ?').run(done ? 1 : 0, nowIso, item.id);
      this.db.prepare('UPDATE lists SET updated = ? WHERE id = ?').run(nowIso, list.id);
    });
    return {
      list: this.findList(list.name) ?? list,
      item: { ...item, done, updated: nowIso },
    };
  }

  removeItem(listName: string, itemRef: string, now = new Date()): { list: OwnerList; removed: ListItem } {
    const list = this.findList(listName);
    if (!list) throw new Error(`List "${listName}" not found.`);
    const item = this.findItem(list.id, itemRef);
    if (!item) throw new Error(`Item "${itemRef}" not found in list "${list.name}".`);
    const nowIso = now.toISOString();
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM list_items WHERE id = ?').run(item.id);
      this.db.prepare('UPDATE lists SET updated = ? WHERE id = ?').run(nowIso, list.id);
    });
    return {
      list: this.findList(list.name) ?? list,
      removed: item,
    };
  }

  toggleItemById(itemId: string, now = new Date()): { list: OwnerList; items: ListItem[]; item: ListItem } | null {
    const row = this.db
      .prepare('SELECT id, list_id, text, done, position, created, updated FROM list_items WHERE id = ?')
      .get(itemId.trim()) as ItemRow | undefined;
    if (!row) return null;
    const listRow = this.db.prepare('SELECT id, name, created, updated FROM lists WHERE id = ?').get(row.list_id) as
      ListRow | undefined;
    if (!listRow) return null;
    const nextDone = row.done !== 1;
    const nowIso = now.toISOString();
    transaction(this.db, () => {
      this.db.prepare('UPDATE list_items SET done = ?, updated = ? WHERE id = ?').run(nextDone ? 1 : 0, nowIso, row.id);
      this.db.prepare('UPDATE lists SET updated = ? WHERE id = ?').run(nowIso, listRow.id);
    });
    const list = { ...mapList(listRow), updated: nowIso };
    return {
      list,
      items: this.itemsForList(list.id),
      item: { ...mapItem(row), done: nextDone, updated: nowIso },
    };
  }

  setDoneById(
    itemId: string,
    done?: boolean,
    now = new Date(),
  ): { list: OwnerList; item: ListItem; view: ListView } | null {
    const row = this.db
      .prepare('SELECT id, list_id, text, done, position, created, updated FROM list_items WHERE id = ?')
      .get(itemId.trim()) as ItemRow | undefined;
    if (!row) return null;
    const listRow = this.db.prepare('SELECT id, name, created, updated FROM lists WHERE id = ?').get(row.list_id) as
      ListRow | undefined;
    if (!listRow) return null;
    const nextDone = done ?? row.done !== 1;
    const nowIso = now.toISOString();
    transaction(this.db, () => {
      this.db.prepare('UPDATE list_items SET done = ?, updated = ? WHERE id = ?').run(nextDone ? 1 : 0, nowIso, row.id);
      this.db.prepare('UPDATE lists SET updated = ? WHERE id = ?').run(nowIso, listRow.id);
    });
    const list = this.findList(listRow.name) ?? mapList(listRow);
    const item = { ...mapItem(row), done: nextDone, updated: nowIso };
    return { list, item, view: { list, items: this.itemsForList(list.id) } };
  }
}

export function formatTelegramChecklist(view: ListView): {
  text: string;
  buttons: { text: string; callback_data: string }[][];
} {
  const lines = view.items.length ? view.items.map((item) => `${item.done ? '☑' : '☐'} ${item.text}`) : ['(empty)'];
  return {
    text: `${view.list.name}\n${lines.join('\n')}`,
    buttons: view.items.map((item) => [
      {
        text: `${item.done ? '☑' : '☐'} ${item.text}`.slice(0, 64),
        callback_data: `lt:${item.id}`,
      },
    ]),
  };
}

export function toChecklistSurface(view: ListView): ChecklistSurface {
  return {
    version: 1,
    component: 'nerv-checklist-card',
    props: {
      listId: view.list.id,
      name: view.list.name,
      items: view.items.map((item) => ({ id: item.id, text: item.text, done: item.done })),
    },
  };
}
