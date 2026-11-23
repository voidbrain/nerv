import type { AccessibleControl, BrowserAdapterDriver, BrowserTabSnapshot } from './browser-control.ts';

/** One DevTools-protocol connection to a page target. */
export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  onEvent(listener: (method: string, params: Record<string, unknown>) => void): void;
  close(): void;
}

export interface CdpTarget {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly title: string;
  readonly webSocketDebuggerUrl?: string;
}

export interface CdpBrowserDriverOptions {
  /** The dedicated profile's remote-debugging port on 127.0.0.1. */
  readonly port: number;
  readonly listTargets?: () => Promise<CdpTarget[]>;
  readonly connect?: (webSocketUrl: string) => Promise<CdpSession>;
  /** How long to wait after a click before reading the page back. */
  readonly settleMs?: number;
  readonly timeoutMs?: number;
}

const MAX_SUMMARY = 4000;
const MAX_CONTROLS = 500;

// Runs in the page. Collects visible interactive elements with an accessible name and role, marks
// credential/payment fields and controls inside dialogs. Shared by the read and the click.
const COLLECT = `function collect() {
  const SEL = 'button, a[href], input, textarea, select, summary, [role=button], [role=link], [role=menuitem], [role=tab], [role=checkbox], [role=radio], [role=switch]';
  const text = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && text(aria)) return text(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = text(by.split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '));
      if (t) return t;
    }
    if (el.labels && el.labels.length) {
      const t = text(Array.from(el.labels).map((l) => l.textContent).join(' '));
      if (t) return t;
    }
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) return text(el.value);
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') {
      const t = text(el.innerText || el.textContent);
      if (t) return t;
    }
    return text(el.getAttribute('title') || el.getAttribute('placeholder'));
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    if (el.tagName === 'A') return 'link';
    if (el.tagName === 'BUTTON' || el.tagName === 'SUMMARY') return 'button';
    if (el.tagName === 'SELECT') return 'combobox';
    if (el.tagName === 'TEXTAREA') return 'textbox';
    const type = (el.type || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'checkbox' || type === 'radio') return type;
    return 'textbox';
  };
  const sensitive = (el) => {
    const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
    return (el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'password') ||
      /(^|\\s)(cc-|current-password|new-password|one-time-code)/.test(auto);
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (out.length >= ${MAX_CONTROLS}) break;
    if (!visible(el) || el.disabled) continue;
    const name = nameOf(el);
    if (!name) continue;
    out.push({ el, name, role: roleOf(el), sensitive: sensitive(el), inDialog: !!el.closest('dialog[open], [role=dialog], [role=alertdialog]') });
  }
  return out;
}`;

const SNAPSHOT_EXPRESSION = `(() => { ${COLLECT}
  return {
    url: location.href,
    title: document.title,
    visible: document.visibilityState === 'visible',
    controls: collect().map((c) => ({ name: c.name, role: c.role, sensitive: c.sensitive, inDialog: c.inDialog })),
    textSummary: ((document.body && document.body.innerText) || '').slice(0, ${MAX_SUMMARY}),
  };
})()`;

function clickExpression(controlName: string): string {
  return `(() => { ${COLLECT}
  const target = ${JSON.stringify(controlName.trim().toLowerCase())};
  const match = collect().find((c) => c.name.toLowerCase() === target);
  if (!match) return 'missing';
  if (match.sensitive || match.inDialog) return 'refused';
  setTimeout(() => match.el.click(), 0);
  return 'clicked';
})()`;
}

interface PageSnapshot {
  url: string;
  title: string;
  visible: boolean;
  controls: { name: string; role: string; sensitive: boolean; inDialog: boolean }[];
  textSummary: string;
}

