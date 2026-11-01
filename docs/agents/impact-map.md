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

## Content dependencies

What each output is made of, besides code: change one of these and the output is out of date.

| Output | Made of | Redo with |
|---|---|---|
| (none listed) | | |

## Value couplings

A value that lives in more than one place: change it in one, change it in all. Best kept by one shared source, else by a test.

| Value | Where | Kept equal by |
|---|---|---|
| (none listed) | | |

## Outside the repository

What can change an output with no commit here, and how we would notice.

| What | Affects | Noticed by |
|---|---|---|
| Node SQLite API and Angular dependencies | Runtime, builds and persistence compatibility | Pinned install, regression tests and doctor |
| Host clock and timezone | Reminder deadlines | Explicit timezone inputs and doctor |
