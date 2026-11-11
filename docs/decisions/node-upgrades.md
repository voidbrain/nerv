# Safe application upgrades (F-005-T06)

2026-11-11, baseline main `b68802d`. Scope: the one per-user NERV service (launchd `io.nerv.agent` on the selected Mac) with its single checkout, data home and SQLite database. The brain and nervous processes are children of that service and upgrade with it. Local model engines are F-005-T08; Windows and Linux adapters are T09/T10. This slice adds a reader contract and a **review-only rehearsal**. It admits no upgrade: `nodes lifecycle-inspect --action update` still accepts only documentation/README changes.

## Why a rehearsal, not a marker

The [service review](../reviews/2026-11-10-mac-service.md) rejected update compatibility read from text markers. A candidate revision declaring "I read schema 6" proves nothing about what its reader does to existing data. The evidence that matters is the candidate reader opening the actual data and an independent comparison of the result, before the checkout, its dependencies or the live database change.

Alternatives considered: trust a version field in the candidate tree; rejected as marker-only. Migrate the live database and roll back on failure; rejected because rollback is a restore (F-062) and a half-migrated database is uncertainty, not a retry. Diff allow-lists beyond documentation; rejected because a changed reader cannot be judged by its paths.

## Reader contract

`src/upgrade-contract.ts` holds `readerSchema` (newest schema this revision reads and writes) and `minimumServiceSchema` (oldest schema the service lifecycle accepts). `Store` and the lifecycle adapter read these values instead of their own literals, and `test/upgrade-rehearsal.test.ts` binds them to behaviour: the Store refuses `readerSchema + 1`, and a fresh database lands inside the range. A revision that changes schema support changes the contract, its migration and those regressions in one reviewed change.

## Rehearsal

`nerv nodes upgrade-rehearse --backup ABS-DIR [--out FILE]` runs the reader of the checkout it is invoked from on a private copy of a backup in the lifecycle layout (`database.sqlite`, optional `config.json` and `manifest.json`, as written by the update backup step under `~/.nerv-lifecycle/backups/`).

1. The backup must be a private, symlink-free directory owned by the user. A directory holding a live database (`nerv.sqlite`, `nodo.sqlite`, or WAL/journal files) is refused. If a manifest is present its database digest must match. A lifecycle backup also holds copies of credentials; the rehearsal copies only `database.sqlite` and `config.json` and never reads the others.
2. Two copies go to a new private temporary directory; their digests must equal the source. Only the copies are opened; the backup stays byte-identical. The directory is removed afterwards.
3. The actual schema and integrity of the input are checked against the contract **before** the reader runs. Outside the range, nothing runs.
4. The real `Store` opens the working copy with the copied `config.json` as its data home, so root-binding and other configuration checks are the real ones. It opens the copy **twice**, because a service restarts.
5. After each open the untouched copy and the working copy are compared read-only: integrity, foreign keys, schema direction, every table, column, index and trigger still present (the append-only triggers are safeguards), id counters not lowered, and every existing row still present under the same key **and row id** (inbox row ids are channel cursors; a table rebuilt without row ids is reported). Search indexes (FTS5) are compared by row count; only their five internal shadow tables are skipped. The second open must also leave every table's row count as the first open left it.

The report carries the source digest, schemas, table and row counts and blockers; never row content. A reader failure is reported with its fixed message; a parse failure is reported without the text it quotes. `forwardOnly: true` means the reader moved the schema forward: the installed revision may no longer read that data, and undoing it is a separately reviewed restore. Renumbering or dropping existing rows is reported even for an intended migration: that case needs its own review rather than a relaxed check.

## What this does not establish

- The rehearsal trusts the checkout it runs from. Running it from the candidate revision is still manual: a separate clone or worktree at the pinned commit. It is not yet bound to a lifecycle plan digest.
- It does not test dependencies, the build, the runtime after start, in-flight worker or outbox state, or configuration files other than `config.json`.
- Row presence is not content equality: a reader that rewrites values, or changes a column's type or an index's or trigger's definition while keeping its name, is not detected. Search indexes are checked by count, not content.
- An interrupted run (SIGINT/SIGKILL) can leave the private working copy (mode 0700/0600) in the temporary directory; remove `nerv-rehearsal-*` there. Two full copies are made with no free-space check.
- Ownership checks and the later copy are separate steps; another process of the same user could swap files in between. The digest check after copying bounds this, and no other user can.
- Lifecycle plans bind the handler file and the contract values; a change elsewhere in the reader is covered by the pinned clean revision, not by the handler identity.
- POSIX ownership only; Windows is refused until T09.

## Remaining T06 work

1. Journaled `rehearse` step in the update operation, after `backup` and `fetch` and before `checkout`: export the pinned candidate tree to a private staging directory, run its reader on the operation's own backup, and compare with the installed revision's code. A blocker ends the operation before the checkout changes.
2. Admission beyond documentation: candidate must descend from the installed revision (no downgrade), carry this contract, and satisfy the engine range before dependency effects; the receipt records prior revision, schemas and backup.
3. Post-start acceptance and explicit forward recovery when build or start fails after a forward-only migration.
4. Independent review, then a real application upgrade on the owner-selected Mac.

## Review

[Independent review, 2026-11-11](../reviews/2026-11-11-upgrade-rehearsal.md): one blocker (real lifecycle backups were refused) and nine comparison/safety gaps, each with a committed failing regression before its fix.
