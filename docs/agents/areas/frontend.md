# Frontend & Native Companion

## Frontend

- Read [the style guide](../../STYLE-GUIDE.md). Angular renders registered components, never model-generated JavaScript.
- The admin token lives in a mode-0600 file under `NERV_HOME` and never reaches the browser. `open` mints a single-use code (60 s, max 5 unused), the page strips `#code=` from URL/history and exchanges it for an in-memory **dashboard session** (12 h max, ended by restart or `sessions revoke`, barred from minting codes, revoking sessions, or calling `POST /api/stop`).
- Dashboard keeps the session in `sessionStorage`; Angular keeps it in component memory. Pasted admin tokens stay in memory only. No token or code appears in a command line or a URL after sign-in, and native TLS offers no codes or sessions.
- English is the default UI language with Italian switching; CLI commands and raw diagnostics remain English.
- The NERV dashboard lives in `web/public/dashboard/` (`dashboard.js` simulation, `live.js` live adapter active only with `#code=`). It must run under service CSP (no inline script, no CDN, no remote fonts).
- Live panels without real data say planned, never show simulated numbers. Current UI uses typed reminder data and a registered Web Component status surface; model-generated selection, PWA offline caching, and full browser acceptance remain tracked in [the roadmap](../../ROADMAP.md).

## Headless installation

- Serve built Angular assets and the API from one loopback process on `4317` (`4318` for dev); both must agree with README and tests.
- Service definitions contain no token, use absolute paths, and run as the current user. Never install system services or enable linger on the execution host as part of a code change.
- Test service rendering and real process lifecycle; distinguish those from launchd/systemd acceptance on a user machine. Keep `Quit companion` separate from `Stop NERV Agency`. Read [docs/INSTALL.md](../../INSTALL.md) before changing service lifecycle.

## Native companion and credentials

- Read `native/README.md` and the current pairing decision. Never ship root/provider credentials to the companion, its URL, argv, `UserDefaults`, logs, or Brain.
- Native TLS is opt-in and pinned before sending a ticket/client token; no blanket trust bypass or global trust-store installation.
- `NativeAuth` owns a separate private verifier database in process C; it must not hold reminder transactions. Tickets are 2-minute single-use; client credentials are read-only and revocable with 30-day expiry.
- Swift tests/build run on macOS CI; Linux does not establish native acceptance. Keychain prompts, menu interaction, notifications and service login/logout need explicit evidence. Keep local Forget pairing distinct from server revocation. Build artifacts are ad-hoc signed previews, not notarized installers.

## Native notifications and OS actions

- Read the native guide before changing cursor or permission semantics.
- Enable establishes a current-head baseline; checkpoints contain sequence plus delivery UUID and are private/atomic, never message content or credentials.
- Validate whole pages before posting; advance only after OS acceptance/reconciliation, never on error. Do not claim exactly-once banners. History restore resets require an explicit visible warning; corrupt local state must not silently replay old reminders. Every notification request is opt-in; tests use fake sinks and do not prompt CI.
- Service commands are fixed user `launchctl` actions with timeouts and a separate Stop confirmation. Paired runtime must match local plist `NERV_HOME`. `SMAppService.mainApp` owns companion login only. Do not register or modify actual OS services/login items in repository tests. CI validates pure command plans, simulated notification outcomes, pinning and compilation; live Mac permission/banner/login acceptance remains separate.
- Native background polling uses `/api/status`, never a recurring full doctor/SQLite integrity scan. Keep an authenticated runtime ping distinct from explicit database diagnostics, and test that polling cannot call `quick_check` indirectly.
