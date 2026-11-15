import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { readScrolls } from '../src/config.ts';
import { OWNER_SOURCE, Store } from '../src/store.ts';

const dirs: string[] = [];
const makeStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-docs-'));
  dirs.push(dir);
  return new Store(join(dir, 'nerv.db'), readScrolls(dir), { home: dir });
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('F-083-T01 saved documents with categories', () => {
  it('proposes save on an approval card and stores local-only after approval', () => {
    const store = makeStore();
    try {
      const sortie = store.ledger.openSortie(OWNER_SOURCE, 'Save invented recipe', 'trusted');
      const body =
        'Ingredients:\n  - 200 g oat flour\n  - 120 ml maple syrup\n\nSteps:\n1. Whisk.\n2. Bake 18 min at 180 C.';

      const pending = store.runAction(sortie, {
        tool: 'docs.save',
        args: { title: 'Maple Oat Squares', category: 'recipes', body },
        stage: 'production',
      });
      assert.equal(pending.pattern, 'blue');
      assert.equal(pending.outcome, 'approval');
      assert.ok(pending.approvalId);
      assert.equal(store.documents.list().length, 0);

      const decision = store.decide(pending.approvalId, 'approve', 'telegram');
      assert.equal(decision.decision, 'approve');

      const saved = store.documents.list('Recipes');
      assert.equal(saved.length, 1);
      assert.equal(saved[0].title, 'Maple Oat Squares');
      assert.equal(saved[0].category, 'recipes');
      assert.equal(saved[0].body, body);
      assert.equal(saved[0].shareable, false);
      assert.equal(saved[0].sortieId, sortie);
    } finally {
      store.close();
    }
  });

  it('lists by category, shows verbatim, and edits/forgets with append-only history', () => {
    const store = makeStore();
    try {
      const soupBody = '1. Simmer 500 g squash.\n2. Blend with 250 ml broth.';
      const cakeBody = '1. Mix 150 g almond meal.\n2. Bake 25 min.';

      const soup = store.documents.save({ title: 'Winter Squash Soup', category: 'soups', body: soupBody });
      store.documents.save({ title: 'Almond Tart', category: 'desserts', body: cakeBody });

      const listSortie = store.ledger.openSortie(OWNER_SOURCE, 'List soups', 'trusted');
      const listed = store.runAction(listSortie, {
        tool: 'docs.list',
        args: { category: 'soups' },
        stage: 'production',
      });
      assert.equal(listed.outcome, 'grant');
      assert.equal((listed.result as { documents: Array<{ title: string }> }).documents.length, 1);
      assert.equal((listed.result as { documents: Array<{ title: string }> }).documents[0].title, 'Winter Squash Soup');

      const showSortie = store.ledger.openSortie(OWNER_SOURCE, 'Show soup', 'trusted');
      const shown = store.runAction(showSortie, {
        tool: 'docs.show',
        args: { title: 'Winter Squash Soup', category: 'soups' },
        stage: 'production',
      });
      assert.equal(shown.outcome, 'grant');
      assert.equal((shown.result as { body: string }).body, soupBody);

      const updatedBody = `${soupBody}\n3. Top with toasted seeds.`;
      const editSortie = store.ledger.openSortie(OWNER_SOURCE, 'Edit soup', 'trusted');
      const editPending = store.runAction(editSortie, {
        tool: 'docs.edit',
        args: { id: soup.id, body: updatedBody },
        stage: 'production',
      });
      assert.equal(editPending.outcome, 'approval');
      store.decide(editPending.approvalId!, 'approve', 'telegram');

      assert.equal(store.documents.get(soup.id)?.body, updatedBody);
      assert.equal(store.documents.recall('toasted seeds', 'soups').length, 1);

      const forgetSortie = store.ledger.openSortie(OWNER_SOURCE, 'Forget soup', 'trusted');
      const forgot = store.runAction(forgetSortie, {
        tool: 'docs.forget',
        args: { id: soup.id },
        stage: 'production',
      });
      assert.equal(forgot.outcome, 'approval');
      const forgetDecision = store.decide(forgot.approvalId!, 'approve', 'telegram');
      assert.equal((forgetDecision.result as { forgotten: boolean }).forgotten, true);
      assert.equal(store.documents.get(soup.id), undefined);
      assert.equal(store.documents.list('soups').length, 0);

      const history = store.documents.history(soup.id);
      assert.deepEqual(
        history.map((h) => h.kind),
        ['saved', 'edited', 'forgotten'],
      );
      assert.throws(() => store.db.prepare('DELETE FROM saved_document_history').run(), /append-only/);
    } finally {
      store.close();
    }
  });

  it('computes scaled quantities strictly from saved values with working shown, and asks when a ratio or setting is missing', () => {
    const store = makeStore();
    try {
      const recipe = store.documents.save({
        title: 'Country Loaf',
        category: 'bread',
        body: ['500 g flour', '350 ml water', '10 g salt', 'oven: 230 C'].join('\n'),
      });

      // Scale from saved values (100 g flour -> 70 ml water, 2 g salt)
      const scaled = store.documents.compute(recipe.id, {
        baseIngredient: 'flour',
        targetQuantity: 100,
        targetUnit: 'g',
      });
      assert.equal(scaled.ok, true);
      assert.equal(scaled.status, 'computed');
      assert.deepEqual(scaled.citedDocument, { id: recipe.id, title: 'Country Loaf', category: 'bread' });
      assert.equal(scaled.results.length, 2);
      assert.equal(scaled.results[0].name, 'water');
      assert.equal(scaled.results[0].scaledQuantity, 70);
      assert.equal(scaled.results[0].unit, 'ml');
      assert.match(scaled.answer, /500 g/);
      assert.match(scaled.answer, /350 ml × \(100 g \/ 500 g\) = 70 ml/);
      assert.match(scaled.answer, /10 g × \(100 g \/ 500 g\) = 2 g/);
      // No unrequested quantities or advice
      assert.doesNotMatch(scaled.answer, /yeast|sugar|230/);

      // Setting lookup cites the saved setting verbatim
      const setting = store.documents.compute('Country Loaf', { setting: 'oven' }, 'bread');
      assert.equal(setting.ok, true);
      assert.match(setting.answer, /oven = 230 C/);

      // Missing ingredient / ratio / setting / unit mismatch makes NERV ask, never guess
      const missingIngredient = store.documents.compute(recipe.id, {
        baseIngredient: 'flour',
        targetQuantity: 100,
        ingredient: 'butter',
      });
      assert.equal(missingIngredient.ok, false);
      assert.equal(missingIngredient.status, 'missing');
      assert.deepEqual(missingIngredient.results, []);
      assert.match(missingIngredient.question ?? '', /butter/);

      const missingSetting = store.documents.compute(recipe.id, { setting: 'steam' });
      assert.equal(missingSetting.ok, false);
      assert.equal(missingSetting.status, 'missing');
      assert.match(missingSetting.question ?? '', /steam/);

      const unitMismatch = store.documents.compute(recipe.id, {
        baseIngredient: 'flour',
        targetQuantity: 1,
        targetUnit: 'cups',
      });
      assert.equal(unitMismatch.ok, false);
      assert.equal(unitMismatch.status, 'missing');
      assert.match(unitMismatch.question ?? '', /cups/);

      // Wired as a read-only Green tool (`docs.compute`)
      const sortie = store.ledger.openSortie(OWNER_SOURCE, 'Compute water for 250 g flour', 'trusted');
      const action = store.runAction(sortie, {
        tool: 'docs.compute',
        args: { id: recipe.id, baseIngredient: 'flour', targetQuantity: 250, targetUnit: 'g', ingredient: 'water' },
        stage: 'production',
      });
      assert.equal(action.outcome, 'grant');
    } finally {
      store.close();
    }
  });
});
