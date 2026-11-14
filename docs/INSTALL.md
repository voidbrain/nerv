# Installation and Service Setup

## Quick local setup

Requires **Node 24+**. Keep the checkout at a stable absolute path:

```bash
npm ci
npm run build
npm link            # optional: adds `nerv` (otherwise use `npm start -- …`)
npm start -- init --base NERV-01 --name "Neo Tokyo-3"
npm start -- doctor
npm start -- launch # starts service and opens the signed-in dashboard
```

- `serve` supervises three processes on loopback (`127.0.0.1:4317`): the API/UI gateway, an isolated SQLite/scheduler process, and an execution boundary. Stop the foreground process (`Ctrl-C`) before installing a background service.
- User data defaults to `~/.nerv` (`%USERPROFILE%\.nerv` on Windows; override with an absolute `NERV_HOME`). Private credentials (`token`, `anthropic-key`, `telegram-token`, `scrolls.json`) stay local and are never pasted into chat or the repo.
- Rotate a live credential with `nerv credentials rotate admin|telegram|cloud`. Secret input is hidden, old file-backed credentials stop authenticating immediately, and `doctor` reports credential ages without values.
- Defaults: port `4317`, language `en`, `timeZone` `Europe/Rome`. Edit `config.json` and restart to change them.

## User services (no open terminal)

```bash
nerv service install   # install and start user service
nerv service status    # check running state
nerv service stop      # stop cleanly
nerv service start     # start again
nerv service uninstall # remove service definition (keeps data)
```

| Platform | Manager & Unit | Logs & Notes |
|---|---|---|
| **macOS** | `launchd` (`~/Library/LaunchAgents/io.nerv.agent.plist`) | `NERV_HOME/service.log`, `service-error.log`. Runs in GUI login session; pauses during sleep. |
| **Linux** | `systemd --user` (`~/.config/systemd/user/nerv.service`) | `journalctl --user -u nerv.service`. Requires user systemd session; enable linger deliberately if needed. |
| **Windows 11** | Task Scheduler (`NERV Agency`) | `NERV_HOME/service.log`, `service-error.log`. Keep data home private to your Windows account; run `git config core.autocrlf false` if needed. |

## Updating, migration, and troubleshooting

- **Updating:** Stop the service, pull, run `npm ci && npm run build`, then start again. Uninstall/reinstall the service if Node or checkout paths change. (For the managed Mac default profile, use the fenced `nerv nodes lifecycle-inspect` / `lifecycle-apply` flow in [Kaji & Nodes](guides/kaji-and-nodes.md#service-lifecycle-and-local-mac-updates); never `git pull` a running managed service checkout.)
- **Legacy 0.1 / Nodo data:** Existing `~/.nodo` directories and `NODO_*` env vars remain supported; `service install` replaces older `io.nodo.agent` / `nodo.service` units. Legacy checkout-local `.nodo` databases trigger migration guidance rather than silent overwrite.
- **Database upgrades:** Schema upgrades are one-way; back up `nerv.sqlite` before updating if you may roll back.
- **Frontend dev (`4318`) & Native companion (`4319`):** `npm run dev` proxies API calls to `4317` for Angular work; `npm run test:browser` runs Chrome/axe checks after build. For the macOS SwiftUI menu-bar preview, see [native/README.md](../native/README.md).

## Topic guides

| Guide | Covers |
|---|---|
| [Models and Pilots](guides/models-and-pilots.md) | S² (Ollama/LM Studio), Umbilical (Claude), API keys, Dummy Plug outage handling, specialist pilots |
| [Memory, Chat, Tools, and Gate Rules](guides/memory-and-chat.md) | Misato chat, Lilith memory & Instrumentality, MCP tools, Scrolls gate rules, CycloneDX BOM |
| [Channels, Dashboard, and Proactive Watches](guides/channels-and-watches.md) | Dashboard shortcuts & Battery, Telegram (Aoba), daily briefs, chronicle, Hyuga watches |
| [Kaji Line, Remote Workers, and Node Setup](guides/kaji-and-nodes.md) | Base enrollment, Tailscale live link, remote actions, `nerv nodes` bootstrap, lifecycle & root migration |
