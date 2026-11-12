export const REMINDER_KINDS = ['at', 'all-day', 'from-to', 'from', 'until'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const DEFAULT_BRIEF_AT = '08:00';
export const UNTIL_LEAD_MS = 60 * 60 * 1000;

export function normalizeReminderKind(value: unknown): ReminderKind {
  if (value === undefined || value === null || value === '') return 'at';
  if (typeof value !== 'string') throw new Error('Reminder kind must be all-day, at, from-to, from or until.');
  const clean = value.trim().toLowerCase().replace(/[–_]/g, '-');
  if (clean === 'at' || clean === 'at a time' || clean === 'at-a-time') return 'at';
  if (clean === 'all-day' || clean === 'all day' || clean === 'allday') return 'all-day';
  if (clean === 'from-to' || clean === 'from to' || clean === 'between') return 'from-to';
  if (clean === 'from' || clean === 'after') return 'from';
  if (clean === 'until' || clean === 'by' || clean === 'before') return 'until';
  throw new Error('Reminder kind must be all-day, at, from-to, from or until.');
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayKey: string;
  hhmm: string;
}

export function localParts(date: Date, timeZone = 'Europe/Rome'): LocalDateParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const rawHour = get('hour');
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = get('minute');
  return {
    year,
    month,
    day,
    hour,
    minute,
    dayKey: `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`,
    hhmm: `${pad2(hour)}:${pad2(minute)}`,
  };
}

export function isValidDayKey(dayKey: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function validateIsoTimestamp(due: string): number {
  if (
    typeof due !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.test(due) ||
    !Number.isFinite(Date.parse(due))
  ) {
    throw new Error('Use an ISO date with an explicit timezone offset.');
  }
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,3})?)?(Z|[+-](\d\d):(\d\d))$/.exec(due)!;
  const [, year, month, day, hour, minute, second, zone, offsetHour, offsetMinute] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > days ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second ?? 0) > 59 ||
    (zone !== 'Z' &&
      (Number(offsetHour) > 14 ||
        Number(offsetMinute) > 59 ||
        (Number(offsetHour) === 14 && Number(offsetMinute) !== 0)))
  ) {
    throw new Error('Invalid calendar date or timezone offset.');
  }
  return Date.parse(due);
}

export function localDayTimeToUtc(dayKey: string, hhmm: string, timeZone = 'Europe/Rome'): Date {
  if (!isValidDayKey(dayKey)) throw new Error('Reminder due date must be a valid ISO timestamp.');
  const tm = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!tm) throw new Error('Reminder clock time must be HH:MM.');
  const y = Number(dayKey.slice(0, 4));
  const mo = Number(dayKey.slice(5, 7));
  const d = Number(dayKey.slice(8, 10));
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) throw new Error('Reminder clock time must be HH:MM.');
  const targetAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  let guess = targetAsUtc;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
    guess += targetAsUtc - actualAsUtc;
  }
  return new Date(guess);
}

