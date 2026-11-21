import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/config.ts';
import { toolDocs } from '../src/executors.ts';
import {
  PackRegistry,
  builtinPackRegistry,
  validatePacksConfig,
  type CoreServices,
  type PackManifest,
} from '../src/packs.ts';
import { Runtime } from '../src/runtime.ts';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

describe('F-114-T01: pack manifest, registry, CoreServices interface, and config switch', () => {
  it('validates packs config and registers built-in packs with tools, tables, phrases, captions and panels', () => {
    assert.deepEqual(validatePacksConfig({ fpv: true, cooking: false }), { fpv: true, cooking: false });
    assert.throws(() => validatePacksConfig([]), /Invalid packs config/);
    assert.throws(() => validatePacksConfig({ fpv: 'yes' }), /Invalid packs\.fpv/);

    const fpv = builtinPackRegistry.get('fpv');
    const cooking = builtinPackRegistry.get('cooking');
    assert.ok(fpv);
    assert.ok(cooking);
    assert.ok(fpv.tools.includes('batteries.list'));
    assert.ok(fpv.tables.includes('batteries'));
    assert.ok(fpv.telegramCaptions.includes('battery'));
    assert.ok(fpv.dashboardPanels.some((p) => p.id === 'batteries'));
    assert.ok(cooking.tools.includes('pantry.check'));
    assert.ok(cooking.tables.includes('pantry_items'));
    assert.ok(cooking.telegramCaptions.includes('recipe'));
    assert.ok(cooking.dashboardPanels.some((p) => p.id === 'pantry'));
  });

  it('offers CoreServices to packs through an interface and refuses silent phrase collisions', () => {
    const registry = new PackRegistry();
    const received: string[] = [];
    const packA: PackManifest = {
      id: 'alpha',
      name: 'Alpha',
      tools: ['alpha.read'],
      tables: ['alpha_items'],
      chatPhrases: [{ id: 'shared-phrase', pattern: /^check status$/i }],
      telegramCaptions: ['alpha'],
      dashboardPanels: [{ id: 'alpha', title: 'Alpha', route: '/alpha' }],
      init(core) {
        received.push(
          typeof core.reminders.listPending,
          typeof core.todos.show,
          typeof core.timers.set,
          typeof core.photos.attach,
        );
      },
    };
    const packB: PackManifest = {
      id: 'beta',
      name: 'Beta',
      tools: ['beta.read'],
      tables: ['beta_items'],
      chatPhrases: [{ id: 'shared-phrase', pattern: /^check status$/i }],
      telegramCaptions: ['beta'],
      dashboardPanels: [{ id: 'beta', title: 'Beta', route: '/beta' }],
    };
    registry.register(packA);
    registry.register(packB);

    const core: CoreServices = {
      reminders: { listPending: () => [], add: () => ({}) },
      todos: { show: () => ({}), add: () => ({}) },
      timers: { set: () => 'ok', stop: () => 'ok' },
      photos: { attach: () => ({}) },
    };
    packA.init?.(core);
    assert.deepEqual(received, ['function', 'function', 'function', 'function']);

    // Two enabled packs claiming the same phrase are never silently routed to one.
    assert.deepEqual(registry.resolveChatPhrase('check status'), { ambiguous: ['alpha', 'beta'] });
    // Turning one off resolves unambiguously to the remaining enabled pack.
    assert.deepEqual(registry.resolveChatPhrase('check status', { beta: false }), {
      packId: 'alpha',
      phraseId: 'shared-phrase',
    });
  });

  it('join: switching a pack off hides its tools from planner, skips its chat phrases and hides its dashboard panel while keeping data', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nerv-f114-t01-'));
    const dbPath = join(home, 'nerv.sqlite');
    let runtime: Runtime | undefined;
    let server: ReturnType<typeof makeServer> | undefined;
    try {
      writeFileSync(
        join(home, 'config.json'),
        JSON.stringify({
          base: { id: 'NERV-01', name: 'Tokyo-3' },
          packs: { fpv: false, cooking: false },
        }),
      );
      const cfg = readConfig(home);
      assert.deepEqual(cfg.packs, { fpv: false, cooking: false });

      // Seed FPV data in SQLite; switching the pack off must keep the data intact.
      const seed = new Store(dbPath);
      seed.batteries.register({
        packNumber: 1,
        label: 'Lipo-1',
        brand: 'Tattu',
        batteryType: 'LiPo',
        cellCount: 4,
        capacityMah: 1500,
        purchaseDate: '2026-01-01',
        allowPendingResistance: true,
      });
      assert.equal(seed.batteries.list().length, 1);
      seed.close();

      // Planner tool docs exclude disabled packs' tools.
      const offeredTools = builtinPackRegistry.filterToolDocs(toolDocs, cfg.packs);
      assert.equal(
        offeredTools.some((t) => t.name.startsWith('batteries.')),
        false,
      );
      assert.equal(
        offeredTools.some((t) => t.name.startsWith('pantry.')),
        false,
      );
      assert.equal(
        offeredTools.some((t) => t.name === 'reminders.list'),
        true,
      );

      runtime = new Runtime(dbPath, undefined, home);
      let modelCalls = 0;
      runtime.setDispatch(async () => {
        modelCalls++;
        return { sortieId: '', reply: 'Handled as normal chat.', steps: [], waiting: [] };
      });
      await runtime.ready();

      // Disabled cooking pack does not intercept cooking phrases.
      const chatRes = await runtime.chat('start cooking pasta', 'dashboard');
      assert.equal(chatRes.reply, 'Handled as normal chat.');
      assert.equal(modelCalls, 1);

      // Dashboard API omits panels of disabled packs while keeping data in SQLite.
      const token = 'e'.repeat(32);
      server = makeServer(runtime, token);
      await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/packs`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        packs: { id: string; enabled: boolean; dashboardPanels: unknown[] }[];
        panels: unknown[];
      };
      assert.deepEqual(body.panels, []);
      assert.equal(body.packs.find((p) => p.id === 'fpv')?.enabled, false);
      assert.equal(body.packs.find((p) => p.id === 'cooking')?.enabled, false);

      // Verify seeded battery data is still present in SQLite.
      const checkStore = new Store(dbPath);
      assert.equal(checkStore.batteries.list().length, 1);
      checkStore.close();
    } finally {
      if (server?.listening) await new Promise<void>((done) => server!.close(() => done()));
      await runtime?.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('F-114-T04: asks the owner back when two enabled packs claim the same chat phrase', async () => {
    const { RuntimeChat } = await import('../src/runtime-chat.ts');
    const registry = new PackRegistry();
    registry.register({
      id: 'alpha',
      name: 'Alpha',
      tools: ['alpha.read'],
      tables: ['alpha_items'],
      chatPhrases: [{ id: 'check', pattern: /^check items$/i }],
      telegramCaptions: ['alpha'],
      dashboardPanels: [],
    });
    registry.register({
      id: 'beta',
      name: 'Beta',
      tools: ['beta.read'],
      tables: ['beta_items'],
      chatPhrases: [{ id: 'check', pattern: /^check items$/i }],
      telegramCaptions: ['beta'],
      dashboardPanels: [],
    });
    let loopCalled = 0;
    const chat = new RuntimeChat({
      home: undefined,
      packRegistry: registry,
      nervous: { call: async () => null } as never,
      maxQueue: 4,
      requestTimeoutMs: 5000,
      record: async () => {},
      bases: async () => [],
      baseHealth: async () => ({ state: 'ok', reasons: [] }),
      channelState: () => ({ mode: 'local', updatedAt: new Date().toISOString() }),
      getDispatch: () => undefined,
      resolveOperator: async () => ({ kind: 'none' }) as never,
      loop: async () => {
        loopCalled++;
        return { sortieId: 's1', reply: 'should not route', steps: [], waiting: [] };
      },
    });
    const res = await chat.chatOnce('check items', 'dashboard');
    assert.equal(loopCalled, 0);
    assert.equal(res.command, true);
    assert.match(res.reply ?? '', /alpha.*beta/i);
  });
});
