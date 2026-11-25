# Shared skills

Skills are optional workflow entry points. AGENTS.md owns project rules; APPLY.md owns harness adoption and release procedure. A skill must link those authorities rather than restate them or override existing authorization. A reusable master never relies on a derived project to supply missing instructions.

## In short

Moved from AGENTS.md in 3.3.0, unchanged in substance; AGENTS keeps the trigger.

When a workflow needs an additional skill, read this guidance. Discover existing capabilities first; review source, dependencies and project-rule compatibility before use. Shared skills are optional entry points and do not replace project rules or grant installation permissions.

Moved to [skill discovery](skills-discovery.md): "Discover additional skills" (with the OWASP AST10 checklist). Read it before you search for, recommend or run a skill the project does not already have.

## Locate and share

The harness publishes `skills/apply-harness/SKILL.md` in its repository. Locate it in the template checkout named by `.harness.json`, or read it from the selected verified template revision through GitHub. It is not copied into every consumer by default. Agents without skill discovery can read that file explicitly and follow the linked procedure.

Install or register it only when needed for the actual client. Check that client's current documented discovery locations and supported fields; a committed SKILL.md does not prove automatic discovery by every agent. Prefer one canonical directory with a client-supported reference or link. If the client requires a copy, record its upstream repository/path/revision and compare it on update. Review existing personal/project skills with the same name before enabling another; do not delete or overwrite them silently. This repository does not edit personal installations.

The folder format is portable where Agent Skills is supported. Runtime dependencies, scripts, MCPs, permissions, credentials and client-specific extensions are separate requirements. Offline use requires local files and dependencies; harness application/reconciliation still follows APPLY.md's online-first policy.

## Package and publish standalone skills

Standalone skills under `skills/<name>/` (excluding `metadata.distribution: repo-only` skills such as `apply-harness`) are packaged into `dist/skills/<name>-<version>.zip` with `npm run skills:package`. Each archive places `SKILL.md`, `LICENSE`, and the skill's own bundled files at the zip root without external repository links or `.harness.json` dependencies. Publishing and updating external marketplace listings (such as Agensi) is a manual upload of the generated zip.

`npm run check:skills` checks every skill against the release it ships in: a standalone skill must be self-contained, carry its own `metadata.version` and name only npm scripts `package.json` defines; a repo-only skill must name only scripts, files and links that exist. Examples for the consumer belong under the skill's `templates/`, which is not checked. Before a release, `npm run skills:affected` (since the last tag, or `-- <tag>`) lists the skills that name a changed file, to re-read, and the standalone skills whose own files changed, to package and upload again (it warns when such a skill's `metadata.version` is unchanged since the tag); the release entry names both.

## Skill discovery review

Projects opt in via `reviews.skills.days` in `.harness.json` so `npm run check:freshness` warns when `docs/reviews/skills/<YYYY-MM-DD>.md` is missing or stale. Each project owns its own skills; the harness owns only its own skills and this review procedure.

Review these sources:
- Repeated agent or owner work across recent tasks
- Friction notes and recurring copy-paste owner checks
- Domain operations with clear inputs and outputs
- Long procedures re-read in every session
- Existing skills whose instructions have drifted behind their code

Record the dated report at `docs/reviews/skills/<YYYY-MM-DD>.md` and log every candidate outcome in the project's own backlog as one of:
1. **Project skill**: add or update under `skills/<name>/`
2. **Distributable skill**: self-contained skill under `skills/<name>/` (packaged via `npm run skills:package` when applicable)
3. **Harness proposal**: generic workflow proposed to the harness through "Changing the harness from a project"
4. **Not a skill**: decline with its reason
