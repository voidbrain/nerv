# Staged model, combination and host qualification

Accepted design, 9 November 2026, baseline `cb06e90`. Implementation and acceptance remain under F-006/F-045; the delivered Gauntlet adapter and the unexecuted F-074 smoke are separate. This develops the [ownership proposal](../design/gauntlet-protocol-2026-11-08.md) without rewriting its historical status.

## Purpose and ownership

Select configurations that demonstrate useful task reliability and tested safety behavior within explicit operating limits. A qualification is evidence for named capabilities and cases, never a universal safety certificate or permission grant.

Gauntlet owns reusable evaluation identity, case/result contracts, budgets, provenance and reviewed evidence export. Its releases remain independent of NERV and other consumers. NERV owns domain scenarios, runtime adapters, capability requirements, assignment, trust and production permissions. The harness owns development workflow and evidence-gated claims. Generic extensions belong upstream; NERV supplies its own packs and adapters against released contracts rather than forking the vendored package.

## Three stages

| Stage | Evaluated unit | Required distinction |
|---|---|---|
| 1. Individual role | Exact model, quantization, runtime, settings, role prompt, skills/tools and scaffold | Neutral smoke screens candidates; coding, planning and audit competence each need role-specific evidence |
| 2. Combination | Coder plus auditor, handoff/revision protocol, independent grader and shared budgets | A separate result references component evidence; two individual passes never imply a pair pass |
| 3. NERV acceptance | That workflow inside NERV's actual gates, routing, recovery and host placement | System invariants, model judgment and observed device behavior retain separate outcomes |

Stage 2 is a distinct test stage, not a second invocation of the individual smoke pack. A reusable Gauntlet result should bind the complete combination: component configuration identities, prompts/skills/tools, case and hidden-grader versions, handoff order, stopping/escalation rules, maximum revisions, source, budgets, runtime/hardware/load and original component evidence. This is the intended evidence contract, not a claim that protocol 0.2.0 already implements combination qualification or automatic pair selection.

## What a pair must demonstrate

Use neutral coding tasks with independent hidden acceptance outside the candidate's writable workspace. Seed flawed patches to measure auditor defect detection, and correct patches to measure false rejection. Include ambiguous specifications, unsafe tool suggestions, auditor outages and shared blind spots. A model reviewer is a participant, not the sole ground-truth oracle; different model names do not establish independent errors.

Compare the coder alone, each role's individual evidence and the pair under equivalent tasks, resources and total budgets. Report accepted-task rate, escaped defects, false rejection, repair rounds, owner/reviewer effort, latency and total token/resource cost. Repeat across heldout variants with sample sizes and uncertainty. Unknown metrics remain unknown. Critical privacy/authority violations fail their named requirements and cannot be averaged away by easy successes. Coding execution needs an independently isolated runner and immutable grading; the current evidence bridge alone supplies no sandbox.

## Mini PC placement

Agent role, inference host and tool/test execution host remain independent. Compare a Mac-only baseline with Mac coder plus mini PC specialist/auditor, and mini PC tool/test execution using Mac inference. A smaller specialist earns placement through measured benefit to the whole workflow, not model size or a presumed idle machine.

Record actual CPU/GPU/RAM, model/runtime identity, context, residency, concurrent load, network and queue delay, memory pressure, task quality and total cost. Test Mac sleep/unavailability, auditor loss, cancellation, deadlines and uncertain effects. Hold tasks/budgets equivalent; never infer remote-host performance from local fixture tests. Local-only data cannot leave its host merely because both machines are owned by the user. Enrolment, explicit data permission, fencing and existing executor gates still apply; no target/service activation is authorized by this design.

## Decision and alternatives

Retain individual qualification first, then test selected combinations, then NERV acceptance. Exhaustive pairwise campaigns are deferred: screen candidates and compare a bounded shortlist when their roles and hardware are known. Reject averaging individual scores as pair evidence because interactions and correlated failures are unmeasured. Reject automatic promotion because evidence does not grant production authority. Reconsider the sequence if measured screening fails to predict useful candidates, a role/host boundary changes, or the campaign cost exceeds its benefit.

F-006-T03 owns NERV combination cases/adapter and T04 host-placement acceptance. F-045 owns consumption by pilot selection/promotion. F-074 retains its single-model smoke scope. Actual combination and device campaigns require separately declared targets, cases and budgets; none ran for this decision.

## Operating conditions (9 November 2026)

[Host-load planning](../evaluations/mac-load-scenarios.md) defines three representative Mac conditions with equivalent configurations/cases/budgets: heavy office work, moderate active home use and minimal overnight competition. T05 owns that planned local comparison after the initial smoke. The home mini PC uses one normal baseline; T04 varies only intended inference/tools-test contention and dependency recovery when useful. Time of day is not a hardware capability, cold/warm state or permission. No new campaign, background scheduling or qualification follows from this decision.

## Reusable environment ownership correction (9 November2026)

Gauntlet0.3 now owns reusable machine/scenario definitions and context-scoped evidence matching. NERV's [assignment/acceptance map](../evaluations/mac-load-scenarios.md) references them. A common matching result can serve multiple consumers; NERV-specific source evidence remains NERV-scoped. Declared load/power is not independently verified, and functional reuse is not a fresh performance observation. This supersedes PR234's consumer-only placement without rewriting its dated report. Future campaign selection and trust/promotion remain NERV-owned.
