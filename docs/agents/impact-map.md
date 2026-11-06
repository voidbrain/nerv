<!-- Written by tools/impact-map.mjs from the "impact" rows of .harness.json: change the rows, then run it. -->

# Impact map

What must follow a change, and what must run again after it (AGENTS, "What follows a change"). `npm run check:freshness` lists, on every PR, the rows a branch sets off and the order to run them.

**More detail:** [Architecture](../ARCHITECTURE.md) (Implemented and intended boundaries)

| Id | When these change | Made of (content) | This must follow | Command | Runs again after | Checked by |
|---|---|---|---|---|---|---|
| frontend | `web/**`, `angular.json`, `package*.json` |  | Build and inspect the Angular workspace; reconcile README and style guide. | `npm run build` |  | Angular compiler and browser acceptance F-004 |
| core | `src/**`, `test/**` |  | Run core regression tests and reconcile the architecture and commands. | `npm test` |  | Restart, duplicate delivery, cancellation and HTTP tests |
| service | `src/config.ts`, `src/service.ts`, `src/cli.ts`, `test/headless.integration.ts`, `docs/INSTALL.md` |  | Verify production process lifecycle and reconcile installation/roadmap acceptance. | `npm run build && npm run test:headless` | core | Process restart regression; real target-host acceptance remains F-009 |
| protocol-surfaces | `src/rpc.ts`, `src/socket.ts`, `src/process-client.ts`, `shared/**`, `web/src/status-card.ts` |  | Validate protocol/schema/graph security and rebuild the registered Web Component host. | `npm test && npm run build` | core | Protocol/isolation/DOM fixtures; browser/remote acceptance stays explicit |
| native-app | `native/**`, `src/native-auth.ts`, `src/server.ts`, `src/config.ts`, `test/native*`, `.github/workflows/ci.yml` |  | Validate backend pairing/TLS and run macOS Swift tests/app packaging; reconcile setup and lifecycle limits. | `npm test; swift test --package-path native/NervMenuBar; sh native/build-app.sh` | core | Linux backend tests plus macOS CI; live menu/Keychain/OS tests remain F-011/F-015 |
| notification-feed | `src/store.ts`, `src/rpc.ts`, `src/runtime.ts`, `src/nervous-process.ts`, `src/server.ts`, `native/NervMenuBar/Sources/NervMenuBar/Notifications.swift`, `native/NervMenuBar/Sources/NervMenuBar/OSControls.swift`, `test/inbox-page.test.ts` |  | Check bounded cursor/restore semantics, notification replay/failure behavior and fixed user OS actions; reconcile guides and native tests. | `npm test; swift test --package-path native/NervMenuBar` | core | Store/page tests and Swift notification mocks/command plans; live OS acceptance remains F-011 |
| backlog-recap | `docs/BACKLOG.md`, `docs/archive/backlog-*.md`, `tools/backlog-recap.mjs` |  | Regenerate the recap at the top of docs/BACKLOG.md (open and owner-waiting records by kind, opened and closed in the last 7 days). | `npm run backlog:recap` |  | npm run check:recap in CI validate |
| angular-browser | `web/src/**`, `shared/surface.ts`, `angular.json`, `package*.json`, `src/server.ts`, `test/angular.browser.mjs` |  | Verify full CSS under the service CSP, English/Italian controls, unchanged reminder text and UTC times, responsive layout and axe accessibility. | `npm run test:browser` | frontend | CI validate browser acceptance and screenshot artifacts; manual visual review remains explicit. |

## Content dependencies

What each output is made of, besides code: change one of these and the output is out of date.

| Output | Made of | Redo with |
|---|---|---|
| (none listed) | | |

## Value couplings

A value that lives in more than one place: change it in one, change it in all. Best kept by one shared source, else by a test.

| Value | Where | Kept equal by |
|---|---|---|
| Seven-eye triangle geometry and mark colour | `web/public/mark.svg` (Web SVG mark (browser icon))<br>`web/public/brand.svg` (Sidebar mark: half leaf beside the same triangle)<br>`native/NervMenuBar/Sources/NervMenuBar/NervMenuBar.swift` (Native monochrome menu template drawing)<br>`web/src/styles.css` (--mark colour token, literal in both SVGs) | test/brand.test.ts asserts the same triangle and eye centres in the three drawings and the --mark colour in both SVGs. |
| Node flags for every NERV process (--use-system-ca) | `src/process-client.ts` (NODE_FLAGS, used for child processes and service units)<br>`package.json` (scripts.start)<br>`src/service.ts` (launchd ProgramArguments, systemd ExecStart and the Windows task launcher (windowsLauncher))<br>`src/cli.ts` (shebang of the nerv command (package.json bin)) | test/runtime.test.ts asserts package.json start, the nerv shebang, both service units and the child processes carry every NODE_FLAGS entry; test/runtime.test.ts also asserts the Windows launcher carries them. |
| Sortie short ID (S- plus the first 4 characters of the id, upper case) | `web/public/dashboard/live.js` (short(), the ID on sortie cards, cards and Comms)<br>`src/brief.ts` (sortieRef(), the trace reference on every brief item) | test/brief.test.ts asserts sortieRef and live.js short() give the same ID for the same sortie. |
| Dashboard default colours (Eva · Dark · Orange) | `web/public/dashboard/index.html` (:root tokens, the first paint before the script)<br>`web/public/dashboard/dashboard.js` (palette('eva','dark','orange')) | test/dashboard.test.ts asserts every :root token equals palette('eva','dark','orange'). |
| Angular stylesheet activation under the service CSP | `angular.json` (Critical CSS extraction disabled so stylesheets do not require an inline activation script)<br>`src/server.ts` (script-src self blocks inline activation scripts) | test/angular.browser.mjs serves the built workspace through makeServer and asserts the full grid stylesheet is applied with no CSP errors. |

## Outside the repository

What can change an output with no commit here, and how we would notice.

| What | Affects | Noticed by |
|---|---|---|
| Node SQLite API and Angular dependencies | Runtime, builds and persistence compatibility | Pinned install, regression tests and doctor |
| Host clock and timezone | Reminder deadlines | Explicit timezone inputs and doctor |
| GitHub-hosted runner images (macos-15, windows-latest, ubuntu-latest) | CI jobs: an image GitHub retires fails the job before it runs | The job fails in about a second with "configuration … is not supported" (B-015, macos-14 retired 2026-11-05) |
| MCP servers the owner adds (`npx -y package` fetches the newest version at each start) | What a granted tool does: its code can change with no commit here; a grant notices only a changed description (F-021) | The tool's fingerprint (description changes suspend the grant); docs/INSTALL.md recommends a pinned version; audit |
| The Node version on each base (the owner runs Node 26 under nvm; CI runs Node 24) | Native TypeScript, node:sqlite and the bundled npm/npx (B-019: nvm Node 26.12's npm lacked npm-cli.js) | nerv doctor, the CI matrix (Node 24 only) and audit |
| Chrome/Chromium installed on the execution host and GitHub Ubuntu runner | Angular bilingual browser acceptance, native control rendering, axe results and screenshots | Browser acceptance uses an isolated profile and fails explicitly if Chrome is missing; CHROME_BIN can select a compatible executable; audit reviews runner/browser changes. |