export function addDaysToDayKey(dayKey: string, days: number): string {
  const y = Number(dayKey.slice(0, 4));
  const mo = Number(dayKey.slice(5, 7));
  const d = Number(dayKey.slice(8, 10));
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export interface ResolveReminderTimeOptions {
  due: string;
  kind?: unknown;
  end?: string | null | undefined;
  now?: Date | undefined;
  timeZone?: string | undefined;
  briefAt?: string | undefined;
}

export interface ResolvedReminderTime {
  due: string;
  kind: ReminderKind;
  end: string | null;
}

export function resolveReminderTime(opts: ResolveReminderTimeOptions): ResolvedReminderTime {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone || 'Europe/Rome';
  const briefAt = opts.briefAt && /^\d{2}:\d{2}$/.test(opts.briefAt) ? opts.briefAt : DEFAULT_BRIEF_AT;
  const rawDue = typeof opts.due === 'string' ? opts.due.trim() : '';
  if (!rawDue) throw new Error('Reminder due date must be a valid ISO timestamp.');
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawDue);
  const kind =
    opts.kind !== undefined && opts.kind !== null && opts.kind !== ''
      ? normalizeReminderKind(opts.kind)
      : isDateOnly
        ? 'all-day'
        : 'at';

  if (kind === 'all-day') {
    let dayKey: string;
    if (isDateOnly) {
      if (!isValidDayKey(rawDue)) throw new Error('Invalid calendar date or timezone offset.');
      dayKey = rawDue;
    } else {
      const parsed = validateIsoTimestamp(rawDue);
      dayKey = localParts(new Date(parsed), timeZone).dayKey;
    }
    const arrival = localDayTimeToUtc(dayKey, briefAt, timeZone);
    const dayEnd = localDayTimeToUtc(dayKey, '23:59', timeZone);
    if (dayEnd.getTime() <= now.getTime()) {
      throw new Error('Reminder must be in the future.');
    }
    return { due: arrival.toISOString(), kind: 'all-day', end: null };
  }

  if (kind === 'at' || kind === 'from') {
    const parsed = isDateOnly ? localDayTimeToUtc(rawDue, briefAt, timeZone).getTime() : validateIsoTimestamp(rawDue);
    if (parsed <= now.getTime()) throw new Error('Reminder must be in the future.');
    return { due: new Date(parsed).toISOString(), kind, end: null };
  }

  if (kind === 'from-to') {
    const startMs = validateIsoTimestamp(rawDue);
    if (startMs <= now.getTime()) throw new Error('Reminder must be in the future.');
    const rawEnd = typeof opts.end === 'string' ? opts.end.trim() : '';
    if (!rawEnd) throw new Error('From–to reminder requires a valid end timestamp.');
    const endMs = validateIsoTimestamp(rawEnd);
    if (endMs <= startMs) {
      throw new Error('From–to reminder end must be after its start.');
    }
    return {
      due: new Date(startMs).toISOString(),
      kind: 'from-to',
      end: new Date(endMs).toISOString(),
    };
  }

  // kind === 'until'
  const rawEnd = typeof opts.end === 'string' ? opts.end.trim() : '';
  if (rawEnd && rawEnd !== rawDue) {
    const startMs = validateIsoTimestamp(rawDue);
    const endMs = validateIsoTimestamp(rawEnd);
    if (endMs <= now.getTime()) {
      throw new Error('Reminder must be in the future.');
    }
    if (startMs >= endMs) {
      throw new Error('Until reminder arrival must be ahead of its end.');
    }
    const arrivalMs =
      startMs > now.getTime() ? startMs : now.getTime() + Math.max(1000, Math.floor((endMs - now.getTime()) / 2));
    return {
      due: new Date(arrivalMs).toISOString(),
      kind: 'until',
      end: new Date(endMs).toISOString(),
    };
  }

  const endMs = isDateOnly ? localDayTimeToUtc(rawDue, '18:00', timeZone).getTime() : validateIsoTimestamp(rawDue);
  if (endMs <= now.getTime()) throw new Error('Reminder must be in the future.');
  const arrivalMs =
    endMs - UNTIL_LEAD_MS > now.getTime()
      ? endMs - UNTIL_LEAD_MS
      : now.getTime() + Math.max(1000, Math.floor((endMs - now.getTime()) / 2));
  return {
    due: new Date(arrivalMs).toISOString(),
    kind: 'until',
    end: new Date(endMs).toISOString(),
  };
}

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  gennaio: 1,
  gen: 1,
  february: 2,
  feb: 2,
  febbraio: 2,
  march: 3,
  mar: 3,
  marzo: 3,
  april: 4,
  apr: 4,
  aprile: 4,
  may: 5,
  maggio: 5,
  mag: 5,
  june: 6,
  jun: 6,
  giugno: 6,
  giu: 6,
  july: 7,
  jul: 7,
  luglio: 7,
  lug: 7,
  august: 8,
  aug: 8,
  agosto: 8,
  ago: 8,
  september: 9,
  sep: 9,
  sept: 9,
  settembre: 9,
  set: 9,
  october: 10,
  oct: 10,
  ottobre: 10,
  ott: 10,
  november: 11,
  nov: 11,
  novembre: 11,
  december: 12,
  dec: 12,
  dicembre: 12,
  dic: 12,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  domenica: 0,
  monday: 1,
  lunedi: 1,
  lunedì: 1,
  tuesday: 2,
  martedi: 2,
  martedì: 2,
  wednesday: 3,
  mercoledi: 3,
  mercoledì: 3,
  thursday: 4,
  giovedi: 4,
  giovedì: 4,
  friday: 5,
  venerdi: 5,
  venerdì: 5,
  saturday: 6,
  sabato: 6,
};

