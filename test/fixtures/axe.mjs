// @ts-check
// B-154: axe in the browser tests. axe puts text whose contrast it cannot decide (over a gradient, an image, an SVG
// shape or a translucent layer) in `incomplete`, not in `violations`; asserting only violations let a contrast failure
// there pass. `axeRun` returns both: every violation, and every undecided colour-contrast node that is not accepted
// by name in `accepted` (a selector as axe prints it, with the reason it was checked by hand).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** axe-core itself, to evaluate in the page once before `axeRun`. */
export const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/**
 * An expression for the page: axe on `context` (a selector; the whole document when omitted) resolving to
 * `{ violations, undecided }`. `undecided` lists the colour-contrast nodes axe could not decide, except those inside
 * an `accepted` selector, each named with the check that covers it instead.
 * @param {string} [context]
 * @param {Record<string, string>} [accepted] selector → why its undecided nodes pass (the check that measures them)
 */
export function axeRun(context, accepted = {}) {
  const scope = context ? `document.querySelector(${JSON.stringify(context)})` : 'document';
  return `axe.run(${scope}).then(r=>{const accepted=${JSON.stringify(Object.keys(accepted))};const inside=n=>{if(n.target.length!==1)return false;const e=document.querySelector(n.target[0]);return !!e&&accepted.some(a=>e.closest(a))};return{violations:r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target.join(' ')),why:v.nodes.map(n=>n.any.map(a=>a.message).join(' '))})),undecided:r.incomplete.filter(v=>v.id==='color-contrast').flatMap(v=>v.nodes).filter(n=>!inside(n)).map(n=>({target:n.target.join(' '),why:n.any.map(a=>a.message).join(' ')}))}})`;
}

/**
 * An expression for the page: every text in `selector` below WCAG AA against the box behind it, which axe cannot
 * measure when that box is an SVG shape: a MAGI seat's polygon fill, else the nearest opaque background, with each
 * translucent layer and the text's own opacity composited, and, with the EVA CRT on, the darker of the plain and the
 * scanline rows (the stripe colour is read from `body::after`, so a change to the CRT is measured too).
 * @param {string} selector
 */
export function textContrast(selector) {
  return `(${pageTextContrast.toString()})(${JSON.stringify(selector)})`;
}

/** @param {string} selector */
function pageTextContrast(selector) {
  // Any CSS colour (rgb, color(srgb …), oklab from color-mix …) as sRGB 0–255 and alpha 0–1, read back from a canvas.
  const ink = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
  /** @param {string} c @returns {number[]} */
  const parse = (c) => {
    ink.clearRect(0, 0, 1, 1);
    ink.fillStyle = c;
    ink.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ink.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  /** @param {number[]} top @param {number[]} under */
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  /** @param {number[]} c */
  const lum = (c) => {
    const [r, g, b] = c.slice(0, 3).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  /** @param {number[]} a @param {number[]} b */
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  /** @param {Element} el */
  const background = (el) => {
    const layers = [];
    for (let n = /** @type {Element | null} */ (el); n; n = n.parentElement) {
      const seat = n !== el && n.classList.contains('mseat') ? n.querySelector('polygon') : null;
      if (seat) layers.push(parse(getComputedStyle(seat).fill));
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg[3] > 0) layers.push(bg);
      if (layers.length && layers[layers.length - 1][3] === 1) break;
    }
    return layers.reverse().reduce((c, layer) => over(layer, c), [255, 255, 255, 1]);
  };
  /** @param {Element} el */
  const opacity = (el) => {
    let o = 1;
    for (let n = /** @type {Element | null} */ (el); n; n = n.parentElement) o *= +getComputedStyle(n).opacity;
    return o;
  };
  const stripes = document.body.classList.contains('crt-on')
    ? (getComputedStyle(document.body, '::after').backgroundImage.match(/rgba?\([^)]*\)/g) ?? []).map(parse)
    : [];
  const failures = [];
  for (const el of document.querySelectorAll(selector + ' *')) {
    if (![...el.childNodes].some((t) => t.nodeType === 3 && t.textContent?.trim()) || !el.getClientRects().length)
      continue;
    const style = getComputedStyle(el),
      text = parse(style.color);
    const fg = [text[0], text[1], text[2], text[3] * opacity(el)];
    const size = parseFloat(style.fontSize),
      need = size >= 24 || (+style.fontWeight >= 700 && size >= 18.66) ? 3 : 4.5;
    const box = background(el);
    // The CRT layer is above the page: it tints the text and its box alike, row by row.
    for (const stripe of [[0, 0, 0, 0], ...stripes]) {
      const r = ratio(over(stripe, over(fg, box)), over(stripe, box));
      if (r < need) {
        failures.push({ text: (el.textContent ?? '').trim().slice(0, 40), class: el.className, ratio: +r.toFixed(2) });
        break;
      }
    }
  }
  return failures;
}
