/**
 * F-005-T12 (T06e) independent review of the update path: regressions for its findings, committed before the fixes.
 * Neutral fixtures only; no real service, checkout or data home is touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { serviceFixture } from './mac-service-fixture.ts';
import * as lifecycle from '../src/node-lifecycle-execution.ts';
import {
  applyService,
  assertServiceStartup,
  macServiceAdapter,
  planService,
  serviceReceipt,
  type ServicePlan,
  type ServiceReceipt,
} from '../src/node-lifecycle-execution.ts';
import { canonical } from '../src/kaji.ts';

const supported = { skip: process.platform === 'win32' || process.getuid?.() === 0 };
const NEXT = 'b'.repeat(40);
type Fixture = ReturnType<typeof serviceFixture>;
async function stopped(f: Fixture): Promise<void> {
  const install = await planService(f.host, 'install');
  await applyService(f.host, install, install.digest);
  const stop = await planService(f.host, 'stop');
  await applyService(f.host, stop, stop.digest);
}
/**
 * Rewrites the held operation so its plan carries another handler identity, as the plan of the installed revision does
 * when the candidate revision changed the lifecycle files, then restores it. Returns what `check` returned.
 */
async function withOtherHandler<T>(f: Fixture, digest: string, check: () => Promise<T>): Promise<T> {
  const db = new DatabaseSync(join(f.directory, '.nerv-lifecycle/journal.sqlite'));
  const row = db.prepare('SELECT plan,receipt FROM operations WHERE digest=?').get(digest) as {
    plan: string;
    receipt: string;
  };
  const plan = JSON.parse(row.plan) as ServicePlan,
    { digest: _old, ...body } = { ...plan, handler: 'f'.repeat(64) },
    other = createHash('sha256').update(canonical(body)).digest('hex');
  const receipt = { ...(JSON.parse(row.receipt) as ServiceReceipt), digest: other };
  const move = (from: string, to: string, planText: string, receiptText: string) => {
    db.prepare('UPDATE operations SET digest=?,plan=?,receipt=? WHERE digest=?').run(to, planText, receiptText, from);
    db.prepare('UPDATE resource SET digest=? WHERE id=1').run(to);
  };
  move(digest, other, canonical({ ...body, digest: other }), JSON.stringify(receipt));
  try {
    return await check();
  } finally {
    move(other, digest, row.plan, row.receipt);
    db.close();
  }
}

test(
  'review B1: the candidate started by an update passes the startup fence although it carries other lifecycle code',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      await stopped(f);
      f.host.authorizedStart = async () => true;
      let checked = false;
      f.setBeforeCommand(async (step, p) => {
        if (step !== 'register') return;
        // The candidate's own handler differs from the installed revision's plan when the update changes lifecycle code.
        await withOtherHandler(f, p.digest, () => assertServiceStartup(f.host, true));
        checked = true;
      });
      const plan = await planService(f.host, 'update', NEXT),
        receipt = await applyService(f.host, plan, plan.digest);
      assert.equal(checked, true);
      assert.equal(receipt.state, 'completed');
    } finally {
      f.close();
    }
  },
);

test(
  'review B1 control: a plain start plan made under other lifecycle code still cannot authorize startup',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      await stopped(f);
      f.host.authorizedStart = async () => true;
      let checked = false;
      f.setBeforeCommand(async (step, p) => {
        if (step !== 'register') return;
        await assert.rejects(
          withOtherHandler(f, p.digest, () => assertServiceStartup(f.host, true)),
          /not authorized/,
        );
        checked = true;
      });
      const plan = await planService(f.host, 'start');
      assert.equal((await applyService(f.host, plan, plan.digest)).state, 'completed');
      assert.equal(checked, true);
    } finally {
      f.close();
    }
  },
);

type Release = (host: unknown, snapshot: unknown, evidence: unknown) => unknown;
test(
  'review should-fix: releasing an operation is refused while the service is still registered or running',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      await stopped(f);
      const plan = await planService(f.host, 'update', NEXT);
      f.setBeforeCommand((step) => {
        if (step === 'register') throw Error('neutral injected start failure');
      });
      await assert.rejects(applyService(f.host, plan, plan.digest), /injected/);
      const receipt = serviceReceipt(f.host, plan.digest) as ServiceReceipt;
      assert.equal(receipt.state, 'uncertain');
      const release = (lifecycle as unknown as Record<string, Release | undefined>).releaseObservedService;
      assert.equal(typeof release, 'function', 'the CLI release path inspects the service before releasing');
      // The fixture pid is not alive, so only the service check can refuse; evidence otherwise passes.
      const evidence = {
        ...receipt,
        pid: 2 ** 22 + 7,
        handlerStopped: true,
        descendantsStopped: true,
        operatorConfirmed: true,
        reason: 'Neutral review fixture: handler stopped',
      };
      const db = new DatabaseSync(join(f.directory, '.nerv-lifecycle/journal.sqlite'));
      db.prepare('UPDATE resource SET pid=? WHERE id=1').run(evidence.pid);
      db.prepare('UPDATE operations SET receipt=? WHERE digest=?').run(
        JSON.stringify({ ...receipt, pid: evidence.pid }),
        plan.digest,
      );
      db.close();
      f.setManager(true);
      await assert.rejects(
        Promise.resolve().then(() => release!(f.host, evidence, evidence)),
        /registered|running|stop/i,
      );
      assert.equal((serviceReceipt(f.host, plan.digest) as ServiceReceipt).state, 'uncertain');
      f.setManager(false);
      const released = (await release!(f.host, evidence, evidence)) as ServiceReceipt;
      assert.equal(released.state, 'released');
    } finally {
      f.close();
    }
  },
);

test(
  'review should-fix: the fetch step uses the admitted local commit and never needs the network',
  supported,
  async () => {
    const f = serviceFixture();
    try {
      const calls: string[][] = [];
      let present = true;
      const run = async (program: string, args: string[]) => {
        calls.push([program, ...args]);
        if (args.includes('cat-file')) return { status: present ? 0 : 1, out: '', err: '' };
        if (args.includes('fetch')) return { status: 128, out: '', err: 'neutral network failure' };
        return { status: 0, out: '', err: '' };
      };
      const host = macServiceAdapter(f.host.context, run as Parameters<typeof macServiceAdapter>[1]);
      const plan = { nextRevision: NEXT, digest: '0'.repeat(64) } as ServicePlan;
      await host.command('fetch', plan);
      assert.equal(
        calls.some((c) => c.includes('fetch')),
        false,
        'an admitted commit is already local',
      );
      present = false;
      await assert.rejects(host.command('fetch', plan), /fetch/);
      assert.ok(calls.some((c) => c.includes('fetch')));
    } finally {
      f.close();
    }
  },
);
