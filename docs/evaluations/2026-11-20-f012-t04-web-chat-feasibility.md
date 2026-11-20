# F-012-T04: Web-chat resume adapter feasibility

Assessed on 2026-11-20 against NERV's durable resume engine (`src/resume-intent.ts`) and browser worker control boundary (`src/browser-control.ts`).

## Verdict

**Feasible within narrow browser-worker boundaries; implemented in `src/web-chat-resume-adapter.ts`.**

## How stale clicks after sleep are prevented

1. **No cached coordinates or DOM handles:** Every phase (`checkAvailability`, `verifyIdentity`, `executeResume`) calls `driver.getActiveTab()` fresh and looks up the target button by accessible name (`clickNamedControl`), never by screen coordinates.
2. **Identity & fingerprint recheck:** `webChatTabFingerprint` hashes `tabId`, `origin + pathname`, `title`, and `textSummary`. If the tab switched, navigated, or the conversation changed after sleep/wake, `verifyIdentity` or `executeResume` refuses to click.
3. **State guards before clicking:** `checkAvailability` refuses when the session shows login/expiration (`session-expired`), the job is already running (`already-running`), the rate-limit banner is still visible (`limit-still-active`), or the named control is absent (`resume-control-missing`).
4. **Origin & credential boundary:** `clickNamedControl` restricts actions to `browser.allowedOrigins`, requires `active: true` and matching `tabId`, and refuses credential/payment controls.
5. **Uncertain click acknowledgement:** If `clickControl` returns an unchanged `textSummary` without a running indicator, the attempt is marked `failed` (`uncertain-click-acknowledgement`, `retryable: false`) rather than blindly re-clicking.

## Documented infeasibilities / limits

- **Locked or sleeping host:** When the host machine is asleep or the browser session is closed/minimized without an active allowlisted tab, the adapter defers (`target-tab-unavailable`) until an active session returns; it cannot wake a sleeping browser or unlock the OS.
- **CAPTCHAs, 2FA, and login prompts:** Intentionally blocked (`session-expired`); requires owner login.
- **Provider UI changes:** If a provider renames or removes the accessible button text (e.g. `Continue`), the adapter refuses (`resume-control-missing`) rather than guessing.