function parseClockToken(raw: string, fallbackMeridiem?: string): string | undefined {
  const clean = raw.trim().toLowerCase();
  if (clean === 'noon' || clean === 'mezzogiorno') return '12:00';
  if (clean === 'midnight' || clean === 'mezzanotte') return '00:00';
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(clean);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (minute < 0 || minute > 59) return undefined;
  const mer = (m[3] || fallbackMeridiem || '').toLowerCase();
  if (mer === 'am') {
    if (hour < 1 || hour > 12) return undefined;
    if (hour === 12) hour = 0;
  } else if (mer === 'pm') {
    if (hour < 1 || hour > 12) return undefined;
    if (hour < 12) hour += 12;
  } else {
    if (hour < 0 || hour > 24) return undefined;
    if (hour === 24) return '23:59';
  }
  return `${pad2(hour)}:${pad2(minute)}`;
}

const NOT_DATE_OR_UNIT_AFTER_CLOCK =
  '(?!\\s*(?:st|nd|rd|th|°)?\\s*(?:of\\s+)?(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec|gennaio|gen|febbraio|marzo|aprile|maggio|mag|giugno|giu|luglio|lug|agosto|ago|settembre|set|ottobre|ott|novembre|dicembre|dic)\\b)(?!\\s*(?:minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks|month|months|year|years|minut[oi]|or[ae]|giorn[oi]|settiman[ae]|mes[ei]|ann[oi])\\b)';

const CLOCK_TOKEN = '(\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm)?|noon|midnight|mezzogiorno|mezzanotte)';

const RE_FROM_TO_EN_BETWEEN = new RegExp(
  `\\bbetween\\s+${CLOCK_TOKEN}\\s+and\\s+${CLOCK_TOKEN}${NOT_DATE_OR_UNIT_AFTER_CLOCK}`,
  'i',
);
const RE_FROM_TO_EN_FROM = new RegExp(
  `\\bfrom\\s+${CLOCK_TOKEN}\\s+(?:to|until|till|–|-)\\s+${CLOCK_TOKEN}${NOT_DATE_OR_UNIT_AFTER_CLOCK}`,
  'i',
);
const RE_FROM_TO_IT_TRA = new RegExp(
  `\\b(?:tra|fra)\\s+(?:le(?:\\s+ore)?\\s+|l['’]\\s*)?${CLOCK_TOKEN}\\s+e\\s+(?:le(?:\\s+ore)?\\s+|l['’]\\s*)?${CLOCK_TOKEN}${NOT_DATE_OR_UNIT_AFTER_CLOCK}`,
  'i',
);
const RE_FROM_TO_IT_DALLE = new RegExp(
  `\\b(?:dalle(?:\\s+ore)?\\s+|dall['’]\\s*)${CLOCK_TOKEN}\\s+(?:alle(?:\\s+ore)?\\s+|all['’]\\s*|fino\\s+alle\\s+${CLOCK_TOKEN ? '' : ''})${CLOCK_TOKEN}${NOT_DATE_OR_UNIT_AFTER_CLOCK}`,
  'i',
);

const RE_UNTIL_EN = new RegExp(
  `\\b(?:by|until|till|before|no\\s+later\\s+than)\\s+${CLOCK_TOKEN}${NOT_DATE_OR_UNIT_AFTER_CLOCK}`,
  'i',
);
const RE_UNTIL_IT = new RegExp(
  `\\b(?:entro\\s+(?:le(?:\\s+ore)?\\s+|l['’]\\s*)?(?=\\d|mezzogiorno|mezzanotte)|fino\\s+(?:alle(?:\\s+ore)?\\s+|all['’]\\s*|a\\s+(?=mezzogiorno|mezzanotte))|prima\\s+(?:delle(?:\\s+ore)?\\s+|dell['’]\\s*|di\\s+(?=mezzogiorno|mezzanotte)))${CLOCK_TOKEN}${NOT_DATE_OR_UNIT_AFTER_CLOCK}`,
  'i',
);

const RE_FROM_EN = new RegExp(
  `\\b(?:after|from|starting(?:\\s+at|\\s+from)?)\\s+${CLOCK_TOKEN}${NOT_DATE_OR_UNIT_AFTER_CLOCK}`,
  'i',
);
const RE_FROM_IT = new RegExp(
  `\\b(?:dopo\\s+(?:le(?:\\s+ore)?\\s+|l['’]\\s*)?(?=\\d|mezzogiorno|mezzanotte)|dalle(?:\\s+ore)?\\s+|dall['’]\\s*|a\\s+partire\\s+(?:dalle\\s+|dall['’]\\s*))${CLOCK_TOKEN}${NOT_DATE_OR_UNIT_AFTER_CLOCK}`,
  'i',
);

