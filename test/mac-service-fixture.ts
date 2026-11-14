import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  realpathSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { renderService } from '../src/service.ts';
import type {
  ServiceHealthCheck,
  ServiceHost,
  ServiceObservation,
  ServicePlan,
} from '../src/node-lifecycle-execution.ts';
import { rehearseUpgrade, type UpgradeContractBounds, type UpgradeReader } from '../src/upgrade-rehearsal.ts';
export function serviceFixture(directory = realpathSync(mkdtempSync(join(tmpdir(), 'nerv-service-')))) {
  const context = {
    userHome: directory,
    home: join(directory, '.nerv'),
    source: join(directory, 'source'),
    node: realpathSync(process.execPath),
    uid: process.getuid!(),
  };
  for (const dir of [context.home, context.source, join(directory, 'Library'), join(directory, 'Library/LaunchAgents')])
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  const revision = join(context.source, 'REVISION'),
    manager = join(directory, 'manager.json'),
    definition = join(directory, 'Library/LaunchAgents/io.nerv.agent.plist');
  if (!existsSync(revision)) writeFileSync(revision, 'a'.repeat(40));
  if (!existsSync(manager)) writeFileSync(manager, JSON.stringify(false));
  if (!existsSync(join(context.home, 'config.json')))
    for (const [name, content] of [
      ['config.json', '{"base":{"id":"BASE-01","name":"Neutral fixture"}}'],
      ['token', 'neutral-fixture-token'],
      ['base-key', 'neutral-fixture-private'],
      ['base.pub', 'neutral-fixture-public'],
    ])
      writeFileSync(join(context.home, name!), content!, { mode: 0o600 });
  const data = join(context.home, 'nerv.sqlite');
  if (!existsSync(data)) {
    const db = new DatabaseSync(data);
    db.exec(
      "PRAGMA user_version=5;CREATE TABLE reminders(id TEXT PRIMARY KEY,title TEXT);INSERT INTO reminders VALUES('original','Neutral existing reminder')",
    );
    db.close();
  }
  const calls: string[] = [],
    controls = { clean: true, session: true, pending: false, legacy: false, built: true, compatible: true };
  let beforeCommand: ((step: string, plan: ServicePlan) => Promise<void> | void) | undefined;
  let reader: UpgradeReader = () => {};
  let readerContract: UpgradeContractBounds | undefined;
  let healthOverride: ((plan: ServicePlan) => Promise<ServiceHealthCheck> | ServiceHealthCheck) | undefined;
  const host: ServiceHost = {
    context,
    inspect: async () => {
      let kind: ServiceObservation['definition'] = 'absent';
      try {
        const s = lstatSync(definition);
        kind =
          !s.isSymbolicLink() &&
          s.isFile() &&
          (s.mode & 0o077) === 0 &&
          readFileSync(definition, 'utf8') === renderService('darwin', context.home, context.source, context.node)
            ? 'owned'
            : 'foreign';
      } catch (e) {
        if (!(e instanceof Error) || !('code' in e) || e.code !== 'ENOENT') throw e;
      }
      const running = JSON.parse(readFileSync(manager, 'utf8')) as boolean;
      const db = new DatabaseSync(data, { readOnly: true });
      let schema: number;
      try {
        schema = Number(db.prepare('PRAGMA user_version').get()!.user_version);
      } finally {
        db.close();
      }
      return {
        revision: readFileSync(revision, 'utf8'),
        schema,
        profile: createHash('sha256')
          .update(readFileSync(join(context.home, 'config.json')))
          .digest('hex'),
        definition: kind,
        registration: running ? 'owned' : 'absent',
        runtime: running ? 'owned' : 'stopped',
        pids: [],
        ...controls,
      };
    },
    compatible: async () => controls.compatible,
    command: async (step, plan) => {
      const db = new DatabaseSync(join(directory, '.nerv-lifecycle/journal.sqlite'), { readOnly: true });
      try {
        const row = db.prepare('SELECT receipt FROM operations WHERE digest=?').get(plan.digest) as { receipt: string };
        if (
          !row ||
          !JSON.parse(row.receipt).steps.at(-1).endsWith(':started') ||
          !db.prepare('SELECT 1 FROM resource WHERE digest=?').get(plan.digest)
        )
          throw Error('Effect ran without durable acceptance/started/resource');
      } finally {
        db.close();
      }
      calls.push(step);
      await beforeCommand?.(step, plan);
      if (step === 'register') writeFileSync(manager, JSON.stringify(true));
      if (step === 'unregister') writeFileSync(manager, JSON.stringify(false));
      if (step === 'checkout') writeFileSync(revision, plan.nextRevision!);
    },
    rehearse: (_plan, backup) => rehearseUpgrade(backup, reader, readerContract),
    health: async (plan) =>
      healthOverride
        ? healthOverride(plan)
        : {
            ok: true,
            checkedAt: new Date().toISOString(),
            commit: plan.nextRevision ?? plan.before.revision,
            baseId: 'BASE-01',
            database: 'ok',
            nervous: true,
            brain: true,
            failures: [],
          },
    backup: async (dest) => {
      const file = join(dest, 'database.sqlite');
      const db = new DatabaseSync(data);
      try {
        db.prepare('VACUUM INTO ?').run(file);
      } finally {
        db.close();
      }
      chmodSync(file, 0o600);
      const sums: Record<string, string> = {};
      for (const name of ['config.json', 'token', 'base-key', 'base.pub']) {
        const src = join(context.home, name);
        if (existsSync(src)) {
          const bytes = readFileSync(src);
          writeFileSync(join(dest, name), bytes, { mode: 0o600, flag: 'wx' });
          sums[name] = createHash('sha256').update(bytes).digest('hex');
        }
      }
      writeFileSync(
        join(dest, 'manifest.json'),
        JSON.stringify({
          files: sums,
          database: createHash('sha256').update(readFileSync(file)).digest('hex'),
          restore: 'separately reviewed; never automatic',
        }),
        { mode: 0o600, flag: 'wx' },
      );
    },
  };
  return {
    host,
    controls,
    calls,
    directory,
    definition,
    data,
    revision,
    setBeforeCommand: (f: typeof beforeCommand) => {
      beforeCommand = f;
    },
    setReader: (f: UpgradeReader, contract?: UpgradeContractBounds) => {
      reader = f;
      readerContract = contract;
    },
    setHealth: (f: typeof healthOverride) => {
      healthOverride = f;
    },
    setManager: (on: boolean) => writeFileSync(manager, JSON.stringify(on)),
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}
