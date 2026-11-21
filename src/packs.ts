/**
 * Domain pack manifest, core-services interface, and pack registry (F-114-T01).
 *
 * Packs declare their tools, SQLite tables, chat phrases, Telegram captions, and dashboard panels.
 * `config.json` (`packs.<id>: false`) turns a pack off: its tools are not offered to Misato,
 * its chat phrases are not routed, and its dashboard panels are hidden, while its data stays.
 */

export interface CoreServices {
  readonly reminders: {
    listPending(): unknown;
    add(title: string, due: string, now?: Date, options?: unknown): unknown;
  };
  readonly todos: {
    show(list?: string): unknown;
    add(list: string, item: string): unknown;
  };
  readonly timers: {
    set(key: string, seconds: number, onExpire: (line: string) => void): string;
    stop(key: string): string;
  };
  readonly photos: {
    attach(ownerKind: string, ownerId: string, bytes: Uint8Array, mimeType: string): unknown;
  };
}

export interface PackPanelDeclaration {
  readonly id: string;
  readonly title: string;
  readonly route: string;
}

export interface PackPhraseDeclaration {
  readonly id: string;
  readonly pattern: RegExp;
}

export interface PackManifest {
  readonly id: string;
  readonly name: string;
  readonly tools: readonly string[];
  readonly tables: readonly string[];
  readonly chatPhrases: readonly PackPhraseDeclaration[];
  readonly telegramCaptions: readonly string[];
  readonly dashboardPanels: readonly PackPanelDeclaration[];
  readonly init?: (core: CoreServices) => void;
  readonly handleTelegramText?: (text: string, store: unknown) => Promise<string | undefined>;
  readonly resolveTelegramPhoto?: (
    store: unknown,
    ownerKind: string,
    query: string,
  ) => { id: string; label: string } | undefined;
  readonly resolvePhotoOwner?: (store: unknown, ownerKind: string, id: string) => string | undefined;
}

export type PacksConfig = Record<string, boolean>;

export interface PackStatusEntry {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly tools: readonly string[];
  readonly tables: readonly string[];
  readonly dashboardPanels: readonly PackPanelDeclaration[];
}

export function validatePacksConfig(raw: unknown): PacksConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid packs config: expected an object mapping pack id to boolean.');
  }
  const out: PacksConfig = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(k)) {
      throw new Error(`Invalid pack id ${JSON.stringify(k)} in packs config.`);
    }
    if (typeof v !== 'boolean') {
      throw new Error(`Invalid packs.${k}: expected true or false.`);
    }
    out[k] = v;
  }
  return out;
}

export class PackRegistry {
  private readonly manifests = new Map<string, PackManifest>();
  private readonly toolOwners = new Map<string, string>();
  private readonly captionOwners = new Map<string, string>();

