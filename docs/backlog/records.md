# Backlog records

Read before you change any record. Part of the [backlog rules](../BACKLOG-RULES.md).


Copy an existing record for the layout; `npm run check:backlog` and `npm run check:work` name any missing or malformed field.


## Record and evidence requirements

- Keep IDs stable; a hand-edited ledger keeps them in ID order within each section, a generated one in its configured order (`workItems.order`). Never reuse an ID for a different item. A new finding about the same behaviour as an existing record (a failed check, a follow-up, a regression) goes into that record, reopened if it was closed, not under a new ID. `B-nnn` is a bug or reliability problem, `F-nnn` a feature or improvement. Opened is the first known date that ID entered the ledger, not a guessed original-report date; preserve it through reopening.
- Each item records a reproducible trigger/request, scope, next action and closure requirements. Active records show the stable ID heading and a bold title, then a four-column signal table (Signal, Priority, Status, Effort). Sources keep the four authored columns and the authored human-action line. Keep the human-action line and the Issue / Reproduce / Check table visible for every bug and feature, regardless of actor or whether the record changed. Put the full Next action / closure evidence and the PR history, Opened, Verification and Reviewed metadata in one closed-by-default details block. Priority measures impact: P1 data integrity, reliable CI/build, core behaviour; P2 important workflows and visual defects; P3 enhancements and narrower review.
- PR / evidence identifies actual changes or checks with links and labels. Use `—` if no PR is known. Link the latest relevant evidence without discarding important historical context. **Record size:** `check:backlog` warns when an active record passes `rules.budgets.record` (default 1,500 tokens, characters ÷ 4). Then move evidence older than the last reconciliation, verbatim with its dates, to `docs/archive/evidence-<year>.md` under a `## <ID>` heading (append only, like every archive), and link it from PR / evidence. The record keeps its Issue, Reproduce, Check, current next action and latest verification.
- Verification records date, method, result and evidence separately from Reviewed. Methods: Human, Unit/integration, Browser/accessibility, Real-device and Documentation. Use Pending where applicable; different checks may have different dates. Verification states the current result: one entry per method, the latest check of it. Earlier results (a failure since fixed, a superseded pass) belong in PR / evidence, labelled with their PR or run, so the cell never reads “Pending; … passed” for the same check. A unit test does not prove visual or field behaviour, and an overall CI result does not replace checking which jobs ran.
- **A bug fix starts with a failing test.** The fix for a B- record commits a test that reproduces the defect and fails without the fix: commit it before the fix, and do not edit that test while making it pass (a changed expectation is a changed requirement: say which). When no test can show the defect (visual, device-only or external-service behaviour), record why and the manual check that replaces it. The record names it in PR / evidence or Verification: `Test: <file or test name>`, or `No test: <reason and manual check>`. `check:backlog` warns when a branch makes a B- record Verified or Closed with neither in those cells.
- Reviewed is when status/evidence were actually reconciled, not an inferred merge date. Preserve existing dated history; do not invent dates.
- Whenever you change a record, also read [human action](human-action.md) (the human-action line and the Issue / Reproduce / Check table every record carries, and when the line must change with the record) and [estimates](estimates.md), "Effort" (sizes, rationale, and reassessing effort when scope, dependencies, implementation or verification change).

## Visual cues and table integrity

| Cue | Rule |
|---|---|
| First-column status | 🔴 Open · 🟠 Investigate · 🟡 Implemented · 🟢 Verified · 🟣 Blocked · 🔵 Closed; match the written Status. |
| Active priority | 🔺 P1 · 🔶 P2 · 🔹 P3; keep its written label and value. |
| Closed or Blocked priority | ◻️ P1 / ◻️ P2 / ◻️ P3; only the marker changes. Verified priorities keep their colour until Closed. |
| Reopened or unblocked | Restore the colour for the retained priority; preserve ID, Opened and previous evidence. |

Colour never replaces status text, priority labels or evidence. Table rows must be contiguous: a blank line ends a Markdown table. Every row needs its header's number of cells: four for active signal rows, two for metadata, and the original width in historical archives. Escape literal pipes inside cells. Use `<br />` for an in-cell line break. Keep a blank line before a table and after its last row. Validate all affected rows, not just the added one, and check local links and status/priority consistency. For documentation-only changes these structural checks and a deliberate review are enough; do not invent application test coverage.
