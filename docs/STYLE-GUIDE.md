# NERV Agency Style Guide

## Brand & tokens

- **Mark & wordmark:** Original inverted triangle with seven almond eyes in rows of 4, 2, and 1 (`web/public/mark.svg`), paired with an original half leaf in `web/public/brand.svg`. One colour: dark NERV red `--mark` (`#d4002a`, ≥3:1 on `--bg`). `test/brand.test.ts` keeps SVG literal colours synced with `--mark`. Never ship third-party Evangelion/SEELE artwork or raster/stock concept art.
- **Palette & typography:** `web/src/styles.css` is the token source of truth (dark navy surfaces, pale text, muted labels, seafoam actions). Use system sans-serif for controls and Georgia italic for the introductory line; no remote fonts.
- **Voice & state honesty:** Calm, concrete copy. Distinguish *planned*, *configured*, *connected*, *observed*, and *failed* states; never claim connected devices or delivered phone notifications unless observed.

## Internationalization, accessibility & workspace

- **Languages & time:** English default, Italian selectable (`web/src/i18n.ts` keeps matching keys). User reminder text is never translated automatically. Browser inputs/dates use browser local time (explicitly labelled); server schedules default to `Europe/Rome`. CLI commands and raw doctor fields remain technical English.
- **WCAG AA & layout:** Generous spacing, visible focus, persistent labels, and explicit error messages. Navigation wraps at 320 px without horizontal overflow. `npm run test:browser` verifies styles, i18n, local dates, responsiveness, and axe checks.
- **Status card & CSP:** `nerv-status-card` uses Shadow DOM with theme tokens (encapsulation only, not a security boundary; preserve escaping). Critical-CSS extraction is disabled so CSP blocks no inline activation scripts.
- **PWA shell & update prompt:** Seven-eye icons (`web/public/icons/`, regenerated via `node tools/render-icons.mjs`) match `--bg` (`test/pwa.test.mjs`). `nerv-update-prompt` uses a polite live region with Reload/Later (never auto-reloads). Service worker caches the shell only; API calls send `ngsw-bypass`.

## Dashboard theme system

- **Three-part selector:** **Theme** (*Eva* or *Simple*), **Mode** (*dark* or *light*), and **Colour** (*orange*, *blue*, *green*, *violet*, or *ochre*).
- **Token source:** `palette()` in `web/public/dashboard/dashboard.js` computes all `var(--…)` tokens (`test/dashboard.test.ts` enforces WCAG AA 4.5:1 across all 20 combinations). Eva · Dark · Orange matches `:root`.

## Detailed component specifications

For MAGI/Sephirot lore rules, CRT brightness/noise tuning, Map/Midori/Battery/Pilots/History/Search UI details, and native macOS companion preview rules, see [Dashboard and Native UI Specifications](design/dashboard-and-native-ui.md).
