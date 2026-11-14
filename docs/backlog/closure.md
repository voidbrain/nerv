# Closure and archives

Read before you close or archive a record. Part of the [backlog rules](../BACKLOG-RULES.md).


## Closure and archives

Close fixes after their recorded criteria pass and no action remains; Verified is a transition, not a permanent holding pen. Human/device acceptance is required only where specified. Cancelled, duplicate or superseded items can close without a verified implementation when the reason and replacement link, if any, are explicit. Do not close a reported bug because one attempt could not reproduce it without recording the investigation and the remaining uncertainty.

Move closed records, including completed maintenance-only changes, into the year's archive, `docs/archive/backlog-<year>.md` (one file per year, the year the record closed), linked from the active ledger. Inside it records follow their closing date, under a `## Closed <YYYY-MM-DD>` heading per day; records closed before a project adopted this layout keep a heading of their own. Preserve each complete record (visible actions plus metadata), with original ID/priority, PR history, evidence, resolution and closure date (`Closed YYYY-MM-DD` in its evidence). Historical archive content only grows: add records anywhere and corrections as dated notes, but never change or remove a line already on the default branch; a record may move from one archive file to another, never out of the archives. `check:backlog` compares every line with the default branch (a line no longer in its file must be in another archive file) and fails on a record whose closing year is not its file's. Write an archive by reading it fully first, never by truncating it. Historical Closed records keep their closure cues if an item is later reopened; the active record describes the new work and links its prior history.

Closing a documentation audit or recording change does not close a product feature whose checks remain pending. Put that pending work on its own active item rather than keeping the completed maintenance entry yellow indefinitely.

An optional weekly closure index can precede an archive. Adopt `tools/archive-recap.mjs`, list it in the copied stamp, and run it whenever records move into the archive. It groups features/bugs by recorded closing date, Monday–Sunday, with links to the first section of each week. Only its exact generated `archive-recap` block is replaceable: `check:backlog` recomputes it before excluding that block from historical-line protection. Missing tools, stale/forged recaps or hidden record content fail. Every original record line remains immutable; adding or regenerating an index never verifies or closes product work. Archives without an index need no migration.
