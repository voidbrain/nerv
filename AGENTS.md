You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Do NOT set `changeDetection: ChangeDetectionStrategy.OnPush` explicitly. `OnPush` is the default in Angular v22+.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Accessibility Requirements

- It MUST pass all AXE checks.
- It MUST follow all WCAG AA minimums, including focus management, color contrast, and ARIA attributes.

### Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `model()` for two-way bound properties with `[(prop)]` syntax instead of pairing `input()` with `output()`
- Use `computed()` for derived state
- Use `linkedSignal()` for state derived from multiple reactive sources that must stay synchronized
- Prefer inline templates for small components
- Prefer Signal Forms (`@angular/forms/signals`) for new forms. They are stable in Angular v22+ and provide signal-based state, type-safe field access, and schema-based validation
- When not using Signal Forms, prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead
- Do NOT import `CommonModule`, import only the directives and pipes the template uses, such as `AsyncPipe` or `DatePipe`
- When using external templates/styles, use paths relative to the component TS file.

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Prefer the `@Service` decorator over `@Injectable({providedIn: 'root'})` for new singleton services (Angular v22+)
- Use the `inject()` function instead of constructor injection

## Angular pitfalls

- In an `effect()`, read every signal before any guard or optional call (`const on = this.spin(); if (r) r.spin = on`). A signal read behind a false guard, or as an argument of `this.r?.f(this.sig())` while `r` is missing, is never tracked and the effect never re-runs (`check:conventions` flags the second form).
- Signals in `effect()` that write other signals are fine in v22, but wrap reads you do not want tracked in `untracked()`.
- Bind sizes with units (`[style.height.px]`); a unit-less `[style.height]` is ignored.
- Emulated encapsulation does not apply a component's CSS to projected content: layout CSS for projected children lives in the component that owns them.

The convention checker applies default-specific rules to the installed workspace version: standalone at v20+, OnPush at v22+. Install locked dependencies before CI checks; an unknown or cross-major uninstalled range cannot establish a default. Other text checks still run. This heuristic does not replace lint, type checking, accessibility or browser tests.


## Project conventions (NERV Agency)

The project is **NERV Agency**. The repository is `https://github.com/voidbrain/nerv`; the default branch is `main`. No hosted deployment is provisioned. Angular project: `nerv`. Backend: Node 24 native TypeScript and SQLite.

### Architecture

- `src/` is plain TypeScript with no framework imports, so it stays unit-testable (enforced by `npm run typecheck` and review). Put logic there and keep components thin.

### Style guide

- Before any UI change (templates, styles, user-facing text) read [docs/STYLE-GUIDE.md](docs/STYLE-GUIDE.md). Follow its voice, tokens, type and spacing; use the `var(--…)` tokens, never a new literal colour.
- A new token or shared component updates the style guide in the same change.

### Adding things

- Add backend operations through validated interfaces and regression tests; add UI surfaces through registered Angular components. Update the owning backlog record and documentation.

### Checks before you finish

Open every PR against `main`, never on another PR's branch (merging it would not reach `main`). Once a PR's CI is green the owner may merge it at any moment: push no new work to it, open a new PR. Exception: a green PR that conflicts with `main` cannot merge, so it may get a push that only resolves the conflict; its checks run again before it can merge. A conflict in `docs/BACKLOG.md` is resolved record by record with `node tools/merge-backlog.mjs`, never by keeping one side's record (that silently drops the other side's edits).

**What the agent does on its own, and what it asks first.**
- On its own: branch from `main`, commit, push its branches, open PRs against `main` (then name the PR by its number in the records it touches, and push that before the checks finish), resolve conflicts on its own PRs, merge its own PR once every check on it has passed and GitHub can merge it (`node tools/merge-when-green.mjs <PR>…` waits for that and stops on any failing check or conflict), delete merged branches, reconcile and close backlog records.
- Asks first: a decision or check a record marks 🧑; repository settings (branch protection, required checks, secrets) and dismissing a code-scanning alert; rewriting published history or force-pushing; deleting what it did not create; a harness change it cannot place as project or template ("Changing a harness file").
- Never: merge with a failing or pending check, or bypass the branch protection. A project narrows this list with a project line.

```bash
npm run check:freshness   # first, at session start: backlog behind main, merged branches, audit age
npm run typecheck
npm test
npm run build
npm run check:integrations
npm run check:backlog     # active record layout and lifecycle cues
npm run check:conventions # stack conventions above and unused exports (when the stack has one)
```

- A failing test is evidence until shown otherwise: check it against the intended behaviour. Change its expectation only when the requirement deliberately changed, and say which requirement; otherwise fix the code.
- Do not leave dead code behind when replacing a feature: its state, helpers and tests go too.

### Code coverage

