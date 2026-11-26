# Solution profile

Optional coordination for one solution composed of multiple repositories. Use a dedicated coordinator repository even for a small solution when that is the owner's preference. Apply `core/` there, then the `solution/` fragment. Apply relevant stack add-ons to each component independently. This profile creates no actual consumer repositories and requires none for the template's own release.

Moved to solution refresh and adoption (`docs/agents/solution-refresh.md`): "Refresh and verification", "Adoption and CI". Only the coordinator receives that page, `docs/agents/solution-dashboard.md`, `docs/agents/solution-gaps.md` and `tools/solution.mjs` (the `solution/` fragment, B-129), so this page names them as paths; the coordinator's `docs/SOLUTION.md` links them.

## In short

Moved from AGENTS.md in 3.3.0, unchanged in substance; AGENTS keeps the trigger.

Read available solution context (this profile) when configured/relevant; missing coordinator access does not block independent component work. A solution coordinator owns contracts, compatibility and integration acceptance in its own backlog; components own implementation and their independent acceptance. Link records using repository-qualified IDs and derive dashboards from source ledgers without copying editable statuses or averaging completion. A reusable master never waits for downstream adoption. Only the coordinator writes its dashboard; source revisions, unavailable inputs and dirty snapshots remain explicit.

## Sources of truth

- The reusable harness owns generic rules/tools and stays independent of its users.
- The coordinator owns its solution backlog, architecture, compatibility/contracts and end-to-end integration acceptance. Its dependency on component releases is legitimate composition, not a reusable master depending on consumers.
- Components own implementation, tests, releases and their project backlogs. Close each component record on its own criteria even if solution integration remains pending. Never mirror editable status/history into the coordinator.
- The dashboard reads source backlogs. It is replaceable derived evidence, with a snapshot timestamp and source revisions. Nobody edits it to change a project's status. It neither changes any source nor computes an average/combined completion percentage.

Read generic instructions, then available solution contracts/context and the current project's instructions. Link authoritative facts instead of copying them. A solution adds context; it does not silently override project rules or authorize modifying another repository. Respect explicit user instructions and surface genuine conflicts. Missing coordinator/device access does not block independent component work.

## Manifest and component context

The coordinator's `.harness.json` contains:

```json
{"stacks":["core","solution"],"solution":{"role":"coordinator","manifest":".solution.json"}}
```

`.solution.json` has `schemaVersion: 1`, a solution `name`, coordinator `repository` (`owner/name`), optional `backlog`/`dashboard` paths, and a `repositories` array. Each component has a unique lowercase `id`, GitHub `repository`, explicit local checkout `path`, branch/tag/commit `ref`, optional `backlog` (default `docs/BACKLOG.md`) and `archives` (explicit file list, default empty). Paths to backlog/archive/dashboard files stay within their owning repository. Component checkout paths can be outside the coordinator; reads are allowed, writes are not.

The manifest may also contain an optional `integrations` object (same schema as `.harness.json`) for solution-scoped MCP recommendations; project selections explicitly override matching IDs. Runtime availability is still checked per host/session.

A component can point to available coordination context without adopting the solution stack:

```json
{"solution":{"role":"component","id":"client","manifest":"../coordination/.solution.json"}}
```

Portable repository/ref references are versioned; machine-specific checkout arrangements and credentials may use local workspace configuration or an explicit `--manifest=PATH` at invocation. Do not store an absolute personal path or secret as shared project content. The helper does not clone, fetch, change branches or repair repositories automatically.

## Solution order

An optional `order` in `.solution.json` names a coordinator file (for example `docs/SOLUTION-ORDER.md`) holding the owner's order across the solution: a numbered list of `repo:ID` references between `<!-- order:start -->` and `<!-- order:end -->` (one such list per file), each a record (`api:F-101`) or a step (`web:F-012-T03`) with an optional note after ` — `. The rules:

- Take the first ready item in the order. Work not listed follows each repository's own priority.
- The order changes only by an owner instruction, landed as a PR in the coordinator. One exception (B-058): an item the dashboard shows ✅ Done (a record that closed, or a step completed in its repository) leaves the order in the next refresh PR (`node tools/solution.mjs dashboard --write --prune-order`).
- The order never skips a prerequisite or an owner decision: an item whose step waits on either is not ready, whatever its place.
- The list holds references only, never status: the state comes from the owning backlogs at the dashboard's resolved commits.

`node tools/solution.mjs check` validates the list offline, without reading any component: the syntax, known manifest IDs (`solution` included), duplicates and numbering from 1.

## Backlogs and links

The coordinator uses the same compact B-/F- record format and validator as any project. Its own records describe integration outcomes, shared-contract decisions or coordination. Add `| Components | client:F-012, api:B-004 |` in a record's details metadata. IDs are repository-qualified using exact manifest IDs; `solution` is reserved for the coordinator. Components may use a `Solution` field to link back; that does not copy acceptance ownership. No foreign implementation action belongs in the coordinator record. A component step that waits on a step of another component names it in its task file's `dependsOn` as `<repo>:<STEP-ID>` with the same manifest ID ([ordering](../backlog/ordering.md)); the component never reads the other repository.

How the dashboard reads each backlog (layouts, built views, remaining hours) is in solution dashboard (`docs/agents/solution-dashboard.md`), moved from here unchanged (F-095-T04). Its gap review, proposals for missing cross-repository work, is in solution gaps (`docs/agents/solution-gaps.md`).

## Dashboard sections

Since 10.20.0 (F-095, F-097) the dashboard holds, in order: the sources and their revisions; the owner view (a summary per project with harness and next audit, the solution order with live state, hours and open prerequisites, blocked with the block reached, nothing to do, waiting for the owner; since 10.21.0 in the layout of a coordinator's own overview, F-099); the agent runway; audits, reviews and harness release per project; the gap review; each project's open steps, collapsed; remaining effort; integration outcomes; component work; source and link problems. Solution dashboard says how each is read, solution gaps what the gap review proposes, and solution refresh, "Moving from project tools", how a coordinator with its own order or overview tools moves to them.
