import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readScrolls } from '../src/config.ts';
import { builtinTools } from '../src/executors.ts';
import { Store } from '../src/store.ts';

describe('F-082-T01: list store and list tools', () => {
  it('exposes lists.add_items, lists.show, lists.set_done, and lists.remove_item with Green gate class', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-lists-'));
    try {
      for (const name of ['lists.add_items', 'lists.show', 'lists.set_done', 'lists.remove_item']) {
        assert.ok(
          builtinTools.some((t) => t.name === name),
          `missing tool ${name}`,
        );
      }

      const store1 = new Store(join(dir, 'nerv.db'), readScrolls(dir), { home: dir });
      const sortieId = store1.ledger.openSortie('owner', 'manage invented list', 'trusted');

      const added = await store1.runAction(sortieId, {
        tool: 'lists.add_items',
        args: { list: 'Bench Kit', items: ['Spare Prop', 'Tape Roll', 'spare prop', 'Hex Driver'] },
        stage: 'production',
      });
      assert.equal(added.outcome, 'grant');
      assert.equal(added.pattern, 'green');
      const addRes = added.result as {
        added: { text: string }[];
        duplicates: string[];
        items: { text: string; done: boolean }[];
      };
      assert.deepEqual(
        addRes.added.map((i) => i.text),
        ['Spare Prop', 'Tape Roll', 'Hex Driver'],
      );
      assert.deepEqual(addRes.duplicates, ['Spare Prop']);
      assert.equal(addRes.items.length, 3);

      const sortieDone = store1.ledger.openSortie('owner', 'mark item done', 'trusted');
      const doneRes = await store1.runAction(sortieDone, {
        tool: 'lists.set_done',
        args: { list: 'bench kit', item: 'Tape Roll', done: true },
        stage: 'production',
      });
      assert.equal(doneRes.outcome, 'grant');
      assert.equal(doneRes.pattern, 'green');
      assert.equal((doneRes.result as { item: { done: boolean } }).item.done, true);

      const sortieRemove = store1.ledger.openSortie('owner', 'remove item', 'trusted');
      const removeRes = await store1.runAction(sortieRemove, {
        tool: 'lists.remove_item',
        args: { list: 'Bench Kit', item: 'Hex Driver' },
        stage: 'production',
      });
      assert.equal(removeRes.outcome, 'grant');
      assert.equal(removeRes.pattern, 'green');
      store1.close();

      // Reopen store to verify persistence across restart
      const store2 = new Store(join(dir, 'nerv.db'), readScrolls(dir), { home: dir });
      const sortie2 = store2.ledger.openSortie('owner', 'show list after restart', 'trusted');
      const shown = await store2.runAction(sortie2, {
        tool: 'lists.show',
        args: { list: 'Bench Kit' },
        stage: 'production',
      });
      assert.equal(shown.outcome, 'grant');
      assert.equal(shown.pattern, 'green');
      const view = shown.result as { list: { name: string }; items: { text: string; done: boolean }[] };
      assert.equal(view.list.name, 'Bench Kit');
      assert.deepEqual(
        view.items.map((i) => ({ text: i.text, done: i.done })),
        [
          { text: 'Spare Prop', done: false },
          { text: 'Tape Roll', done: true },
        ],
      );
      store2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
