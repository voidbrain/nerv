# First lifecycle update of the Mac service, 12 November 2026

Evidence for [F-005](../BACKLOG.md#f-005) step F-005-T13 (T06f): the first update of the owner-selected Mac service through `nodes lifecycle-inspect` / `nodes lifecycle-apply`, following the [T13 Mac update procedure](f005-t13-mac-update-procedure.md).

**Who ran it:** the agent (Claude Code, in the owner's VS Code session on the Mac, in the live checkout), with the owner's explicit approval on 2026-11-12, and with the owner's own digest confirmation replaced by the agent reading the digest from the saved plan. A first owner attempt had passed the literal placeholder `STOP_DIGEST` and was refused with nothing changed. This run shows that the update path works on the real service, but not that the procedure can be followed by hand.

**Machine:** the owner's Mac (Darwin 27.0.0, arm64), per-user launchd service `io.nerv.agent`, Node v26.12.0 from the service definition, base `NERV-01`.

**Revisions:** from `2a3448d` (installed and running since 2026-11-11) to `f8b8116`, the merge commit of [PR #287](https://github.com/voidbrain/nerv/pull/287). `main` does not run CI on push; the merge commit's tree equals the PR head `39afae7`, whose checks (plan, validate, windows, native-macos, full-suite) passed.

## Steps and observations (19:20–19:29 CET)

| Step | Expected | Observed |
|---|---|---|
| 0. Variables | nvm Node, 40-character target | `…/node/v26.12.0/bin/node`, `f8b81169483ced83716ed9f6f6291913374bca26` |
| 1. Running build | doctor `2a3448d… NERV-01`, clean checkout at 2a3448d, one `serve` | as expected; `serve` pid 48409 started 2026-11-11 10:01 |
| 2. Stop plan | `[] owned 2a3448d…` | `4ddb16a5… [] owned 2a3448d…` (fresh plan; the earlier plan file was kept, not overwritten) |
| 2. Stop apply | `stop:completed`, `verify:completed`, no `serve`, `Could not find service` | receipt `completed` with both steps, no `serve` line. `launchctl print` said `Bad request.`, not `Could not find service`: from this shell a made-up label gives the same text, and `launchctl list` no longer listed `io.nerv.agent`, so the service was unloaded |
| 2b. Dependencies at 2a3448d | `npm ci`, build, clean tree, `matched` | as expected |
| 3. Target and update plan | `commit`, `descends`, `DIGEST [] 6 <T>` | `commit`, `descends`, `fd13cec5… [] 6 f8b8116…` |
| 4. Update apply | eight steps `:completed`, `rehearsal.blockers` `[]`, schema 6 → 6, `forwardOnly` false | `completed`: backup, fetch, rehearse, checkout, dependencies, build, start, verify. Rehearsal: source schema 6, result schema 6, `forwardOnly` false, 40 tables, 788 rows before and after, no blockers |
| 5. After-checks | HEAD `<T>`, clean; one new `serve`; `state = running` with the plist Node; doctor `<T> NERV-01`; `ok`, `6` | all as expected; new `serve` pid 47380 started 19:29:22 |

The update applied with the code installed at `2a3448d` (the limit the F-005 record notes): PR #287's release check and local-commit fetch did not protect this run and apply from the next update on.

## Not covered

- Owner-by-hand usability of the procedure (above).
- A refused or uncertain outcome on the real service: neither happened, so the recovery steps in the procedure stay untested on this machine.
- The after-start health check in the receipt (F-005-T14) and upgrades that raise the schema (F-005-T15).

Plans, receipts and logs stay private in the owner's `~/nerv-t13`; this note keeps only digest prefixes, step results and counts.
