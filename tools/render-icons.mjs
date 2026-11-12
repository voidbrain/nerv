// Renders the PWA icons in web/public/icons/ from web/public/mark.svg (F-004-T01) with headless Chrome.
// The mark is the owner's choice; the icons only place it on the `--bg` surface. Rerun after changing either:
//   node tools/render-icons.mjs        (CHROME_BIN overrides the Chrome path)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chrome =
  process.env.CHROME_BIN ||
  ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(
    existsSync,
  );
if (!chrome) throw new Error('Install Chrome/Chromium or set CHROME_BIN.');
const bg = /--bg:(#[0-9a-f]{6})/.exec(readFileSync('web/src/styles.css', 'utf8'))?.[1];
if (!bg) throw new Error('No --bg token in web/src/styles.css.');
const mark = readFileSync('web/public/mark.svg', 'utf8').replace(/<title>.*?<\/title>/, '');
// Mark height as a share of the icon: "any" icons fill most of the square; maskable ones keep the mark inside the
// central safe zone (a circle of 80% diameter), so launchers can crop to any shape without cutting the triangle.
const icons = [
  { file: 'icon-192.png', size: 192, share: 0.8 },
  { file: 'icon-512.png', size: 512, share: 0.8 },
  { file: 'icon-maskable-512.png', size: 512, share: 0.6 },
  { file: 'apple-touch-icon.png', size: 180, share: 0.75 },
];
const work = mkdtempSync(join(tmpdir(), 'nerv-icons-'));
try {
  for (const { file, size, share } of icons) {
    const height = Math.round(size * share);
    const html = join(work, 'icon.html');
    writeFileSync(
      html,
      `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:${bg};display:grid;place-items:center">` +
        mark.replace('<svg ', `<svg height="${height}" width="${Math.round((height * 32) / 48)}" `) +
        '</body></html>',
    );
    const out = resolve('web/public/icons', file);
    const run = spawnSync(
      chrome,
      [
        '--headless',
        '--no-first-run',
        '--disable-gpu',
        '--hide-scrollbars',
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
        `--user-data-dir=${join(work, 'profile')}`,
        `--window-size=${size},${size}`,
        `--screenshot=${out}`,
        'file://' + html,
      ],
      { stdio: 'ignore', timeout: 60000 },
    );
    if (run.status !== 0 || !existsSync(out)) throw new Error('Chrome could not render ' + file);
    console.log('rendered web/public/icons/' + file);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
