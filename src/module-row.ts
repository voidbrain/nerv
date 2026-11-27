/**
 * F-159: one module as the service reports it and the dashboard shows it. Its own file, free of Node imports, so the
 * web app can share the shape (src/modules.ts builds the rows).
 */
export interface ModuleRow {
  id: string;
  name: string;
  on: boolean;
  /** Whether its parts answer now: a pack always does; null for a server while off (nothing is asked) or unlisted. */
  reachable: boolean | null;
  /** Why it is not reachable, as the tools process said. */
  why?: string;
  /** The tools it gives Misato: a pack's own and the server's granted ones. */
  tools: number;
  packs: string[];
  servers: string[];
}
