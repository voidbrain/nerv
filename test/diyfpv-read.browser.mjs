import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCdpPageReader } from '../src/browser-cdp-driver.ts';
import { DIYFPV_BUILDER_ORIGIN, parseDiyfpvBuild } from '../src/diyfpv-build.ts';

const chrome =
  process.env.CHROME_BIN ||
  ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(
    existsSync,
  );

// An invented, client-rendered build page: the tables appear after the shell loads, as on a script-built site.
const FIXTURE = `<!doctype html><html><head><title>Sample build</title></head><body><div id="app">Loading…</div>
<script>
setTimeout(() => {
  document.getElementById('app').innerHTML = \`
    <h1>Sample 3in Cinewhoop</h1>
    <table><caption>Parts</caption><thead><tr><th>Category</th><th>Part</th></tr></thead>
      <tbody><tr><td>Flight controller</td><td>ExampleFC F7 Mini</td></tr>
      <tr><td>Receiver</td><td>ExampleRX Nano</td></tr></tbody></table>
    <table><caption>Wiring</caption><thead><tr><th>From</th><th>From pad</th><th>To</th><th>To pad</th><th>UART</th></tr></thead>
      <tbody><tr><td>ExampleRX Nano</td><td>TX</td><td>ExampleFC F7 Mini</td><td>R2</td><td>UART2</td></tr></tbody></table>\`;
}, 300);
</script></body></html>`;

test(
  'F-099-T04: the page reader reads a client-rendered build page in a new tab and closes it',
  { timeout: 90000 },
  async () => {
    assert.ok(chrome, 'Install Chrome/Chromium or set CHROME_BIN.');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(FIXTURE);
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const profile = mkdtempSync(join(tmpdir(), 'nerv-diyfpv-read-'));
    const child = spawn(
      chrome,
      [
        '--headless',
        '--no-first-run',
        '--no-default-browser-check',
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    try {
      const port = await new Promise((done, fail) => {
        let output = '';
        const timer = setTimeout(() => fail(new Error('Chrome startup timed out: ' + output)), 30000);
        child.once('exit', (code) => {
          clearTimeout(timer);
          fail(new Error('Chrome exited: ' + code));
        });
        child.stderr.on('data', (chunk) => {
          output = (output + chunk).slice(-4000);
          const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(output);
          if (match) {
            clearTimeout(timer);
            done(Number(match[1]));
          }
        });
      });
      const reader = createCdpPageReader({ port });
      const page = await reader.readPageTables(`${origin}/build/sample0build`, [origin]);
      assert.equal(page.tables.length, 2);
      const build = parseDiyfpvBuild(page, `${DIYFPV_BUILDER_ORIGIN}/build/sample0build`);
      assert.equal(build.name, 'Sample 3in Cinewhoop');
      assert.deepEqual(
        build.components.map((c) => c.model),
        ['ExampleFC F7 Mini', 'ExampleRX Nano'],
      );
      assert.equal(build.wiring.length, 1);
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      assert.ok(!targets.some((t) => t.url.includes('/build/sample0build')), 'the read tab is closed');
    } finally {
      const exited = child.exitCode !== null ? Promise.resolve() : new Promise((done) => child.once('exit', done));
      child.kill();
      await exited;
      await new Promise((done) => server.close(done));
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  },
);
