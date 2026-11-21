import type { ChannelState } from './channel-state.ts';

export type ChatCommandName =
  'help' | 'status' | 'cards' | 'reminders' | 'why' | 'brief' | 'pilots' | 'bases' | 'spear' | 'log';

export interface CommandCatalogEntry {
  readonly name: ChatCommandName;
  readonly usage: string;
  readonly summaryEn: string;
  readonly summaryIt: string;
  readonly readOnly: boolean;
}

export const COMMAND_CATALOG: readonly CommandCatalogEntry[] = [
  {
    name: 'help',
    usage: '/help',
    summaryEn: 'List available commands',
    summaryIt: 'Elenca i comandi disponibili',
    readOnly: true,
  },
  {
    name: 'status',
    usage: '/status [base]',
    summaryEn: 'Show base health and Midori status',
    summaryIt: 'Mostra stato della base e di Midori',
    readOnly: true,
  },
  {
    name: 'cards',
    usage: '/cards',
    summaryEn: 'List pending approval cards',
    summaryIt: 'Mostra le schede in attesa di approvazione',
    readOnly: true,
  },
  {
    name: 'reminders',
    usage: '/reminders',
    summaryEn: 'List pending reminders',
    summaryIt: 'Mostra i promemoria in attesa',
    readOnly: true,
  },
  {
    name: 'why',
    usage: '/why S-XXXX',
    summaryEn: 'Explain a sortie or action from the ledger',
    summaryIt: 'Spiega una sortita o azione dal registro',
    readOnly: true,
  },
  {
    name: 'brief',
    usage: '/brief',
    summaryEn: 'Show brief schedule and latest summary',
    summaryIt: 'Mostra orario del brief e stato recente',
    readOnly: true,
  },
  {
    name: 'pilots',
    usage: '/pilots',
    summaryEn: 'List configured specialist pilots',
    summaryIt: 'Elenca i piloti specialistici configurati',
    readOnly: true,
  },
  {
    name: 'bases',
    usage: '/bases',
    summaryEn: 'List enrolled bases in the mesh',
    summaryIt: 'Elenca le basi registrate nella rete',
    readOnly: true,
  },
  {
    name: 'spear',
    usage: '/spear [S-XXXX]',
    summaryEn: 'Stop an active or waiting sortie',
    summaryIt: 'Ferma una sortita attiva o in attesa',
    readOnly: false,
  },
  {
    name: 'log',
    usage: '/log conversation|steps|all',
    summaryEn: 'Set trace verbosity for chat replies',
    summaryIt: 'Imposta il dettaglio della traccia in chat',
    readOnly: false,
  },
];

const KNOWN_COMMANDS = new Set<string>(COMMAND_CATALOG.map((c) => c.name));

export function helpText(language: 'en' | 'it'): string {
  const it = language === 'it';
  const header = it ? 'Comandi disponibili:' : 'Available commands:';
  const lines = COMMAND_CATALOG.map((c) => `${c.usage} — ${it ? c.summaryIt : c.summaryEn}`);
  return `${header}\n${lines.join('\n')}`;
}

/** Command menu entries for Telegram `setMyCommands`, generated from `COMMAND_CATALOG` (F-056-T04). */
export function telegramCommands(language: 'en' | 'it' = 'en'): { command: string; description: string }[] {
  return COMMAND_CATALOG.map((c) => ({
    command: c.name,
    description: language === 'it' ? c.summaryIt : c.summaryEn,
  }));
}

/** Read commands are recognized before planning/dispatch; prose aliases are deliberately narrow. */
export function readCommand(text: string): { name: ChatCommandName | 'unknown'; target?: string } | undefined {
  const value = text.trim();
  const alias = /^ask (.{1,60}?) (?:his |her |its |for )?\/status[.!?]?$/i.exec(value);
  if (alias) return { name: 'status', target: alias[1]!.trim() };
  const match = /^\/([a-z]+)(?:@[a-z0-9_]+)?(?:\s+(.{1,80}))?$/i.exec(value);
  if (!match) return value.startsWith('/') ? { name: 'unknown' } : undefined;
  const name = match[1]!.toLowerCase();
  return {
    name: KNOWN_COMMANDS.has(name) ? (name as ChatCommandName) : 'unknown',
    ...(match[2] ? { target: match[2].trim() } : {}),
  };
}
export interface StatusBase {
  baseId: string;
  name: string;
  online: boolean;
  self?: boolean;
  health?: { state: string; reasons: string[] } | null;
  channel?: ChannelState | null;
  channelFresh?: boolean;
  operator?: { name: string; aliases: string[] } | null;
}
export function statusText(bases: StatusBase[], target: string | undefined, language: 'en' | 'it'): string {
  const it = language === 'it';
  const q = target?.trim().toLowerCase();
  let selected = q
    ? bases.filter((b) => b.baseId.toLowerCase() === q || b.name.toLowerCase() === q)
    : bases.filter((b) => b.self);
  if (q && !selected.length) {
    const byOperator = bases.filter(
      (b) =>
        b.operator && (b.operator.name.toLowerCase() === q || b.operator.aliases.some((a) => a.toLowerCase() === q)),
    );
    if (byOperator.length > 1) {
      const list = byOperator.map((b) => `${b.baseId} (${b.name})`).join(', ');
      return it
        ? `Alias operatore "${target}" ambiguo tra più basi (${list}). Specifica /status ID-base.`
        : `Operator alias "${target}" is ambiguous across multiple bases (${list}). Specify /status BASE-ID.`;
    }
    selected = byOperator;
  }
  if (!selected.length)
    return it
      ? 'Base non trovata nei registri locali. Usa /status ID-base.'
      : 'Base not found in the local registry. Use /status BASE-ID.';
  return selected
    .map((b) => {
      const mode = b.channelFresh && b.channel ? b.channel.mode : 'unknown';
      const opLine = b.operator ? `\n${it ? 'Operatore' : 'Operator'}: ${b.operator.name}` : '';
      return `${b.baseId} · ${b.name}\n${it ? 'Stato' : 'State'}: ${b.online ? (b.health?.state ?? 'online') : 'offline'}${b.health?.reasons.length ? ' · ' + b.health.reasons.join('; ') : ''}${opLine}\nMidori: ${mode}${b.channel?.destination ? ' → ' + b.channel.destination : ''}\n${it ? 'Fonte: registri e ultimo rapporto della base; nessuna chiamata al modello.' : 'Source: local records and the base’s last report; no model call.'}`;
    })
    .join('\n\n');
}