async function defaultListTargets(port: number, timeoutMs: number): Promise<CdpTarget[]> {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Browser debugging port ${port} answered ${res.status}.`);
  return (await res.json()) as CdpTarget[];
}

function defaultConnect(timeoutMs: number) {
  return (url: string): Promise<CdpSession> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      let serial = 0;
      const pending = new Map<number, { done: (v: Record<string, unknown>) => void; fail: (e: Error) => void }>();
      const listeners: ((method: string, params: Record<string, unknown>) => void)[] = [];
      const timer = setTimeout(() => reject(new Error('Browser connection timed out.')), timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve({
          send(method, params = {}) {
            const id = ++serial;
            return new Promise((done, fail) => {
              const t = setTimeout(() => {
                pending.delete(id);
                fail(new Error(`Browser did not answer ${method} (a dialog may be open).`));
              }, timeoutMs);
              pending.set(id, {
                done: (v) => {
                  clearTimeout(t);
                  done(v);
                },
                fail: (e) => {
                  clearTimeout(t);
                  fail(e);
                },
              });
              ws.send(JSON.stringify({ id, method, params }));
            });
          },
          onEvent(listener) {
            listeners.push(listener);
          },
          close() {
            ws.close();
          },
        });
      });
      ws.addEventListener('error', () => reject(new Error('Browser connection failed.')));
      ws.addEventListener('message', (event) => {
        const msg = JSON.parse(String(event.data)) as {
          id?: number;
          method?: string;
          params?: Record<string, unknown>;
          result?: Record<string, unknown>;
          error?: { message?: string };
        };
        if (msg.id !== undefined) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) p?.fail(new Error(msg.error.message ?? 'Browser protocol error.'));
          else p?.done(msg.result ?? {});
        } else if (msg.method) {
          for (const l of listeners) l(msg.method, msg.params ?? {});
        }
      });
    });
}

async function evaluate<T>(session: CdpSession, expression: string): Promise<T> {
  const res = await session.send('Runtime.evaluate', { expression, returnByValue: true, userGesture: true });
  if (res.exceptionDetails) throw new Error('The page script failed.');
  return (res.result as { value: T }).value;
}

function toSnapshot(target: CdpTarget, page: PageSnapshot): BrowserTabSnapshot {
  const controls: AccessibleControl[] = page.controls.map((c) => ({
    name: c.name,
    role: c.role,
    ...(c.sensitive ? { isCredentialOrPayment: true } : {}),
    ...(c.inDialog ? { inDialog: true } : {}),
  }));
  return {
    tabId: target.id,
    url: page.url,
    title: page.title,
    active: page.visible,
    controls,
    textSummary: page.textSummary,
  };
}

/**
 * F-089-T04: the live browser driver for the click adapter, over the Chrome DevTools protocol on the
 * dedicated profile's local debugging port (127.0.0.1 only). The active tab is the most recently used
 * page target; the click runs in the page by accessible name, never answers a JavaScript dialog, and
 * the page is read back after it.
 */
export function createCdpBrowserDriver(options: CdpBrowserDriverOptions): BrowserAdapterDriver {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('browser.debugPort must be a port number.');
  }
  const timeoutMs = options.timeoutMs ?? 5000;
  const settleMs = options.settleMs ?? 400;
  const listTargets = options.listTargets ?? (() => defaultListTargets(options.port, timeoutMs));
  const connect = options.connect ?? defaultConnect(timeoutMs);

  const pages = async () => (await listTargets()).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const open = async (target: CdpTarget) => connect(target.webSocketDebuggerUrl!);

  return {
    async getActiveTab() {
      const [target] = await pages();
      if (!target) throw new Error(`No open page in the browser on debugging port ${options.port}.`);
      const session = await open(target);
      try {
        return toSnapshot(target, await evaluate<PageSnapshot>(session, SNAPSHOT_EXPRESSION));
      } finally {
        session.close();
      }
    },
    async clickControl(tabId, controlName) {
      const target = (await pages()).find((t) => t.id === tabId);
      if (!target) throw new Error(`Tab "${tabId}" is no longer open.`);
      const session = await open(target);
      try {
        let dialog: string | undefined;
        session.onEvent((method, params) => {
          if (method === 'Page.javascriptDialogOpening') dialog = String(params.type ?? 'dialog');
        });
        await session.send('Page.enable');
        const outcome = await evaluate<string>(session, clickExpression(controlName));
        if (outcome === 'missing') throw new Error(`Accessible control "${controlName}" was not found on the tab.`);
        if (outcome === 'refused') {
          throw new Error(`Refusing to interact with credential, payment or dialog control "${controlName}".`);
        }
        await new Promise((done) => setTimeout(done, settleMs));
        if (dialog) {
          throw new Error(
            `The click opened a browser ${dialog} dialog; NERV never answers dialogs. Answer it in the browser.`,
          );
        }
        return toSnapshot(target, await evaluate<PageSnapshot>(session, SNAPSHOT_EXPRESSION));
      } finally {
        session.close();
      }
    },
  };
}
