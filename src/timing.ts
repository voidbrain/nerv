/**
 * Per-call timing helpers (F-052): formatting durations, collecting sortie timings,
 * and summarizing daily median/slowest times per role.
 */
export interface SortieTiming {
  role: 'consultant' | 'misato' | 'casper' | 'seat' | 'executor' | 'kaji';
  label: string;
  durationMs: number;
  shadow?: boolean;
  transferMs?: number;
}
export interface RoleTimingStats {
  role: string;
  count: number;
  medianMs: number;
  maxMs: number;
}
/** Formats a millisecond duration as e.g. `38 s`, `6 s`, `0.1 s`, or `12 ms`. */
export function formatDurationMs(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  if (safe < 100) return `${safe} ms`;
  if (safe < 1000) return `${(safe / 1000).toFixed(1)} s`;
  return `${Math.round(safe / 1000)} s`;
}
/** Formats a sortie's step timings into one line, e.g. `Misato 38 s · Casper 6 s · Tabgha (shadow) 41 s · EVA-02 0.1 s`. */
export function formatSortieTimings(timings: readonly SortieTiming[], lang: 'en' | 'it' = 'en'): string {
  const shadowWord = lang === 'it' ? 'ombra' : 'shadow';
  return timings
    .map((t) => `${t.label}${t.shadow ? ` (${shadowWord})` : ''} ${formatDurationMs(t.durationMs)}`)
    .join(' · ');
}
/** Computes median and slowest (max) duration in ms for each role, slowest first. */
export function computeRoleTimingStats(samples: readonly { role: string; durationMs: number }[]): RoleTimingStats[] {
  const grouped = new Map<string, number[]>();
  for (const s of samples) {
    if (!s.role || !Number.isFinite(s.durationMs) || s.durationMs < 0) continue;
    const list = grouped.get(s.role) ?? [];
    list.push(Math.round(s.durationMs));
    grouped.set(s.role, list);
  }
  const stats: RoleTimingStats[] = [];
  for (const [role, values] of grouped) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const medianMs = values.length % 2 === 1 ? values[mid]! : Math.round((values[mid - 1]! + values[mid]!) / 2);
    stats.push({
      role,
      count: values.length,
      medianMs,
      maxMs: values[values.length - 1]!,
    });
  }
  return stats.sort((a, b) => b.maxMs - a.maxMs || b.medianMs - a.medianMs || a.role.localeCompare(b.role));
}
