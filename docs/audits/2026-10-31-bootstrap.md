# Nodo bootstrap review — 1 November 2026

Scoped review of the initial local implementation, baseline `04ca127aaf0f4b8c91fa6ef1b1e8494db3f0b752`, plus final documentation and logo asset changes. This is not a completed full product audit or device acceptance.

## Evidence

- `npm test`: 5 passing tests. Restart catch-up, durable inbox, duplicate suppression across connections, invalid dates/timezones, cancellation, authenticated HTTP and validated writes.
- `npm run typecheck`: passed.
- `npm run build`: passed, Angular production bundle.
- `npm run check:conventions`: passed, 4 files.
- `node tools/check-backlog.mjs`: passed, 8 records.
- `node tools/mcp.mjs check`: passed with zero selected integrations; none installed.
- `node tools/check-harness.mjs`: copied files match published v3.1.1.
- Maintenance input-bound receipt generated from reviewed outcomes; no historical friction baseline invented. Adoption timing includes implementation and waits; original timer file moved from template helper root into this project before finishing.
- `npm audit --omit=dev --audit-level=high`: zero reported production dependency vulnerabilities at review time. This is not a full supply-chain audit.

## Inspected areas

| Area | Result | Scope and limits |
|---|---|---|
| code | Checked | Store, CLI, HTTP, contracts and Angular source; fixed normalized invalid dates and future-schema rejection. No remote runtime exists. |
| logic | Checked | Reminder transitions, atomic inbox commit, explicit timezone parsing, cancellation and restart. Recurring schedules remain F-003. |
| tests | Checked | Five backend tests and Angular compiler; browser launch failed because no browser was installed. Browser download returned truncated archives. No visual, AXE or phone acceptance claimed. |
| documentation | Checked | README commands, implemented/planned distinction, architecture, roadmap, backlog and style-guide consistency reviewed. |
| harness | Checked | Published release source, copied file equality, adapted ownership, maintenance receipt and owned milestones. No Node profile upstream; F-001. |
| security | Checked | Loopback binding, mandatory bearer token, bounded body, constant-time token comparison, no arbitrary tool execution and no permissive CORS. Deployment/browser/device security not established. |
| delivery | Blocked | Local build works; no GitHub repository creation capability, hosted CI, TLS deployment, real phones or devices provisioned. |
| backlog | Checked | F-001–F-008 distinguish implemented foundations, unbuilt features and pending acceptance. |

## Findings and next work

| Classification | Finding | Owner |
|---|---|---|
| Incomplete agreed work | Reusable Node harness profile missing; project conventions are local only | F-001 |
| Acceptance gap | Browser/visual/accessibility and real phone checks unavailable | F-004 |
| Incomplete agreed work | Providers, messaging and recurring schedules absent | F-003 |
| Incomplete agreed work | Discovery, bootstrap and worker protocol are intentions only | F-005 |
| Incomplete agreed work | Distributed model/agent runtime, voice, evaluated learning and FPV adapter absent | F-006–F-008 |

No physical action, cloud model call, Telegram message or external device connection was performed. Doctor currently covers local runtime/database only. The generated vertical knot is a concept; editable monochrome SVG supplies the application icon.
