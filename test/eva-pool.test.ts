// F-049-T06: EVA instances run within per-machine limits; over a limit a job waits, never refused silently.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/config.ts';
import { EvaLimitError, EvaPool, defaultEvaLimits, validateEvaLimits } from '../src/eva-pool.ts';
import { runEva03Job } from '../src/eva-runner.ts';

/** A job the test finishes by hand, recording when it started. */
function gate() {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  return { done, open };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('F-049-T06: per-machine EVA limits', () => {
  it('limits come from config.json, with defaults for what it leaves out, and bad values are refused', () => {
    assert.deepEqual(defaultEvaLimits(8, 16 * 1024 ** 3), { instances: 7, memoryMb: 8192, modelSlots: 1 });
    assert.deepEqual(defaultEvaLimits(1, 256 * 1024 ** 2), { instances: 1, memoryMb: 256, modelSlots: 1 });
    const defaults = { instances: 3, memoryMb: 4096, modelSlots: 1 };
    assert.deepEqual(validateEvaLimits({ instances: 2 }, defaults), { instances: 2, memoryMb: 4096, modelSlots: 1 });
    assert.throws(() => validateEvaLimits({ instances: 0 }, defaults), /eva\.limits\.instances/);
    assert.throws(() => validateEvaLimits({ cores: 2 }, defaults), /unknown "cores"/);
    const home = mkdtempSync(join(tmpdir(), 'nerv-eva-limits-'));
    try {
      writeFileSync(join(home, 'config.json'), JSON.stringify({ eva: { limits: { instances: 2, modelSlots: 0 } } }));
      assert.equal(readConfig(home).eva?.limits.instances, 2);
      assert.equal(readConfig(home).eva?.limits.modelSlots, 0);
      writeFileSync(join(home, 'config.json'), JSON.stringify({ eva: { limits: { instances: 'many' } } }));
      assert.throws(() => readConfig(home), /eva\.limits\.instances/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('a job over the instance limit waits in order and starts when one finishes', async () => {
    const pool = new EvaPool({ instances: 2, memoryMb: 100_000, modelSlots: 1 });
    const started: string[] = [];
    const gates = { a: gate(), b: gate(), c: gate(), d: gate() };
    const runs = (['a', 'b', 'c', 'd'] as const).map((id) =>
      pool.run({ jobId: id, evaClass: 'eva-03' }, async () => {
        started.push(id);
        await gates[id].done;
        return id;
      }),
    );
    await tick();
    assert.deepEqual(started, ['a', 'b']);
    assert.deepEqual(pool.status(), { running: 2, waiting: 2, memoryMb: 512, modelSlots: 0 });
    gates.b.open();
    await runs[1];
    await tick();
    assert.deepEqual(started, ['a', 'b', 'c'], 'the first waiting job starts, not a later one');
    gates.a.open();
    gates.c.open();
    gates.d.open();
    assert.deepEqual(await Promise.all(runs), ['a', 'b', 'c', 'd']);
    assert.deepEqual(pool.status(), { running: 0, waiting: 0, memoryMb: 0, modelSlots: 0 });
  });

  it('memory and model slots are limits too; a failed job frees its room', async () => {
    // eva-01 reserves 1024 MB: two do not fit in 1500 MB, whatever the instance limit.
    const pool = new EvaPool({ instances: 8, memoryMb: 1500, modelSlots: 1 });
    const started: string[] = [];
    const first = gate();
    const a = pool.run({ jobId: 'a', evaClass: 'eva-01' }, async () => {
      started.push('a');
      await first.done;
      throw new Error('job failed');
    });
    const b = pool.run({ jobId: 'b', evaClass: 'eva-01' }, async () => void started.push('b'));
    await tick();
    assert.deepEqual(started, ['a']);
    first.open();
    await assert.rejects(a, /job failed/);
    await b;
    assert.deepEqual(started, ['a', 'b']);

    const models = new EvaPool({ instances: 8, memoryMb: 100_000, modelSlots: 1 });
    const held = gate();
    const order: string[] = [];
    const m1 = models.run({ jobId: 'm1', evaClass: 'eva-01', needsModel: true }, async () => {
      order.push('m1');
      await held.done;
    });
    const m2 = models.run({ jobId: 'm2', evaClass: 'eva-01', needsModel: true }, async () => void order.push('m2'));
    await tick();
    assert.deepEqual(order, ['m1'], 'one model slot: the second model job waits');
    held.open();
    await Promise.all([m1, m2]);
    assert.deepEqual(order, ['m1', 'm2']);
  });

  it('a job that can never fit is refused with its reason, and a waiting job can be cancelled', async () => {
    const small = new EvaPool({ instances: 4, memoryMb: 512, modelSlots: 0 });
    await assert.rejects(
      small.run({ jobId: 'big', evaClass: 'eva-02' }, async () => 'ran'),
      (e: Error) =>
        e instanceof EvaLimitError && /big needs 2048 MB \(eva-02\); this machine allows 512 MB/.test(e.message),
    );
    await assert.rejects(
      small.run({ jobId: 'model', evaClass: 'eva-03', needsModel: true }, async () => 'ran'),
      /allows no model slot/,
    );
    const one = new EvaPool({ instances: 1, memoryMb: 100_000, modelSlots: 1 });
    const held = gate();
    const first = one.run({ jobId: 'first', evaClass: 'eva-03' }, () => held.done);
    const abort = new AbortController();
    let ran = false;
    const waiting = one.run({ jobId: 'waiting', evaClass: 'eva-03', signal: abort.signal }, async () => {
      ran = true;
    });
    await tick();
    assert.equal(one.status().waiting, 1);
    abort.abort(new Error('Spear cancelled it'));
    await assert.rejects(waiting, /Spear cancelled it/);
    assert.equal(one.status().waiting, 0);
    held.open();
    await first;
    assert.equal(ran, false, 'a cancelled job never starts');
  });

  it(
    'two jobs of one pilot run at once, each in its own EVA-03 instance with its own state',
    { skip: !(process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) },
    async () => {
      const pool = new EvaPool({ instances: 2, memoryMb: 100_000, modelSlots: 1 });
      // Each job writes a file, waits long enough to overlap the other, then reports its workspace and what it sees.
      const job = (n: number) =>
        pool.run({ jobId: `notes-helper-${n}`, evaClass: 'eva-03' }, () =>
          runEva03Job({
            jobId: `notes-helper-${n}`,
            command: process.execPath,
            args: [
              '-e',
              `const fs = require("node:fs"); fs.writeFileSync("mine.txt", "${n}"); const t = Date.now(); ` +
                `setTimeout(() => console.log(JSON.stringify({ cwd: process.cwd(), mine: fs.readFileSync("mine.txt", "utf8"), t, end: Date.now() })), 400);`,
            ],
          }),
        );
      const [one, two] = await Promise.all([job(1), job(2)]);
      const a = JSON.parse(one.stdout.trim()) as { cwd: string; mine: string; t: number; end: number };
      const b = JSON.parse(two.stdout.trim()) as { cwd: string; mine: string; t: number; end: number };
      assert.notEqual(a.cwd, b.cwd, 'separate instances');
      assert.deepEqual([a.mine, b.mine], ['1', '2'], 'neither sees the other’s state');
      assert.ok(a.t < b.end && b.t < a.end, 'the two ran at the same time');
      assert.equal(one.workspaceDiscarded && two.workspaceDiscarded, true);
    },
  );
});