const RE_AT_EN = new RegExp(`\\bat\\s+${CLOCK_TOKEN}${NOT_DATE_OR_UNIT_AFTER_CLOCK}`, 'i');
const RE_AT_IT = new RegExp(
  `\\b(?:alle(?:\\s+ore)?\\s+|all['’]\\s*|a\\s+(?=mezzogiorno|mezzanotte))${CLOCK_TOKEN}${NOT_DATE_OR_UNIT_AFTER_CLOCK}`,
  'i',
);

const RE_RELATIVE_OR_PART_OF_DAY =
  /\b(?:in\s+\d+\s+(?:minute|minutes|min|mins|hour|hours|hr|hrs)|(?:tra|fra)\s+\d+\s+(?:minut[oi]|or[ae])|morning|afternoon|evening|tonight|stamattina|stasera|stanotte|mattina|pomeriggio|sera)\b/i;

const RE_EXPLICIT_ALL_DAY = /\b(?:all[\s-]day|tutto\s+il\s+giorno)\b/i;

interface ParsedDateInfo {
  dayKey: string;
  explicitYear: boolean;
  month?: number | undefined;
  day?: number | undefined;
}

function parseDateFromText(
  text: string,
  now: Date,
  timeZone: string,
  fallbackDue?: string,
): ParsedDateInfo | undefined {
  const nowLocal = localParts(now, timeZone);
  const fallbackLocal =
    fallbackDue && Number.isFinite(Date.parse(fallbackDue))
      ? localParts(new Date(Date.parse(fallbackDue)), timeZone)
      : undefined;

  const isoMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (isoMatch && isValidDayKey(isoMatch[1]!)) {
    return { dayKey: isoMatch[1]!, explicitYear: true };
  }

  const monthNames = Object.keys(MONTHS).join('|');
  const dayFirst = new RegExp(
    `\\b(?:on\\s+(?:the\\s+)?|il\\s+)?(\\d{1,2})(?:st|nd|rd|th|°)?\\s+(?:of\\s+)?(${monthNames})(?:\\s+(\\d{4}))?\\b`,
    'i',
  ).exec(text);
  const monthFirst = new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i').exec(
    text,
  );

  if (dayFirst || monthFirst) {
    const day = Number(dayFirst ? dayFirst[1] : monthFirst![2]);
    const monthName = (dayFirst ? dayFirst[2] : monthFirst![1])!.toLowerCase();
    const month = MONTHS[monthName]!;
    const explicitYearStr = dayFirst ? dayFirst[3] : monthFirst![3];
    let year: number;
    if (explicitYearStr) {
      year = Number(explicitYearStr);
    } else if (fallbackLocal && fallbackLocal.month === month && fallbackLocal.day === day) {
      year = fallbackLocal.year;
    } else {
      year = nowLocal.year;
      const candidate = `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
      if (isValidDayKey(candidate)) {
        const endOfCandidate = localDayTimeToUtc(candidate, '23:59', timeZone);
        if (endOfCandidate.getTime() <= now.getTime()) year += 1;
      }
    }
    const dayKey = `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
    if (isValidDayKey(dayKey)) {
      return { dayKey, explicitYear: Boolean(explicitYearStr), month, day };
    }
  }

  if (/\b(?:day\s+after\s+tomorrow|dopodomani)\b/i.test(text)) {
    const base = fallbackLocal ? addDaysToDayKey(nowLocal.dayKey, 2) : addDaysToDayKey(nowLocal.dayKey, 2);
    return { dayKey: base, explicitYear: false };
  }
  if (/\b(?:tomorrow|domani)\b/i.test(text)) {
    const dayKey =
      fallbackLocal && fallbackLocal.dayKey > nowLocal.dayKey
        ? fallbackLocal.dayKey
        : addDaysToDayKey(nowLocal.dayKey, 1);
    return { dayKey, explicitYear: false };
  }
  if (/\b(?:today|oggi)\b/i.test(text)) {
    const dayKey = fallbackLocal && fallbackLocal.dayKey >= nowLocal.dayKey ? fallbackLocal.dayKey : nowLocal.dayKey;
    return { dayKey, explicitYear: false };
  }

  for (const [name, targetDow] of Object.entries(WEEKDAYS)) {
    const re = new RegExp(`(?<![\\p{L}])${name}(?![\\p{L}])`, 'iu');
    if (re.test(text)) {
      if (fallbackLocal && fallbackLocal.dayKey > nowLocal.dayKey) {
        return { dayKey: fallbackLocal.dayKey, explicitYear: false };
      }
      const cur = new Date(Date.UTC(nowLocal.year, nowLocal.month - 1, nowLocal.day));
      let diff = (targetDow - cur.getUTCDay() + 7) % 7;
      if (diff === 0) diff = 7;
      return { dayKey: addDaysToDayKey(nowLocal.dayKey, diff), explicitYear: false };
    }
  }

  return undefined;
}

