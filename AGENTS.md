## Project conventions (NERV Agency)

The project is **NERV Agency**. The repository is `https://github.com/voidbrain/nerv`; the default branch is `main`. No hosted deployment is provisioned. Angular project: `nerv`. Backend: Node 24 native TypeScript and SQLite.

### Architecture

- `src/` is plain TypeScript with no framework imports, so it stays unit-testable (enforced by `npm run typecheck` and review). Put logic there and keep components thin.

### Style guide

- Before any UI change (templates, styles, user-facing text) read [docs/STYLE-GUIDE.md](docs/STYLE-GUIDE.md): its voice, tokens, type and spacing; `var(--…)` tokens, never a new literal colour. A new token or shared component updates it in the same change.

### Adding things

- Add backend operations through validated interfaces and regression tests; add UI surfaces through registered Angular components. Update the owning backlog record and documentation.

### Checks before you finish

Before you open, update or merge a PR, read [pull requests](docs/agents/pull-requests.md).

<!-- safety:start -->
**What the agent does on its own, and what it asks first.** These rules load with this file in every session; the procedures below are read when they apply, never in place of these rules.
- On its own: branch from `main` in a separate `git worktree` (every task, single or parallel: the primary checkout stays on `main` with no edits of its own, because a running service, another session or the owner may rely on it; put worktrees in a sibling directory or under `.claude/worktrees/`; a project names what relies on its primary checkout with a project line), commit, push its branches, open PRs against `main` (then name the PR by its number in the records it touches, and push that before the checks finish), resolve conflicts on its own PRs, land its own PR through the landing queue once every check on it has passed and GitHub can merge it: one lander merges ready PRs one at a time, with at most two in CI ([parallel work](docs/agents/parallel-work.md), "Landing queue"; `node tools/merge-when-green.mjs <PR>…` waits for the checks and stops on any failing check or conflict), delete merged branches and their worktrees, reconcile and close backlog records.
- Asks first: material changes to an adopted upfront feature plan (BACKLOG-RULES, "Optional upfront feature plans"); a decision or check a record marks 🧑; repository settings (branch protection, required checks, secrets) and dismissing a code-scanning alert; rewriting published history or force-pushing; deleting what it did not create; a harness change it cannot place as project or template ("Changing a harness file").
- Never: merge with a failing or pending check, or bypass the branch protection. A project narrows this list with a project line.
- NERV install folder: the live launchd service `io.nerv.agent` runs from `~/.nerv-app` (`src/cli.ts serve`; moved there 2026-11-23 with `nerv service move`). Never switch, edit or `git pull` it; it moves only through the lifecycle update. `~/Projects/NERV/NERV` is a development checkout: keep it on `main`, and create worktrees from `origin/main` after `git fetch`. A lifecycle install already starts and verifies the service. <!-- project -->
- Optional push guard: `node tools/guard.mjs install` makes git refuse a push to `main`, a force-push and an archive rewrite, citing these rules (APPLY.md, "Push guard"; a Claude Code adapter does the same before the command runs). A refused operation the owner approves runs once with `HARNESS_GUARD_ALLOW=<rule>`; never set it without that approval.
- Never remove a safeguard (an ownership, evidence, privacy or safety rule) because it is old or rarely triggered, and never rewrite governing rules unattended: consolidating rules keeps every requirement ([rule review](docs/agents/rule-review.md), "Periodic rule consolidation").
<!-- safety:end -->


```bash
npm run check:freshness   # first, at session start: backlog behind main, merged branches, audit age
npm run typecheck
npm test
npm run build
npm run check:integrations
npm run check:backlog     # active record layout and lifecycle cues
npm run check:conventions # stack conventions (docs/agents/<stack>.md) and unused exports (when the stack has one)
npm run format:check      # Prettier on src/, test/ and web/src TypeScript and JavaScript; `npm run format` fixes it <!-- project -->
npm run lint              # ESLint with TypeScript rules: backend, tests, NERV's own tools, web/src <!-- project -->
npm run check:tooling     # a formatter check and a linter exist and run in CI (required for every stack)
npm run check:fast        # single pre-push bundle: format, lint, typecheck, backlog/roadmap/rules/maintenance <!-- project -->
npm run code:map -- <path> # exports with line ranges: read those lines, not the whole file
```

