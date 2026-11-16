# F-101-T01: Sharing the FPV Battery Manager Outside NERV

**Status:** Recommendation for owner decision (`F-101`). Pairs with `project-harness` `F-075` (self-contained skills for Agensi).

## Goal

Let friends and other FPV pilots use the battery manager (`src/batteries.ts`, `src/battery-storage-reminders.ts`)—including pilots using Claude on mobile/web, Claude Code / Agensi, or local MCP hosts—without duplicating domain logic or mixing owner fleet data.

## Core-Once Principle

Keep the battery domain logic (`BatteryStore`, `BATTERIES_SCHEMA`, resistance tracking, storage reminders, bilingual formatting) in a **single shared core**:
- Either an extractable workspace/package (`@nerv/fpv-batteries` or `packages/fpv-batteries/`) with zero NERV runtime dependencies (only `node:sqlite` / SQL schema + pure state logic),
- Wrapped by thin adapters for each distribution shape.

## Comparison of Distribution Shapes

| Dimension | 1. Self-contained Claude / Agensi Skill | 2. Standalone Package / Repo + CLI | 3. MCP Server (`stdio` / Hosted) |
|---|---|---|---|
| **Who it reaches** | **Broadest**: Claude web & mobile (phone app via uploaded/shared skill), Claude Code, Agensi marketplace/plugins | Developers & CLI users (`npx fpv-batteries` / `npm i -g`); no direct phone chat reach without a wrapper | Desktop/IDE AI clients (Claude Desktop, Cursor, Antigravity) via `stdio`; phone reach requires hosting a remote HTTPS MCP endpoint |
| **Where each pilot's data lives** | On-device / per-pilot: local SQLite via CLI/script when running locally (Agensi/Claude Code), or conversation/artifact state (JSON/Markdown attachment) on Claude phone app | Strictly local on each pilot's machine (`~/.fpv-batteries/batteries.sqlite` or `$XDG_DATA_HOME`); zero shared server | `stdio`: local SQLite per pilot. Remote MCP: requires hosted multi-tenant DB + auth (privacy/ops liability) |
| **Maintenance & ops cost** | **Low**: Markdown `SKILL.md` + optional bundled helper script calling the core package; versioned alongside `F-075` | **Low–Medium**: npm publish + semver releases; zero hosting cost | **Low** (`stdio` local wrapper) / **High** (remote multi-tenant server: auth, backups, uptime, GDPR/privacy) |
| **Interaction UX** | Natural-language logging & status checks in chat; no custom UI card on phone unless client supports artifacts | Explicit CLI subcommands; easily wrapped by skills or desktop apps | Structured tool calls (`batteries.log`, `batteries.list`, `batteries.resistance`) with deterministic schemas |
| **Fit with NERV** | NERV stays the owner's private runtime; skill does not depend on NERV daemon | NERV imports or vendors the same core module | MCP server wraps the core module; NERV can consume or expose it |

## Recommendation

1. **Single Core Package (`packages/fpv-batteries` or standalone `fpv-batteries` repo):** Extract pure battery schema, state machine, resistance trend checks, and storage-schedule rules so NERV and external adapters share one tested implementation.
2. **Primary External Shape — Self-Contained Skill (paired with `project-harness` `F-075`):** Ship a self-contained skill (`SKILL.md` + lightweight CLI/script backed by the core) for Agensi and Claude (including Claude on mobile/phone via portable Markdown/JSON state fallback when no local shell/SQLite is present).
3. **Secondary Shape — Local `stdio` MCP Wrapper:** Expose the same core over `stdio` MCP for pilots using desktop agents, without operating a hosted multi-tenant server.
4. **Defer Hosted Remote MCP:** Avoid hosting a central server for other pilots' battery data unless a future multi-user product is explicitly desired, as it introduces auth, hosting cost, and data-stewardship obligations.

## Open Decision for Owner

Confirm whether to:
- (A) Keep the core inside NERV (`src/batteries.ts`) and export a standalone `fpv-batteries` npm package + `SKILL.md` (Recommended), or
- (B) Split `fpv-batteries` into its own repository immediately.
