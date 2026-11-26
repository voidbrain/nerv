# NERV verification selection

NERV adopts the shared [verification policy](agents/verification.md) from harness v4.1.0. `.harness.json` owns its risk paths and test groups; `tools/verification.mjs` is copied unchanged. The NERV adapters report CI outputs and run selected Node regression files. No tool launches real-model evaluation automatically.

At job start, run `npm run check:freshness` and `npm run verification:plan` with GitHub access. Inspect the reasons and changed joins. Run applicable fast backlog/roadmap/queue/integration/rule/maintenance/convention checks and selected regressions. Reconcile the plan after edits. Unknown paths and missing verified history request full work. Do not repeat a successful broad local suite at an unchanged revision before CI; after a narrow fix, rerun its affected tests and use final CI for the full result.

| Change | Default application work with current full evidence |
|---|---|
| Backlog/docs only | Fast documentation/harness checks; no app suites, browser, Windows install or native build |
| Brief, channels, inventory, usage, explanations, build info | Mapped Node regressions, including changed test files and relevant joins; typecheck on Linux/Windows |
| Angular/dashboard | Mapped DOM regressions, typecheck, build and bilingual browser/axe |
| CLI/service or process integration | Node regressions, build, headless lifecycle and Windows service integration |
| Native companion | Node pairing/protocol regressions plus Swift/TLS fixture and ad-hoc package build |
| Authentication, persistence, grants, worker protocol, shared contracts, dependencies, policy/workflow/planner or unknown path | Complete deterministic CI |

Risk mappings deliberately stay conservative. A shared runtime change usually requires full CI; optimization still avoids duplicate push workflows, repeated local full/evaluation runs and unrelated stress/model campaigns. Add or widen groups when a changed join cannot be established. Test-only changes run the changed test plus mapped join tests; deletion without remaining regressions fails explicitly.

Full deterministic CI consists of all Node tests with Linux coverage, typecheck, Angular build/browser/axe, headless lifecycle, Windows full tests/service integration and native Swift/TLS/ad-hoc packaging. It does not include repeated stress campaigns, paid/real-model evaluation, physical phone acceptance, production notarization or target-host trials. Those retain their owning records and explicit risk/request triggers.

CI runs once per PR head, with concurrency cancellation for superseded heads, plus a manual trigger and a weekly main-branch freshness check; the scheduled run has its own concurrency group, so a push to `main` does not cancel it (B-156). Existing `validate`, `windows` and `native-macos` job names remain. Unselected platform jobs report scoped skips without installing dependencies. Whenever Node work or a full run is selected, `native-macos` also runs the Node tests that skip on every other runner (`node tools/macos-node-tests.mjs`: EVA `sandbox-exec` confinement, egress proxy, job user, desktop driver, moved-service joins), and fails if one skips (B-157); `test/macos-node-tests.test.mjs` keeps its list complete. The `full-suite` marker runs only for a full plan and rejects failed/cancelled/skipped dependencies. Only its successful, merged exact-head evidence resets freshness.

A docs-only pull request starts no Windows or macOS runner (B-139). Docs-only means every changed file is under `docs/` (records, tasks, the generated backlog views, guides, archives), a Markdown file at the repository root, or `LICENSE`; `native/README.md` or any other path is not. The `plan` job's changed-paths step decides it, and `windows` and `native-macos` skip at job level only when it is docs-only and the plan selected no work for them, so a full plan still runs both. A job-level skip reports the required `native-macos` check as skipped, which passes; a workflow-level `paths:` filter would leave it pending. Pushes to `main`, the merge queue, manual and scheduled runs always run both jobs. The `native-macos` limit stays 30 minutes: the 2026-11-25 cancellations at about 15 minutes with no step run were GitHub failing to acquire a macOS runner, which `timeout-minutes` does not govern.

## CodeQL

`.github/workflows/codeql.yml` (B-139) replaces GitHub's default code-scanning setup with the same languages, build modes and default query suite: `actions` and `javascript-typescript` on every pull request, push to `main` and weekly run; `swift` (a macOS runner, about 12 minutes) only when a `.swift` file, anything under `native/NervMenuBar/` or the workflow itself changed, and always on the weekly or a manual run.

<a id="codeql-default-setup-off"></a>**Owner procedure, before the PR that adds the workflow merges** (B-139-T02). While the default setup is on, GitHub rejects the workflow's uploads and its jobs fail, and a PR never merges with a failing check. So turn the default setup off first, on any machine with `gh` signed in as a repository admin:

```bash
gh api -X PATCH repos/voidbrain/nerv/code-scanning/default-setup -f state=not-configured
gh api repos/voidbrain/nerv/code-scanning/default-setup -q .state
```

Expected: the second command prints `not-configured`. Then the agent reruns the PR's CodeQL jobs (`gh run rerun <run> --failed -R voidbrain/nerv`) until they pass; only then does the PR merge. Until it merges, the repository has no CodeQL analysis on `main`.

<a id="codeql-alert-triage"></a>**Alert triage** (B-152). B-152-T01 lists here each open alert it judges a false positive: number, rule, location and reason. Dismissing one is the owner's (B-152-T02): for each listed alert run

```bash
gh api -X PATCH repos/voidbrain/nerv/code-scanning/alerts/<number> -f state=dismissed -f dismissed_reason="false positive" -f dismissed_comment="<reason from the list>"
gh api --paginate 'repos/voidbrain/nerv/code-scanning/alerts?state=open&per_page=100' --jq length
```

Expected: the second command prints the number of alerts B-152 still names with an owner (0 when every alert was fixed or dismissed). No list yet: B-152-T01 adds it.

## Gauntlet adoption

Protocol/pack/adapter changes run `node --test test/gauntlet.test.mjs` plus manifest/index drift validation and `gauntlet:plan`; actual native joins are selected explicitly. The pinned package/lockfile is a dependency risk and therefore requests complete deterministic CI. No check above launches real-model qualification, downloads or repeated stress campaigns. See [commands and costs](evaluations/gauntlet.md).
