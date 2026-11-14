# Periodic audit procedure

An audit reviews evidence and records findings; it is not a guarantee of no defects. This procedure applies to the template and adopted projects, with repository-owned acceptance. Read all applicable rules first. Audits never weaken starting rules or create a master release dependency on consumers.

Moved to [audit findings](audit-findings.md): "Findings and improvement proposals".

## In short

Moved from AGENTS.md in 3.3.0, unchanged in substance; AGENTS keeps the trigger.

Follow this procedure. Produce a dated report and scope manifest with baseline, checked/not-applicable/blocked results, evidence, limits and findings. Full audits cover all eight areas; scope narrow reviews honestly. Separate confirmed bugs, incomplete agreed work, hypotheses, context and value-based improvement proposals. Track actionable unresolved work under owning IDs, preserving uncertainty and authorization. A fresh maintenance receipt or passing CI is not a completed product audit.

## Triggers and scope

At session start and CI, run freshness plus `node tools/check-audits.mjs`. The default interval is 7 days (`audit.days`, else freshness.auditDays). The daily read-only workflow reports between sessions; no agent performs repairs while no execution host is running.

A full audit is due when area coverage is missing/stale, explicitly requested, or a significant architecture/profile/security/dependency change makes previous evidence insufficient. Also audit after serious regressions or repeated procedural conflicts. A targeted incident or narrow change can receive a scoped review; it does not reset unrelated areas or establish a completed full audit. Restart a pending audit when intervening changes invalidate its scope. Reuse earlier evidence only by naming its revision/scope and why it still applies. Age alone does not invalidate a finding or justify closing it.

Pin the actual baseline commit and state changed files, inputs, external dependencies and limits. Inspect current code before deciding a finding exists. Review all active backlog records in a full audit, checking merged CI and actual acceptance; do not silently expand scope to another repository.

## Required areas

| Area ID | Required inspection |
|---|---|
| code | Bugs, incomplete paths/stubs/TODOs, dead or unreachable code, unused exports/dependencies, error handling, resource cleanup and compatibility. Confirm dynamic/framework uses before removing apparently unused code. |
| logic | Requirements versus behavior; invariants, boundaries, invalid input, state transitions, save/import/undo, coordinates/data contracts and interactions between modules. Trace representative end-to-end paths, not only isolated helpers. |
| tests | Assertion quality, regression tests, missing branches/workflows, skipped/flaky checks, meaningful coverage and static/security results. Unit, browser, visual and real-device evidence are distinct. |
| documentation | README, architecture/area notes, commands, guides/clips, examples, generated outputs and design/art/style guidance versus actual behavior. Regenerating text is not rerecording media. |
| harness | Rule conflicts/duplication, copied/forked/adapted drift, ownership, authorization, tool behavior, impact/coupling maps, measurement/review evidence and justified rule/tool/skill improvements. |
| security | Privacy/secrets/metadata, trust boundaries, input validation, permission handling and supply-chain/external access. Record required live checks not performed; a metadata check is not a security audit. |
| delivery | Build/CI/deploy/release status, reproducibility, runtime/dependency versions and external services/data. Check actual runs and skipped jobs; merge is not release. |
| backlog | Findings, ownership, evidence, states, next actions, dependencies, human requirements, estimates and closable work. Never duplicate an existing ID for the same behavior. |

Every full report covers all eight. Scoped reports declare their subset. For each area use checked, not-applicable with a reason, or blocked with a named dependency. Checked means the review was performed, not that all observed defects are fixed. Blocked never counts as freshly completed. Record method, evidence, exclusions and residual risks for every area.

## Dated outputs

Build on the repository’s existing audit directory and conventions; do not create a parallel audit system. Preserve earlier reports and backlog IDs, explicitly reference relevant prior findings, and reconcile their current disposition against the active ledger. New metadata supplements existing reports; it does not retroactively certify their scope or change their original review date.

Always write a human-readable `docs/audits/YYYY-MM-DD-topic.md` and matching dated `.audit.json` scope manifest. Published reports are immutable history; a later correction is a dated addendum, not a rewrite. The report includes baseline, full/scoped designation, scope/method, per-area results, findings, recommendations, backlog references, checks performed, deferred work and limits. Do not leave conclusions only in chat or CI logs.

Manifest shape: schemaVersion 1, kind full/scoped, reviewed ISO timestamp, baseline full commit SHA, report repository-relative Markdown path, and areas keyed by the IDs above. Each area contains result, evidence and limits; blocked also names blocker. Use actual review time, not just a new filename to reset freshness. The checker validates shape/age/scope, not whether the prose or revision claim is truthful. Configure audit.enforce=true when an actual area baseline is established; due areas then fail the check. Invalid manifests fail even in warning mode. Historical prose remains readable but unclassified until explicitly mapped in a new evidence-backed manifest; do not guess its scope from its date/title.
