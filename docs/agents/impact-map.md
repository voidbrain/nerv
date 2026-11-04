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
| Node flags for every NERV process (--use-system-ca) | `src/process-client.ts` (NODE_FLAGS, used for child processes and service units)<br>`package.json` (scripts.start)<br>`src/service.ts` (launchd ProgramArguments and systemd ExecStart)<br>`src/cli.ts` (shebang of the nerv command (package.json bin)) | test/runtime.test.ts asserts package.json start, the nerv shebang, both service units and the child processes carry every NODE_FLAGS entry. |
| Sortie short ID (S- plus the first 4 characters of the id, upper case) | `web/public/dashboard/live.js` (short(), the ID on sortie cards, cards and Comms)<br>`src/brief.ts` (sortieRef(), the trace reference on every brief item) | test/brief.test.ts asserts sortieRef and live.js short() give the same ID for the same sortie. |

## Outside the repository

What can change an output with no commit here, and how we would notice.

| What | Affects | Noticed by |
|---|---|---|
| Node SQLite API and Angular dependencies | Runtime, builds and persistence compatibility | Pinned install, regression tests and doctor |
| Host clock and timezone | Reminder deadlines | Explicit timezone inputs and doctor |
