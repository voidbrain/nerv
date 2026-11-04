# NERV Agency

**Your machines, connected.** A local-first proactive personal agent, built in TypeScript with an Angular frontend. Its mark is an original inverted triangle with seven eyes, paired with a half leaf in the web sidebar.

## Current build: 0.1 foundation

Working: CLI; SQLite reminders and durable local inbox; cancellation; restart catch-up; duplicate delivery prevention; authenticated loopback API; local doctor; bilingual Angular workspace; one supervised service with isolated scheduler/execution processes and production UI serving; user-service installation commands; bounded local JSON-RPC reads and a registered Web Component status card; pinned native HTTPS pairing and revocable read-only clients.

Model routes exist without an agent: `ask "text"` sends one prompt to a local OpenAI-compatible model (S², e.g. Ollama or LM Studio) and `ask --cloud "text"` to Claude (Umbilical) when enabled; see [model routes](docs/INSTALL.md#model-routes). Not implemented yet: conversational agents (the Misato loop), Telegram/WhatsApp, phone delivery, recurring schedules, model-driven GenUI generation, device discovery/bootstrap, remote workers, PWA installation/offline behaviour, voice, coding agents, skill learning or any agent using the per-action gate. The gate itself exists without an agent: a deterministic ballot, single-use grants, approvals with expiry and an append-only event ledger (CLI `approvals`, `approve`, `reject`, `events`, `spear`; `GET /api/approvals`, `POST /api/approvals/ID`, `GET /api/sorties/ID/events`); names follow the [NERV architecture](docs/NERV/NERV-ARCHITECTURE.md). Their contracts and acceptance criteria are in [the roadmap](docs/ROADMAP.md) and [backlog](docs/BACKLOG.md). No device is controlled by this build. A native SwiftUI menu-bar development preview with notifications, user-service controls and login selection is included; Electron is not required. See [native setup and limits](native/README.md).

## Run it

Requires Node **24+**. English is the default interface language; Italian is selectable. CLI commands remain English. NERV Agency does not yet understand conversational Italian or English.

```bash
npm ci
npm run build
npm start -- init
npm start -- serve
```

Open **http://127.0.0.1:4317** and enter the token from `~/.nerv/token`. This one service supervises the built UI/API gateway, an isolated scheduler/database process and an execution-process boundary. To run without keeping Terminal open, stop the foreground process and run `npm start -- service install`. Supports macOS launchd and Linux systemd **user** services. See [installation, updates, data migration and service controls](docs/INSTALL.md).

For frontend development only, `npm run dev` uses **4318**, with its API proxy targeting 4317. Port 4200 is not used.

```bash
npm start -- doctor
npm start -- remind "Rinnovare assicurazione auto" "2030-01-15T09:00:00+01:00"
npm start -- list
npm start -- tick
npm start -- inbox
npm test
npm run typecheck
npm run test:headless
```

Use your actual future deadline. CLI timestamps require an explicit UTC offset. User data now defaults to `~/.nerv` (override with an absolute `NERV_HOME`). Legacy checkout-local databases trigger migration guidance rather than being silently ignored. `init` preserves existing files; token/configuration files are private. Reminders enter the local inbox while running, or catch up after restart. Sleep or logout can pause user services; use an awake always-on host for dependable scheduling.

All `/api` routes require a bearer token (except the native TLS claim route, which requires a private single-use invitation). Lightweight `/api/status` is used for background health; explicit `/api/doctor` retains integrity diagnostics. Native clients can also use authenticated, read-only JSON-RPC 2.0 WebSockets at `/rpc`; browser ticket pairing and remote execution are not implemented. Static UI files are public on loopback and contain no credentials. No permissive CORS or public-network binding is enabled. Doctor covers local configuration/runtime/database; remote/device probes remain planned.

## Where things are

| Path | Owns |
|---|---|
| `src/` | Local backend, CLI, persistence and proposed distributed contracts |
| `web/` | Angular workspace and brand marks |
| `test/` | Restart, cancellation, idempotency and API regression tests |
| `docs/INSTALL.md` | Headless installation, service lifecycle and data migration |
| `docs/decisions/runtime-boundaries.md` | Reviewed process, RPC, Web Component and native-pairing decisions |
| `docs/ARCHITECTURE.md` | Boundaries, trust and future orchestration |
| `docs/ROADMAP.md` | Sequenced delivery and acceptance |
| `docs/BACKLOG.md` | Current work and gaps |
| `docs/audits/` | Dated evidence and limits |

## Working on it

Read [AGENTS.md](AGENTS.md), [area notes](docs/agents/areas.md), [style guide](docs/STYLE-GUIDE.md) and [backlog rules](docs/BACKLOG-RULES.md). Harness adopted from published v3.1.1. No dedicated Node profile exists upstream; see F-001. The local adoption is a starting baseline, not proof of live device acceptance or a complete personal assistant.
