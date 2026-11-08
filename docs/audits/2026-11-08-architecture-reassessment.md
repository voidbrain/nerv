# Architecture reassessment — 8 November 2026

Scoped source/documentation review against NERV main `1869340` (full revision in the manifest). This review covers the model/execution boundary, native access, distributed ownership and accepted development workflow. It does not establish a full audit, model benchmark, live device acceptance or remote inference support.

## Method and findings

Compared `src/model.ts`, `src/runtime.ts`, `src/misato.ts`, `src/pilots.ts`, `src/server.ts` and `src/worker-jobs.ts` with the runtime-boundary decision, architecture, roadmap and affected F-006/F-015/F-023/F-045/F-048/F-049/F-050 records. Existing worker protocol and native guide supply the intended recovery/authentication contracts. Source inspection establishes the described branches, not their real-host performance.

| Finding | Evidence and consequence | Disposition / owner |
|---|---|---|
| Stale description of implemented planning | Runtime uses bounded Misato steps and local model adapters; F-006 still said neither existed | Correct F-006 wording; distributed endpoint/execution scheduling stays open |
| Remote inference is an unmet capability | `validateModels` in model.ts rejects non-loopback local URLs; local-only requests cannot route to cloud | Retain privacy guard; F-006-T01 defines a separate reviewed endpoint/trust contract before implementation |
| Pilot advice differs from execution | `choosePilot` selects a keyword-matching local adviser; runtime records consultant advice before planning | F-045 owns remote capability/evolution; F-049 owns sandbox execution; profiles or Git claims deliver neither |
| Uncertain whole-job fallback was underspecified | worker-jobs receipts return uncertain for work that may have run and retain exclusive resources | Correct F-050 acceptance: reconcile before reassignment; heartbeat loss is no proof an effect stopped |
| Effort summary contradicted expanded scope | F-048 showed Medium while its own chunking/multiple-consultant rationale said Large | Align summary to Large; no priority or completion claim changes |
| Native and local RPC descriptions were conflated | Native access uses pinned REST and read-only credentials; local RPC is a distinct interface | Correct architecture wording; F-015 live acceptance remains open and F-023 must review decision authority |
| Development and runtime ownership differ | Git claims coordinate repository edits; worker receipts, gates and resource locks coordinate effects | Keep separate contracts; adoption F-072 does not close runtime F-048/F-049/F-050 |

## Representative printer request

An owner asks the coordinator to print an artifact. The coordinator may obtain specialist advice using a separately selected model endpoint, then propose a bounded action to an enrolled worker advertising the required printer capability. The execution host is selected for device access, not merely because its model advised. The target applies its own gate and preserves artifact identity, owner approval and durable receipts. A timeout requires inspection/reconciliation before another print is attempted. Slicing and physical printing require distinct adapter capabilities and acceptance; neither is implemented or tested by this review. Splitting preparation and execution is possible in the intended architecture only through explicit dependent tasks and artifact handoff, not two concurrent owners of one physical effect. Whole-job delegation is a separate F-050 option, not a prerequisite for every remote action.

## Retain or change

Retain the TypeScript coordinator with isolated process responsibilities and explicit typed contracts. The existing runtime-boundary decision already distinguishes model role, inference endpoint, worker and permissions; current gaps are implementations of those boundaries. A backend/Python framework rewrite has no measured benefit in this review and would add migration and security-validation cost. Reconsider only with a representative benchmark demonstrating an unmet requirement. Retain a single durable coordinator; a second full coordinator or context copying does not solve sleep/partition recovery. F-016 owns replication, leader epochs and fencing before relocation is safe. Prior decision reports remain historical evidence and are not rewritten.

Adopt reusable development task sources, cooperative claims and evidence-based model profiles from harness v4.2.0. This reduces shared ledger editing and makes resource overlap reviewable; it cannot guarantee conflict-free merges or prevent a non-cooperating writer. Gemma remains candidate: version, quantization, runtime, context budget and capability evaluations have not been inspected. No model was invoked or inference endpoint enabled. Qualification must measure the exact configuration on bounded representative tasks, including structured tool use, regression quality and escalation behavior.

## Scope and validation limits

Documentation, logic and related backlog were reviewed for these boundaries only. Other backlog records, broad security testing, dependency upgrades, live service/printer/native acceptance, model performance and stress campaigns were excluded. The linked procedure index centralizes discovery while original authorities retain their requirements. Adoption checks and final CI are recorded in F-072; this report does not claim those future results. Actionable unresolved work stays under F-006/F-023/F-045/F-048/F-049/F-050/F-016; no feature closes on source inspection alone.
