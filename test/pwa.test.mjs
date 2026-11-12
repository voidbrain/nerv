// F-004-T01: the PWA files agree with each other and with the theme tokens; test/pwa.browser.mjs covers the behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
/** Width and height from a PNG's IHDR chunk. */
const pngSize = (file) => {
  const png = readFileSync(file);
  assert.equal(png.toString('latin1', 1, 4), 'PNG', file + ' is a PNG');
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
};

test('the manifest names the app, uses the --bg token and lists square PNG icons of the declared sizes', () => {
  const manifest = JSON.parse(read('web/public/manifest.webmanifest'));
  const bg = /--bg:(#[0-9a-f]{6})/.exec(read('web/src/styles.css'))[1];
  assert.equal(manifest.name, 'NERV Agency');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, bg);
  assert.equal(manifest.theme_color, bg);
  assert.match(read('web/src/index.html'), new RegExp(`<meta name="theme-color" content="${bg}">`));
  const sizes = manifest.icons.map((icon) => {
    assert.equal(icon.type, 'image/png');
    assert.equal(pngSize('web/public/' + icon.src), icon.sizes, icon.src);
    return icon.purpose + ' ' + icon.sizes;
  });
  for (const needed of ['any 192x192', 'any 512x512', 'maskable 512x512']) assert.ok(sizes.includes(needed), needed);
  assert.equal(pngSize('web/public/icons/apple-touch-icon.png'), '180x180');
});

test('index.html links the manifest and the build registers the service worker', () => {
  const index = read('web/src/index.html');
  assert.match(index, /<link rel="manifest" href="manifest.webmanifest">/);
  assert.match(index, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon.png">/);
  const build = JSON.parse(read('angular.json')).projects.nerv.architect.build.options;
  assert.equal(build.serviceWorker, 'web/ngsw-config.json');
  assert.match(read('web/src/main.ts'), /provideServiceWorker\('ngsw-worker\.js', \{ enabled: !isDevMode\(\) \}\)/);
});

test('the service worker caches only the shell: never the API, never the dashboard', () => {
  const config = JSON.parse(read('web/ngsw-config.json'));
  assert.equal(config.dataGroups, undefined, 'no API responses are cached');
  for (const excluded of ['!/api', '!/api/**', '!/dashboard', '!/dashboard/**'])
    assert.ok(config.navigationUrls.includes(excluded), excluded);
  const files = config.assetGroups.flatMap((group) => group.resources.files);
  assert.ok(
    files.every((glob) => !glob.includes('dashboard') && !glob.includes('api') && !glob.startsWith('/**')),
    files.join(),
  );
});
