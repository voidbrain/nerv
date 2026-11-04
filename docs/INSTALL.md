# Running NERV Agency without an open terminal

## Single-process local workspace

Requires Node 24+. Keep the checkout at a stable absolute path. Install and build:

```bash
npm ci
npm run build
npm start -- init
npm start -- doctor
npm start -- serve
```

Run `npm start -- open` in another terminal: it opens **http://127.0.0.1:4317** in your browser already signed in, using a single-use code that expires after 60 seconds (the token itself is never put in the address). Opening the page yourself still works with the token. `serve` supervises three processes: isolated SQLite/scheduler, an execution/health boundary and the API/static gateway. There is no Angular development server to keep open in this mode. Before installing a service, stop this foreground process with Ctrl-C to free the port.

Initialization creates `~/.nerv/config.json` and `~/.nerv/token` with private file permissions. Read the token locally to connect the UI; do not paste it into chat, a URL or a repository. The token stays in tab memory. Repeat initialization preserves configuration and credentials.

Each machine has a **base identity**, shown in the dashboard, `doctor` and the daily brief: give it at setup with `npm start -- init --base NERV-02 --name "Tabgha"` (both flags), see it with `npm start -- base`, change it later with `npm start -- base NERV-03 "Bethany"` (or edit `"base"` in `config.json`) and restart. Without one, a base is `NERV-01 · Neo Tokyo-3`. `npm start -- launch` is `serve` plus opening the live dashboard signed in.

### Windows

NERV Agency runs on Windows 11 with Node 24 (tested on macOS and Linux; Windows checks are unit-level so far, F-037). Differences:

- The data home is `%USERPROFILE%\.nerv`. Windows has no Unix permission bits, so private files (`telegram-token`, `anthropic-key`, `scrolls.json`) rely on your user profile being private to your account; do not put the data home in a shared folder. Store the bot token with PowerShell: `Read-Host -AsSecureString` is awkward for this, so paste it into a new file instead: `notepad $env:USERPROFILE\.nerv\telegram-token` (one line, save, close) — never in a chat or the repository.
- `open` and `launch` open your default browser.
- `service install` is not automated yet: it prints the Task Scheduler command that starts `serve` at logon (`schtasks /Create /SC ONLOGON …`); run it once.
- If `nerv` (after `npm link`) does not start, use `npm start -- …` from the checkout.

### A second machine

