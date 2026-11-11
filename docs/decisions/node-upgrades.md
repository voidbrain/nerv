# Safe application upgrades (F-005-T06)

2026-11-11, baseline main `b68802d`. Scope: the one per-user NERV service (launchd `io.nerv.agent` on the selected Mac) with its single checkout, data home and SQLite database. The brain and nervous processes are children of that service and upgrade with it. Local model engines are F-005-T08; Windows and Linux adapters are T09/T10. The first slice added a reader contract and a review-only rehearsal; the second makes the rehearsal a journaled step of every update. The third slice widens admission to application changes that leave the schema where it is.

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

## Rehearsal inside the update operation

Baseline main `ee9cbb6`. An update now runs `backup`, `fetch`, **`rehearse`**, `checkout`, `dependencies`, `build`, `start`, `verify`, each journaled as started and completed under the operation's fence.

1. The pinned revision is exported with `git archive` into `~/.nerv-lifecycle/staging/<plan digest>` (private) and unpacked there. It is never checked out: the installed checkout and its dependencies stay as they are. The export is removed when the step ends.
2. The candidate's reader is its own file `src/upgrade-reader.ts`, run as a separate process from the exported tree: `node src/upgrade-reader.ts DATABASE HOME`. It opens the private copy with that tree's real `Store` and prints nothing. The entry is part of the contract: a tree without it fails the rehearsal.
3. The copying, the schema and integrity checks and the comparison are the **installed** revision's code, on the backup this same operation took. The candidate does not judge itself.
4. The receipt records the rehearsal (source digest, schemas, counts, blockers; no row content).
5. A reported blocker ends the operation with state `refused`. Source, data and service are re-inspected as unchanged first, and the claim on the service is released in the same transaction, so the installed revision can be started again with a fresh `start` plan and no recovery release. Replaying the plan returns the refusal.
6. Anything else stays `uncertain` as before: the export failing, the source or runtime changing during the step, or the handler being interrupted.

The handler identity in a plan now also covers `src/upgrade-rehearsal.ts`, so a plan made under another comparison is refused.

Alternatives considered: let the candidate tree run the whole rehearsal and report; rejected because a faulty candidate would then also own the comparison. `git worktree add` for the export; rejected because it writes into the installed checkout's Git metadata. Treat a blocker as `uncertain`; rejected because the outcome is known and a held claim would block starting the unchanged service until a manual release.

## Admission beyond documentation

Baseline main `6a960bf`. `nodes lifecycle-inspect --action update --revision FULL-SHA` now admits two kinds of revision, with the actual database schema inside the contract range in both cases:

1. **Documentation only**, as before: the diff from the installed revision touches only `docs/` and `README.md`.
2. **An application change**, when all of these hold before any effect:
   - the candidate **descends from the installed revision**. An ancestor or an unrelated line is refused, so there is no downgrade through this path;
   - the candidate tree carries the reader entry `src/upgrade-reader.ts`, so there is something to rehearse;
   - the candidate's `package.json` declares a Node range in the plain `>=X.Y.Z` form and the service's own Node meets it. Another form, or none, is refused rather than guessed.

Admission lets the attempt start; it does not vouch for the data. Inside the operation the rehearsal still decides, and it now also refuses a candidate whose reader **moves the schema forward**: after such a migration the installed revision could no longer read the data, and the recovery for that is not built (step 3). So this slice admits upgrades that keep the schema, which is every revision between the reader contract's introduction and today.

The candidate commit must already be in the checkout when the plan is made (`git -C CHECKOUT fetch origin FULL-SHA`), because admission reads its tree.

If `dependencies`, `build` or `start` fails after the checkout moved, the operation stays `uncertain` as for any interrupted update. The data is as the backup has it or, after a start, as a reader that was rehearsed to lose nothing left it. Recovery is manual and explicit: reconcile and release the operation, check out the previous revision by hand, rebuild, and apply a fresh `start` plan. An `update` plan back to the previous revision is refused as a downgrade by design.

Alternatives considered: allow-listing more paths; rejected earlier, a changed reader cannot be judged by its paths. Reading the candidate's contract values from its source; rejected as a marker, the rehearsal shows what the reader does. A full semver range evaluator; rejected for now, one plain form covers this project and anything else fails closed.

## What this does not establish

- The standalone `upgrade-rehearse` command trusts the checkout it runs from. Inside an update the candidate tree is the pinned one and the result is bound to the plan digest.
- The exported tree has no installed dependencies. A candidate reader that needs an npm package fails and the update is refused; today's reader needs none. The reader runs as the owner's user, like the revision would after checkout.
- An interrupted step can leave `~/.nerv-lifecycle/staging/<plan digest>` and its `.tar` (private); remove them after reconciling the operation.
- It does not test dependencies, the build, the runtime after start, in-flight worker or outbox state, or configuration files other than `config.json`.
- Row presence is not content equality: a reader that rewrites values, or changes a column's type or an index's or trigger's definition while keeping its name, is not detected. Search indexes are checked by count, not content.
- An interrupted run (SIGINT/SIGKILL) can leave the private working copy (mode 0700/0600) in the temporary directory; remove `nerv-rehearsal-*` there. Two full copies are made with no free-space check.
- Ownership checks and the later copy are separate steps; another process of the same user could swap files in between. The digest check after copying bounds this, and no other user can.
- Lifecycle plans bind the handler file and the contract values; a change elsewhere in the reader is covered by the pinned clean revision, not by the handler identity.
- POSIX ownership only; Windows is refused until T09.

## Remaining T06 work

1. Done (second slice, above): journaled `rehearse` step between `fetch` and `checkout`.
2. Done (third slice, above) for upgrades that keep the schema: descendant-only, reader entry and engine range; forward migrations are refused until step 3.
3. Post-start acceptance and explicit forward recovery when build or start fails after a forward-only migration.
4. Independent review, then a real application upgrade on the owner-selected Mac.

## Review

[Independent review, 2026-11-11](../reviews/2026-11-11-upgrade-rehearsal.md): one blocker (real lifecycle backups were refused) and nine comparison/safety gaps, each with a committed failing regression before its fix. The second slice (journaled step, `refused` state) has not had an independent review yet; it is due before admission widens (step 4).
