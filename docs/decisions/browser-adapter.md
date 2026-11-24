# Browser Adapter Decision (F-089-T01)

Date: 2026-11-15  
Status: Accepted (decision for F-089)

## 1. Adapter Choice

- **Choice**: **Playwright** connected to a **dedicated, owner-created browser profile** (isolated user-data-dir launched with explicit remote-debugging port or Playwright persistent context), rather than a broad browser extension or unpinned third-party MCP server.
- **Why**: Deterministic accessible-name locators (`getByRole` / `getByLabel`), zero access to the owner's primary browser cookies/passwords, and direct in-process control over timeouts, origin allowlists, and `tainted: true` page-text tagging.

## 2. Scope, Pages & Host Permissions

- **Allowed pages**: Only tabs/origins explicitly matching the owner's configured origin allowlist (`browser.allowedOrigins`) inside the dedicated profile; never `chrome://`, `file://`, extension pages, or unlisted tabs.
- **Allowed actions**:
  - Read-only inspection (visible accessible control names, URL/title, post-action diff) is tagged `tainted: true` (`F-027`) so page text never becomes an instruction.
  - Clicking a named control by accessible name on the active allowlisted tab is an **Orange** action gated behind an owner approval card.
  - Never enters credentials, never approves OS/browser permission or payment dialogs, and never switches to or acts on another tab.
- **Host permission**: Local loopback CDP / Playwright process only (`127.0.0.1`), running under the owner's desktop session where the dedicated profile lives; no remote browser exposure.

## Live binding (F-089-T04)

- The live driver speaks the Chrome DevTools protocol directly (`src/browser-cdp-driver.ts`, no Playwright dependency) to the dedicated profile's debugging port on `127.0.0.1`. The owner starts that profile with `--remote-debugging-port=<port> --user-data-dir=<dedicated folder>` and sets `"browser": {"allowedOrigins": [...], "debugPort": <port>}` in `config.json`.
- `nerv browser-click <control> --approved` acts on the most recently used page target, only when it is visible and its origin is allowed. Controls are found by accessible name in the page; password, payment-autocomplete fields and controls inside an open page dialog are refused; a click that opens a JavaScript dialog stops with a message and the dialog is left for the owner.
- `test/browser-click.browser.mjs` runs it against a local fixture page in headless Chrome.

## Owner decision: a chat tool for browser clicks (F-089-T05)

Today the Chrome DevTools driver is reachable only from the CLI (`nerv browser-click`) and from the F-012 web-chat resume. Misato has no chat tool that calls it, so a chat request such as "click the skip button" cannot reach the browser. Should Misato get one?

| Option | What it means |
|---|---|
| **A. Add a `browser.click` chat tool** | Misato can ask to click a named control on the allowed page. Each click is an Orange action behind an approval card; the same allowlist, refusals and tainted page text as the CLI apply. Agent work about 2–3 h, in its own planned step with a test across the chat tool and the driver. |
| **B. Keep it CLI-only** | No change: browser clicks stay with the owner's terminal and the F-012 resume. F-089 closes on the CLI owner check (F-089-T03). |
| **C. Read-only chat tool first** | Misato can read the allowed page's control names and title (tainted), but not click; a click tool stays a later decision. About 1–2 h. |

Reply in chat with `F-089-T05: A`, `B` or `C`. Expected: the agent records the decision on F-089 and, for A or C, adds the planned step with its estimate.
