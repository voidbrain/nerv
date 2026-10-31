# Nodo

**Your machines, connected.** A local-first proactive personal agent, built in TypeScript with an Angular frontend. The name evokes nodes and connections; its mark is a small monochrome pixel marine knot.

## Current build: 0.1 foundation

Working: CLI; SQLite reminders and durable local inbox; cancellation; restart catch-up; duplicate delivery prevention; authenticated loopback API; local doctor; Angular reminder and diagnostics workspace.

Not implemented yet: conversational agents, Claude/Ollama execution, Telegram/WhatsApp, phone delivery, recurring schedules, GenUI generation, device discovery/bootstrap, remote workers, PWA installation/offline behaviour, voice, coding agents or skill learning. Their contracts and acceptance criteria are in [the roadmap](docs/ROADMAP.md) and [backlog](docs/BACKLOG.md). No device is controlled by this build.

## Run it

Requires Node **24+**. Node SQLite is built in; its API may still emit an experimental warning on supported releases.

```bash
npm ci
npm test
npm run typecheck
npm run build
npm start -- doctor
npm start -- remind "Renew car insurance" "2030-01-15T09:00:00+01:00"
npm start -- list
npm start -- tick
npm start -- inbox
```

Use your actual future deadline. CLI timestamps require an explicit UTC offset. `tick` catches overdue reminders and atomically writes their local inbox entries. `serve` runs the scheduler each second; reminders catch up after downtime. Nothing runs while the process is stopped. Data defaults to `.nodo/nodo.sqlite`; set `NODO_HOME` to a private durable directory. Back up with the process stopped, retaining SQLite sidecar files if present. Do not share the data directory.

Start backend and frontend in separate terminals:

```bash
# Terminal 1: token is an example command that generates a fresh secret.
export NODO_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
npm start -- serve
# Copy the token locally into the frontend, without sharing or committing it.

# Terminal 2
npm run dev
```

Open the Angular development-server URL (normally http://localhost:4200). The dev proxy forwards `/api` to the loopback backend at port 4317. Enter the same token. Set `NODO_PORT` only if you also update the dev proxy. The token stays in tab memory; reload requires it again. `dist/web/browser` is the production frontend build; a production same-origin server, TLS and remote access configuration are not included. Do not expose this development setup publicly.

API: authenticated `GET /api/doctor`, `GET/POST /api/reminders`, `DELETE /api/reminders/:id`, `GET /api/inbox`. Bearer token required for every endpoint. No CORS access is enabled.

## Where things are

| Path | Owns |
|---|---|
| `src/` | Local backend, CLI, persistence and proposed distributed contracts |
| `web/` | Angular workspace and knot identity |
| `test/` | Restart, cancellation, idempotency and API regression tests |
| `docs/ARCHITECTURE.md` | Boundaries, trust and future orchestration |
| `docs/ROADMAP.md` | Sequenced delivery and acceptance |
| `docs/BACKLOG.md` | Current work and gaps |
| `docs/audits/` | Dated evidence and limits |

## Working on it

Read [AGENTS.md](AGENTS.md), [area notes](docs/agents/areas.md), [style guide](docs/STYLE-GUIDE.md) and [backlog rules](docs/BACKLOG-RULES.md). Harness adopted from published v3.1.1. No dedicated Node profile exists upstream; see F-001. The local adoption is a starting baseline, not proof of live device acceptance or a complete personal assistant.
