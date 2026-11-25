/**
 * A moved, built install folder on the production macOS observation (launchctl, ps, authenticated doctor), with neutral
 * fixtures only: no real service, checkout or data home is touched. Shared by the B-122 and B-135 join tests.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync } from 'node:crypto';
import { serviceFixture } from './mac-service-fixture.ts';
import { macServiceAdapter, type DoctorProbeOptions, type ServiceContext } from '../src/node-lifecycle-execution.ts';
import { renderService } from '../src/service.ts';
import { NODE_FLAGS } from '../src/process-client.ts';
import type { UpdateAvailability } from '../src/update-availability.ts';

export const supported = { skip: process.platform !== 'darwin' || process.getuid?.() === 0 };
export const INSTALLED = 'a'.repeat(40);
export const NEXT = 'b'.repeat(40);

/** A moved install folder: built, its definition written as `service move` writes it, the service not registered. */
export async function movedHost(doctor?: DoctorProbeOptions) {
  const f = serviceFixture();
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const c: ServiceContext = { ...f.host.context, node: join(f.directory, 'neutral-node') };
  const keys = generateKeyPairSync('ed25519');
  writeFileSync(c.node, 'Neutral executable', { mode: 0o700 });
  writeFileSync(join(c.source, 'package.json'), JSON.stringify({ name: 'nerv-agency', engines: { node: '>=24.0.0' } }));
  mkdirSync(join(c.source, 'src'), { recursive: true });
  writeFileSync(join(c.source, 'src/cli.ts'), '// Neutral CLI\n');
  mkdirSync(join(c.source, 'dist/web/browser'), { recursive: true });
  writeFileSync(join(c.source, 'dist/web/browser/index.html'), '<html>Neutral</html>');
  writeFileSync(join(c.home, 'base-key'), keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(join(c.home, 'base.pub'), keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
  chmodSync(join(c.home, 'base.pub'), 0o644);
  writeFileSync(join(c.home, 'token'), 'c'.repeat(32));
  writeFileSync(join(c.home, 'config.json'), JSON.stringify({ base: { id: 'BASE-01', name: 'Neutral' }, port }));
  const data = new DatabaseSync(f.data);
  data.exec(
    'CREATE TABLE worker_jobs(state TEXT);CREATE TABLE kaji_outbox(done TEXT);CREATE TABLE worker_legacy_outbox(state TEXT)',
  );
  data.close();
  writeFileSync(f.definition, renderService('darwin', c.home, c.source, c.node), { mode: 0o600 });

  const state = {
    registered: false,
    /** ps rows: what runs besides the launchd service. */
    foreground: '',
    calls: [] as string[][],
  };
  let server: Server | undefined;
  /** The doctor answers as NERV does; `handle` may delay, refuse or ignore a request instead (B-135). */
  const serveDoctor = async (
    commit: string,
    handle?: (req: IncomingMessage, res: ServerResponse, answer: () => void) => void,
  ) => {
    server = createServer((req, res) => {
      const answer = () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ base: { id: 'BASE-01' }, build: { commit } }));
      };
      if (handle) handle(req, res, answer);
      else answer();
    });
    await new Promise<void>((done) => server!.listen(port, '127.0.0.1', done));
  };
  const stopDoctor = async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((done) => server!.close(() => done()));
    server = undefined;
  };
  const manager = () =>
    [
      'path = ' + f.definition,
      'program = ' + c.node,
      'working directory = ' + c.source,
      'arguments = {',
      ...[c.node, ...NODE_FLAGS, join(c.source, 'src/cli.ts'), 'serve'].map((s) => '  ' + s),
      '}',
      'environment = {',
      '  NERV_HOME => ' + c.home,
      '}',
      'pid = 7000001',
    ].join('\n');
  const run = async (program: string, args: string[]) => {
    state.calls.push([program, ...args]);
    if (program === 'git') {
      const op = args[2];
      const out =
        op === 'rev-parse'
          ? INSTALLED
          : op === 'remote'
            ? 'https://github.com/voidbrain/nerv.git'
            : op === 'diff'
              ? 'README.md\0'
              : op === 'cat-file'
                ? 'commit'
                : '';
      return { status: 0, err: '', out };
    }
    if (program === c.node) return { status: 0, err: '', out: 'v24.0.0\n' };
    if (program === 'ps')
      return {
        status: 0,
        err: '',
        out:
          (state.registered
            ? `7000001 1 node ${c.node} ${NODE_FLAGS.join(' ')} ${join(c.source, 'src/cli.ts')} serve\n`
            : '') + state.foreground,
      };
    if (program === 'launchctl' && args[0] === 'print') {
      if (args[1] === 'gui/' + c.uid) return { status: 0, err: '', out: 'Neutral GUI session' };
      return state.registered && args[1]?.endsWith('/io.nerv.agent')
        ? { status: 0, err: '', out: manager() }
        : { status: 113, err: 'Could not find service "io.nerv.agent" in domain for user gui', out: '' };
    }
    return { status: 0, err: '', out: '' };
  };
  const host = doctor ? macServiceAdapter(c, run, doctor) : macServiceAdapter(c, run);
  return {
    f,
    c,
    host,
    state,
    serveDoctor,
    stopDoctor,
    close: async () => {
      await stopDoctor();
      f.close();
    },
  };
}

export const outsideUpdater = (host: ReturnType<typeof macServiceAdapter>) => ({
  resolveUpdate: async () =>
    ({ status: 'update-available', channel: 'main', availableRevision: NEXT }) as unknown as UpdateAvailability,
  lifecycleHost: () => host,
  stopFirst: true,
  fetchRevision: async () => {},
  // Planning only: this test never applies a plan.
  applyPlan: async () => {
    throw Error('This test never applies a plan.');
  },
});
