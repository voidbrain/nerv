// B-145 test helper for live views: load the dashboard page in linkedom and tell which nodes a render touched.
// `touched(root, render)` runs render and returns the nodes it replaced (gone from the tree), the nodes whose text
// or attributes changed, and the number of DOM writes a MutationObserver saw (a same-value write counts too).
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const realTimeout = globalThis.setTimeout;
const flush = () => new Promise((done) => realTimeout(done, 0));

/** The dashboard simulation (dashboard.js, demo mode) in a linkedom page, with a frozen clock and no timers. */
export function loadDashboard(now = Date.UTC(2030, 0, 2, 9, 0, 0)) {
  const html = readFileSync('web/public/dashboard/index.html', 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const { window, document } = parseHTML(html);
  const noop = () => {};
  const ctx2d = new Proxy(
    {},
    {
      get: (_, k) =>
        k === 'measureText' ? () => ({ width: 1 }) : k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop,
      set: () => true,
    },
  );
  window.HTMLCanvasElement.prototype.getContext = () => ctx2d;
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
  class FrozenDate extends Date {
    constructor(...a) {
      if (a.length) super(...a);
      else super(now);
    }
    static now() {
      return now;
    }
  }
  const globals = {
    location: { protocol: 'file:', search: '', hash: '', pathname: '/' },
    navigator: { userAgent: 'test', clipboard: {} },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    setInterval: noop,
    setTimeout: noop,
    clearTimeout: noop,
    clearInterval: noop,
    requestAnimationFrame: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
    ResizeObserver: class {
      observe() {}
    },
    Path2D: class {
      moveTo() {}
      lineTo() {}
    },
    Image: class {},
    addEventListener: noop,
    devicePixelRatio: 1,
    innerWidth: 1440,
  };
  // The page's own window: the test globals first, then linkedom's (never Node's own globals).
  const pageWindow = new Proxy(window, { get: (t, k) => (k in globals ? globals[k] : Reflect.get(t, k)) });
  const sandbox = { window: pageWindow, document, console, Date: FrozenDate, Math, JSON, Promise, URLSearchParams, ...globals };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync('web/public/dashboard/dashboard.js', 'utf8'), sandbox, { filename: 'dashboard.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  return { window, document, run, sandbox };
}

function snapshot(root) {
  const nodes = new Map();
  const walk = (n) => {
    nodes.set(
      n,
      n.nodeType === 1 ? [...n.attributes].map((a) => a.name + '=' + a.value).join('\u0001') : String(n.data ?? ''),
    );
    for (const c of n.childNodes) walk(c);
  };
  walk(root);
  return nodes;
}

/** Runs render and reports what it did to root: replaced nodes, changed nodes, and observed writes. */
export async function touched(window, root, render) {
  const before = snapshot(root);
  const records = [];
  const mo = new window.MutationObserver((list) => records.push(...list));
  mo.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  render();
  await flush();
  mo.disconnect();
  const after = snapshot(root);
  const replaced = [...before.keys()].filter((n) => !after.has(n));
  const changed = [...after].filter(([n, v]) => before.has(n) && before.get(n) !== v).map(([n]) => n);
  const added = [...after.keys()].filter((n) => !before.has(n));
  return { replaced, changed, added, writes: records.length };
}
