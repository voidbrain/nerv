import { builtinToolDescriptors } from './executors.ts';
import type { ExternalTools } from './runtime-api.ts';

/** F-021-T05: one tool as the dashboard lists it. */
export interface ListedTool {
  readonly name: string;
  /** `nerv` for NERV's own tools, `mcp:<server>` for a granted MCP tool. */
  readonly source: string;
  readonly effect: string;
  /** The descriptor version: a changed description is a new version, and an MCP grant is tied to it. */
  readonly version: string;
  /** NERV's own tools need no grant; an MCP tool is listed only while its grant matches. */
  readonly grant: 'built-in' | 'granted';
  /** The EVA class an MCP grant names, when it names one. */
  readonly eva?: string;
}

export interface ToolListing {
  readonly tools: ListedTool[];
  /** Granted MCP tools that do not run now, with why (changed description, server gone). */
  readonly suspended: { name: string; why: string }[];
}

/** NERV's own tools and, when given, the MCP tools granted on this base now: what the dashboard shows. */
export function toolListing(external?: ExternalTools): ToolListing {
  const own: ListedTool[] = builtinToolDescriptors.map((d) => ({
    name: d.name,
    source: 'nerv',
    effect: d.effect,
    version: d.version,
    grant: 'built-in',
  }));
  const granted: ListedTool[] = (external?.docs ?? []).map((d) => {
    const g = external!.byName.get(d.name);
    return {
      name: d.name,
      source: d.source,
      effect: d.effect,
      version: d.version,
      grant: 'granted',
      ...(g?.eva ? { eva: g.eva } : {}),
    };
  });
  return {
    tools: [...own, ...granted].sort((a, b) => a.name.localeCompare(b.name)),
    suspended: [...(external?.suspended ?? [])],
  };
}
