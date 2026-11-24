# Ledger header and Other changes

Read before you move the backlog header, add a reconcile log entry or edit `## Other changes`. Part of the [backlog rules](../BACKLOG-RULES.md); [review](review.md) owns when to reconcile.

## Ledger header

- With source-owned records the header can be generated (8.4.0): the layout segment `{"header": "docs/archive"}` renders "Current work ledger, reviewed <date> against <branch> `<sha>`. <summary>" from the newest entry of `docs/archive/reconciliation-<year>.md`, an appended `## <date> — <branch> `<sha>`` heading followed by one paragraph of at most 300 characters naming the PRs merged since and their CI. Reconciling then appends an entry and rebuilds; nothing in the layout changes, and parallel appends merge on their own (`merge=union` on `docs/archive/*.md`, from `core/gitattributes.txt`). Earlier bullet-style history in that log is ignored, never changed.
- Keep `## Other changes` concise (8.6.0): at most 2 paragraphs and 1000 characters (a link to `docs/archive/reconciliation-<year>.md` and at most the latest entry). Move older entries to `docs/archive/reconciliation-<year>.md` under `## Archived Other changes`; `check:backlog` enforces this.
