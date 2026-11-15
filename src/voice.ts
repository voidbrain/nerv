export type VoiceLanguage = 'it' | 'en';

export type VoiceIntentKind =
  'status-query' | 'reminder-create' | 'battery-state' | 'cooking-step' | 'refused-escalation' | 'unknown';

export interface VoiceCommandCase {
  id: string;
  language: VoiceLanguage;
  split: 'regression' | 'holdout';
  transcript: string;
  expectedIntent: VoiceIntentKind;
  expectedTarget?: string;
  expectedRequiresConfirmation: boolean;
  expectedRefused: boolean;
}

export interface VoiceCorpus {
  id: string;
  schemaVersion: 1;
  languages: VoiceLanguage[];
  cases: VoiceCommandCase[];
}

export interface VoiceIntentMatch {
  intent: VoiceIntentKind;
  language: VoiceLanguage;
  target?: string;
  requiresConfirmation: boolean;
  refused: boolean;
  reason: string;
}

export interface VoiceCorpusReport {
  corpusId: string;
  total: number;
  passed: number;
  holdoutTotal: number;
  holdoutPassed: number;
  italianPassed: number;
  italianTotal: number;
  englishPassed: number;
  englishTotal: number;
  failures: Array<{ id: string; reason: string }>;
}

const ESCALATION_RE = /\b(sudo|scrolls\.json|anthropic-key|seat-keys|gpio\.relay|senza chiedere|without asking)\b/i;
const BASE_TARGET_RE = /\b(NERV-[A-Z0-9-]+|BASE-[A-Z0-9-]+)\b/i;

export function detectVoiceLanguage(transcript: string): VoiceLanguage {
  const lower = transcript.toLowerCase();
  if (
    /\b(stato|basi|base|ricordami|batterie|batteria|carica|scarica|passaggio|avvia|esegui|senza|quale|qual è|controlla)\b/.test(
      lower,
    )
  ) {
    return 'it';
  }
  return 'en';
}

/**
 * Parses a push-to-talk transcript in Italian or English into a bounded intent (F-007-T02).
 * Refuses policy/credential/silent physical escalation and requires confirmation for mutating intents.
 */
export function parseVoiceCommandIntent(transcript: string, language?: VoiceLanguage): VoiceIntentMatch {
  const text = transcript.trim();
  const lang = language ?? detectVoiceLanguage(text);
  const target = BASE_TARGET_RE.exec(text)?.[1]?.toUpperCase();

  if (ESCALATION_RE.test(text)) {
    return {
      intent: 'refused-escalation',
      language: lang,
      ...(target ? { target } : {}),
      requiresConfirmation: true,
      refused: true,
      reason: 'Policy, credential, or unconfirmed physical escalation is refused.',
    };
  }

  const lower = text.toLowerCase();

  if (/\b(batteria|batterie|battery|batteries|storage|stored|carica|scarica)\b/.test(lower)) {
    if (/\b(ricordami|remind|reminder|promemoria)\b/.test(lower)) {
      return {
        intent: 'reminder-create',
        language: lang,
        ...(target ? { target } : {}),
        requiresConfirmation: true,
        refused: false,
        reason: 'Reminder creation requires transcript confirmation before scheduling.',
      };
    }
    return {
      intent: 'battery-state',
      language: lang,
      ...(target ? { target } : {}),
      requiresConfirmation: true,
      refused: false,
      reason: 'Battery state update requires transcript confirmation before writing.',
    };
  }

  if (/\b(ricordami|promemoria|remind|reminder)\b/.test(lower)) {
    return {
      intent: 'reminder-create',
      language: lang,
      ...(target ? { target } : {}),
      requiresConfirmation: true,
      refused: false,
      reason: 'Reminder creation requires transcript confirmation before scheduling.',
    };
  }

  if (/\b(passaggio|avanti|prossimo|timer|ripeti|next step|repeat|instructions)\b/.test(lower)) {
    return {
      intent: 'cooking-step',
      language: lang,
      requiresConfirmation: false,
      refused: false,
      reason: 'Read-only / hands-free recipe navigation.',
    };
  }

  if (/\b(stato|status|controlla|check)\b/.test(lower)) {
    return {
      intent: 'status-query',
      language: lang,
      ...(target ? { target } : {}),
      requiresConfirmation: false,
      refused: false,
      reason: 'Read-only status query.',
    };
  }

  return {
    intent: 'unknown',
    language: lang,
    ...(target ? { target } : {}),
    requiresConfirmation: true,
    refused: false,
    reason: 'Unrecognized voice command; ask for clarification.',
  };
}

/** Evaluates a bilingual Italian/English voice command corpus against `parseVoiceCommandIntent` (F-007-T02). */
export function evaluateVoiceCorpus(corpus: VoiceCorpus): VoiceCorpusReport {
  if (!corpus || corpus.schemaVersion !== 1 || !Array.isArray(corpus.cases) || corpus.cases.length === 0) {
    throw new Error('Invalid voice corpus: requires schemaVersion 1 and non-empty cases.');
  }
  let passed = 0;
  let holdoutTotal = 0;
  let holdoutPassed = 0;
  let italianTotal = 0;
  let italianPassed = 0;
  let englishTotal = 0;
  let englishPassed = 0;
  const failures: Array<{ id: string; reason: string }> = [];

  for (const c of corpus.cases) {
    const match = parseVoiceCommandIntent(c.transcript, c.language);
    const reasons: string[] = [];
    if (match.intent !== c.expectedIntent) {
      reasons.push(`expected intent ${c.expectedIntent}, got ${match.intent}`);
    }
    if (c.expectedTarget !== undefined && match.target !== c.expectedTarget) {
      reasons.push(`expected target ${c.expectedTarget}, got ${match.target ?? 'none'}`);
    }
    if (match.requiresConfirmation !== c.expectedRequiresConfirmation) {
      reasons.push(
        `expected requiresConfirmation=${c.expectedRequiresConfirmation}, got ${match.requiresConfirmation}`,
      );
    }
    if (match.refused !== c.expectedRefused) {
      reasons.push(`expected refused=${c.expectedRefused}, got ${match.refused}`);
    }
    const ok = reasons.length === 0;
    if (ok) passed += 1;
    else failures.push({ id: c.id, reason: reasons.join('; ') });

    if (c.split === 'holdout') {
      holdoutTotal += 1;
      if (ok) holdoutPassed += 1;
    }
    if (c.language === 'it') {
      italianTotal += 1;
      if (ok) italianPassed += 1;
    } else {
      englishTotal += 1;
      if (ok) englishPassed += 1;
    }
  }

  return {
    corpusId: corpus.id,
    total: corpus.cases.length,
    passed,
    holdoutTotal,
    holdoutPassed,
    italianPassed,
    italianTotal,
    englishPassed,
    englishTotal,
    failures,
  };
}
