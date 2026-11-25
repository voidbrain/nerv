# Solution refresh and adoption

Read before you refresh or verify a solution dashboard, or adopt the solution profile in CI. Moved from [solution-profile](solution-profile.md) unchanged (F-076).

## Refresh and verification

- `node tools/solution.mjs check`: validate manifest, source identities/refs and component links; read local snapshots without fetching.
- `node tools/solution.mjs dashboard`: print a combined Markdown snapshot.
- `node tools/solution.mjs dashboard --write`: coordinator only; replace only its marked generated dashboard. Source backlogs/archives, the manifest, Git metadata and every declared component checkout (including nested or symlinked destinations) are protected. Arbitrary existing files cannot be overwritten.
- `node tools/solution.mjs dashboard --write --prune-order`: also drop the order items the dashboard shows ✅ Done from the order file and renumber the rest; nothing outside the order markers changes (B-058). Run it in a refresh PR.
- Add `--remote` to read component backlogs through the GitHub API. Each requested ref is resolved once to a commit, then all files are read at that SHA. Supply `GH_TOKEN` in the executing environment when needed; never commit or print it. The coordinator still reads its local backlog, including current edits.

Local checkout identity must match the declared GitHub repository. Component HEAD must resolve to its declared ref; the coordinator reads its current working checkout so a feature branch can review its own integration records. Ref equality is local, not proof the checkout is up to date with GitHub; every row says local/not fetched or GitHub. Initially clean checkouts read backlog/archive blobs from the reported commit, so a mid-read working-tree change cannot be presented under that SHA. Dirty working copies are marked and use local record links rather than pretending modified content is in the published commit; their multiple file reads are not an atomic snapshot. Refresh deliberately before a review or after relevant component changes. An offline snapshot keeps its timestamp and is not presented as live status.

Missing checkout, denied access, unsupported source or missing referenced record produces an explicit problem and nonzero exit status. `dashboard --write` can still write a partial report with Unknown rows so absence is visible. Do not publish that report as a successful integration result. Semantic ownership, acceptance quality, stale evidence, real device checks and overall progress still require review. The tool checks declared links and structure, not the truth of free text.

## Moving from project tools

A coordinator that built its own order or overview tools before 10.20.0 moves to the shipped sections in a session of the coordinator, recorded in its own backlog:

1. Reconcile to the release that ships them (copy `tools/solution.mjs` and `docs/agents/solution-profile.md`, `solution-refresh.md`, `solution-dashboard.md` and `solution-gaps.md`).
2. Move the order file to the shipped format: name it in `.solution.json` `order`; between `<!-- order:start -->` and `<!-- order:end -->`, one numbered `N. repo:ID — note` per line, from 1, with the manifest IDs. Keep any state out of it: the dashboard reads state from the owning backlogs. `node tools/solution.mjs check` must pass.
3. Turn prose prerequisites ("waits on api:F-012-T01") into `dependsOn` entries `repo:STEP-ID` in the waiting step's task file, in the repository that owns that step, and list each one in that repository's `externalMet` once its outcome is checked (until then the step waits).
4. Run the project tool and `node tools/solution.mjs dashboard` on the same commits and compare section by section. A difference that is a defect of the shipped section goes to the template as a change asked from a project, never into an edited copy of `tools/solution.mjs`.
5. Remove the project tools the shipped sections replace, with their scripts, tests, CI steps and dashboard output, in the same change (no dead code). Keep, as project tools, only views the shipped sections do not offer.

## Adoption and CI

Merge the solution fragment into the coordinator stamp and copy its helper. Its CI template checks the coordinator’s own backlog and optional MCP metadata only, without fetching or waiting on components; merge it with existing CI rather than replacing it. Add optional `check:solution`/`solution:dashboard` scripts in that coordinator. Provision its authorized component checkouts or use `--remote` in a deliberate dashboard job; inaccessible private repos must remain explicit failures. A timestamped dashboard is a refreshed snapshot, not a reproducible artifact compared on every CI run. Do not run cross-repository availability checks as a mandatory component build gate.

A generic fix goes into the template first. Its acceptance uses repository-owned fixtures and contracts; no real solution or consumer adoption is required. Each actual coordinator/component records its own adoption in its own backlog. Nothing in the example profile authorizes fixing the user's existing solution.

Unknown, duplicate or malformed command options fail explicitly. Mixed headed/unheaded legacy tables and multiple summary rows fail rather than silently dropping work. These checks do not support every historical Markdown layout; an unsupported source remains Unknown until its owner chooses a supported representation or reader.
