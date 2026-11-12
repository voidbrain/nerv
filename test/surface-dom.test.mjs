import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

test('registered Web Component displays hostile text without creating executable markup', async () => {
  const { window } = parseHTML('<html><body></body></html>');
  Object.assign(globalThis, {
    HTMLElement: window.HTMLElement,
    customElements: window.customElements,
    document: window.document,
  });
  const { registerSurfaces } = await import('../web/src/status-card.ts');
  registerSurfaces();
  registerSurfaces();

  // 1. Status card renders safely
  const statusEl = window.document.createElement('nerv-status-card');
  statusEl.surface = {
    version: 1,
    component: 'nerv-status-card',
    props: { title: '<img src=x onerror=alert(1)>', detail: '<script>bad()</script>', status: 'ok' },
  };
  assert.equal(statusEl.shadowRoot.querySelector('img'), null);
  assert.equal(statusEl.shadowRoot.querySelector('script'), null);
  assert.match(statusEl.shadowRoot.querySelector('p').textContent, /<script>bad/);

  statusEl.surface = { component: 'script' };
  assert.match(statusEl.shadowRoot.querySelector('p').textContent, /Invalid surface/);

  // 2. Notice card renders safely
  const noticeEl = window.document.createElement('nerv-notice-card');
  noticeEl.surface = {
    version: 1,
    component: 'nerv-notice-card',
    props: { topic: '<b>Alert</b>', message: '<iframe src=evil.com></iframe>', tone: 'warn' },
  };
  assert.equal(noticeEl.shadowRoot.querySelector('b'), null);
  assert.equal(noticeEl.shadowRoot.querySelector('iframe'), null);
  assert.match(noticeEl.shadowRoot.querySelector('p').textContent, /<iframe src=evil\.com>/);
  assert.equal(noticeEl.shadowRoot.querySelector('span').textContent, 'WARN');

  noticeEl.surface = { component: 'nerv-status-card', props: { title: 't', detail: 'd', status: 'ok' } };
  assert.match(noticeEl.shadowRoot.querySelector('p').textContent, /Invalid surface/);
});

test('GenUI surface renderer rejects and logs arbitrary component, code or action payloads', async () => {
  const { surfaceRejectionLog, clearSurfaceRejectionLog, logSurfaceRejection, validateSurfaceResult } =
    await import('../shared/surface.ts');

  clearSurfaceRejectionLog();
  assert.equal(surfaceRejectionLog.length, 0);

  // Test arbitrary component payload rejection
  const arbitraryComponent = {
    version: 1,
    component: 'arbitrary-exploit-widget',
    props: { custom: 'payload' },
  };
  const compResult = validateSurfaceResult(arbitraryComponent);
  assert.equal(compResult.ok, false);
  assert.match(compResult.reason, /Unregistered component/);
  logSurfaceRejection(compResult.reason, arbitraryComponent);
  assert.equal(surfaceRejectionLog.length, 1);
  assert.equal(surfaceRejectionLog[0].raw, arbitraryComponent);

  // Test code payload rejection
  const codePayload = {
    version: 1,
    component: 'nerv-status-card',
    props: { title: 't', detail: 'd', status: 'ok' },
    code: 'process.exit(1)',
  };
  const codeResult = validateSurfaceResult(codePayload);
  assert.equal(codeResult.ok, false);
  assert.match(codeResult.reason, /Forbidden key or action payload/);
  logSurfaceRejection(codeResult.reason, codePayload);
  assert.equal(surfaceRejectionLog.length, 2);

  // Test action payload rejection
  const actionPayload = {
    version: 1,
    component: 'nerv-status-card',
    props: { title: 't', detail: 'd', status: 'ok' },
    action: 'reboot_host',
  };
  const actionResult = validateSurfaceResult(actionPayload);
  assert.equal(actionResult.ok, false);
  assert.match(actionResult.reason, /Forbidden key or action payload/);
  logSurfaceRejection(actionResult.reason, actionPayload);
  assert.equal(surfaceRejectionLog.length, 3);

  // Test valid payload succeeds
  const validPayload = {
    version: 1,
    component: 'nerv-notice-card',
    props: { topic: 'Safe Topic', message: 'Safe Message', tone: 'info' },
  };
  const validResult = validateSurfaceResult(validPayload);
  assert.equal(validResult.ok, true);
});
