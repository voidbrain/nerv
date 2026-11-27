/**
 * F-159: modules, the owner's on/off switches over what NERV can reach: each external MCP server and each built-in
 * domain pack is one module. Owner correction 2026-11-27: the built-in FPV pack and the FPVBuddy MCP server are one
 * module, FPVBuddy (FPV moves behind that server; until it exists the switch turns the pack). Off: Misato is offered
 * none of its tools, its dashboard cards hide and nothing calls its server; grants and data are kept, so on restores it
 * without granting again. `nerv tools remove` differs: it drops the server and its grants. Storage reuses config.json:
 * `packs.<id>: false` for a pack, `off: true` on the server's entry in `tools.mcp`.
 */
import { readConfig, savePacks, saveTools, type Config } from './config.ts';
import { builtinPackRegistry, type PackRegistry } from './packs.ts';
import type { ModuleRow } from './module-row.ts';

export type { ModuleRow };

/** A pack the owner knows under another module's name. */
const PACK_MODULE: Record<string, { id: string; name: string }> = { fpv: { id: 'fpvbuddy', name: 'FPVBuddy' } };

/** What the tools process's `tools.list` says per server (only servers that are on are listed). */
export type ServerListing = { server: string; error?: string }[];

/** A module made of two parts answers only when both do; unknown when either is unknown. */
const both = (a: boolean | null, b: boolean | null) =>
  a === false || b === false ? false : a === null || b === null ? null : true;

/** Every module, packs first in registry order, then MCP servers in config order. */
export function listModules(config: Config, registry: PackRegistry, listing?: ServerListing): ModuleRow[] {
  const rows = new Map<string, ModuleRow>();
  for (const pack of registry.list()) {
    const as = PACK_MODULE[pack.id] ?? { id: pack.id, name: pack.name };
    rows.set(as.id, {
      ...as,
      on: registry.isEnabled(pack.id, config.packs),
      reachable: true,
      tools: pack.tools.length,
      packs: [pack.id],
      servers: [],
    });
  }
  for (const s of config.tools?.mcp ?? []) {
    const listed = s.off ? undefined : listing?.find((l) => l.server === s.id);
    const reachable = s.off || !listed ? null : listed.error === undefined;
    const granted = (config.tools?.grants ?? []).filter((g) => g.server === s.id).length;
    const row = rows.get(s.id) ?? {
      id: s.id,
      name: s.id.charAt(0).toUpperCase() + s.id.slice(1),
      on: true,
      reachable: true,
      tools: 0,
      packs: [],
      servers: [],
    };
    rows.set(s.id, {
      ...row,
      on: row.on && !s.off,
      reachable: both(row.reachable, reachable),
      ...(listed?.error !== undefined ? { why: listed.error } : {}),
      tools: row.tools + granted,
      servers: [...row.servers, s.id],
    });
  }
  return [...rows.values()];
}

/** Turn a module on or off by its id (any case), keeping grants and data. */
export function setModuleOn(home: string, id: string, on: boolean): ModuleRow {
  const config = readConfig(home);
  const row = listModules(config, builtinPackRegistry).find((r) => r.id === id.toLowerCase());
  if (!row) throw new Error(`No module ${id}: nerv modules lists them.`);
  if (row.packs.length) {
    const packs = { ...config.packs };
    for (const p of row.packs)
      if (on) delete packs[p];
      else packs[p] = false;
    savePacks(home, packs);
  }
  if (row.servers.length) {
    const tools = config.tools!;
    saveTools(home, {
      ...tools,
      mcp: tools.mcp.map((s) => {
        if (!row.servers.includes(s.id)) return s;
        const { off: _, ...rest } = s;
        return on ? rest : { ...rest, off: true as const };
      }),
    });
  }
  return { ...row, on };
}
