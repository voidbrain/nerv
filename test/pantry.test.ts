import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { execute } from '../src/executors.ts';

test('F-083-T05: logs purchases in Italian/English and flags old items as "might be expired" only after confirmed shelf life', () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-pantry-'));
  const store = new Store(join(home, 'nerv.sqlite'));
  try {
    const boughtAt = new Date('2026-01-01T10:00:00.000Z');
    const chatRes = store.pantry.applyChatPhrase('ho comprato la farina', boughtAt);
    assert.equal(chatRes.matched, true);
    if (!chatRes.matched) return;
    assert.equal(chatRes.purchase.itemName, 'farina');
    assert.equal(chatRes.purchase.purchasedAt, '2026-01-01T10:00:00.000Z');

    // Without owner-confirmed shelf life, never guesses expiry.
    const later = new Date('2026-11-15T10:00:00.000Z');
    const unconfirmed = store.pantry.checkIngredient('farina', later);
    assert.equal(unconfirmed.status, 'unconfirmed-shelf-life');
    assert.equal(unconfirmed.notice, undefined);

    // Owner confirms shelf life of 180 days.
    const confirmed = store.pantry.confirmShelfLife('farina', 180, boughtAt);
    assert.equal(confirmed.shelfLifeConfirmed, true);
    assert.equal(confirmed.shelfLifeDays, 180);

    // Save an invented recipe containing farina and recall it later.
    const recipe = store.documents.save({
      title: 'Pizza fatta in casa',
      category: 'recipes',
      body: 'Ingredienti:\n- 500 g farina\n- 300 ml acqua\n- 10 g sale',
      source: 'test',
    });
    const warnings = store.pantry.recallDocumentWarnings(recipe, later);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.status, 'might-be-expired');
    assert.match(warnings[0]?.notice ?? '', /might be expired/i);
    assert.doesNotMatch(warnings[0]?.notice ?? '', /\bis expired\b/i);

    // Verify executor tools work end-to-end as well.
    const engPurchase = execute(store, 'pantry.purchase', {
      phrase: 'I bought yeast',
      purchasedAt: '2026-11-14T08:00:00Z',
    }) as {
      itemName: string;
    };
    assert.equal(engPurchase.itemName, 'yeast');
    execute(store, 'pantry.shelf_life', { item: 'yeast', days: 30 });
    const check = execute(store, 'pantry.check', { item: 'yeast' }) as { status: string };
    assert.equal(check.status, 'fresh');
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
