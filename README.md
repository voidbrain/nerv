# NERV Agency

**Your machines, connected.** A local-first proactive personal agent built in TypeScript with an Angular frontend.

## What works today (0.1 foundation)

- **Local core & gate:** CLI and loopback HTTP/WebSocket API (`127.0.0.1:4317`) with SQLite reminders, durable inbox, restart catch-up, Misato step-by-step planning, Casper local intent review, Scrolls gate rules, and Lilith confirmed memory.
- **Models & pilots:** Local S² routes (Ollama/LM Studio), optional Umbilical cloud route (Claude for Misato), Dummy Plug outage detection, specialist pilots, and SQLite token/cost accounting.
- **Channels & UI:** Bilingual (EN/IT) Angular workspace and live NERV dashboard, Aoba Telegram bot, Hyuga daily briefs and proactive watches, and macOS menu-bar companion preview.
- **Multi-base & operations:** Signed Kaji line over Tailscale, remote worker execution, `nerv nodes` discovery/inspection/bootstrap, local Mac lifecycle updates with rehearsal, CycloneDX BOM, and versioned evaluations.
- **Planned & open work:** See [the roadmap](docs/ROADMAP.md) and [the backlog](docs/BACKLOG.md) for upcoming milestones, platform adapters, and open features.

## Quick start

Requires **Node 24+**.

```bash
npm ci
npm run build
npm link            # optional: adds the `nerv` command
npm start -- init --base NERV-01 --name "Neo Tokyo-3"
npm start -- launch # starts service and opens http://127.0.0.1:4317/dashboard/
```

Common commands (`nerv <cmd>` or `npm start -- <cmd>`):

```bash
nerv doctor
nerv remind "Renew car insurance" "2030-01-15T09:00:00+01:00"
nerv chat "What reminders do I have?"
nerv service install   # macOS launchd, Linux systemd --user, Windows Task Scheduler
```

Verification: `npm test`, `npm run typecheck`, `npm run test:headless`, `npm run test:browser` (Chrome/Chromium after build).

## Where things are

| Path | Owns |
|---|---|
| `src/` | Local backend, CLI, persistence, and Kaji network contracts |
| `web/` | Angular workspace, NERV dashboard, and brand marks |
| `test/` | Unit, integration, headless, and browser acceptance tests |
| [docs/README.md](docs/README.md) | Full documentation map and ownership |
| [docs/INSTALL.md](docs/INSTALL.md) | Installation, user services, and topic guides |
| [docs/STYLE-GUIDE.md](docs/STYLE-GUIDE.md) | Brand tokens, accessibility, and UI specifications |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System boundaries, trust, and vocabulary |
| [docs/ROADMAP.md](docs/ROADMAP.md) & [docs/BACKLOG.md](docs/BACKLOG.md) | Milestones, open work, and queue order |

## Contributing

Read [AGENTS.md](AGENTS.md), [area notes](docs/agents/areas.md), [backlog rules](docs/BACKLOG-RULES.md), and [verification mapping](docs/verification.md). Author backlog changes in `docs/work/records/` and `docs/work/tasks/`, then run `npm run work:build` and `npm run check:fast` before pushing.
