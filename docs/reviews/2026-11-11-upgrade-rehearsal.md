# Upgrade rehearsal review — 11 November 2026

F-005-T06 first slice, independent fresh-context report-only review of candidate 0f31954. The reviewer did not edit, approve, merge, or touch any data home or service.

**Blocker.** The rehearsal refused every backup written by the real lifecycle adapter: those backups hold credential copies, which the candidate treated as a live data home. The fixture used a synthetic layout, so the join was untested.

**Unreported changes (false "no blockers").** A table rebuilt `WITHOUT ROWID` (lost inbox cursors); emptied search index; an ordinary table whose name starts like an index table; dropped non-key columns, indexes and append-only triggers; a reader adding rows on every open; a table named `sqlitex_…`; lowered `sqlite_sequence` counters.

**Safety.** No path writes to the backup, a live data home, the checkout or a service; update admission is unchanged. A parse error could quote a fragment of `config.json` into the report. Schema bounds had moved out of the file the plan handler hashes.

Failing regressions 01fd504 (`test/upgrade-rehearsal-review.test.ts`) precede the fixes and are unchanged by them. Two first-slice expectations changed deliberately: the lower bound is now named as the service lifecycle's, and a dropped key column is reported as a lost column. One first-slice assertion counted temporary directories and failed beside parallel tests; it now checks the working directory it was given.

Not fixed, recorded as limits in the [decision](../decisions/node-upgrades.md): content equality, leftover copies after a killed run, same-user check-then-use race.

Reviewer runs at 0f31954: 31 lifecycle/rehearsal tests, typecheck and conventions passed. After fixes, local: 63 lifecycle/rehearsal/root-migration tests pass; full suite and CI recorded in the owning record. The fixes themselves have not had a second independent review. Re-review on any change to the comparison, the accepted backup layout or update admission.
