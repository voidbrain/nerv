# Update path review — 12 November 2026

F-005-T12 (T06e). Independent fresh-context, report-only review of the update path as merged on main `90d797d`: PRs #257 (rehearsal), #258 (journaled `rehearse` step, `refused` state) and #262 (admission of schema-preserving application upgrades). The reviewer ran in a separate context on the strongest model (`design-reviewer`). It did not edit, approve or merge, and did not touch the live checkout, the owner's data home, the lifecycle journal or launchctl. It ran the 40 lifecycle and upgrade tests (all passed), and in a temporary directory exported `90d797d` and checked that `npm ci --engine-strict --ignore-scripts` and `npm run build` succeed, the tree stays clean afterwards, `src/upgrade-reader.ts` runs without `node_modules`, and the CLI does not (`ERR_MODULE_NOT_FOUND: 'ajv'`).

## Blockers

**B1, update path in general (not T13's target).** `assertServiceStartup` compared the plan's handler identity with a hash of the lifecycle files on disk. During an update's `start` step the started candidate hashes its own files. An update to a revision that changes `src/node-lifecycle-execution.ts`, `src/upgrade-rehearsal.ts` or the contract (T14 will) was therefore refused at startup. launchd would restart it repeatedly, the 20-second wait would expire, and the operation would end `uncertain` with the candidate checked out. Only a same-process `install` start was tested. **Fixed:** an `update` plan's start is authorised by the live applying handler's process identity, fence, nonce and the exact launchd registration, as before, but not by the plan's handler identity. Other actions still require the same handler. Regression: `test/update-path-review.test.ts` ("review B1"), with a control showing that a `start` plan under other code is still refused.

**B2, recovery text (could happen in T13).** If `dependencies` fails or times out, `npm ci` has already removed `node_modules` and the CLI cannot load, so the documented step "release with `nodes lifecycle-release`" could not run before the reinstall step. **Fixed in the docs** ([upgrade decision](../decisions/node-upgrades.md), INSTALL): run `npm ci --ignore-scripts` in the checkout as it is before releasing. No test: this is the order of manual commands. The reviewer reproduced the failure by running the CLI without `node_modules`.

## Should-fix

1. **Release never looked at the service.** `releaseService` relied only on the operator's evidence. If the owner released while the candidate was still registered, the next launchd restart passed the startup guard, because no operation was held any more. **Fixed:** the CLI release (`releaseObservedService`) inspects the service first and refuses while it is registered or running, or while descendants remain. Regression: "review should-fix: releasing … is refused while the service is still registered or running".
2. **A network failure in `fetch` left an unchanged service uncertain.** Admission already requires the commit locally, so the fetch was redundant. A network or authentication failure, or a credential prompt, ended the operation `uncertain` and needed a release. **Fixed:** the step uses the local commit and fetches only if it is missing, with `GIT_TERMINAL_PROMPT=0`. Regression: "review should-fix: the fetch step uses the admitted local commit".
3. **Not fixed, recorded.** The backup covers only the database and the named configuration and credential files. It leaves out `native-auth.sqlite`, the native TLS key and certificate, `scrolls.json`, `telegram-state.json` and `model-prices.json`. Every update keeps its credential copies under `~/.nerv-lifecycle/backups/` (mode 0700/0600) without pruning or a documented retention. Restore remains F-062.
4. **Not fixed, recorded, unverified.** A timeout sends SIGTERM to `npm` only. Children of `npm` or `ng` might keep writing after the operation is marked `uncertain`.
5. **Not fixed, recorded.** `built` checks only that `dist/web/browser/index.html` exists, not which revision built it, so a stale `dist` passes the `start` precondition. The manual recovery therefore always rebuilds.

## Notes and accepted gaps (code and docs agree)

- Plan and admission refusals happen before the journal is written. `refused` is set only after source and runtime are re-checked, and it releases the claim in the same transaction. A fresh `start` after a refusal is tested end to end with the fixture, not with the production adapter.
- An export failure or source drift stays `uncertain` (tested).
- Admission: git prints normalised paths, so a path like `docs/../src` cannot appear. The pinned SHA is immutable, so the re-check at apply time covers the gap after planning. Any commit that descends from the installed one is admissible; choosing the pin is the owner's review.
- The applying process loads no module after `checkout`. The only dynamic import is the model SDK.
- Gaps already documented: a schema move after the second open, and rewrites of values at the same schema version, are not detected. The candidate reader runs as the owner with the real `HOME`.
- `inspect` counts any `node src/cli.ts serve|launch` process of the user, worktrees and end-to-end servers included. Such a process makes the runtime `unknown`, or makes stop and start time out.

## Precondition found for T13

The live service started on 2026-11-11 from the main checkout at running build `2a3448d` (T06d). That checkout has since been fast-forwarded by `git pull` to `90d797d` without a restart, `npm ci` or rebuild. In this state:

- `inspect` reports the runtime as `unknown`, because the doctor's commit differs from `HEAD`. Every plan is blocked, `stop` included.
- A launchd restart, a reboot, or a brain or nervous child respawning would run the pulled backend code with `node_modules` from `2a3448d`.

None of the lifecycle files differ between `2a3448d` and `90d797d`, so B1 does not apply to that update. The owner procedure in [F-005](../work/records/F-005.md) first puts the checkout back on `2a3448d` and stops pulling it.

## Verification

Failing regressions were committed in 93b89cc before the fixes and are unchanged by them. After the fixes, 50 lifecycle and upgrade tests pass locally, and typecheck and lint pass. The fixes have not had a second independent review. Re-review on any change to the startup fence, release or admission.