export interface ParsedReminderRequest {
  kind: ReminderKind;
  due: string;
  end: string | null;
  dayKey: string;
  startTime?: string | undefined;
  endTime?: string | undefined;
}

export interface ParseReminderRequestOptions {
  now?: Date | undefined;
  timeZone?: string | undefined;
  briefAt?: string | undefined;
  fallbackDue?: string | undefined;
}

export function parseReminderRequest(
  text: string,
  options: ParseReminderRequestOptions = {},
): ParsedReminderRequest | undefined {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone || 'Europe/Rome';
  const briefAt = options.briefAt && /^\d{2}:\d{2}$/.test(options.briefAt) ? options.briefAt : DEFAULT_BRIEF_AT;
  const fallbackDue = options.fallbackDue;

  const dateInfo = parseDateFromText(text, now, timeZone, fallbackDue);
  const resolveDayKey = (clockForFutureCheck?: string): string => {
    if (dateInfo) return dateInfo.dayKey;
    if (fallbackDue) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(fallbackDue.trim())) return fallbackDue.trim();
      const parsed = Date.parse(fallbackDue);
      if (Number.isFinite(parsed)) return localParts(new Date(parsed), timeZone).dayKey;
    }
    const todayKey = localParts(now, timeZone).dayKey;
    if (clockForFutureCheck) {
      const candidate = localDayTimeToUtc(todayKey, clockForFutureCheck, timeZone);
      if (candidate.getTime() > now.getTime()) return todayKey;
    }
    return addDaysToDayKey(todayKey, 1);
  };

  // 1. Check from-to ("between 10 and 12", "from 10 to 12", "tra le 10 e le 12", "dalle 10 alle 12")
  const fromToMatch =
    RE_FROM_TO_EN_BETWEEN.exec(text) ??
    RE_FROM_TO_EN_FROM.exec(text) ??
    RE_FROM_TO_IT_TRA.exec(text) ??
    RE_FROM_TO_IT_DALLE.exec(text);
  if (fromToMatch) {
    const rawEndToken = fromToMatch[2]!;
    const endMeridiem = /\b(am|pm)\b/i.exec(rawEndToken)?.[1];
    const startClock = parseClockToken(fromToMatch[1]!, endMeridiem);
    let endClock = parseClockToken(rawEndToken);
    if (startClock && endClock) {
      if (endClock <= startClock) {
        const eh = Number(endClock.slice(0, 2));
        if (eh > 0 && eh < 12) {
          endClock = `${pad2(eh + 12)}:${endClock.slice(3, 5)}`;
        }
      }
      if (endClock > startClock) {
        const dayKey = resolveDayKey(startClock);
        const startUtc = localDayTimeToUtc(dayKey, startClock, timeZone);
        const endUtc = localDayTimeToUtc(dayKey, endClock, timeZone);
        return {
          kind: 'from-to',
          due: startUtc.toISOString(),
          end: endUtc.toISOString(),
          dayKey,
          startTime: startClock,
          endTime: endClock,
        };
      }
    }
  }

  // 2. Check until ("by 18", "until 18", "before 18", "entro le 18", "fino alle 18", "prima delle 18")
  const untilMatch = RE_UNTIL_EN.exec(text) ?? RE_UNTIL_IT.exec(text);
  if (untilMatch) {
    const endClock = parseClockToken(untilMatch[1]!);
    if (endClock) {
      const dayKey = resolveDayKey(endClock);
      const endUtc = localDayTimeToUtc(dayKey, endClock, timeZone);
      const resolved = resolveReminderTime({
        due: endUtc.toISOString(),
        kind: 'until',
        now,
        timeZone,
        briefAt,
      });
      return {
        kind: 'until',
        due: resolved.due,
        end: resolved.end,
        dayKey,
        endTime: endClock,
      };
    }
  }

  // 3. Check from ("after 15", "from 15", "dopo le 15", "dalle 15")
  const fromMatch = RE_FROM_EN.exec(text) ?? RE_FROM_IT.exec(text);
  if (fromMatch) {
    const startClock = parseClockToken(fromMatch[1]!);
    if (startClock) {
      const dayKey = resolveDayKey(startClock);
      const startUtc = localDayTimeToUtc(dayKey, startClock, timeZone);
      return {
        kind: 'from',
        due: startUtc.toISOString(),
        end: null,
        dayKey,
        startTime: startClock,
      };
    }
  }

  // 4. Check at ("at 10", "alle 10")
  const atMatch = RE_AT_EN.exec(text) ?? RE_AT_IT.exec(text);
  if (atMatch) {
    const atClock = parseClockToken(atMatch[1]!);
    if (atClock) {
      const dayKey = resolveDayKey(atClock);
      const atUtc = localDayTimeToUtc(dayKey, atClock, timeZone);
      return {
        kind: 'at',
        due: atUtc.toISOString(),
        end: null,
        dayKey,
        startTime: atClock,
      };
    }
  }

  // 5. Relative time or part-of-day ("in 2 hours", "tomorrow morning", "domani mattina") -> stays 'at'
  if (RE_RELATIVE_OR_PART_OF_DAY.test(text) && !RE_EXPLICIT_ALL_DAY.test(text)) {
    if (fallbackDue && Number.isFinite(Date.parse(fallbackDue))) {
      const dueDate = new Date(Date.parse(fallbackDue));
      return {
        kind: 'at',
        due: dueDate.toISOString(),
        end: null,
        dayKey: localParts(dueDate, timeZone).dayKey,
      };
    }
    return undefined;
  }

  // 6. Explicit all-day or a date with no clock time ("on 3 March", "il 3 marzo")
  if (RE_EXPLICIT_ALL_DAY.test(text) || dateInfo) {
    const dayKey = resolveDayKey();
    const arrival = localDayTimeToUtc(dayKey, briefAt, timeZone);
    return {
      kind: 'all-day',
      due: arrival.toISOString(),
      end: null,
      dayKey,
    };
  }

  return undefined;
}

