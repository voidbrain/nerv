import type { DatabaseSync } from 'node:sqlite';
import { CookingSessions, readCookingCommand } from './cooking-session.ts';
import type { PackChatContext, PackManifest } from './packs.ts';
import { PANTRY_SCHEMA, PantryStore } from './pantry.ts';

export interface CookingStoreSlice {
  readonly pantry: PantryStore;
}

export function createCookingStoreSlice(db: DatabaseSync): CookingStoreSlice {
  db.exec(PANTRY_SCHEMA);
  const pantry = new PantryStore(db);
  return { pantry };
}

const sessions = new CookingSessions();

export const cookingPackManifest: PackManifest = {
  id: 'cooking',
  name: 'Cooking',
  tools: ['pantry.purchase', 'pantry.shelf_life', 'pantry.check'],
  tables: ['pantry_items'],
  chatPhrases: [{ id: 'cooking-session', pattern: /^\s*(?:inizia a cucinare|start cooking)\b/i }],
  telegramCaptions: ['recipe'],
  dashboardPanels: [{ id: 'pantry', title: 'Pantry', route: '/pantry' }],
  async handleChatMessage(message: string, conversation: string, ctx: PackChatContext) {
    const cooking = readCookingCommand(message);
    if (!cooking) return undefined;
    const onExpire = (line: string) => {
      void ctx.notice?.(line).catch(() => {});
    };
    if (cooking.kind === 'start') {
      const doc = (await ctx.findDocument(cooking.recipe)) as {
        title: string;
        body: string;
        photos?: import('../shared/surface.ts').RecipePhoto[];
      } | null;
      return doc ? sessions.start(conversation, doc.title, doc.body, cooking.it, doc.photos) : undefined;
    }
    if (cooking.kind === 'timer-set') return sessions.setTimer(conversation, cooking.seconds, onExpire);
    if (cooking.kind === 'timer-confirm') return sessions.confirmTimer(conversation, onExpire);
    if (cooking.kind === 'timer-stop') return sessions.stopTimer(conversation);
    return sessions.move(conversation, cooking.kind);
  },
};
