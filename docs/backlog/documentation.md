# Documentation consistency

Read before you change documentation or close a record that changed behaviour. Part of the [backlog rules](../BACKLOG-RULES.md).

## Documentation consistency

[Architecture](../ARCHITECTURE.md) owns system boundaries; [roadmap](../ROADMAP.md) owns milestone acceptance.
README summarizes capabilities; AGENTS directs repository work, with per-area rules in [docs/agents/areas.md](../agents/areas.md); BACKLOG-RULES and `docs/backlog/` own backlog procedure; BACKLOG holds current records and the quick lifecycle legend; the [style guide](../STYLE-GUIDE.md) owns UI and writing conventions. User instructions take precedence. Dated archives and audits preserve context and do not override current rules.

When changing shared rules, reconcile linked summaries and scoped exceptions in the same PR. Application symbols must remain accessible; backlog markers are permitted. Keep historical evidence dated rather than rewriting it as current verification.

Derived things (generated pages, translations, recordings, guides) follow the impact map, `impact` in `.harness.json`, chains included (`after`): `check:freshness` lists the rows a branch sets off in run order, and each is done in the same PR or recorded with its reason; `docs/agents/impact-map.md` shows the whole map. The check below covers what the map does not.

For **every modification**, including a backlog-only edit, check README, AGENTS and its area notes, BACKLOG, BACKLOG-RULES and the style guide for affected claims, rules, links and exceptions. Update every affected document in the same PR; do not edit an unaffected file merely to mark it reviewed. Preserve user changes. State the consistency check and any outstanding discrepancy in the PR validation notes. A backlog state change can require README or guide corrections even when code did not change.

On every change or review, actively reassess whether each affected status, next action, human dependency, blocker, verification result/date and PR evidence can advance. When the next action is authorized and feasible, perform it; do not merely rewrite an “Agent can…” reminder or stop at a review. Pause only for an actual dependency or missing required human evidence, record it explicitly, and continue independent authorized work. Never advance a state without the required evidence.

Run `npm run check:backlog` after every ledger edit. CI validates active signal widths, remaining-effort colours, words and rationale, visible titles, human cues and all three recap rows on every record, collapsed next actions and metadata, dates, unique IDs, status/priority cues and balanced details. Historical archives remain outside this active-layout schema.

## Top-level documents

Moved from AGENTS.md ("Documentation") in 10.5.0, unchanged in substance.

- Keep top-level docs (`README.md`, `docs/README.md`, `docs/INSTALL.md`, `docs/STYLE-GUIDE.md`, and general guides) concise (~150–200 lines max) and clearly structured as entry points.
- Move feature-specific, platform-specific, or deep technical details into dedicated topic files under `docs/<topic>/` (e.g. `docs/guides/`, `docs/design/`, `docs/architecture/`) and link to them. <!-- project -->
- Keep docs current and free of backlog IDs or "not yet shipped / planned" lists; document shipped behavior and point to `docs/ROADMAP.md` & [docs/BACKLOG.md](../BACKLOG.md) where needed.
