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
| native-app | `native/**`, `src/native-auth.ts`, `src/server.ts`, `src/config.ts`, `test/native*`, `.github/workflows/ci.yml` |  | Validate backend pairing/TLS and run macOS Swift tests/app packaging; reconcile setup and lifecycle limits. | `npm test; swift test --package-path native/NodoMenuBar; sh native/build-app.sh` | core | Linux backend tests plus macOS CI; live menu/Keychain/OS tests remain F-011/F-015 |
| notification-feed | `src/store.ts`, `src/rpc.ts`, `src/runtime.ts`, `src/nervous-process.ts`, `src/server.ts`, `native/NodoMenuBar/Sources/NodoMenuBar/Notifications.swift`, `native/NodoMenuBar/Sources/NodoMenuBar/OSControls.swift`, `test/inbox-page.test.ts` |  | Check bounded cursor/restore semantics, notification replay/failure behavior and fixed user OS actions; reconcile guides and native tests. | `npm test; swift test --package-path native/NodoMenuBar` | core | Store/page tests and Swift notification mocks/command plans; live OS acceptance remains F-011 |

## Content dependencies

What each output is made of, besides code: change one of these and the output is out of date.

| Output | Made of | Redo with |
|---|---|---|
| (none listed) | | |

## Value couplings

A value that lives in more than one place: change it in one, change it in all. Best kept by one shared source, else by a test.

| Value | Where | Kept equal by |
|---|---|---|
| Vertical wrapped-knot geometry | `web/public/knot.svg` (Web SVG mark)<br>`native/NodoMenuBar/Sources/NodoMenuBar/NodoMenuBar.swift` (Native monochrome menu template drawing) | Review both geometric renditions in branding changes; no automatic pixel equivalence claimed. |

## Outside the repository

What can change an output with no commit here, and how we would notice.

| What | Affects | Noticed by |
|---|---|---|
| Node SQLite API and Angular dependencies | Runtime, builds and persistence compatibility | Pinned install, regression tests and doctor |
| Host clock and timezone | Reminder deadlines | Explicit timezone inputs and doctor |