- Format and lint in CI too (`check:tooling`; a project with no source code records `tooling.exempt` with its reason).
- A failing test is evidence until shown otherwise: change its expectation only when the requirement deliberately changed, and say which; otherwise fix the code.
- A bug fix starts with a committed test that fails without the fix; the fix never edits that test to pass (BACKLOG-RULES, "A bug fix starts with a failing test").
- Replacing a feature removes its state, helpers and tests too: no dead code.

### Changing a harness file

Before editing a file listed in `.harness.json` (`copied`, `forked`, `adapted`, or `.harness.json` itself), decide: this project only, or every project. The edit is the trigger, whatever the request's words: an "allow X" that changes how work is done is a rule.
- **This project only**: content or a setting stays here; a project line in a template section ends with `<!-- project -->`; a changed harness rule is an override (APPLY.md, "Project overrides").
- **Every project**: the template first, then reconcile here (APPLY.md, "Changing the harness from a project").
- **Unsure**: ask the user before editing. Never decide silently. (`check:freshness` lists the harness files a branch changes.)

### Procedures: read before the task

Each procedure is binding when its trigger applies: read it before the task; a short index never defers a requirement. All of them: [procedure index](docs/agents/procedures.md). `npm run check:rules` fails when a never or ask-first rule lives only in a procedure.

| Before you | Read |
|---|---|
| start a session | [session start](docs/agents/session-start.md) |
| open, update or merge a PR | [pull requests](docs/agents/pull-requests.md) |
| change Angular code (`web/`) | [Angular rules](docs/agents/angular.md) |
| update or close a backlog record | [backlog rules](docs/BACKLOG-RULES.md) (it names the one file a change needs) |
| write or change documentation | [documentation](docs/backlog/documentation.md) |
| change something an output is derived from (generated pages and data, recordings, translations, guides, a value used in two places) | [change impact](docs/agents/change-impact.md); do each row `check:freshness` lists, or record why not |
| change tests or coverage | [coverage guide](docs/agents/coverage-guide.md) |
| switch tasks or hand off context | [task context](docs/agents/task-context.md) |
| work in parallel: claimed tasks, branches, model assignments | [parallel work](docs/agents/parallel-work.md) (claims inside) |
| start, change the phase of or finish a job, when `workUsage.enabled` | [job usage](docs/agents/work-usage.md) (sources, launch, effectiveness inside) |
| reassess architecture or decisions | [architecture review](docs/agents/architecture-review.md) |
| set up the project or change its stack or workflow (capability assessment) | [MCP guidance](docs/agents/mcp.md), "In short" |
| add, configure or rely on an MCP connection, or edit MCP selections | [MCP guidance](docs/agents/mcp.md) (commands inside) |
| work across repositories of a solution | [solution profile](docs/agents/solution-profile.md) (refresh inside) |
| add or use a shared skill | [skills](docs/agents/skills.md) |
| adopt or reconcile the harness, or review maintenance evidence | [maintenance](docs/agents/maintenance.md) |
| change AGENTS.md, CLAUDE.md, BACKLOG-RULES or `docs/backlog/`; measure friction; consolidate rules | [rule review](docs/agents/rule-review.md) (agent-behaviour checks when a runner is set) |
| run an audit, or record its findings or an improvement proposal | [audit](docs/agents/audit.md) ([findings](docs/agents/audit-findings.md)) |

### Testing the joins

- A change that touches how two parts meet gets a test across both, not one per side. Unit tests on each part did not catch the bugs that reached users.

### Known pitfalls

- SQLite delivery means local durable inbox delivery, not a phone notification.

## Area notes

Before changing an area, read its section in [docs/agents/areas.md](docs/agents/areas.md) (**Local core**, **Frontend**, **Distributed contracts**): the rules and lessons there are as binding as this file.

## Privacy

- Never commit secrets, tokens or personal data. Test data is neutral and invented.

## Work tracking

**At the start of every session, before other work, run `npm run check:freshness`** and do what it lists, as [session start](docs/agents/session-start.md) says.

- This backlog owns only this repository's work: reject foreign next actions and closure conditions; a master never waits on what derives from it (BACKLOG-RULES, "One repository, one backlog").
- Keep a confirmed bug, a candidate fix, an unimplemented feature and a completed check distinct: a merge is not verification, a unit test is not a visual, pointer or device check, a green CI run proves only the checks it ran. Archives and audits are dated evidence, not current status.
- A plan or promise given to the user (steps, a table to build, a later fix) becomes backlog records in the same change, and the reply names them. Nothing promised lives only in the conversation.
