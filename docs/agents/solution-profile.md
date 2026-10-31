# Solution profile

Optional coordination for one solution composed of multiple repositories. Use a dedicated coordinator repository even for a small solution when that is the owner's preference. Apply `core/` there, then the `solution/` fragment. Apply relevant stack add-ons to each component independently. This profile creates no actual consumer repositories and requires none for the template's own release.

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

## Backlogs and links

The coordinator uses the same compact B-/F- record format and validator as any project. Its own records describe integration outcomes, shared-contract decisions or coordination. Add `| Components | client:F-012, api:B-004 |` in a record's details metadata. IDs are repository-qualified using exact manifest IDs; `solution` is reserved for the coordinator. Components may use a `Solution` field to link back; that does not copy acceptance ownership. No foreign implementation action belongs in the coordinator record.

Dashboard readers support current signal summaries and the preceding five-column ID/Item summaries. Unsupported or malformed sources are reported as unknown, not silently treated as completed/empty. Configure archive files when records close: linked archived records remain readable; active records take precedence when an ID reopens. Unlinked archived records are omitted from component tables. Older archive tables without record headings require explicit migration or a different reader; the tool reports them rather than guessing.

## Refresh and verification

- `node tools/solution.mjs check`: validate manifest, source identities/refs and component links; read local snapshots without fetching.
- `node tools/solution.mjs dashboard`: print a combined Markdown snapshot.
- `node tools/solution.mjs dashboard --write`: coordinator only; replace only its marked generated dashboard. Source backlogs/archives, the manifest, Git metadata and every declared component checkout (including nested or symlinked destinations) are protected. Arbitrary existing files cannot be overwritten.
- Add `--remote` to read component backlogs through the GitHub API. Each requested ref is resolved once to a commit, then all files are read at that SHA. Supply `GH_TOKEN` in the executing environment when needed; never commit or print it. The coordinator still reads its local backlog, including current edits.

Local checkout identity must match the declared GitHub repository. Component HEAD must resolve to its declared ref; the coordinator reads its current working checkout so a feature branch can review its own integration records. Ref equality is local, not proof the checkout is up to date with GitHub; every row says local/not fetched or GitHub. Initially clean checkouts read backlog/archive blobs from the reported commit, so a mid-read working-tree change cannot be presented under that SHA. Dirty working copies are marked and use local record links rather than pretending modified content is in the published commit; their multiple file reads are not an atomic snapshot. Refresh deliberately before a review or after relevant component changes. An offline snapshot keeps its timestamp and is not presented as live status.

Missing checkout, denied access, unsupported source or missing referenced record produces an explicit problem and nonzero exit status. `dashboard --write` can still write a partial report with Unknown rows so absence is visible. Do not publish that report as a successful integration result. Semantic ownership, acceptance quality, stale evidence, real device checks and overall progress still require review. The tool checks declared links and structure, not the truth of free text.

## Adoption and CI

Merge the solution fragment into the coordinator stamp and copy its helper. Its CI template checks the coordinator’s own backlog and optional MCP metadata only, without fetching or waiting on components; merge it with existing CI rather than replacing it. Add optional `check:solution`/`solution:dashboard` scripts in that coordinator. Provision its authorized component checkouts or use `--remote` in a deliberate dashboard job; inaccessible private repos must remain explicit failures. A timestamped dashboard is a refreshed snapshot, not a reproducible artifact compared on every CI run. Do not run cross-repository availability checks as a mandatory component build gate.

A generic fix goes into the template first. Its acceptance uses repository-owned fixtures and contracts; no real solution or consumer adoption is required. Each actual coordinator/component records its own adoption in its own backlog. Nothing in the example profile authorizes fixing the user's existing solution.

Unknown, duplicate or malformed command options fail explicitly. Mixed headed/unheaded legacy tables and multiple summary rows fail rather than silently dropping work. These checks do not support every historical Markdown layout; an unsupported source remains Unknown until its owner chooses a supported representation or reader.
