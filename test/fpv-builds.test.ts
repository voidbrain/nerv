import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readScrolls } from '../src/config.ts';
import { builtinTools } from '../src/executors.ts';
import { Store } from '../src/store.ts';

describe('F-099-T03: FPV build import and cited wiring answers', () => {
  it('exposes fpv.import_build, fpv.add_doc, and fpv.wiring_answer as Green tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-fpv-'));
    try {
      for (const name of ['fpv.import_build', 'fpv.add_doc', 'fpv.wiring_answer']) {
        assert.ok(
          builtinTools.some((t) => t.name === name),
          `missing tool ${name}`,
        );
      }
      const store = new Store(join(dir, 'nerv.sqlite'), readScrolls(dir), { home: dir });
      const sortieId = store.ledger.openSortie('owner', 'fpv build wiring', 'trusted');
      const res = await store.runAction(sortieId, {
        tool: 'fpv.import_build',
        args: {
          name: 'Talon-3',
          sourceRef: 'build-note:Talon-3',
          components: [{ role: 'fc', model: 'SkyFC-F4' }],
        },
        stage: 'production',
      });
      assert.equal(res.outcome, 'grant');
      assert.equal(res.pattern, 'green');
      assert.equal((res.result as { name: string }).name, 'Talon-3');
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers wiring from saved build with citation, from cited manufacturer docs, and refuses to guess when unknown or unverified', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerv-fpv-'));
    const dbPath = join(dir, 'nerv.sqlite');
    try {
      const store = new Store(dbPath);
      const imported = store.fpvBuilds.importBuild({
        name: 'Kestrel-5',
        sourceRef: 'build-note:Kestrel-5',
        components: [
          { role: 'fc', model: 'AeroFC-M7' },
          { role: 'rx', model: 'LinkRX-900' },
        ],
        wiring: [
          {
            fromComponent: 'AeroFC-M7',
            fromPad: 'R2',
            toComponent: 'LinkRX-900',
            toPad: 'TX',
            uart: 'UART2',
            sourceRef: 'build-note:Kestrel-5#uart2',
          },
          {
            fromComponent: 'AeroFC-M7',
            fromPad: 'T2',
            toComponent: 'LinkRX-900',
            toPad: 'RX',
            uart: 'UART2',
            sourceRef: 'build-note:Kestrel-5#uart2',
          },
        ],
      });
      assert.equal(imported.shareable, false);
      assert.equal(imported.wiringCount, 2);

      const buildAns = store.fpvBuilds.answerWiring({
        buildName: 'Kestrel-5',
        fromModel: 'AeroFC-M7',
        toModel: 'LinkRX-900',
      });
      assert.equal(buildAns.known, true);
      assert.equal(buildAns.connections.length, 2);
      assert.deepEqual(buildAns.citations, ['build-note:Kestrel-5#uart2']);

      // Manufacturer doc citation when no build wiring exists
      store.fpvBuilds.registerManufacturerDoc({
        model: 'AeroFC-M7',
        title: 'AeroFC-M7 Manual',
        sourceRef: 'manufacturer:AeroFC-M7-manual',
        pinouts: [
          { pad: 'T3', signal: 'tx', uart: 'UART3' },
          { pad: 'R3', signal: 'rx', uart: 'UART3' },
          { pad: '5V', signal: 'power_5v' },
          { pad: 'G', signal: 'gnd' },
        ],
      });
      store.fpvBuilds.registerManufacturerDoc({
        model: 'BeaconRX-24',
        title: 'BeaconRX-24 Pinout',
        sourceRef: 'manufacturer:BeaconRX-24-manual',
        pinouts: [
          { pad: 'RX', signal: 'rx' },
          { pad: 'TX', signal: 'tx' },
          { pad: '5V', signal: 'power_5v' },
          { pad: 'GND', signal: 'gnd' },
        ],
      });
      const docAns = store.fpvBuilds.answerWiring({ fromModel: 'AeroFC-M7', toModel: 'BeaconRX-24' });
      assert.equal(docAns.known, true);
      assert.equal(docAns.connections.length, 4);
      assert.deepEqual(docAns.citations, ['manufacturer:AeroFC-M7-manual', 'manufacturer:BeaconRX-24-manual']);

      // Unknown component refuses to guess
      const unknownAns = store.fpvBuilds.answerWiring({ fromModel: 'AeroFC-M7', toModel: 'MysteryVTX-X' });
      assert.equal(unknownAns.known, false);
      assert.match(unknownAns.reason, /Unknown/);

      // Unverified PNG wiring refuses to guess
      store.fpvBuilds.importBuild({
        name: 'Blurry-3',
        sourceRef: 'diyfpv:blurry-png',
        components: [
          { role: 'fc', model: 'AeroFC-M7' },
          { role: 'rx', model: 'LinkRX-900' },
        ],
        wiring: [
          {
            fromComponent: 'AeroFC-M7',
            fromPad: '?',
            toComponent: 'LinkRX-900',
            toPad: 'TX',
            verified: false,
            sourceRef: 'diyfpv:blurry-png',
          },
        ],
      });
      const blurryAns = store.fpvBuilds.answerWiring({
        buildName: 'Blurry-3',
        fromModel: 'AeroFC-M7',
        toModel: 'LinkRX-900',
      });
      assert.equal(blurryAns.known, false);
      assert.match(blurryAns.reason, /unverified\/illegible/);
      store.close();

      // Persists across Store restart
      const store2 = new Store(dbPath);
      assert.equal(store2.fpvBuilds.listBuilds().length, 2);
      store2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
