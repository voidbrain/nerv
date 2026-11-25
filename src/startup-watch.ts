import { Worker } from 'node:worker_threads';
// The watch runs on its own thread, so it can report while the main thread is blocked in a synchronous step (an
// SQLite call) and no IPC message can leave. It writes straight to file descriptor 2, which the coordinator quotes.
const WATCH = `const { parentPort, workerData } = require('node:worker_threads');
const { writeSync } = require('node:fs');
let step = 'starting', since = Date.now(), told = 0;
parentPort.on('message', (s) => { step = String(s).slice(0, 80); since = Date.now(); told = 0; });
setInterval(() => {
  const ms = Date.now() - since;
  if (ms < workerData.stallMs * (told + 1)) return;
  told++;
  try { writeSync(2, workerData.label + ': still in start-up step "' + step + '" after ' + ms + ' ms\\n'); } catch {}
}, Math.min(250, workerData.stallMs));`;
/**
 * B-126-T03: names the start-up step a child is stuck in. `step` hands the watch the step about to run; after `stallMs`
 * in one step (and again after each further `stallMs`), the watch writes "<label>: still in start-up step …" to the
 * error output. `done` stops it once the child is ready.
 */
export function startupWatch(label: string, stallMs: number) {
  const worker = new Worker(WATCH, { eval: true, workerData: { label, stallMs } });
  worker.unref();
  return {
    step: (name: string) => worker.postMessage(name),
    done: () => void worker.terminate(),
  };
}
