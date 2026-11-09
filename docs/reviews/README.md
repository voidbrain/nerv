# Review and assessment register

NERV evidence snapshot reviewed 8 November 2026 against main `2943aad`. Times below use Europe/Rome; dates come from recorded review/run metadata, not file modification time. This register links evidence and existing rerun conditions; it does not install a schedule, run checks or certify an assessment. Refresh the affected rows when new evidence or policy changes.

## Current review windows

| Review | Last actual evidence | Next run / trigger | Owner and limits |
|---|---|---|---|
| Full deterministic verification | [PR #229 CI42584230832](https://github.com/voidbrain/nerv/actions/runs/42584230832), 2026-11-09; all five jobs passed | By 2026-11-16 or ten first-parent integrations, whichever comes first; sooner for risk, unknown coverage or explicit request | [NERV mapping](../verification.md) / [shared policy](../agents/verification.md); no stress/model/physical acceptance implied |
| Architecture reassessment | [2026-11-08 scoped report](../audits/2026-11-08-architecture-reassessment.md) | Significant boundary/hardware/trust change, recurring design failure or owner request; no calendar appointment | [Procedure](../agents/architecture-review.md), affected backlog owners |
| Expensive stress / real-model campaigns | Reports below; latest run depends on suite and selection | On request, concrete changed risk or named acceptance, with explicit scope and budget; no periodic rerun date | [Evaluation procedure](../decisions/evaluation-and-improvement.md); no automatic model qualification |
| Human / real-device acceptance | Per report and current record | When required device, signing identity, service host or human observation is available; not scheduled | F-005/F-009/F-011/F-015 and other owning records |

### Audit coverage by area

The configured interval is 7 days. Due dates below are policy thresholds, not booked runs. Scoped reports refresh only their named areas; prior full coverage remains separate. Risk or a request can trigger an earlier review. `npm run check:audits` is the live coverage authority; this table is a dated snapshot.

| Area | Latest actual review | Report | Due / earlier condition |
|---|---|---|
| code | 2026-11-06 01:50 CET | [2026-11-06-full.md](../audits/2026-11-06-full.md) | 2026-11-13 01:50 CET; changed risk/request earlier |
| logic | 2026-11-08 20:53 CET | [2026-11-08-architecture-reassessment.md](../audits/2026-11-08-architecture-reassessment.md) | 2026-11-15 20:53 CET; changed risk/request earlier |
| tests | 2026-11-06 01:50 CET | [2026-11-06-full.md](../audits/2026-11-06-full.md) | 2026-11-13 01:50 CET; changed risk/request earlier |
| documentation | 2026-11-08 23:22 CET | [2026-11-08-retirement-recheck.md](../audits/2026-11-08-retirement-recheck.md) | 2026-11-15 23:22 CET; changed risk/request earlier |
| harness | 2026-11-06 01:50 CET | [2026-11-06-full.md](../audits/2026-11-06-full.md) | 2026-11-13 01:50 CET; changed risk/request earlier |
| security | 2026-11-06 01:50 CET | [2026-11-06-full.md](../audits/2026-11-06-full.md) | 2026-11-13 01:50 CET; changed risk/request earlier |
| delivery | 2026-11-06 01:50 CET | [2026-11-06-full.md](../audits/2026-11-06-full.md) | 2026-11-13 01:50 CET; changed risk/request earlier |
| backlog | 2026-11-08 20:53 CET | [2026-11-08-architecture-reassessment.md](../audits/2026-11-08-architecture-reassessment.md) | 2026-11-15 20:53 CET; changed risk/request earlier |

## Audit and architecture reports

Every report is retained. Historical rows are evidence of that review, not separate recurring jobs. Area freshness uses the table above; a newer scoped report does not supersede a full report for untouched areas.

| Report | Actual review | Scope / baseline | Next condition |
|---|---|---|---|
| [2026-10-31-bootstrap.md](../audits/2026-10-31-bootstrap.md) | 2026-11-01 00:37 CET | scoped: code, logic, tests, documentation, harness, security, backlog, delivery; `04ca127` | Current area threshold above; affected changes/request |
| [2026-10-31-headless.md](../audits/2026-10-31-headless.md) | 2026-11-01 00:56 CET | scoped: code, logic, tests, documentation, harness, security, delivery, backlog; `f25fae5` | Current area threshold above; affected changes/request |
| [2026-11-01-lightweight-status.md](../audits/2026-11-01-lightweight-status.md) | 2026-11-01 10:01 CET | scoped: code, logic, tests, documentation, harness, security, delivery, backlog; `2a8b901` | Current area threshold above; affected changes/request |
| [2026-11-01-native-notifications.md](../audits/2026-11-01-native-notifications.md) | 2026-11-01 09:56 CET | scoped: code, logic, tests, documentation, harness, security, delivery, backlog; `37398b6` | Current area threshold above; affected changes/request |
| [2026-11-01-native-pairing.md](../audits/2026-11-01-native-pairing.md) | 2026-11-01 09:36 CET | scoped: code, logic, tests, documentation, harness, security, delivery, backlog; `9248f10` | Current area threshold above; affected changes/request |
| [2026-11-01-runtime-boundaries.md](../audits/2026-11-01-runtime-boundaries.md) | 2026-11-01 09:08 CET | scoped: code, logic, tests, documentation, harness, security, delivery, backlog; `718776f` | Current area threshold above; affected changes/request |
| [2026-11-04-rebrand-review.md](../audits/2026-11-04-rebrand-review.md) | 2026-11-04 (documented review; no scope manifest) | Historical narrative; no classified area refresh | New scoped review if this topic changes |
| [2026-11-06-architecture-reassessment.md](../audits/2026-11-06-architecture-reassessment.md) | 2026-11-06 21:26 CET | scoped: documentation, backlog; `cf77cab` | Current area threshold above; affected changes/request |
| [2026-11-06-brainstorm-retirement.md](../audits/2026-11-06-brainstorm-retirement.md) | 2026-11-06 21:00 CET | scoped: documentation, backlog; `7c0b619` | Current area threshold above; affected changes/request |
| [2026-11-06-full.md](../audits/2026-11-06-full.md) | 2026-11-06 01:50 CET | full: code, logic, tests, documentation, harness, security, delivery, backlog; `df7a75e` | Current area threshold above; affected changes/request |
| [2026-11-08-architecture-reassessment.md](../audits/2026-11-08-architecture-reassessment.md) | 2026-11-08 20:53 CET | scoped: logic, documentation, backlog; `1869340` | Current area threshold above; affected changes/request |

## Acceptance evidence

Dates identify the documented observation/report, not a new execution today. Automation, browser, human, signing and real-device evidence retain their separate limits.

| Report | Documented date | Scope / owner | Next condition |
|---|---|---|---|
| [gauntlet-2026-11-09.md](../acceptance/gauntlet-2026-11-09.md) | 2026-11-09 CET (2026-11-08 23:22 UTC) | F-073 / selected native policy through protocol 0.1.1, 90 checks; six adapter/artifact/cancellation fixtures | Changed protocol pin, adapter, pack or supervision; explicit model campaign separate |
| [angular-2026-11-06.md](../acceptance/angular-2026-11-06.md) | 2026-11-06 (report) | F-010 / Angular browser and axe | Changed Angular/CSS/localization or requested phone/PWA acceptance |
| [assistant-2026-11-07.md](../acceptance/assistant-2026-11-07.md) | 2026-11-07 (report) | F-003 / assistant recovery and channel evidence | Changed scheduling/planner/channel joins or new reported failure |
| [core-2026-11-06.md](../acceptance/core-2026-11-06.md) | 2026-11-06 (report) | F-002 / durable local workflows | Changed persistence/reminders/HTTP joins or recovery risk |
| [dashboard-2026-11-07.md](../acceptance/dashboard-2026-11-07.md) | 2026-11-07 (report) | F-019 / shipped dashboard | Changed dashboard bindings, interaction or presentation |
| [native-2026-11-08.md](../acceptance/native-2026-11-08.md) | 2026-11-08 (report) | F-011/F-015 / native development and owner observation | Chosen service/signing target and required human permissions; changed native/auth boundary |
| [node-bootstrap-2026-11-08.md](../acceptance/node-bootstrap-2026-11-08.md) | 2026-11-08 (report) | F-005 / isolated local Mac bootstrap | Changed bootstrap/recovery contract; selected real host for live acceptance |
| [runtime-2026-11-07.md](../acceptance/runtime-2026-11-07.md) | 2026-11-07 (report) | F-013/F-014 / process isolation and bounds | Changed process/protocol/ownership boundary or concrete load concern |
| [verification-2026-11-08.md](../acceptance/verification-2026-11-08.md) | 2026-11-08 (report) | F-071 / shared policy adoption | Changed planner/mappings/workflow or full-run threshold |

Input plan: [verification-plan-2026-11-08.json](../acceptance/verification-plan-2026-11-08.json) is the recorded selection supporting the verification report, not another executed suite.

## Evaluation runs

Read the exact suite, frozen revision, selection and not-covered fields in each artifact. “Complete” refers to its declared suite/selection, not the entire product. No historical result qualifies a different model/runtime configuration.

| Report | Actual finish | Suite / mode / revision | Result / scope | Next condition |
|---|---|---|---|---|
| [2026-11-08-brief-recovery.json](../evaluations/2026-11-08-brief-recovery.json) | 2026-11-08 00:44 CET | nerv-golden-v3; scripted-control-flow; `058c3b8` | pass; complete | Affected flow/scenario changes; full suite only on its own trigger |
| [2026-11-08-card-reconciliation.json](../evaluations/2026-11-08-card-reconciliation.json) | 2026-11-08 00:32 CET | nerv-golden-v2; scripted-control-flow; `85aa894` | pass; partial | Affected flow/scenario changes; full suite only on its own trigger |
| [2026-11-08-casper.json](../evaluations/2026-11-08-casper.json) | 2026-11-08 00:17 CET | casper-intent-v1; real-model-judgment; `3c71986` | pass; complete | Changed model/prompt/runtime or requested budgeted judgment campaign |
| [2026-11-08-f014-bases-stress.json](../evaluations/2026-11-08-f014-bases-stress.json) | 2026-11-08 09:35 CET | nerv-golden-v4; scripted-control-flow; `cdd8a0e` | pass; partial | Affected flow/protocol changes or requested bounded stress campaign |
| [2026-11-08-f014-scripted.json](../evaluations/2026-11-08-f014-scripted.json) | 2026-11-08 09:35 CET | nerv-golden-v4; scripted-control-flow; `cdd8a0e` | pass; complete | Affected flow/scenario changes; full suite only on its own trigger |
| [2026-11-08-misato.json](../evaluations/2026-11-08-misato.json) | 2026-11-08 00:19 CET | misato-planner-v1; real-model-judgment; `3c71986` | failed; complete | Changed model/prompt/runtime or requested budgeted judgment campaign |
| [2026-11-08-scripted.json](../evaluations/2026-11-08-scripted.json) | 2026-11-08 00:17 CET | nerv-golden-v1; scripted-control-flow; `3c71986` | pass; complete | Affected flow/scenario changes; full suite only on its own trigger |
| [2026-11-08-stress.json](../evaluations/2026-11-08-stress.json) | 2026-11-08 00:18 CET | nerv-golden-v1; scripted-control-flow; `3c71986` | pass; partial | Affected flow/protocol changes or requested bounded stress campaign |

## Decisions and design assessments

Current decisions stay in their owning folder until an explicit superseding decision exists. Last linked evidence is not a claim that every sentence was re-reviewed in that run.

| Document | Latest linked review/assessment | Scope / status | Next condition |
|---|---|---|---|
| [Runtime boundaries](../decisions/runtime-boundaries.md) | [2026-11-08 architecture review](../audits/2026-11-08-architecture-reassessment.md) | Retained process/role/trust rationale | Measured gap or changed runtime/trust assumption |
| [Worker protocol](../decisions/worker-protocol.md) | [2026-11-08 F-014 evidence](../evaluations/2026-11-08-f014-scripted.json) | Active signed worker contract; bounded action scope | Protocol/auth/receipt/recovery change |
| [Node bootstrap](../decisions/node-bootstrap.md) | [2026-11-08 acceptance](../acceptance/node-bootstrap-2026-11-08.md) | Active discovery/confirmed-bootstrap contract | Supported-host/service/enrolment change |
| [Evaluation and improvement](../decisions/evaluation-and-improvement.md) | [2026-11-08 suite evidence](../evaluations/2026-11-08-f014-scripted.json) | Active evaluation/improvement boundaries | Flow/model/promotion changes or repeated errors |
| [documentation-organization-2026-11-08.md](../design/documentation-organization-2026-11-08.md) | 2026-11-08 (documented source assessment) | Design/documentation assessment; no runtime acceptance | Relevant topology/requirements change or owner request |
| [operator-flow-review-2026-11-07.md](../design/operator-flow-review-2026-11-07.md) | 2026-11-07 (documented source assessment) | Design/documentation assessment; no runtime acceptance | Relevant topology/requirements change or owner request |

## Supporting review inputs

| Artifact | Recorded date / purpose | Next condition |
|---|---|---|
| [Brainstorm input hashes](../audits/2026-11-06-brainstorm-inputs.json) | 2026-11-06 inventory for the dated retirement review | Preserve historical bytes; a changed source needs a new inventory |
| [Retired-source manifest](../../remove/manifest.json) | 2026-11-08 byte-preserving move ledger | Validate before later relocation/deletion |
| [Maintenance receipt](../agents/maintenance-review.json) | Read its `reviewed` field and input hashes; reviewed evidence, not a product audit | Changed governing inputs or configured seven-day review age |
| [Coverage evidence](../agents/coverage.md) and [baseline](../agents/coverage.json) | Scope/date are recorded by their source; this reorganization does not refresh coverage | Purposeful coverage change/audit; not every documentation PR |
| [Model profiles](../agents/model-profiles.json) | Gemma candidate; no qualifying evaluation date | Exact configuration and bounded capability evidence before qualification |

The [documentation map](../README.md), [procedure index](../agents/procedures.md) and [work-source guide](../work/README.md) distinguish authorities, executable work and dated evidence. No last-run date is inferred from Git commit time or filename alone; report-only dates are labelled as such.

## CI reliability finding discovered during documentation maintenance

[PR #219 CI 42521677029 attempt 1](https://github.com/voidbrain/nerv/actions/runs/42521677029/attempts/1) failed deferred worker-approval cancellation with heartbeat connection loss. An unchanged-head failed-job-only retry passed; it does not establish a fix. [B-046](../BACKLOG.md#b-046) owns controlled reproduction and causal verification. The fixture’s 150 ms heartbeat budget suggests a timing hypothesis, not a proven shared cause with B-043 or a demonstrated production defect. No assertion or runtime behavior was changed.

## Retirement correction and qualification ownership

[2026-11-08 retirement recheck](../audits/2026-11-08-retirement-recheck.md) ([scope manifest](../audits/2026-11-08-retirement-recheck.audit.json)): documentation-only, baseline `7d3d091`; next review on source/target/requirement changes, or its configured seven-day scoped threshold. This does not refresh other audit areas. It restores the [active target](../architecture/target-schema.md) and retains five mixed design sources in the historical-input archive.

[Gauntlet Protocol ownership/reuse assessment](../design/gauntlet-protocol-2026-11-08.md), 2026-11-08: proposed independent project using harness for development, with NERV-owned cases. Next condition: accepted repository/framework scope or changed evaluation requirements. No model execution/qualification date exists for this proposal.

PR #221 CI 42530253552 attempt 1 also observed heartbeat-path connection loss in the Windows deferred-approval resource-retention fixture. Only the failed Windows job and marker were retried on unchanged source; attempt 2 passed. B-046 retains both occurrences without assuming a shared causal fix or production defect.

## Gauntlet integration review

[Independent report, 9 November 2026](2026-11-09-gauntlet.md): protocol/adapters, cost gates and cancellation join. Last execution: 2026-11-09 CET. Next: protocol pin, adapter, supervision or evidence-contract changes; real-model qualification retains a separate campaign/review trigger. No background campaign.

[Gauntlet0.2 adoption review](2026-11-09-gauntlet-v02.md), 2026-11-09: source/runtime-aware evidence reuse and index/telemetry adapters; next on relevant contract, pin, source/grader or admission change. Live Gemma acceptance remains a separate F-074-T02 campaign.

[Gauntlet0.2 adoption acceptance](../acceptance/gauntlet-v02-2026-11-09.md), 2026-11-09: PR225 / CI42573854325 passed all five jobs; next on relevant contract/pin changes. Owner resumed backlog work on 2026-11-09; live Gemma T02 follows the queue and remains unexecuted.

[Configuration qualification reassessment](2026-11-09-configuration-qualification.md), 2026-11-09, baseline `cb06e90`: accepted individual → combination → NERV/host evidence boundary, with NERV tasks F-006-T03/T04 and F-045 consumption. Documentation assessment only; no audit-area baseline, live campaign or model qualification refreshed. Reconsider on changed role/host/protocol requirements or measured campaign cost/benefit.

[Native approval previews](../acceptance/native-approvals-2026-11-09.md), 2026-11-09, baseline `12a24ef`: static EN/IT rendering, schema/expiry and native HTTPS authority join. Next on card schema, credential scope, UI/expiry or delivery changes; actual menu/VoiceOver and durable notifications remain F-023/F-011 acceptance.

Native approval card implementation accepted after PR229 exact head `f3109c1` / full CI42584230832, merged main `5933855`; F-023-T01/T02 closed, T03 ready and unimplemented. This updates deterministic evidence only; no live native interaction or notification acceptance follows.

[Execution boundaries and project separation](2026-11-09-execution-boundaries.md), 2026-11-09, baseline `7f50720`: source assessment retains harness/Gauntlet/NERV ownership, plans deterministic enforcement under F-049, protected grading/promotion under F-006 and security evidence under F-065. No upstream change, audit coverage or runtime acceptance; reconsider on runner/grader/authority changes or a demonstrated extraction need.

[Durable native approval delivery](../acceptance/native-approval-delivery-2026-11-09.md), 2026-11-09: Store/inbox atomicity, restart/backfill/cursors, TLS-to-Swift decoding/notification engine and Telegram reconciliation. Final CI and actual local evidence are distinguished there; live menu/VoiceOver/banner acceptance remains F-023/F-011. Reconsider on delivery identity, checkpoint, approval expiry or native authority changes.

[Independent native delivery review](2026-11-09-native-approval-delivery.md), 2026-11-09: no blocking runtime/security findings, one stale architecture sentence corrected; five independently executed Store/inbox tests passed. No independent Swift/CI/live Mac claim. Next condition: material delivery/grant/checkpoint change.
