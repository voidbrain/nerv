# Running Nodo without an open terminal

## Single-process local workspace

Requires Node 24+. Keep the checkout at a stable absolute path. Install and build:

```bash
npm ci
npm run build
npm start -- init
npm start -- doctor
npm start -- serve
```

Open **http://127.0.0.1:4317**. `serve` supervises three processes: isolated SQLite/scheduler, an execution/health boundary and the API/static gateway. No model provider runs yet. There is no Angular development server to keep open in this mode. Before installing a service, stop this foreground process with Ctrl-C to free the port.

Initialization creates `~/.nodo/config.json` and `~/.nodo/token` with private file permissions. Read the token locally to connect the UI; do not paste it into chat, a URL or a repository. The token stays in tab memory. Repeat initialization preserves configuration and credentials.

Defaults: port 4317, language `it`, timezone `Europe/Rome`. Edit config.json to select `en`, another free port or a valid IANA timezone. Restart the service after configuration changes. Date inputs are browser-local and saved as UTC; the configured timezone does not silently reinterpret them. Natural-language dates, recurring schedules and Italian voice remain future work.

### Existing 0.1 data

The original bootstrap defaulted to `.nodo` inside the checkout. The new durable default is `~/.nodo`. If a legacy project database is detected, Nodo refuses to silently create a different workspace. Keep using it by setting `NODO_HOME` to its **absolute** directory, including before service installation. Alternatively stop every Nodo process, back up the old directory and move it to the chosen durable path; retain SQLite sidecars. Do not overwrite another existing workspace. `doctor` prints the selected directory.

## macOS: launchd user agent

```bash
npm start -- service install
npm start -- service status
npm start -- service stop
npm start -- service start
npm start -- service uninstall
```

Installation creates `~/Library/LaunchAgents/io.nodo.agent.plist` and bootstraps it for the current GUI user. It launches at login and restarts after exit while loaded. Once installation succeeds, close Terminal: Nodo continues running. Stop uses bootout, so intentional stopping is not immediately undone by KeepAlive. Start bootstraps it again. Uninstall removes the service definition and retains reminders/configuration/token.

This is a user agent, not a boot-time system daemon. It depends on the user login session and does not run through computer sleep. Logs: `NODO_HOME/service.log` and `NODO_HOME/service-error.log`; manage retention locally. No machine service is installed by repository CI.

## Linux: systemd user service

The same commands install `nodo.service` under the user systemd configuration directory (normally `~/.config/systemd/user`) and use `systemctl --user`. Logs: `journalctl --user -u nodo.service`. A usable user systemd session is required. To remain active after logout or start without login, the host administrator may enable linger deliberately; Nodo does not enable it. An always-on coordinator still needs an awake machine.

## Updating and troubleshooting

Stop the service, update the checkout, run `npm ci` and `npm run build`, then start it again. Service definitions record absolute Node/checkout/data paths: uninstall and reinstall if these paths change, including an nvm-managed Node upgrade. An existing definition is never overwritten by install. Run doctor and inspect service status/logs if bootstrap fails; a definition left by a failed install can be removed with uninstall before retrying. Environment overrides in your shell are not automatically persisted into the service; put service settings in config.json and use init for the persistent token.

The backend remains bound to loopback. Remote TLS/Tailscale deployment, service auto-update and credential rotation are not implemented. Do not expose the development server publicly.

## Frontend development

`npm run dev` uses **4318**, proxies API calls to **4317** and is only needed for editing the frontend. The installed service serves the production build directly on 4317. Port 4200 is not used.

## Native menu-bar companion — development preview

SwiftUI MenuBarExtra without Electron now includes pairing, Keychain storage, read-only status/reminders and a workspace shortcut. Run native-init, restart the daemon, then pair. Native TLS defaults to 4319; the web workspace remains 4317. Full commands, app build steps, revocation and limits are in [the native guide](../native/README.md). Notifications, guarded start/stop controls and companion launch-at-login selection are now implemented; distribution signing and actual OS permission/login/menu checks remain F-011. No native app is installed on this execution host.

## Isolated child lifecycle

The same launchd/systemd definition starts the supervisor, which starts its two children. A CPU stall or failure in the execution boundary does not stop the scheduler. Scheduler death stops the gateway with failure so the OS supervisor can recover it. The authenticated API doctor reports process PIDs and execution-boundary availability; it does not claim model readiness. Child environment isolation avoids inheriting root/API tokens but does not sandbox processes running under your user. Do not run untrusted tools before the later execution policy/sandbox work. Local native WebSocket reads require an Authorization header; browser use of /rpc remains rejected. Native pairing uses a separate TLS REST flow; client-scoped WebSockets are not implemented.
