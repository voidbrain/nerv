/**
 * F-130-T01: the dashboard's theme tokens for the workspace, framework-free. A port of palette() in
 * web/public/dashboard/dashboard.js (F-047): Theme (eva | simple) × Mode (dark | light) × Accent, every text colour
 * at WCAG AA. test/dashboard-theme.test.ts keeps the two equal for all 20 combinations until F-130-T13 retires the old
 * page. The workspace default is plain (simple · dark); EVA is the optional theme (owner decision 2026-11-25).
 */
export type Theme = 'simple' | 'eva';
export type Mode = 'dark' | 'light';
export type Accent = 'orange' | 'blue' | 'green' | 'violet' | 'ochre';
export interface ThemeChoice {
  theme: Theme;
  mode: Mode;
  accent: Accent;
}

export const ACCENTS: Record<Accent, { base: string; tint: string; soft: string; deep: string }> = {
  orange: { base: '#ff6600', tint: '#ffaa66', soft: '#a67c52', deep: '#b34700' },
  blue: { base: '#2a7fff', tint: '#9cc4ff', soft: '#7d97bd', deep: '#1d5fd1' },
  green: { base: '#22c55e', tint: '#8ef0b0', soft: '#74a888', deep: '#166534' },
  violet: { base: '#a855f7', tint: '#d5b0ff', soft: '#9d88bf', deep: '#7e3fc4' },
  ochre: { base: '#d4a017', tint: '#f0cf7a', soft: '#a8925f', deep: '#7a5d00' },
};

export const DEFAULT_THEME: ThemeChoice = { theme: 'simple', mode: 'dark', accent: 'orange' };

/** A stored or typed choice, each part checked; anything unknown falls back to the default part. */
export function themeChoice(value: unknown): ThemeChoice {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    theme: v.theme === 'eva' || v.theme === 'simple' ? v.theme : DEFAULT_THEME.theme,
    mode: v.mode === 'light' || v.mode === 'dark' ? v.mode : DEFAULT_THEME.mode,
    accent:
      typeof v.accent === 'string' && Object.hasOwn(ACCENTS, v.accent) ? (v.accent as Accent) : DEFAULT_THEME.accent,
  };
}

function rgba(hex: string, alpha: number): string {
  return (
    'rgba(' +
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',') +
    ',' +
    String(alpha).replace(/^0\./, '.') +
    ')'
  );
}

function mix(hex: string, to: string, t: number): string {
  return (
    '#' +
    [1, 3, 5]
      .map((i) =>
        Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + parseInt(to.slice(i, i + 2), 16) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Token name (without the leading --) to colour, for one Theme · Mode · Accent. */
export function palette({ theme, mode, accent }: ThemeChoice): Record<string, string> {
  const a = ACCENTS[accent] ?? ACCENTS.orange,
    eva = theme !== 'simple',
    dark = mode !== 'light';
  const status = dark
    ? {
        ok: '#22c55e',
        warn: eva ? '#ffcc00' : '#f59e0b',
        danger: eva ? '#ff0033' : '#ef4444',
        info: eva ? '#00aaff' : '#38bdf8',
        green: '#22c55e',
        orange: eva ? '#ff8800' : '#f59e0b',
        blue: eva ? '#2a7fff' : '#3b82f6',
      }
    : {
        ok: '#166534',
        warn: '#a15c07',
        danger: '#b91c1c',
        info: '#0369a1',
        green: '#166534',
        orange: '#9a4708',
        blue: '#1d4ed8',
      };
  const base = dark
    ? {
        'on-danger': '#000',
        kanji: eva ? '#ff0033' : '#ef4444',
        eva00: '#2a7fff',
        eva01: '#9b5cff',
        eva02: '#ff3b30',
        eva03: '#8a8a8a',
      }
    : { 'on-danger': '#fff', kanji: '#b91c1c', eva00: '#1d5fd1', eva01: '#7e3fc4', eva02: '#c0261c', eva03: '#5f5f5f' };
  if (eva && dark)
    return Object.assign(
      {
        bg: '#050508',
        panel: '#0d0d12',
        panel2: '#09090d',
        border: rgba(a.base, 0.4),
        text: a.tint,
        muted: a.soft,
        accent: a.base,
        'hdr-bg': a.base,
        'hdr-fg': '#000',
        'brand-bg': a.base,
        'brand-fg': '#000',
        title: a.tint,
        topo: rgba(a.base, 0.42),
        land: '#0c0a0a',
        sea: '#050508',
        glow: rgba(a.base, 0.35),
      },
      status,
      base,
    );
  if (eva)
    return Object.assign(
      {
        bg: '#f3f1ec',
        panel: '#ffffff',
        panel2: '#f8f7f3',
        border: rgba(a.deep, 0.45),
        text: mix(a.deep, '#000000', 0.5),
        muted: a.deep,
        accent: a.deep,
        'hdr-bg': a.base,
        'hdr-fg': '#000',
        'brand-bg': a.deep,
        'brand-fg': '#fff',
        title: mix(a.deep, '#000000', 0.5),
        topo: rgba(a.deep, 0.35),
        land: '#e8e5de',
        sea: '#f3f1ec',
        glow: rgba(a.deep, 0.25),
      },
      status,
      base,
    );
  if (dark)
    return Object.assign(
      {
        bg: '#0b0c10',
        panel: '#12141a',
        panel2: '#0e1015',
        border: '#2a2e3a',
        text: '#e6e8ee',
        muted: '#8b93a7',
        accent: a.base,
        'hdr-bg': 'transparent',
        'hdr-fg': '#8b93a7',
        'brand-bg': a.base,
        'brand-fg': '#000',
        title: '#e6e8ee',
        topo: '#2f3646',
        land: '#151922',
        sea: '#0b0c10',
        glow: rgba(a.base, 0.3),
      },
      status,
      base,
    );
  return Object.assign(
    {
      bg: '#f4f5f7',
      panel: '#ffffff',
      panel2: '#f7f8fa',
      border: '#d8dde8',
      text: '#1a1d26',
      muted: '#5c657a',
      accent: a.deep,
      'hdr-bg': 'transparent',
      'hdr-fg': '#5c657a',
      'brand-bg': a.deep,
      'brand-fg': '#fff',
      title: '#1a1d26',
      topo: '#c3cad8',
      land: '#e9ecf2',
      sea: '#f4f5f7',
      glow: rgba(a.deep, 0.25),
    },
    status,
    base,
  );
}

/** The tokens keyed by custom property (`--bg`), for a host `[style]` binding (set through CSSOM, CSP-safe). */
export function tokenStyle(choice: ThemeChoice): Record<string, string> {
  return Object.fromEntries(Object.entries(palette(choice)).map(([k, v]) => ['--' + k, v]));
}
