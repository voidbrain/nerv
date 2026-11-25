# Audit findings

Read before you record audit findings or improvement proposals. Moved from [audit](audit.md) unchanged (F-076).

## Findings and improvement proposals

| Classification | Treatment |
|---|---|
| Confirmed defect | Evidence and reproducible trigger; update/reopen the owning bug with severity/risk, next action and acceptance checks. |
| Missing/incomplete agreed behavior | Link the requirement and actual gap; update the owning feature/bug rather than calling a stub implemented. |
| Clue or hypothesis | Record the observation, uncertainty and diagnostic that would confirm/refute it. Actionable investigations enter Investigate; do not label speculation a confirmed bug. |
| Annotation/context | Preserve useful constraints, reasoning and limitations in the dated report or authoritative area notes. No invented task for every observation. |
| Improvement/refactor/rethink proposal | State expected user/engineering value, evidence, cost/effort, risk, alternatives, dependencies and an observable success criterion. A suggestion is not an accepted feature or authorization to rewrite working code. |
| Repeated friction | Consider a consolidated rule, reusable tool or skill only when it addresses the cause. Record the proposal/implementation and its owning evidence; no autonomous policy self-authorization. |

A finding table records classification, affected area/location, evidence/reproduction, impact/confidence, recommendation/next diagnostic and owning backlog ID (or report-only rationale). An optional `Reference` column may cite an OpenCRE CRE ID or a version-pinned standard ID (for example `v1.01-C9.4.3`); never use an unpinned standard name or ID. A reference supplies context, not evidence of compliance. Every actionable unresolved finding is tracked before the audit ends; reuse IDs, keep repository ownership and explicit human decisions. Accepted feature proposals enter the backlog with checks; unaccepted options remain clearly proposed, or a decision record names the required choice. Prioritize value/risk over feature count or line-count reduction.

For optional public security-requirement context, the [OpenCRE MCP server](../../tools/mcp-catalog.json) exposes public read tools by default over local stdio. Keep its authenticated tools disabled; they include a write operation. Use the documented public REST API directly as a fallback. Neither a reference nor a lookup is a compliance claim.

Perform authorized feasible fixes with tests and record them; substantial refactors or feature additions follow their recorded scope/authorization. Close the audit outcome when its required review/report/tracking is complete, without closing product defects or unavailable human/device checks it discovered. End with remaining risks and next actions. No audit promises that all bugs, dead code or opportunities have been found.
