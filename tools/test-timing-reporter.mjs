// A timing reporter for `node --test` (B-118): one line per test file as it starts and as it finishes, written
// synchronously so a run stopped by its step limit still names the files that never finished; at the end, the files
// sorted by wall time. Each failed test is logged as it ends (B-118-T03): node:test passes a test's completion on at
// once, while its pass/fail events (and the spec report) wait behind a file that is still running, so a stopped run
// used to fail files without naming the test. Pair it with the quiet reporter:
//   node --test ... --test-reporter=./tools/test-timing-reporter.mjs --test-reporter-destination=stdout
// The log goes to NERV_TEST_TIMINGS (default .test-timings.txt); the reporter's own output stays empty.
// `node tools/test-timing-reporter.mjs [log]` prints the slowest files and any file that started but never finished.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG = process.env.NERV_TEST_TIMINGS || '.test-timings.txt';
const where = (file) => relative(process.cwd(), resolve(file)).replaceAll('\\', '/');
// A file-level event names the file itself; a test inside it carries its own name.
const isFile = (data) => data.nesting === 0 && data.file && resolve(data.name) === resolve(data.file);
const clock = (start) => ((Date.now() - start) / 1000).toFixed(1);
/** First line of a failed test's error, unwrapping node:test's wrapper around the test's own error. */
const reason = (error) => {
  const own = error?.failureType === 'testCodeFailure' && error.cause ? error.cause : error;
  return String(own?.message ?? own ?? 'failed').split('\n')[0].slice(0, 300);
};

export default async function* timingReporter(source) {
  const start = Date.now();
  writeFileSync(LOG, `# node --test timings, started ${new Date(start).toISOString()}\n`);
  for await (const { type, data } of source) {
    if (type === 'test:dequeue' && isFile(data)) appendFileSync(LOG, `start ${clock(start)} ${where(data.file)}\n`);
    else if (type === 'test:complete' && isFile(data))
      appendFileSync(
        LOG,
        `done ${clock(start)} ${where(data.file)} ${(data.details.duration_ms / 1000).toFixed(1)} ${data.details.passed ? 'pass' : 'fail'}\n`,
      );
    else if (type === 'test:complete' && data.file && !data.details.passed)
      appendFileSync(
        LOG,
        `fail ${clock(start)} ${where(data.file)} ${JSON.stringify({ test: data.name, error: reason(data.details.error) })}\n`,
      );
  }
  appendFileSync(LOG, `end ${clock(start)}\n`);
  yield ''; // the log above is the output; the reporter's own stream stays empty
}

/** The log read back: each finished file with its wall time, the files that started but never finished, each failed
 * test with its error (in the order they failed), the total. */
export function summarize(text) {
  const started = new Map();
  const done = [];
  const failed = [];
  let end;
  for (const line of text.split('\n')) {
    const [kind, at, file, seconds, result] = line.split(' ');
    if (kind === 'fail') {
      const { test, error } = JSON.parse(line.split(' ').slice(3).join(' '));
      failed.push({ file, test, error, at: Number(at) });
    } else if (kind === 'start') started.set(file, Number(at));
    else if (kind === 'done') {
      started.delete(file);
      done.push({ file, seconds: Number(seconds), result, at: Number(at) });
    } else if (kind === 'end') end = Number(at);
  }
  done.sort((a, b) => b.seconds - a.seconds);
  return { done, unfinished: [...started].map(([file, at]) => ({ file, at })), failed, end };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] || LOG;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    console.log(`No timing log at ${path}.`);
    process.exit(0);
  }
  const { done, unfinished, failed, end } = summarize(text);
  const sum = done.reduce((total, f) => total + f.seconds, 0);
  console.log(
    `${done.length} files finished; sum of file times ${sum.toFixed(0)} s; ${end === undefined ? 'the run did not finish' : `wall ${end.toFixed(0)} s`}.`,
  );
  for (const f of unfinished) console.log(`NOT FINISHED  ${f.file} (started at ${f.at.toFixed(1)} s)`);
  for (const f of failed) console.log(`FAILED  ${f.file} > ${f.test}: ${f.error}`);
  for (const f of done.slice(0, 25))
    console.log(`${f.seconds.toFixed(1).padStart(7)} s  ${f.file}${f.result === 'fail' ? '  (failed)' : ''}`);
}
