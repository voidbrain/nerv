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
  const element = window.document.createElement('nerv-status-card');
  element.surface = {
    version: 1,
    component: 'nerv-status-card',
    props: { title: '<img src=x onerror=alert(1)>', detail: '<script>bad()</script>', status: 'ok' },
  };
  assert.equal(element.shadowRoot.querySelector('img'), null);
  assert.equal(element.shadowRoot.querySelector('script'), null);
  assert.match(element.shadowRoot.querySelector('p').textContent, /<script>bad/);
  element.surface = { component: 'script' };
  assert.match(element.shadowRoot.querySelector('p').textContent, /Invalid surface/);
});
