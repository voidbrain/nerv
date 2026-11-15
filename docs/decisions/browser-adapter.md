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
