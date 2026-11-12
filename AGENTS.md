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

Open every PR against `main`, never on another PR's branch (merging it would not reach `main`). Once a PR's CI is green the owner may merge it at any moment: push no new work to it, open a new PR. Exception: a green PR that conflicts with `main` cannot merge, so it may get a push that only resolves the conflict; its checks run again before it can merge. For generated backlog conflicts, resolve per-record sources/layout preserving both sides, then regenerate all affected views; use `node tools/merge-backlog.mjs` for a non-adopted ledger. Never keep one side and silently drop the other side's edits.

<!-- safety:start -->
**What the agent does on its own, and what it asks first.**
- On its own: branch from `main` in a separate `git worktree` (every task, single or parallel: the primary checkout stays on `main` with no edits of its own, because a running service, another session or the owner may rely on it; put worktrees in a sibling directory or under `.claude/worktrees/`; a project names what relies on its primary checkout with a project line), commit, push its branches, open PRs against `main` (then name the PR by its number in the records it touches, and push that before the checks finish), resolve conflicts on its own PRs, merge its own PR once every check on it has passed and GitHub can merge it (`node tools/merge-when-green.mjs <PR>…` waits for that and stops on any failing check or conflict), delete merged branches and their worktrees, reconcile and close backlog records.
- Asks first: material changes to an adopted upfront feature plan (BACKLOG-RULES, "Optional upfront feature plans"); a decision or check a record marks 🧑; repository settings (branch protection, required checks, secrets) and dismissing a code-scanning alert; rewriting published history or force-pushing; deleting what it did not create; a harness change it cannot place as project or template ("Changing a harness file").
- Never: merge with a failing or pending check, or bypass the branch protection. A project narrows this list with a project line.
- NERV primary checkout: `~/Projects/NERV/NERV` is the source the live launchd service `io.nerv.agent` runs (`src/cli.ts serve`). Never switch, edit or `git pull` it; it moves only through the `nodes lifecycle-*` update flow. Create worktrees from `origin/main` after `git fetch`. <!-- project -->
- Never remove a safeguard (an ownership, evidence, privacy or safety rule) because it is old or rarely triggered, and never rewrite governing rules unattended: consolidating rules keeps every requirement ([maintenance guidance](docs/agents/maintenance.md)).
<!-- safety:end -->

NERV has scoped verification enabled. Follow [verification selection](docs/agents/verification.md) and the [NERV check mapping](docs/verification.md): run freshness and applicable fast checks, then affected regressions. The commands below are the available check catalogue, not a requirement to repeat every suite locally on every edit. Full deterministic checks run on request, risk, unmapped changes or stale/missing full evidence; required CI validates the final revision. Stress and real-model campaigns have separate triggers/budgets. <!-- project -->

```bash
npm run check:freshness   # first, at session start: backlog behind main, merged branches, audit age
npm run typecheck
npm test
npm run build
npm run check:integrations
npm run check:backlog     # active record layout and lifecycle cues
npm run check:conventions # stack conventions above and unused exports (when the stack has one)
npm run format:check      # Prettier on src/, test/ and web/src TypeScript and JavaScript; `npm run format` fixes it <!-- project -->
npm run lint              # ESLint with TypeScript rules: backend, tests, NERV's own tools, web/src <!-- project -->
npm run check:tooling     # a formatter check and a linter exist and run in CI (required for every stack)
npm run check:fast        # single pre-push bundle: format, lint, typecheck, backlog/roadmap/rules/maintenance <!-- project -->
```

- Every project formats and lints its source, in CI too: `check:tooling` fails without both. A project with no source code records `tooling.exempt` with its reason in `.harness.json`.
- A failing test is evidence until shown otherwise: check it against the intended behaviour. Change its expectation only when the requirement deliberately changed, and say which requirement; otherwise fix the code.
- Do not leave dead code behind when replacing a feature: its state, helpers and tests go too.
- A bug fix starts with a committed test that fails without the fix; the fix never edits that test to pass (BACKLOG-RULES, "A bug fix starts with a failing test").
- A PR that closes a P1 record or changes a harness file gets a review in a fresh context before it merges, with the exemptions listed there; the reviewer reports, never approves or merges (BACKLOG-RULES, "Independent review"). Pass the reviewer `git diff origin/main...HEAD` and the changed file list rather than asking it to rediscover the diff. <!-- project -->

