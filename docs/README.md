# Documentation map

Start here for document ownership. This is the NERV-specific map; the [procedure index](agents/procedures.md) remains the shared harness authority for how work is done.

| Location | What belongs here | Current source / status |
|---|---|---|
| [Architecture](ARCHITECTURE.md), `architecture/` | Current boundaries, vocabulary and status-labelled target | Maintained; planned behavior is labelled |
| [Decisions](decisions/README.md) | Design choices, alternatives and reasons | Retained until explicitly superseded, not obsolete because old |
| [Roadmap](ROADMAP.md) | Milestones and acceptance | Authored placement plus generated status |
| [Backlog](BACKLOG.md) | Current outcome ledger | Generated from `work/records/` and `work/layout.json` |
| [Work sources/tasks](work/README.md) | Authored records, bounded tasks, required capabilities and model evidence links | Edit sources; task completion never closes its parent automatically |
| [Queue](agents/backlog-queue.md), [dependencies](agents/backlog-dependencies.md) | Derived order and prerequisite views | Generated; neither replaces the backlog |
| [Agent procedures](agents/procedures.md), [area rules](agents/areas.md) | Repository workflow authorities and project-specific constraints | Maintained; copied harness files retain release ownership |
| [Verification mapping](verification.md) | NERV commands and selected test groups | Complements the [shared selection procedure](agents/verification.md); these are distinct roles |
| [Review register](reviews/README.md) | Links, last actual execution, next date/condition, scope and owner | Dated snapshot; future triggers are not completed checks or a background scheduler |
| [Audits](audits/README.md) | Dated report plus scope manifest | Immutable evidence; scoped reviews refresh only their declared areas |
| [Acceptance](acceptance/README.md) | Observed automated/human/device acceptance and limits | Dated evidence, not current status |
| [Test-to-capability index](test-capability-index.md) | Generated common/NERV case mapping, areas, capabilities and explicit coverage gaps | Implemented cases, not measured qualification; CI rejects drift |
| [Gauntlet adoption](evaluations/gauntlet.md) | Independent capability protocol, NERV flow adapters and explicit model comparison commands | Pinned dependency; no automatic qualification or model campaign |
| [Evaluations](evaluations/README.md) | Versioned scenario/model/stress run reports | Retained by revision and suite; no automatic expensive reruns |
| `design/` | Scoped proposals/assessments not yet adopted as a decision | Findings map to existing records; no implied implementation |
| `security/`, [installation](INSTALL.md), [model usage](model-usage.md) | Topic-specific operating guides | Maintained beside their owning subsystem |
| [Archive](archive/README.md) | Closed records, reconciliation history and original design inputs | Append-only history, not a second active backlog |
| [remove/](../remove/README.md) | Superseded prototypes, visual references and metadata; no automatic deletion approval | Quarantined references, not runtime assets, instructions or current requirements |

Stable top-level entry points remain because tools, harness mappings and historical links use them. Adding another copy is not the way to reorganize an authority. The runtime dashboard is `web/public/dashboard/`, served at `/dashboard/`; the retired HTML files are not deployed.