export function reconcileReminderArgs(
  request: string,
  args: Record<string, unknown>,
  options: ParseReminderRequestOptions = {},
): Record<string, unknown> {
  if (!request || typeof args.due !== 'string') return args;
  const parsed = parseReminderRequest(request, { ...options, fallbackDue: args.due });
  if (!parsed) return args;
  if (parsed.kind === 'at' && args.kind === undefined) {
    const existingMs = Date.parse(args.due);
    const parsedMs = Date.parse(parsed.due);
    if (Number.isFinite(existingMs) && existingMs === parsedMs) {
      return args;
    }
    return { ...args, due: parsed.due };
  }
  const next: Record<string, unknown> = { ...args, due: parsed.due, kind: parsed.kind };
  if (parsed.end !== null) next.end = parsed.end;
  else delete next.end;
  return next;
}

export function formatBriefReminderTime(
  reminder: { due: string; kind?: ReminderKind | string | undefined; end?: string | null | undefined },
  timeZone = 'Europe/Rome',
  lang: 'en' | 'it' = 'en',
): string {
  const kind = normalizeReminderKind(reminder.kind);
  const it = lang === 'it';
  if (kind === 'all-day') return it ? 'tutto il giorno' : 'all day';
  if (kind === 'from-to' && reminder.end) {
    const startP = localParts(new Date(reminder.due), timeZone);
    const endP = localParts(new Date(reminder.end), timeZone);
    return `${startP.hhmm}–${endP.hhmm}`;
  }
  if (kind === 'from') {
    const startP = localParts(new Date(reminder.due), timeZone);
    return `${it ? 'dalle' : 'from'} ${startP.hhmm}`;
  }
  if (kind === 'until') {
    const endP = localParts(new Date(reminder.end ?? reminder.due), timeZone);
    return `${it ? 'entro le' : 'until'} ${endP.hhmm}`;
  }
  return localParts(new Date(reminder.due), timeZone).hhmm;
}

export function formatInboxReminderMessage(
  reminder: { title: string; due: string; kind?: ReminderKind | string | undefined; end?: string | null | undefined },
  timeZone = 'Europe/Rome',
  lang: 'en' | 'it' = 'en',
): string {
  const kind = normalizeReminderKind(reminder.kind);
  if (kind === 'at') return reminder.title;
  return `${reminder.title} (${formatBriefReminderTime(reminder, timeZone, lang)})`;
}
