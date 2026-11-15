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
});