`docs/agents/coverage.md` shows, per folder, how much of the code the unit tests run (lines, statements, branches, functions) and the files no test runs; `npm run coverage` (or the stack's coverage run, then `node tools/coverage-table.mjs --write`) refreshes it and its baseline. CI prints the current table and warns when a folder drops more than `coverage.drop` points; projects opting into `coverage.enforce` fail the check against the main-branch baseline instead. Coverage says what ran, not that the behaviour is checked: a table to find untested parts, never a number to hit. The committed page and baseline change only in a PR that changes coverage on purpose (code removed, tests added for it) and in audits, never as a side effect of other work: CI prints the live table on every PR anyway, and parallel PRs that each rewrite the page conflict.

### Changing a harness file

Before editing a file listed in `.harness.json` (`copied`, `forked`, `adapted`, or `.harness.json` itself), decide whether the change holds for this project only or for every project. The edit is the trigger, whatever the request's words: an "allow X" that changes how work is done is a rule.
- **This project only**: its content or a setting stays here. A project line inside a section that comes from the template ends with `<!-- project -->`, so a reconcile keeps it; a changed harness rule is an override (APPLY.md, "Project overrides").
- **Every project**: the template first, then reconcile here (APPLY.md, "Changing the harness from a project").
- **Unsure**: ask the user before editing. Never decide silently.

`npm run check:freshness` lists the harness files a branch changes, locally and on every PR.

### What follows a change

Everything derived from something else is a row of the impact map, `impact` in `.harness.json`: generated pages and data, recordings (clips, screenshots, films), translations, guides and tours, docs that describe a feature. A row: `{ "id", "when": [file globs], "then": "what must follow", "run": "command", "checked": "what verifies it", "after": [ids] }`. `after` makes chains: when a row it names must run again, so must this one (a catalogue rebuilt → the examples that use it → their pages).
- Rows are as fine as the code can name things (a recording per step, not "all recordings"), and complete: a derived thing you find without a row gets one in the same PR.
- A row watches what its output is made of, not only code: the data a recording or a generated page loads (an example, a demo file, a fixture) goes in its `inputs`, which set it off like `when`. A setting with a wide reach (a theme colour, a font, a scale) has its own row chained to every output it shows in, art included.
- **Couplings.** A value used in two places (a timing, a colour, an offset, a size) has one source that both read. If it cannot, a test asserts the relation. Either way it is listed in `couplings` (`{ value, places: [{ file, what }], kept }`), and `check:freshness` names the other places when a branch changes one. A value copied by hand is a bug waiting to happen.
- What can change an output with no commit here (library upgrades, the CI browser and machine, external services and data) is listed in `outside` (`{ what, affects, noticed }`) and reviewed by the audit.
- `npm run check:freshness` lists, locally and on every PR, the rows a branch sets off and the order to run them. Do each in the same PR, or record in the backlog why not.
- `node tools/impact-map.mjs` writes the readable page (`docs/agents/impact-map.md`): what must follow a change, content dependencies, value couplings and what lies outside the repository, with links to the project's own detailed maps (`pages`: `{ title, path, about }`). CI keeps it equal to `.harness.json`. A row that nothing checks is a candidate for a check.

### Testing the joins

- A change that touches how two parts meet gets a test across both, not one per side. Unit tests on each part did not catch the bugs that reached users.

### Known pitfalls

- SQLite delivery means local durable inbox delivery, not a phone notification.

## Area notes

Before changing an area, read its section in [docs/agents/areas.md](docs/agents/areas.md): the rules and lessons there are as binding as this file.

| Area | Covers |
|---|---|
| Local core | Persistence, reminders, API, doctor |
| Frontend | Angular surfaces and branding |
| Distributed contracts | Nodes, models, jobs and agents |


## Privacy

- Never commit secrets, tokens or personal data. Test data is neutral and invented.

### Capability assessment

At setup and relevant stack/workflow changes, understand the project and assess existing capabilities and useful gaps. At session start, inspect `.harness.json` for selected integrations and solution context. Existing tools may suffice; assessment does not require installing an integration.

### MCP recommendations

Read [MCP guidance](docs/agents/mcp.md) when configured/relevant. Discover actual host tools before installing duplicates; a recommendation or generated config is not a working connection. Research fresh candidates only when the workflow needs them, following trusted sources and existing authorization. Missing optional connections do not block independent work.

### Solution context

Read available [solution context](docs/agents/solution-profile.md) when configured/relevant; missing coordinator access does not block independent component work. A solution coordinator owns contracts, compatibility and integration acceptance in its own backlog; components own implementation and their independent acceptance. Link records using repository-qualified IDs and derive dashboards from source ledgers without copying editable statuses or averaging completion. A reusable master never waits for downstream adoption. Only the coordinator writes its dashboard; source revisions, unavailable inputs and dirty snapshots remain explicit.

## Work tracking

- Keep single responsibility and dependency inversion across repository boundaries: reusable masters define contracts; derived projects supply their adapters/configuration. A master never depends on derived implementation, deployment or adoption for its release or acceptance. Each backlog owns only its repository’s work; reject foreign next actions and closure conditions (BACKLOG-RULES, Ownership rejection and dependency direction).

**At the start of every session, before other work, run `npm run check:freshness`** and do what it lists, in the session's first PR:
- the backlog is behind `main`: read the CI of the PRs merged since (`npm run ci:status -- <numbers>`) and review any commit it lists without a PR, update or close their records, archive closed ones, move the header to the current `main`;
- merged branches are still on GitHub: delete them (and their local branches and worktrees);
- the scope-aware audit checker reports missing/stale/blocked areas (7 days by default): audit what changed since (docs, tests, style guide, accessibility, privacy, and what the outputs rely on outside the repository: dependency upgrades, the CI browser and machine, external services and data) and write `docs/audits/<date>.md`;
- the harness template has a newer release (`.harness.json` names the one this project is on), or its clone is missing, behind or unreachable: pull it first (`git -C ~/Projects/project-harness pull --ff-only --tags`), reconcile as its `APPLY.md` ("Reconciling") says, then move `version` forward. A copied tool under `tools/` is never edited here unless it is listed under `forked` in `.harness.json`; its settings are there too.

CI prints ordinary freshness findings as warnings; the required maintenance evidence check can fail in 3.0. `ci:status` needs a logged-in `gh`; if unavailable, inspect the same runs/jobs through an authenticated connector/API and name that evidence source. If neither is available, record the missing evidence; never claim the CLI ran.

- [docs/BACKLOG.md](docs/BACKLOG.md) is the source of truth for status; [docs/BACKLOG-RULES.md](docs/BACKLOG-RULES.md) is the procedure (statuses, human-action cues, record layout, CI reconciliation, closure and archives, documentation ownership and the consistency check every PR records). Update the affected records in the same PR as the change, and run `npm run check:backlog`.
- [docs/ROADMAP.md](docs/ROADMAP.md) places every feature that is not closed in exactly one milestone (its Records column); its status table is generated from the records. A PR that opens, closes or changes a feature's status places it and runs `npm run roadmap:status`; `npm run check:roadmap` enforces both in CI. <!-- project -->
- Keep a confirmed bug, a candidate fix awaiting review, an unimplemented feature and a completed check distinct. A merge is not verification, and a passing unit test is not a verified visual, pointer or device fix. A green CI run establishes the checks it named, not the absence of bugs. Archives (`docs/archive/`) and audits (`docs/audits/`) are dated evidence, not current status; current audit coverage is reported per area by check:audits; a scoped report never resets the full-audit baseline.
- A change to a harness file follows "Changing a harness file" above: this project only, every project (the template first), or ask.
- A plan or promise given to the user (steps, a table to build, a later fix) becomes backlog records in the same change, and the reply names them. Nothing promised lives only in the conversation.

### Optional shared skills

When a workflow needs an additional skill, read [skill guidance](docs/agents/skills.md). Discover existing capabilities first; review source, dependencies and project-rule compatibility before use. Shared skills are optional entry points and do not replace project rules or grant installation permissions.

### Maintenance cost and rule consolidation

All applicable rules must be known and followed from the start; shorter indexes never defer requirements. Use [maintenance guidance](docs/agents/maintenance.md) for read-only preview, mandatory timed adoption/reconciliation and input-bound review evidence. Run `node tools/maintenance.mjs check` at session start and in CI; failures require current reviewed outcomes before proceeding. At audits, repeated procedural conflicts or significant workflow changes, consolidate redundant rules with requirement/owner/exception traceability. Never remove a safeguard just because it is old or rarely triggered. Record unresolved findings on their owning outcomes; no automatic expiry or telemetry.

Maintenance findings drive justified rule/tool/skill improvements through tested, owned PRs or an explicit no-change/backlog outcome, never unattended policy rewriting. Daily CI checks freshness between sessions. Coverage is separate from quality: test changed behavior and risky joins, preserve static/security checks, use optional main-baseline non-regression, never demand a percentage increase on every PR.

### Periodic audits and findings

Follow [the audit procedure](docs/agents/audit.md). Produce a dated report and scope manifest with baseline, checked/not-applicable/blocked results, evidence, limits and findings. Full audits cover all eight areas; scope narrow reviews honestly. Separate confirmed bugs, incomplete agreed work, hypotheses, context and value-based improvement proposals. Track actionable unresolved work under owning IDs, preserving uncertainty and authorization. A fresh maintenance receipt or passing CI is not a completed product audit.
