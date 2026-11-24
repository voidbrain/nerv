import type { PageTables } from './browser-cdp-driver.ts';
import type { BuildComponentInput, BuildWiringInput } from './fpv-builds.ts';

/** The page origin a diyfpv.com build link must have. */
export const DIYFPV_BUILDER_ORIGIN = 'https://builder.diyfpv.com';
const BUILD_PATH = /^\/build\/[A-Za-z0-9_-]{4,64}\/?$/;

/**
 * The page structure this reader expects (structure v1): a parts table whose headers include a
 * category column (Category, Type or Role) and a part column (Part, Name, Product or Model), and an
 * optional wiring table with From, From pad, To and To pad columns (UART optional). Anything else is
 * a changed page: the read fails and nothing is saved.
 */
export const DIYFPV_STRUCTURE_VERSION = 1;

const ROLE_HEADERS = ['category', 'type', 'role'];
const PART_HEADERS = ['part', 'name', 'product', 'model'];

export interface DiyfpvBuildRead {
  readonly name: string;
  readonly sourceRef: string;
  readonly notes: string;
  readonly components: BuildComponentInput[];
  readonly wiring: BuildWiringInput[];
}

export function assertDiyfpvBuildLink(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a diyfpv.com build link: ${url}`);
  }
  if (parsed.origin !== DIYFPV_BUILDER_ORIGIN || !BUILD_PATH.test(parsed.pathname)) {
    throw new Error(`Not a diyfpv.com build link (${DIYFPV_BUILDER_ORIGIN}/build/<id>): ${url}`);
  }
  return parsed;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function column(headers: readonly string[], names: readonly string[]): number {
  return headers.findIndex((h) => names.includes(norm(h)));
}

function changed(detail: string): Error {
  return new Error(
    `The diyfpv.com page structure is not the one NERV reads (structure v${DIYFPV_STRUCTURE_VERSION}): ${detail}. Nothing was saved; no part or wire was guessed.`,
  );
}

/**
 * F-099-T04: turns a diyfpv.com build page, read read-only through the browser adapter, into the saved
 * build note's input. Every part and wire comes from a table cell; a missing table, an unknown header,
 * an empty cell or a wire to a part not in the parts table fails the whole read.
 */
export function parseDiyfpvBuild(page: PageTables, link: string, readAt = new Date()): DiyfpvBuildRead {
  const source = assertDiyfpvBuildLink(link);
  const partsTable = page.tables.find(
    (t) => column(t.headers, ROLE_HEADERS) >= 0 && column(t.headers, PART_HEADERS) >= 0,
  );
  if (!partsTable) throw changed('no parts table with a category and a part column');
  const roleCol = column(partsTable.headers, ROLE_HEADERS);
  const partCol = column(partsTable.headers, PART_HEADERS);
  if (partsTable.rows.length === 0) throw changed('the parts table is empty');

  const components = partsTable.rows.map((row, i): BuildComponentInput => {
    const role = row[roleCol]?.trim() ?? '';
    const model = row[partCol]?.trim() ?? '';
    if (!role || !model) throw changed(`parts row ${i + 1} has an empty category or part`);
    return { role, model, sourceRef: `${source.href}#parts-row-${i + 1}` };
  });

  const wiring: BuildWiringInput[] = [];
  const wiringTable = page.tables.find((t) => t !== partsTable && column(t.headers, ['from']) >= 0);
  if (wiringTable) {
    const from = column(wiringTable.headers, ['from']);
    const fromPad = column(wiringTable.headers, ['from pad', 'pad']);
    const to = column(wiringTable.headers, ['to']);
    const toPad = wiringTable.headers.findIndex((h, i) => i !== fromPad && ['to pad', 'pad'].includes(norm(h)));
    const uart = column(wiringTable.headers, ['uart']);
    if (fromPad < 0 || to < 0 || toPad < 0) throw changed('the wiring table lacks From pad, To or To pad');
    const known = new Set(components.flatMap((c) => [norm(c.role), norm(c.model)]));
    wiringTable.rows.forEach((row, i) => {
      const cells = [row[from], row[fromPad], row[to], row[toPad]].map((c) => c?.trim() ?? '');
      if (cells.some((c) => !c)) throw changed(`wiring row ${i + 1} has an empty cell`);
      const [fromComponent, fromPadValue, toComponent, toPadValue] = cells as [string, string, string, string];
      if (!known.has(norm(fromComponent)) || !known.has(norm(toComponent))) {
        throw changed(`wiring row ${i + 1} names a part that is not in the parts table`);
      }
      const uartValue = uart >= 0 ? row[uart]?.trim() : '';
      wiring.push({
        fromComponent,
        fromPad: fromPadValue,
        toComponent,
        toPad: toPadValue,
        ...(uartValue ? { uart: uartValue } : {}),
        sourceRef: `${source.href}#wiring-row-${i + 1}`,
        verified: false,
      });
    });
  }

  const name = page.headings.find((h) => h.trim())?.trim() || page.title.trim();
  if (!name) throw changed('the page has no build name');
  return {
    name,
    sourceRef: source.href,
    notes: `Read from ${source.href} through the browser adapter on ${readAt.toISOString().slice(0, 10)} (page structure v${DIYFPV_STRUCTURE_VERSION}); wiring not verified against a manufacturer document.`,
    components,
    wiring,
  };
}
