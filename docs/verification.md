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

CI runs once per PR head, with concurrency cancellation for superseded heads, plus a manual trigger and a weekly main-branch freshness check. Existing `validate`, `windows` and `native-macos` job names remain. Unselected platform jobs report scoped skips without installing dependencies. The `full-suite` marker runs only for a full plan and rejects failed/cancelled/skipped dependencies. Only its successful, merged exact-head evidence resets freshness.

Default limits: seven days or ten first-parent integration commits. Each merged/squashed PR counts once; direct commits conservatively consume the budget. A successful full PR run can count after merge without a duplicate main run. Partial success, skipped marker, changed PR head, unmerged branch or unavailable history cannot reset the limit. Bounded lookup may request full work if the prior baseline is beyond its history window.

For a manual full run, select **Actions → CI → Run workflow → full = true**. `npm run verification:plan -- --full` requests the same scope locally but only prints a plan. `npm run test:affected` executes reviewed selection from `NERV_VERIFY_GROUPS` and JSON `NERV_VERIFY_PATHS`; CI supplies these as environment variables, never interpolated shell commands. Existing `npm test`, `test:browser`, `test:headless`, `evals`, `evals:stress` and `evals:model` commands remain available.