### Changing a harness file

Before editing a file listed in `.harness.json` (`copied`, `forked`, `adapted`, or `.harness.json` itself), decide whether the change holds for this project only or for every project. The edit is the trigger, whatever the request's words: an "allow X" that changes how work is done is a rule.
- **This project only**: its content or a setting stays here. A project line inside a section that comes from the template ends with `<!-- project -->`, so a reconcile keeps it; a changed harness rule is an override (APPLY.md, "Project overrides").
- **Every project**: the template first, then reconcile here (APPLY.md, "Changing the harness from a project").
- **Unsure**: ask the user before editing. Never decide silently.

`npm run check:freshness` lists the harness files a branch changes, locally and on every PR.

### Procedures: read before the task

All applicable rules must be known and followed from the start; shorter indexes never defer requirements. The [procedure discovery index](docs/agents/procedures.md) links authorities and expected evidence. Each procedure below is binding when its trigger applies: read it before starting that task. `npm run check:rules` fails when a never or ask-first rule lives only in a procedure.

| Before you | Read |
|---|---|
| switch independent tasks or compact/handoff context | [Task context](docs/agents/task-context.md) |
| work on claimed tasks, parallel branches or model assignments | [Parallel work](docs/agents/parallel-work.md) |
| reassess architecture, decisions or alternatives | [Architecture reassessment](docs/agents/architecture-review.md) |
| change tests, coverage settings or the coverage page | [coverage guide](docs/agents/coverage-guide.md) |
| change something another output is derived from (generated pages and data, recordings, translations, guides, a value used in two places) | [change impact](docs/agents/change-impact.md); `check:freshness` lists the rows a branch sets off: do each in the same PR, or record in the backlog why not |
| set up the project or change its stack or workflow (capability assessment) | [MCP guidance](docs/agents/mcp.md), "In short" |
| add, configure or rely on an MCP connection | [MCP guidance](docs/agents/mcp.md) |
| work across repositories of a solution | [solution profile](docs/agents/solution-profile.md) |
| add or use a shared skill | [skill guidance](docs/agents/skills.md) |
| adopt or reconcile the harness, review maintenance evidence or consolidate rules (`node tools/maintenance.mjs check` runs at session start and in CI) | [maintenance guidance](docs/agents/maintenance.md) |
| change AGENTS.md, CLAUDE.md or BACKLOG-RULES (rerun the agent-behaviour checks when a runner is configured) | [maintenance guidance](docs/agents/maintenance.md), "Agent-behaviour checks" |
| run an audit (`check:freshness` says when) | [audit procedure](docs/agents/audit.md) |
| update or close a backlog record | [backlog rules](docs/BACKLOG-RULES.md) |

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

### Task context

At a new independent task, follow [task context and handoffs](docs/agents/task-context.md): persist the current scope and use a fresh thread through an available authorized host capability; keep the same task's debugging/review/CI together. Compaction is for a continuing task, and provider caching is a separate capability. Preserve work, claims, approvals, uncertain effects and all governing/privacy/permission limits across transitions. If thread/compaction tools are unavailable, report that limit briefly and continue with bounded relevant context rather than claiming a reset or blocking otherwise authorized work.

## Work tracking

- Keep single responsibility and dependency inversion across repository boundaries: reusable masters define contracts; derived projects supply their adapters/configuration. A master never depends on derived implementation, deployment or adoption for its release or acceptance. Each backlog owns only its repository’s work; reject foreign next actions and closure conditions (BACKLOG-RULES, Ownership rejection and dependency direction).

