import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createCdpBrowserDriver, type CdpSession, type CdpTarget } from '../src/browser-cdp-driver.ts';
import { clickNamedControl, validateBrowserConfig } from '../src/browser-control.ts';
import { readConfig } from '../src/config.ts';

const TARGET: CdpTarget = {
  id: 'page-1',
  type: 'page',
  url: 'https://app.example.test/watch',
  title: 'Sample video',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/page-1',
};

interface FakePage {
  url: string;
  title: string;
  visible: boolean;
  controls: { name: string; role: string; sensitive: boolean; inDialog: boolean }[];
  textSummary: string;
}

/** A fake DevTools endpoint: answers the snapshot and click expressions from a page model. */
function fakeCdp(
  page: FakePage,
  onClick: (name: string, emit: (m: string, p: Record<string, unknown>) => void) => void,
) {
  const sent: string[] = [];
  const connect = async (url: string): Promise<CdpSession> => {
    assert.equal(url, TARGET.webSocketDebuggerUrl);
    const listeners: ((m: string, p: Record<string, unknown>) => void)[] = [];
    const emit = (m: string, p: Record<string, unknown>) => listeners.forEach((l) => l(m, p));
    return {
      async send(method, params = {}) {
        sent.push(method);
        if (method !== 'Runtime.evaluate') return {};
        const expression = String(params.expression);
        const clickTarget = /const target = ("(?:[^"\\]|\\.)*");/.exec(expression);
        if (!clickTarget) return { result: { value: page } };
        const name = JSON.parse(clickTarget[1]!) as string;
        const control = page.controls.find((c) => c.name.toLowerCase() === name);
        if (!control) return { result: { value: 'missing' } };
        if (control.sensitive || control.inDialog) return { result: { value: 'refused' } };
        onClick(control.name, emit);
        return { result: { value: 'clicked' } };
      },
      onEvent(listener) {
        listeners.push(listener);
      },
      close() {},
    };
  };
  return { connect, sent };
}

const PAGE: FakePage = {
  url: TARGET.url,
  title: TARGET.title,
  visible: true,
  controls: [
    { name: 'Skip', role: 'button', sensitive: false, inDialog: false },
    { name: 'Card number', role: 'textbox', sensitive: true, inDialog: false },
    { name: 'Block', role: 'button', sensitive: false, inDialog: true },
    { name: 'Delete all', role: 'button', sensitive: false, inDialog: false },
  ],
  textSummary: 'Ad playing.',
};

describe('F-089-T04 CDP browser driver bound to the click adapter', () => {
  const allowedOrigins = ['https://app.example.test'];

  it('reads the most recent page, clicks by name and reads the page back', async () => {
    const page = { ...PAGE };
    const cdp = fakeCdp(page, () => {
      page.textSummary = 'Ad skipped.';
    });
    const driver = createCdpBrowserDriver({
      port: 9333,
      settleMs: 1,
      listTargets: async () => [{ ...TARGET, id: 'worker', type: 'service_worker' }, TARGET],
      connect: cdp.connect,
    });
    const res = await clickNamedControl(driver, { controlName: 'skip', allowedOrigins, approved: true });
    assert.equal(res.tabId, 'page-1');
    assert.equal(res.after.textSummary, 'Ad skipped.');
    assert.ok(cdp.sent.includes('Page.enable'));
  });

  it('refuses credential fields, dialog controls, unlisted origins and a click that opens a JavaScript dialog', async () => {
    const cdp = fakeCdp({ ...PAGE }, (name, emit) => {
      if (name === 'Delete all') emit('Page.javascriptDialogOpening', { type: 'confirm' });
    });
    const driver = createCdpBrowserDriver({
      port: 9333,
      settleMs: 1,
      listTargets: async () => [TARGET],
      connect: cdp.connect,
    });
    await assert.rejects(
      () => clickNamedControl(driver, { controlName: 'Card number', allowedOrigins, approved: true }),
      /credential or payment/,
    );
    await assert.rejects(
      () => clickNamedControl(driver, { controlName: 'Block', allowedOrigins, approved: true }),
      /inside an open dialog/,
    );
    await assert.rejects(
      () =>
        clickNamedControl(driver, { controlName: 'Skip', allowedOrigins: ['https://other.example'], approved: true }),
      /not in browser\.allowedOrigins/,
    );
    await assert.rejects(
      () => clickNamedControl(driver, { controlName: 'Delete all', allowedOrigins, approved: true }),
      /browser confirm dialog; NERV never answers dialogs/,
    );
  });

  it('a hidden tab is not the active tab, and no page or a closed tab fails with a message', async () => {
    const hidden = createCdpBrowserDriver({
      port: 9333,
      listTargets: async () => [TARGET],
      connect: fakeCdp({ ...PAGE, visible: false }, () => {}).connect,
    });
    await assert.rejects(
      () => clickNamedControl(hidden, { controlName: 'Skip', allowedOrigins, approved: true }),
      /non-active browser tab/,
    );
    const empty = createCdpBrowserDriver({ port: 9333, listTargets: async () => [] });
    await assert.rejects(() => empty.getActiveTab(), /No open page/);
    await assert.rejects(() => empty.clickControl('page-1', 'Skip'), /no longer open/);
    assert.throws(() => createCdpBrowserDriver({ port: 0 }), /debugPort/);
  });

  it('config.json browser: owner-set origins and port are validated', () => {
    assert.deepEqual(validateBrowserConfig({ allowedOrigins: ['https://app.example.test'], debugPort: 9333 }), {
      allowedOrigins: ['https://app.example.test'],
      debugPort: 9333,
    });
    for (const bad of [
      { allowedOrigins: ['https://app.example.test/path'], debugPort: 9333 },
      { allowedOrigins: ['file:///tmp'], debugPort: 9333 },
      { allowedOrigins: ['https://app.example.test'], debugPort: 80 },
      { allowedOrigins: ['https://app.example.test'], debugPort: 9333, extra: true },
      { allowedOrigins: 'https://app.example.test', debugPort: 9333 },
    ]) {
      assert.throws(() => validateBrowserConfig(bad), /Invalid browser/);
    }
    const home = mkdtempSync(join(tmpdir(), 'nerv-browser-config-'));
    try {
      writeFileSync(
        join(home, 'config.json'),
        JSON.stringify({ browser: { allowedOrigins: ['http://127.0.0.1:8080'], debugPort: 9333 } }),
      );
      assert.deepEqual(readConfig(home).browser, { allowedOrigins: ['http://127.0.0.1:8080'], debugPort: 9333 });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
