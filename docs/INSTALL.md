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

- **Worktrees:** If a worktree's `node_modules` is a symbolic link to the primary checkout (`npm run worktree:link`), remove the link first (`rm node_modules`, not its contents) before `npm ci`, or run `npm run deps:install` (which refuses a linked `node_modules`).
- `serve` supervises three processes on loopback (`127.0.0.1:4317`): the API/UI gateway, an isolated SQLite/scheduler process, and an execution boundary. Stop the foreground process (`Ctrl-C`) before installing a background service.
- User data defaults to `~/.nerv` (`%USERPROFILE%\.nerv` on Windows; override with an absolute `NERV_HOME`). Private credentials (`token`, `anthropic-key`, `telegram-token`, `scrolls.json`) stay local and are never pasted into chat or the repo.
- Rotate a live credential with `nerv credentials rotate admin|telegram|cloud`. Secret input is hidden, old file-backed credentials stop authenticating immediately, and `doctor` reports credential ages without values.
- Defaults: port `4317`, language `en`, `timeZone` `Europe/Rome`. Edit `config.json` and restart to change them.
- Automatic updates are off by default. `nerv update-policy on|off|status` (or the dashboard switch) opts this base in: a check every day at 20:00 announces an available revision in Telegram and the inbox with its apply time, it is applied at 03:00 through the safe update path unless you answer "aspetta" / "wait" (postponed one night), never between 08:00 and 23:00, and the result is reported the same way. The times and the mode are settings: `updatePolicy.schedule` in `config.json` (or `POST /api/update/policy`) takes `mode` (`apply`, or `notify` to announce only), `checkHour`, `applyHour`, `quietFrom` and `quietUntil` (local whole hours; defaults 20, 3, 8 and 23); a change is used from the next minute, without a restart.
- **Update now** (dashboard Health, beside the availability line) hands the update to an updater that runs outside the service. Its status stays beside the button: in progress with the current step, then completed, refused, failed or uncertain (no word for 15 minutes) with the reasons and recovery steps, after a restart or a page reload too, until you press Dismiss or start another update. The result also reaches the inbox once; the updater's log is `~/.nerv/updater.log`, and `GET /api/update/status` returns the same status.

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

- **Updating:** Stop the service, pull, run `npm ci && npm run build`, then start again. Uninstall/reinstall the service if Node or checkout paths change. (For the managed Mac default profile, use the fenced `nerv nodes lifecycle-inspect` / `lifecycle-apply` flow in [Kaji & Nodes](guides/kaji-and-nodes.md#service-lifecycle-and-local-mac-updates); never `git pull` a running managed service checkout.) `nerv update` and the dashboard's Update now update the install folder only when NERV runs as the service: a foreground `nerv launch` or `nerv serve` is refused with its pid, so stop it (Ctrl-C) and run `nerv update`. With the service installed, open the dashboard with `nerv open`, not `nerv launch`.
- **Legacy 0.1 / Nodo data:** Existing `~/.nodo` directories and `NODO_*` env vars remain supported; `service install` replaces older `io.nodo.agent` / `nodo.service` units. Legacy checkout-local `.nodo` databases trigger migration guidance rather than silent overwrite.
- **Database upgrades:** Schema upgrades are one-way; back up `nerv.sqlite` before updating if you may roll back.
- **Frontend dev (`4318`) & Native companion (`4319`):** `npm run dev` proxies API calls to `4317` for Angular work; `npm run test:browser` runs Chrome/axe checks after build. For the macOS SwiftUI menu-bar preview, see [native/README.md](../native/README.md).

## Environment variables

`NERV_HOME` (above) is the one variable a normal install sets. The others below are test and tooling seams; set them only for the purpose named.

| Variable | Read by | Effect |
|---|---|---|
| `NERV_PORT`, `NODO_PORT` | `src/node-lifecycle-execution.ts` | Not a way to change the port (that is `config.json`). The service lifecycle (`nerv nodes lifecycle-inspect` / `lifecycle-apply`) refuses to run while either is set in its environment: it requires persistent configuration without runtime overrides. Unset it before the step. `NODO_PORT` is the legacy 0.1 name. |
| `NERV_TELEGRAM_API` | `src/telegram.ts` | Test only. Replaces the Telegram Bot API base with a loopback stand-in (`http://127.0.0.1`, `localhost` or `[::1]`). Any other address throws, because requests carry the bot token. |
| `NERV_FULL_CHECKS` | `tools/plan-verification.mjs` | CI. `true` makes the verification plan full, as `--full` does ([verification selection](verification.md)). |
| `NERV_VERIFY_GROUPS`, `NERV_VERIFY_PATHS` | `tools/selected-tests.mjs` | CI. The plan hands the selected test groups (comma list) and the changed paths (JSON array) to the selected-test runner. |
| `NERV_TEST_TIMINGS` | `tools/test-timing-reporter.mjs` | The file the test timing reporter writes (default `.test-timings.txt`). |

The `ajv-formats` and `ajv-formats-draft2019` devDependencies are used only by `test/bom.test.ts`, to validate the software bill of materials against its JSON schema; nothing at runtime imports them.

## Topic guides

| Guide | Covers |
|---|---|
| [Models and Pilots](guides/models-and-pilots.md) | S² (Ollama/LM Studio), Umbilical (Claude), API keys, Dummy Plug outage handling, specialist pilots |
| [Memory, Chat, Tools, and Gate Rules](guides/memory-and-chat.md) | Misato chat, Lilith memory & Instrumentality, MCP tools, Scrolls gate rules, CycloneDX BOM |
| [A Remote MCP Server on the Tailnet](guides/remote-mcp.md) | Register an HTTPS MCP server (a hub on the tailnet), effect classes, an unreachable server |
| [Channels, Dashboard, and Proactive Watches](guides/channels-and-watches.md) | Dashboard shortcuts & Battery, Telegram (Aoba), daily briefs, chronicle, Hyuga watches |
| [Kaji Line, Remote Workers, and Node Setup](guides/kaji-and-nodes.md) | Base enrollment, Tailscale live link, remote actions, `nerv nodes` bootstrap, lifecycle & root migration |
| [Backups](guides/backups.md) | Nightly snapshots, encrypted off-host copies, `nerv backup keygen\|status\|decrypt` |
