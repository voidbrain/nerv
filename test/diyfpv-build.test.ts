import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createCdpPageReader, type CdpSession, type PageTables } from '../src/browser-cdp-driver.ts';
import { readScrolls } from '../src/config.ts';
import { DIYFPV_BUILDER_ORIGIN, parseDiyfpvBuild } from '../src/diyfpv-build.ts';
import { Store } from '../src/store.ts';

// An invented build: no owner data.
const LINK = `${DIYFPV_BUILDER_ORIGIN}/build/sample0build`;
const PAGE: PageTables = {
  url: LINK,
  title: 'Sample Build | builder',
  headings: ['Sample 3in Cinewhoop'],
  tables: [
    {
      caption: 'Parts',
      headers: ['Category', 'Part', 'Price'],
      rows: [
        ['Flight controller', 'ExampleFC F7 Mini', '40'],
        ['Receiver', 'ExampleRX Nano', '15'],
      ],
    },
    {
      caption: 'Wiring',
      headers: ['From', 'From pad', 'To', 'To pad', 'UART'],
      rows: [
        ['ExampleRX Nano', 'TX', 'ExampleFC F7 Mini', 'R2', 'UART2'],
        ['ExampleRX Nano', 'RX', 'ExampleFC F7 Mini', 'T2', 'UART2'],
      ],
    },
  ],
};

describe('F-099-T04 read a diyfpv.com build through the browser adapter', () => {
  it('turns the parts and wiring tables into the build note input, citing each row and leaving wiring unverified', () => {
    const build = parseDiyfpvBuild(PAGE, LINK, new Date('2026-11-23T10:00:00Z'));
    assert.equal(build.name, 'Sample 3in Cinewhoop');
    assert.equal(build.sourceRef, LINK);
    assert.deepEqual(
      build.components.map((c) => [c.role, c.model, c.sourceRef]),
      [
        ['Flight controller', 'ExampleFC F7 Mini', `${LINK}#parts-row-1`],
        ['Receiver', 'ExampleRX Nano', `${LINK}#parts-row-2`],
      ],
    );
    assert.deepEqual(build.wiring[0], {
      fromComponent: 'ExampleRX Nano',
      fromPad: 'TX',
      toComponent: 'ExampleFC F7 Mini',
      toPad: 'R2',
      uart: 'UART2',
      sourceRef: `${LINK}#wiring-row-1`,
      verified: false,
    });
    assert.match(build.notes, /2026-11-23/);
  });

  it('a missing or changed page structure fails with a message and never guesses a part or a wire', () => {
    const variants: [PageTables, RegExp][] = [
      [{ ...PAGE, tables: [] }, /no parts table/],
      [{ ...PAGE, tables: [{ caption: '', headers: ['Item', 'Thing'], rows: [['a', 'b']] }] }, /no parts table/],
      [
        { ...PAGE, tables: [{ ...PAGE.tables[0]!, rows: [['Flight controller', '']] }, PAGE.tables[1]!] },
        /parts row 1 has an empty category or part/,
      ],
      [
        { ...PAGE, tables: [PAGE.tables[0]!, { ...PAGE.tables[1]!, headers: ['From', 'Wire colour'] }] },
        /lacks From pad, To or To pad/,
      ],
      [
        {
          ...PAGE,
          tables: [PAGE.tables[0]!, { ...PAGE.tables[1]!, rows: [['ExampleRX Nano', 'TX', 'Unknown VTX', 'R1', '']] }],
        },
        /names a part that is not in the parts table/,
      ],
      [
        {
          ...PAGE,
          tables: [
            PAGE.tables[0]!,
            { ...PAGE.tables[1]!, rows: [['ExampleRX Nano', '', 'ExampleFC F7 Mini', 'R2', '']] },
          ],
        },
        /empty cell/,
      ],
    ];
    for (const [page, reason] of variants) {
      assert.throws(
        () => parseDiyfpvBuild(page, LINK),
        (err: Error) => reason.test(err.message) && /Nothing was saved/.test(err.message),
      );
    }
    assert.throws(
      () => parseDiyfpvBuild(PAGE, 'https://example.test/build/sample0build'),
      /Not a diyfpv.com build link/,
    );
  });

  it('reads the page in a new tab, read-only, closes it, and saves the build note locally', async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const methods: string[] = [];
    const reader = createCdpPageReader({
      port: 9333,
      pollMs: 1,
      openTab: async (url) => {
        opened.push(url);
        return {
          id: 'tab-9',
          type: 'page',
          url,
          title: '',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/tab-9',
        };
      },
      closeTab: async (id) => {
        closed.push(id);
      },
      connect: async (): Promise<CdpSession> => {
        let calls = 0;
        return {
          async send(method) {
            methods.push(method);
            calls += 1;
            // The first read sees the client-rendered shell; the second sees the tables.
            return { result: { value: calls === 1 ? { ...PAGE, tables: [], ready: true } : { ...PAGE, ready: true } } };
          },
          onEvent() {},
          close() {},
        };
      },
    });
    await assert.rejects(
      () => reader.readPageTables(LINK, ['https://other.example']),
      /not in browser\.allowedOrigins/,
    );
    assert.deepEqual(opened, []);

    const page = await reader.readPageTables(LINK, [DIYFPV_BUILDER_ORIGIN]);
    assert.deepEqual(opened, [LINK]);
    assert.deepEqual(closed, ['tab-9']);
    assert.ok(
      methods.every((m) => m === 'Runtime.evaluate'),
      'reads only: no input, no navigation',
    );

    const dir = mkdtempSync(join(tmpdir(), 'nerv-diyfpv-'));
    try {
      const store = new Store(join(dir, 'nerv.sqlite'), readScrolls(dir), { home: dir });
      try {
        const saved = store.fpvBuilds.importBuild(parseDiyfpvBuild(page, LINK));
        assert.deepEqual([saved.componentCount, saved.wiringCount, saved.shareable], [2, 2, false]);
        // Wiring read from the page is cited but stays unverified until checked against a manufacturer document.
        const answer = store.fpvBuilds.answerWiring({
          buildName: 'Sample 3in Cinewhoop',
          fromModel: 'ExampleRX Nano',
          toModel: 'ExampleFC F7 Mini',
        });
        assert.equal(answer.known, false);
        assert.ok(answer.citations.some((c) => c.startsWith(`${LINK}#wiring-row-`)));
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
