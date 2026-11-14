# Independent Review — F-005-T15 (T06h — Upgrades that raise the schema version)

- **Date:** 2026-11-14
- **Task:** `F-005-T15` (`T06h — Upgrades that raise the schema version`)
- **Scope:** `src/upgrade-rehearsal.ts`, `src/node-lifecycle-execution.ts`, `src/nodes-cli.ts`, `docs/decisions/node-upgrades.md`, `test/mac-service-fixture.ts`, `test/upgrade-lifecycle.test.ts`

## Pass 1 Findings and Resolution

An independent fresh-context review of the initial `F-005-T15` implementation returned `needs revision` with 2 blocking, 2 should-fix, and 1 minor finding. All 5 findings were fixed and covered by regression tests before Pass 2:

1. **B1 (`blocking`) — `releaseService` could release a failed `forwardOnly` update without restoring the backup if the candidate crashed before bumping `PRAGMA user_version`:**
   - **Resolution:** Updated `releaseService` in `src/node-lifecycle-execution.ts` to refuse releasing any uncertain `update` operation when `old.rehearsal?.result?.forwardOnly === true`, when the live database file is missing, or when the live database `user_version` differs from `storedPlan.before.schema`, requiring `nodes lifecycle-recover`.
2. **B2 (`blocking`) — `recoverServiceUpdate` did not verify service ownership (`definition`, `legacy`), unresolved worker/outbox state (`pending`), or built status (`built`) before restoring the backup:**
   - **Resolution:** Updated `recoverServiceUpdate` in `src/node-lifecycle-execution.ts` to verify `current.definition === 'owned' && !current.legacy`, `!current.pending`, and `current.built` before calling `restoreVerifiedUpdateBackup`. Added regression assertions in `test/upgrade-lifecycle.test.ts` for `pending` and `!built` refusal.
3. **S1 (`should-fix`) — `restoreVerifiedUpdateBackup` unlinked sidecars before `renameSync`, staged files inside the backup directory, and skipped extra files by hash without checking symlinks/permissions:**
   - **Resolution:** Rewrote `restoreVerifiedUpdateBackup` to stage the database and all backed-up files inside `c.home` (`.restore-*`), `fsync` and verify all staged file hashes, rename `candidateDb` to `liveDbPath` before unlinking stale `-wal`/`-shm`/`-journal` sidecars, always stage-and-rename every backed-up file with explicit `0o600`/`0o644` permissions, and clean up any leftover staged files in `finally`.
4. **S2 (`should-fix`) — `docs/decisions/node-upgrades.md` still described T06c's refusal of forward migrations:**
   - **Resolution:** Updated `docs/decisions/node-upgrades.md` to document `F-005-T15` forward-migration admission via candidate `src/upgrade-contract.ts`, verified operation backup gating before `checkout`, refusal of `lifecycle-release` on forward-migrated updates, and explicit owner-invoked recovery via `nodes lifecycle-recover --confirm-backup-restore DIGEST`.
5. **M1 (`minor`) — Test for missing verified backup manifest in `test/upgrade-lifecycle.test.ts`:**
   - **Resolution:** Added an explicit assertion in `test/upgrade-lifecycle.test.ts` verifying that a forward migration within contract bounds (`5 -> 7` with `readerSchema: 7`) is refused at `rehearse` before `checkout` if the operation backup lacks a valid `manifest.json`.

## Pass 2 Verdict

- **Verdict:** `ready to merge` (0 blocking, 0 should-fix).
