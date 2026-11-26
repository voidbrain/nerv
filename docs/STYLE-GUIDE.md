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
- **Token source:** `palette()` in `web/public/dashboard/dashboard.js` computes all `var(--…)` tokens (`test/dashboard.test.ts` enforces WCAG AA 4.5:1 across all 20 combinations). The workspace dashboard (`/full`, F-130-T01) reads the same tokens from `src/dashboard-theme.ts` (`test/dashboard-theme.test.ts` keeps the two equal), bound on its host by `ThemeService`; there *Simple · Dark* is the default and *Eva* optional, and the choice is kept per browser (`nerv.workspace.theme`). Eva · Dark · Orange matches `:root`. Primary buttons (`.btn.primary`, the sign-in button) and the brand block draw `--brand-fg` on the accent: black on the bright accent in dark modes, white on the deep accent in light modes (B-151; 🧱 bricks#20 chose the same for its light modes). Black and white are three-digit hex (`#000`, `#fff`), which the AA test expands before measuring. Pairing QRs use `--qr-ink`/`--qr-paper` (black on white, set in `:root` only), so every palette draws a QR any camera reads.
- **Shared dashboard layout classes** (`web/public/dashboard/index.html`): `.cols-2` puts two equal columns side by side, on a phone too, with tighter gaps, padding and controls at 720 px or less (Settings: update schedule | paired devices and notifications); `.settings-head` is a Settings block's title row: title and actions wrap with 4–8 px gaps, never pressed against the column edge; `.field-grid` aligns a label column with its controls (`.field` per line, `.wide` spans both); Health rows are `.health-row` with a nowrap `.health-label` and a right-aligned `.health-value` (✓ ok, ✗ warn or danger, · nothing recorded). `.update-status` is the one emphasised status box: bold, bordered and tinted with `currentColor` of its state class (`.warn`, `.danger`, `.ok`), never a literal colour.
- **Workspace components** (F-130-T01): dashboard sections build on `nerv-panel` (titled section) and `nerv-stat` (label, value, detail) in `web/src/ui.ts`, which read only tokens; 🧱 bricks replaces that file once it can be consumed without publishing. Workspace styles stay in the component: the global `web/src/styles.css` rules for `header`, `label`, `p` and `.brand` belong to the simple page.
- **Live views** (B-145): render once, then update only the values that changed (`setText`, `setAttr`, `patchHTML` in `dashboard.js`); lists are keyed rows (`data-key` or `id`): add, remove, move or patch a row, never rebuild the list; no innerHTML on a polled section after its first render. Markup built from data is escaped with `esc`. New UI goes in the Angular workspace (F-130), not the dashboard.

## Detailed component specifications

For MAGI/Sephirot lore rules, CRT brightness/noise tuning, Map/Midori/Battery/Pilots/History/Search UI details, and native macOS companion preview rules, see [Dashboard and Native UI Specifications](design/dashboard-and-native-ui.md).