**At the start of every session, before other work, run `npm run check:freshness`**, inspect `.harness.json` for selected integrations and solution context ([MCP guidance](docs/agents/mcp.md), [solution profile](docs/agents/solution-profile.md)), and do what it lists (in the session's first PR, except the backlog, which has its own rule below):
- the backlog is behind `main`: read the CI of the PRs merged since (`npm run ci:status -- <numbers>`) and review any commit it lists without a PR, update or close their records, archive closed ones, move the header to the current `main`. Do this inside the session's working PR. A PR whose only purpose is reconciliation is opened only when the check marks it due (`!`): 10 merged PRs or one day behind by default (`freshness.backlogPRs`, `freshness.backlogDays`), a commit that reached `main` without a PR, or a session with no other PR;
- merged branches are still on GitHub: delete them (and their local branches and worktrees);
- the scope-aware audit checker reports missing/stale/blocked areas (7 days by default): audit what changed since (docs, tests, style guide, accessibility, privacy, and what the outputs rely on outside the repository: dependency upgrades, the CI browser and machine, external services and data) and write `docs/audits/<date>.md`;
- a declared evaluation dependency (`.harness.json` `evaluations`) reports pending cases: keep an open backlog record naming them until a run covers them; real-model runs need the owner's approval (BACKLOG-RULES, "Evaluation dependencies");
- the harness template has a newer release (`.harness.json` names the one this project is on), or its clone is missing, behind or unreachable: pull it first (`git -C ~/Projects/project-harness pull --ff-only --tags`), reconcile as its `APPLY.md` ("Reconciling") says, then move `version` forward. A copied tool under `tools/` is never edited here unless it is listed under `forked` in `.harness.json`; its settings are there too.

CI prints ordinary freshness findings as warnings; the required maintenance evidence check can fail in 3.0. `ci:status` needs a logged-in `gh`; if unavailable, inspect the same runs/jobs through an authenticated connector/API and name that evidence source. If neither is available, record the missing evidence; never claim the CLI ran.

- [docs/BACKLOG.md](docs/BACKLOG.md) is the generated current-status ledger; authoritative per-record sources live in `docs/work/records/` and layout in `docs/work/layout.json` (see [parallel work](docs/agents/parallel-work.md)); [docs/BACKLOG-RULES.md](docs/BACKLOG-RULES.md) is the procedure (statuses, human-action cues, record layout, CI reconciliation, closure and archives, documentation ownership and the consistency check every PR records). Update the affected records in the same PR as the change, and run `npm run check:backlog`. Prefer reading `docs/work/records/<ID>.md` and `docs/work/tasks/<ID>-T*.json` over loading `docs/BACKLOG.md`, and keep new `effort.basis` entries to 1–2 sentences. <!-- project -->
- [docs/ROADMAP.md](docs/ROADMAP.md) places every feature that is not closed in exactly one milestone (its Records column); its status table is generated from the records. A PR that opens, closes or changes a feature's status places it and runs `npm run roadmap:status`; `npm run check:roadmap` enforces both in CI. <!-- project -->
- Keep a confirmed bug, a candidate fix awaiting review, an unimplemented feature and a completed check distinct. A merge is not verification, and a passing unit test is not a verified visual, pointer or device fix. A green CI run establishes the checks it named, not the absence of bugs. Archives (`docs/archive/`) and audits (`docs/audits/`) are dated evidence, not current status; current audit coverage is reported per area by check:audits; a scoped report never resets the full-audit baseline.
- A change to a harness file follows "Changing a harness file" above: this project only, every project (the template first), or ask.
- A plan or promise given to the user (steps, a table to build, a later fix) becomes backlog records in the same change, and the reply names them. Nothing promised lives only in the conversation.

### Development usage (optional)

When `.harness.json` enables `workUsage.enabled`, follow [job usage](docs/agents/work-usage.md) at each job start, phase change and completion. Record actual client/model and backlog/task identity, import authorized metadata counters when exposed, and retain unknown coverage otherwise. Keep token metadata private and separate from prompts, credentials and conversation text. A model/client assignment need not be declared by the owner before launch unless task suitability requires it; instruction loading and measured usage availability still require verification.
