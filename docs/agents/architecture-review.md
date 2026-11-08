# Architecture reassessment

Use this focused review when a boundary changes significantly, recurring failures expose a design assumption, a dependency/hardware change creates a useful alternative, or the owner requests it. It complements the full audit's code/logic/documentation/security/delivery areas; it never resets unrelated full-audit coverage. It is not a reason to run every application/model/stress test.

Pin the repository revision, changed scope and authoritative requirements. Compare the actual code, architecture, decision records, roadmap and active backlog; distinguish shipped behavior, intended work, hypotheses and conflicts. Trace representative end-to-end paths and failure/recovery paths, including ownership, privacy, permissions, state consistency, runtime resources and deployment. A roadmap-placement check establishes structure, not architectural correctness.

For each material choice record:

| Question | Required evidence |
|---|---|
| What problem and constraints does this solve now? | Current requirements, measured behavior and explicit limits |
| What assumptions justified the existing decision? | Original decision/source and whether those assumptions still hold |
| Which contradictions or duplicated responsibilities exist? | Named code/docs/contracts and concrete conflicting behavior |
| Which alternatives are viable, including previously rejected ones? | Current primary sources, compatibility and a representative experiment when needed |
| Why retain or change? | Reliability/security/operability/cost benefit versus migration, failure and maintenance cost |
| What would cause reconsideration? | Observable trigger, owner and expected evidence |

Use an existing decision record or add one for a new decision. Keep rejected alternatives and original rationale as history; supersede rather than silently rewrite a decision as if it had always been different. No rewrite follows merely because an alternative is newer or an agent prefers it. Separate confirmed defects, unimplemented agreed outcomes and optional proposals. Track actionable unresolved work under its owning records; respect repository ownership and dependency direction. A reusable master's decision/acceptance never depends on downstream adoption.

Write a dated report under the project's existing audit/report conventions, with baseline, scope, inspected paths, evidence, exclusions, decisions, findings and next actions. If claiming scoped audit coverage, use the audit procedure and its matching scope manifest; a prose architecture discussion alone is not a completed audit. Link affected decision records, architecture, roadmap and backlog in the same change. Run affected consistency/regression checks and preserve existing permission/review gates. The result can be retain, change, experiment or defer with a named blocker; it is never an automatic architecture migration or claim of no remaining contradictions.