  register(manifest: PackManifest): void {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(manifest.id)) {
      throw new Error(`Invalid pack id ${JSON.stringify(manifest.id)}.`);
    }
    if (this.manifests.has(manifest.id)) {
      throw new Error(`Pack "${manifest.id}" is already registered.`);
    }
    for (const tool of manifest.tools) {
      const existing = this.toolOwners.get(tool);
      if (existing) {
        throw new Error(`Tool "${tool}" is already declared by pack "${existing}".`);
      }
    }
    for (const caption of manifest.telegramCaptions) {
      const existing = this.captionOwners.get(caption);
      if (existing) {
        throw new Error(`Telegram caption "${caption}" is already declared by pack "${existing}".`);
      }
    }
    this.manifests.set(manifest.id, manifest);
    for (const tool of manifest.tools) this.toolOwners.set(tool, manifest.id);
    for (const caption of manifest.telegramCaptions) this.captionOwners.set(caption, manifest.id);
  }

  get(packId: string): PackManifest | undefined {
    return this.manifests.get(packId);
  }

  list(): PackManifest[] {
    return [...this.manifests.values()];
  }

  isEnabled(packId: string, config?: PacksConfig): boolean {
    if (!this.manifests.has(packId)) return false;
    return config?.[packId] !== false;
  }

  enabledPacks(config?: PacksConfig): PackManifest[] {
    return this.list().filter((m) => this.isEnabled(m.id, config));
  }

  disabledTools(config?: PacksConfig): Set<string> {
    const out = new Set<string>();
    for (const m of this.manifests.values()) {
      if (!this.isEnabled(m.id, config)) {
        for (const t of m.tools) out.add(t);
      }
    }
    return out;
  }

  isToolEnabled(toolName: string, config?: PacksConfig): boolean {
    const owner = this.toolOwners.get(toolName);
    if (!owner) return true;
    return this.isEnabled(owner, config);
  }

  filterToolDocs<T extends { name: string }>(docs: readonly T[], config?: PacksConfig): T[] {
    const disabled = this.disabledTools(config);
    if (disabled.size === 0) return [...docs];
    return docs.filter((d) => !disabled.has(d.name));
  }

  enabledPanels(config?: PacksConfig): PackPanelDeclaration[] {
    return this.enabledPacks(config).flatMap((m) => m.dashboardPanels);
  }

  isCaptionEnabled(captionKind: string, config?: PacksConfig): boolean {
    const owner = this.captionOwners.get(captionKind);
    if (!owner) return true;
    return this.isEnabled(owner, config);
  }

  resolveChatPhrase(
    text: string,
    config?: PacksConfig,
  ): { packId: string; phraseId: string } | { ambiguous: string[] } | undefined {
    const matches: { packId: string; phraseId: string }[] = [];
    for (const pack of this.enabledPacks(config)) {
      for (const phrase of pack.chatPhrases) {
        if (phrase.pattern.test(text)) {
          matches.push({ packId: pack.id, phraseId: phrase.id });
          break;
        }
      }
    }
    if (matches.length === 0) return undefined;
    if (matches.length > 1) {
      return { ambiguous: matches.map((m) => m.packId) };
    }
    return matches[0];
  }

  async handleTelegramText(text: string, store: unknown, config?: PacksConfig): Promise<string | undefined> {
    for (const pack of this.enabledPacks(config)) {
      if (pack.handleTelegramText) {
        const reply = await pack.handleTelegramText(text, store);
        if (reply !== undefined) return reply;
      }
    }
    return undefined;
  }

  resolveTelegramPhoto(
    store: unknown,
    ownerKind: string,
    query: string,
    config?: PacksConfig,
  ): { id: string; label: string } | undefined {
    for (const pack of this.enabledPacks(config)) {
      if (pack.telegramCaptions.includes(ownerKind) && pack.resolveTelegramPhoto) {
        return pack.resolveTelegramPhoto(store, ownerKind, query);
      }
    }
    return undefined;
  }

  resolvePhotoOwner(store: unknown, ownerKind: string, id: string, config?: PacksConfig): string | undefined {
    for (const pack of this.enabledPacks(config)) {
      if (pack.resolvePhotoOwner) {
        const found = pack.resolvePhotoOwner(store, ownerKind, id);
        if (found) return found;
      }
    }
    return undefined;
  }

  status(config?: PacksConfig): PackStatusEntry[] {
    return this.list().map((m) => ({
      id: m.id,
      name: m.name,
      enabled: this.isEnabled(m.id, config),
      tools: m.tools,
      tables: m.tables,
      dashboardPanels: this.isEnabled(m.id, config) ? m.dashboardPanels : [],
    }));
  }
}

import {
  createFpvStoreSlice,
  fpvFleetSnapshot,
  fpvPackManifest,
  type FpvStoreSlice,
  type RegisterBatteryInput,
} from './fpv-pack.ts';

export { createFpvStoreSlice, fpvFleetSnapshot, type FpvStoreSlice, type RegisterBatteryInput };

export const builtinPackRegistry = new PackRegistry();

builtinPackRegistry.register(fpvPackManifest);

builtinPackRegistry.register({
  id: 'cooking',
  name: 'Cooking',
  tools: ['pantry.purchase', 'pantry.shelf_life', 'pantry.check'],
  tables: ['pantry_items'],
  chatPhrases: [{ id: 'cooking-session', pattern: /^\s*(?:inizia a cucinare|start cooking)\b/i }],
  telegramCaptions: ['recipe'],
  dashboardPanels: [{ id: 'pantry', title: 'Pantry', route: '/pantry' }],
});