Until the Kaji line (milestone 3) connects bases, every installation is independent: its own data home, reminders, ledger and memory. Give each one its own base identity. Only **one** installation may run Aoba with a given Telegram bot (Telegram delivers a bot's messages to one reader): when you move NERV to an always-on machine, stop the old one or remove its `telegram-token`; to run both, create a second bot. To move your data, stop both services and copy the data home (`~/.nerv`) to the new machine, then set its base identity.

Defaults: port 4317, language `en`, timezone `Europe/Rome`. Edit config.json to select `it`, another free port or a valid IANA timezone. Restart the service after configuration changes. Date inputs are browser-local and saved as UTC; the configured timezone does not silently reinterpret them. Natural-language dates, recurring schedules and Italian voice remain future work.

### Existing 0.1 data

The original bootstrap defaulted to `.nodo` inside the checkout. The new durable default is `~/.nerv`. If a legacy project database is detected, NERV Agency refuses to silently create a different workspace. Keep using it by setting `NERV_HOME` to its **absolute** directory, including before service installation. Alternatively stop every NERV Agency process, back up the old directory and move it to the chosen durable path; retain SQLite sidecars. Do not overwrite another existing workspace. `doctor` prints the selected directory.

## macOS: launchd user agent

```bash
npm start -- service install
npm start -- service status
npm start -- service stop
npm start -- service start
npm start -- service uninstall
```

Installation creates `~/Library/LaunchAgents/io.nerv.agent.plist` and bootstraps it for the current GUI user. It launches at login and restarts after exit while loaded. Once installation succeeds, close Terminal: NERV Agency continues running. Stop uses bootout, so intentional stopping is not immediately undone by KeepAlive. Start bootstraps it again. Uninstall removes the service definition and retains reminders/configuration/token.

This is a user agent, not a boot-time system daemon. It depends on the user login session and does not run through computer sleep. Logs: `NERV_HOME/service.log` and `NERV_HOME/service-error.log`; manage retention locally. No machine service is installed by repository CI.

## Linux: systemd user service

The same commands install `nerv.service` under the user systemd configuration directory (normally `~/.config/systemd/user`) and use `systemctl --user`. Logs: `journalctl --user -u nerv.service`. A usable user systemd session is required. To remain active after logout or start without login, the host administrator may enable linger deliberately; NERV Agency does not enable it. An always-on coordinator still needs an awake machine.

## Updating and troubleshooting

**Renamed from Nodo (November 2026).** Nothing is moved for you:
- Data stays where it is: when `~/.nerv` does not exist but `~/.nodo` does, NERV Agency keeps using `~/.nodo` (and its `nodo.sqlite`). To move it, stop the service, move the directory to `~/.nerv`, then start again. `NODO_HOME`, `NODO_PORT` and `NODO_TOKEN` are still read when the `NERV_*` names are unset.
- Services: `service install` replaces the old `io.nodo.agent` LaunchAgent or `nodo.service` unit, so two schedulers never run. Until then the old service keeps working, and `service start|stop|status` still find it.
- Menu bar: the app is now `NERV.app` (`io.nerv.companion`). Its pairing moves to the new Keychain item on first launch; notification permission and launch at login are per app, so enable them again once.

Stop the service, update the checkout, run `npm ci` and `npm run build`, then start it again. Service definitions record absolute Node/checkout/data paths: uninstall and reinstall if these paths change, including an nvm-managed Node upgrade. An existing definition is never overwritten by install. Run doctor and inspect service status/logs if bootstrap fails; a definition left by a failed install can be removed with uninstall before retrying. Environment overrides in your shell are not automatically persisted into the service; put service settings in config.json and use init for the persistent token.

Database schema 2 adds the action ledger tables to `nerv.sqlite` on first start; reminders are kept. The upgrade is one-way: an older checkout refuses a schema-2 database with "Database schema is newer", so back up `nerv.sqlite` before updating if you may roll back. Schema 3 adds the event schema version to each ledger event (earlier events read as version 1); a schema-2 checkout refuses it the same way. Schema 4 adds Lilith's facts, their history and a full-text index; older checkouts refuse it likewise.

The backend remains bound to loopback. Remote TLS/Tailscale deployment, service auto-update and credential rotation are not implemented. Do not expose the development server publicly.

## Model routes

NERV Agency has no model route until you add one to `config.json` in the data home (`doctor` prints it):

```json
{"models":{"local":{"baseUrl":"http://127.0.0.1:11434/v1","model":"gemma3"},"cloud":{"provider":"anthropic","enabled":false}}}
```

- **S² (local):** any OpenAI-compatible chat endpoint on this machine, such as Ollama (`http://127.0.0.1:11434/v1`) or LM Studio (`http://127.0.0.1:1234/v1`). Only loopback addresses are accepted; a model on another machine waits for enrolled nodes (milestone 3).
- **Umbilical (cloud):** Claude, model `claude-opus-5-5` unless `model` says otherwise. It stays off until `enabled` is `true` and the API key is in `anthropic-key` in the data home, readable only by you (`chmod 600`). The key is never read from the environment, argv or `config.json`, and `doctor` never prints it.
- `npm start -- ask "text"` is local-only and uses S². `npm start -- ask --cloud "text"` sends the text to Claude. NERV Agency never switches route on its own: when S² is down, the answer is an error, not a cloud call.
- `roles` picks the route and model per role. Misato, the planner, can use either route; Casper, the intent seat, always uses S², because it sees the action's arguments. For example, Misato on Claude and Casper on Gemma:

  ```json
  {"models":{"local":{"baseUrl":"http://127.0.0.1:11434/v1","model":"gemma4:12b"},"cloud":{"provider":"anthropic","enabled":true},"roles":{"misato":{"route":"cloud"},"casper":{"model":"gemma4:12b"}}}}
  ```

  Or everything on Ollama, with the reviewer on a different model from the planner:

  ```json
  {"models":{"local":{"baseUrl":"http://127.0.0.1:11434/v1","model":"gemma4:12b"},"roles":{"misato":{"route":"local","model":"qwen2.5-coder:14b"},"casper":{"model":"gemma4:12b"}}}}
  ```

- After editing `config.json` or `anthropic-key`, run `npm start -- reload`: the running service re-reads them without a restart and prints the routes and roles now in use. A broken file is reported and the previous working settings stay in use. `ask` and `reload` talk to the running service.

### Getting a Claude API key

A Claude Pro or Max subscription does not include API access: the API is billed separately, per use. Sign in at [console.anthropic.com](https://console.anthropic.com), add credit under Billing (optionally set a monthly spend limit), then create a key under API Keys. Store it without it appearing in your shell history:

```bash
read -rs KEY && printf '%s\n' "$KEY" > ~/.nerv/anthropic-key && chmod 600 ~/.nerv/anthropic-key && unset KEY
```

Paste the key and press Enter (nothing is shown). Then set `"enabled": true` under `cloud` and run `npm start -- reload`.

## Memory (Lilith)

Misato remembers facts about you that you confirmed: tell it "remember that my dentist is Dr. Rossi" and it proposes the fact as an approval card (Telegram buttons, `approve`, or the dashboard); nothing is stored until you approve. From then on, facts that match a request are offered to Misato with it, in any conversation. Facts are local-only: they are never sent to a cloud model unless marked shareable.

```bash
npm start -- memory list
npm start -- memory add "I drink coffee at 8"
npm start -- memory edit ID "I drink tea at 8"
npm start -- memory forget ID
npm start -- memory history ID
```

**Instrumentality.** Add `"instrumentality": {"at": "03:00"}` (your time zone) or `{"when": "idle"}` (after an hour without requests, at most once in 20 hours, only when there is something new) to `config.json`: Misato's model reads the conversations since the previous run, writes a short summary (`npm start -- memory episodes`) and proposes lasting facts you stated (about one per two conversations, 3 to 10 at most), each as a normal approval card (Telegram buttons, `approve`, dashboard). Facts already known, or already waiting on a card, are skipped; one-off tasks are not facts. The ledger is never changed. `npm start -- instrumentality` runs it now. If the model's reply is unreadable twice, that night is skipped and the next run covers it.

The dashboard's **Terminal Dogma · Lilith** panel lists your facts with **Edit**, **Forget** and **Local-only / Shareable**, each fact's history, an add box and the latest Instrumentality summaries. Changes there are recorded as yours. A shareable fact may be offered to a cloud model; every fact starts local-only.

Facts you add yourself are active at once. Forgetting removes a fact from recall and lists; its history (created, edited, forgotten, by whom) is kept. IDs can be shortened to their first characters.

## Dashboard

`npm start -- open dashboard` opens **http://127.0.0.1:4317/dashboard/** signed in, with this service's real data, refreshed every 3 seconds: your recent sorties, the selected sortie's flow, ballot and trace (requests, MAGI verdicts, cards, decisions, Misato's replies), the cards waiting for you with working **Approve once** and **Reject** buttons, the pending reminders, health from `doctor`, and TOKYO-3 (this machine) on the map. Typing in the dashboard sends the request to Misato. **Reload models** (Health panel) applies `config.json` changes without a restart and shows the roles in use; **Spear this sortie** (sortie detail, after a confirmation) revokes its unused grants and stands down its cards, and lists what already ran; **While you were away** counts what finished, failed or was stopped and the reminders delivered since you last pressed *Mark as read* (remembered in that browser only). **Terminal Dogma · Lilith** shows and edits your memory (see Memory). **EVA cages** shows the one real executor today, EVA-02 inside the scheduler (not sandboxed yet), with a heartbeat when an action runs. Panels without real data yet (budget, pilot trust, other bases) say *planned · not connected yet*. Opened as a file (`web/public/dashboard/index.html`), or without a login code, the page is the simulation with invented data.

## Telegram (Aoba)

Aoba is a Telegram bot that only you can use: write to Misato from your phone, approve or reject actions with buttons, and receive due reminders. It makes outgoing HTTPS requests only, so it needs no open port, VPN or second machine.

1. In Telegram, message **@BotFather**, send `/newbot`, and choose a name (for example `Aoba`) and a username ending in `bot`.
2. Store the token it gives you privately. Run this, paste the token at the empty prompt (nothing is shown) and press Enter:

   ```bash
   read -rs TOKEN && printf '%s\n' "$TOKEN" > ~/.nerv/telegram-token && chmod 600 ~/.nerv/telegram-token && unset TOKEN
   ```

   Never paste the token into a chat or a file in the repository. If it leaks, send `/revoke` to BotFather and store the new one.
3. Send `/start` to your bot, then run `npm start -- telegram link`. It finds that `/start` and saves your chat ID in `config.json` (if several chats sent `/start`, it lists them: `telegram link CHAT_ID`).
4. Restart the service. `serve` prints `Aoba (Telegram): linked, listening.`

If `telegram link` or Aoba reports `fetch failed` while `curl https://api.telegram.org` works, your network inspects HTTPS with a certificate your Mac trusts but Node does not: `npm start` and the service units run Node with `--use-system-ca` for that reason; reinstall the service (`npm start -- service install`) after updating.

Aoba ignores every other chat and every button pressed by another account, and logs it. A message older than 10 minutes (sent while the service was down) is not run; Aoba asks you to send it again. Approval cards arrive once, with **✅ Approve once** and **❌ Reject**; a tap uses the same decision path as `approve`, so the action runs once and a second tap changes nothing. Due reminders arrive here as well as in the local inbox; reminders delivered before Aoba was linked are not replayed. Its progress (last update, cards sent, last reminder) is in `telegram-state.json` in the data home.

### Hyuga's daily brief

You can also just tell Misato: "move the brief to 9", "brief at 8:30", "turn the brief off", "run Instrumentality when I'm idle". It changes only these two schedules (no card, reversible), and the change applies within a minute without a restart. Models, Telegram, the Scrolls and the base identity are never changeable by chat.

Add `"brief": {"at": "08:00"}` to `config.json` (your time zone, 24-hour) and restart: once a day at or after that time Aoba sends a short summary in your configured language — cards waiting for you, reminders due in the next 24 hours, what finished or failed since the previous brief, and health problems. It is built from the ledger, not by a model, so it is quick and invents nothing. It is sent once per day (also across restarts; if the service starts after the time, it is sent then). `npm start -- brief` prints it now.

Telegram bot chats are not end-to-end encrypted: Telegram's servers can read what you and Aoba write, including reminder titles and action arguments on cards.

## Talking to Misato

After `npm link` (once, in the checkout) the commands are also available as `nerv`: `nerv chat "…"`, `nerv open dashboard`, `nerv reload`. `npm unlink -g nerv-agency` removes it.


With the service running and a model route configured:

```bash
npm start -- chat "Ricordami di rinnovare l'assicurazione auto il 15 gennaio 2030 alle 9"
npm start -- chat "What reminders do I have?"
```

Each Telegram chat, the CLI and the dashboard are separate conversations: Misato sees the last three exchanges of the same one from the past 30 minutes, so a short follow-up ("sì", "all of them", "the first one") is understood, and a bare "yes" with nothing to confirm does nothing. Reminders cancelled by mistake can be restored ("restore the reminder…") while they are still ahead.

Misato plans one step at a time: it proposes an action, the gate reviews it, and Misato sees the outcome before the next step (at most 6 steps). The command prints each step, any action that waits for you (`approve ID` or `reject ID`), the reply, and the sortie ID for `events`. An action waiting for you has not happened. Once you decide (Telegram button, `approve`/`reject`, the API, or it expires), it runs once if approved and Misato picks the request back up with the outcome, within a few seconds; its follow-up reply goes to Telegram when Aoba is linked and is always in the sortie's events. The conversation's steps are kept in the ledger, so this also works after a restart. Misato uses `models.roles.misato` (local unless you choose the cloud route); times are converted to your configured time zone in code before Misato sees them. Locally, a step takes about 10–30 seconds with a 12–14B model.

## Gate rules (the Scrolls)

Every agent action passes the per-action gate. Its rules come from `scrolls.json` in the data home; without the file the defaults apply. Example:

```json
{ "deny": ["mail.send"], "blue": ["calendar.delete"], "syncThreshold": 80, "maxRejects": 3, "budget": 1 }
```

`deny` rejects a tool outright; `blue` always asks you; `syncThreshold` (0–100) is the Sync Ratio an Orange action needs to proceed without you; `maxRejects` (0–10) is how often a rejected plan may retry before it reaches you; `budget` caps a sortie's spend. Every field is optional, and an unknown field is an error, so a typo cannot silently relax a rule. Keep the file private (`chmod 600`): a file others can write, or an invalid one, stops `serve` and every command with a message instead of starting with weaker rules. `doctor` shows the rules in force and where they came from. Restart the service after editing.

To run one action through the gate yourself, with the service running:

```bash
npm start -- act "Remind me to renew the car insurance" reminders.add '{"title":"Renew car insurance","due":"2030-01-15T09:00:00+01:00"}'
npm start -- act "What is due?" reminders.list
```

The reply shows the Pattern, the Sync Ratio and the outcome: `grant` ran the tool and shows its result; `approval` waits for you (`npm start -- approvals`, then `approve ID` or `reject ID`; an approval runs the tool once); `reject` stopped it. The built-in tools are `reminders.list` (read), `reminders.add` and `reminders.cancel` (local writes), so they are Green and run without a model. A tool the Scrolls mark `blue`, or any unregistered tool, first asks Casper on the local route (S²) whether the action matches your request, then always asks you. Casper never uses the cloud route, because the action's arguments may be private; without S², or with an unreadable reply, the card says so and you decide. Every step is an event: `npm start -- events SORTIE_ID`.

## Frontend development

`npm run dev` uses **4318**, proxies API calls to **4317** and is only needed for editing the frontend. The installed service serves the production build directly on 4317. Port 4200 is not used.

## Native menu-bar companion — development preview

SwiftUI MenuBarExtra without Electron now includes pairing, Keychain storage, read-only status/reminders and a workspace shortcut. Run native-init, restart the daemon, then pair. Native TLS defaults to 4319; the web workspace remains 4317. Full commands, app build steps, revocation and limits are in [the native guide](../native/README.md). Notifications, guarded start/stop controls and companion launch-at-login selection are now implemented; distribution signing and actual OS permission/login/menu checks remain F-011. No native app is installed on this execution host.

## Isolated child lifecycle

The same launchd/systemd definition starts the supervisor, which starts its two children. A CPU stall or failure in the execution boundary does not stop the scheduler. Scheduler death stops the gateway with failure so the OS supervisor can recover it. The authenticated API doctor reports process PIDs and execution-boundary availability; it does not claim model readiness. Child environment isolation avoids inheriting root/API tokens but does not sandbox processes running under your user. Do not run untrusted tools before the later execution policy/sandbox work. Local native WebSocket reads require an Authorization header; browser use of /rpc remains rejected. Native pairing uses a separate TLS REST flow; client-scoped WebSockets are not implemented.
