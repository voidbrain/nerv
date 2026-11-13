# Dashboard and Native UI Specifications

Detailed component, visual, and interaction rules for the NERV dashboard (`web/public/dashboard/`) and native macOS companion (`native/`). For palette tokens, voice, i18n, and PWA basics, see [STYLE-GUIDE.md](../STYLE-GUIDE.md).

## Dashboard themes and lore

- **Three-part selector:** **Theme** (*Eva* or *Simple*), **Mode** (*dark* or *light*), **Colour** (*orange*, *blue*, *green*, *violet*, or *ochre*).
- **Tokens:** `palette()` in `dashboard.js` is the single source of truth; `test/dashboard.test.ts` enforces WCAG AA (4.5:1) across all 20 combinations. Eva · Dark · Orange matches `:root`. Legacy names map to their nearest combination.
- **Eva lore scripts (`.jp-only`):** Japanese kanji (`.mk`, `--kanji`) for MAGI seats and Hebrew (`lang="he"`, no letter-spacing) for the 11 numbered Sephirot nodes; hidden in *Simple* theme.
- **Build badge:** outlined header button next to the clock showing `v1.N` (first-parent commits on `main`, package version fallback), with `git rev-parse --short` hover/copy state.

## CRT effects and animations

- **Brightness dips & bands:** 4–8% dips over 31 s with eased zero-velocity band passes (4.5–10 s move, 4.5–14 s rest).
- **Signal noise:** 1 px specks in text token color (12–40% alpha, ≤0.045% pixels capped at 1,800, ≤90 ms refresh).
- **Accessibility & cancellation:** animations and canvas noise stop and clear when CRT is off, *Simple* theme is active, document is hidden, or `prefers-reduced-motion` is set (reduced motion keeps static scanlines/vignette only). CRT MAGI headings use a 70% identity / 30% text mix for AA contrast.
- **Sephirot paths:** reflect recorded route history; busy nodes pulse gently (disabled on reduced motion).

## Panels and controls

- **Empty & degraded states:** empty panels explain why and what to do next; unimplemented live panels read *planned · not connected yet*. Poll failures preserve last data and escalate through *REFRESH DELAYED* → *STATUS UNAVAILABLE* → *SERVICE UNREACHABLE*.
- **Sortie cards & shortcuts:** each sortie carries a one-sentence service-generated *why*. Outside text inputs, `/` searches and `a`/`r` approve/reject with a two-press confirmation announced in visible text.
- **Models, Battery & Pilots:** Models and Battery share accessible tabs (preserving unsaved drafts across polls). Battery shows paged accounting with per-page estimated currency subtotals and price provenance. Pilot cards keep inline `Model` label, selector, and Apply button.
- **Map & Midori:** legend has **■ Bases** and **- Kaji line** headings; main base uses a larger square with an outer outline circle; Midori (round Telegram node, dotted links) reflects recent Bot API checks separately from message pulses and send outcomes.
- **History & Search:** paginated `Previous page` / `Next page` controls preserve focus and label page counts; search filters loaded sorties, memory facts, and Comms without claiming full trace search.

## Native macOS companion

- **Menu bar:** monochrome seven-eye template icon, English/Italian switcher, up to 5 pending reminders with Mac-local dates. **Quit companion** leaves the daemon running; **Stop NERV Agency** requires destructive confirmation.
- **Pairing & renewal:** uses `SecureField` (never exposes admin bearer tokens); renewal preserves the active credential until the new one is saved.
- **Approval previews & notifications:** up to 5 read-only bounded cards with live TTL and a credential-free *Review in dashboard* link. Notifications use generic bilingual copy from enablement onward and never claim banner delivery or pending status.
