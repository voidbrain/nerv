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

The dashboard header shows the running build as `v1.N`: N counts first-parent commits, advancing once per merge on main. Bases on the same revision show the same number. Hover and clicking use the same Git-verified unique short commit ID, honoring Git’s abbreviation settings and lengthening when needed for uniqueness. Build metadata is read once at service start, so restart after updating. A shallow checkout or a source copy without git history falls back to the package version; use a full clone for the incrementing number. This identifies source revisions, not repeated builds of identical code.

### Windows

NERV Agency runs on Windows 11 with Node 24; CI runs the suite and a real service install on Windows too (F-037). Differences:

- The data home is `%USERPROFILE%\.nerv` (`C:\Users\<you>\.nerv`; `nerv doctor` prints it as `home`). Windows has no Unix permission bits, so private files (`telegram-token`, `anthropic-key`, `scrolls.json`) rely on your user profile being private to your account; do not put the data home in a shared folder. Store a bot token with `nerv telegram token`.
- `open` and `launch` open your default browser.
- `nerv service install` (after `npm run build`) registers a Task Scheduler task, **NERV Agency**, that starts NERV at your logon with no window, restarts it a minute after a crash, and writes `service.log` and `service-error.log` in the data home. `nerv service status | start | stop | uninstall` manage it; `stop` asks NERV to shut down as Ctrl+C would, then ends the task. While the service runs, do not also start `nerv launch` (the port would be taken): open the dashboard with `nerv open dashboard`.
- If `nerv` (after `npm link`) does not start, use `npm start -- …` from the checkout.
- If `git pull` refuses because a file "will be replaced by CRLF", run `git config core.autocrlf false` and `git restore <file>` once; the repository's `.gitattributes` keeps LF line endings on every system.

### Kaji line: enrolling your bases

The Kaji line connects your bases. Trust comes from your **Key of Nebuchadnezzar**, an offline root key; the network (Tailscale) only carries the traffic. Phase 1 builds the signed list of bases; the live connection (heartbeats, sync, dashboard) comes next.

1. Install **Tailscale** on every base, logged into the same account, and note each one's address: `tailscale ip -4` (100.x.y.z).
2. On the main base (Neo Tokyo-3): `npm start -- key init`. Type a passphrase (12+ characters, twice). It writes `~/.nerv/key-of-nebuchadnezzar.enc` (encrypted) and prints the **root fingerprint**. Copy that file to a USB stick and keep the passphrase safe: without them no base can be enrolled. To keep the key only on the stick: `key init --out /Volumes/STICK/key-of-nebuchadnezzar.enc`, then pass `--key` with that path below.
3. Enrol the main base itself: `npm start -- kaji enrol NERV-01 "Neo Tokyo-3" self 100.x.y.z` (its Tailscale address).
4. On the other base (Tabgha): `npm start -- base pubkey` prints its public key; copy that line to the main base and enrol it: `npm start -- kaji enrol NERV-02 "Tabgha" <that key> 100.x.y.z`.
5. On the main base: `npm start -- kaji export bases.json`; copy the file to Tabgha and import it with the **root** fingerprint you read in step 2 (the `Root …` line of `kaji list` on the main base — not the base's own fingerprint from `base pubkey`): `npm start -- kaji import bases.json --root <root fingerprint>`. The fingerprint check is what stops a forged list.
6. `npm start -- kaji list` on either base shows both, marking "this base". Revoke a lost or retired base with `kaji revoke NERV-02` (then export/import again); its key is refused from then on.

Each base's own key (`~/.nerv/base-key`) is created on first use and never leaves it.

**The live link.** Once a base is enrolled and its root pinned, `serve` listens for the Kaji line on **its enrolled address only** (the Tailscale IP, port 4320 unless the address says `:port`) and greets every other enrolled base every 30 seconds. Every message is signed with the sender's base key and checked against the signed list (a known, non-revoked base; a time within two minutes; never replayed). Bases merge what they have heard, so each shows every base as online (heard in the last 90 s) or offline with its last-seen time, and a base that is behind on the list fetches the missing records and verifies each against its own pinned root. The dashboard's NERV bases panel and map show them; `GET /api/bases` (admin) returns the same.

**One channel (Aoba on the main base).** Name your main base once, on the base that holds the Key: `nerv kaji main NERV-01` (it asks for the passphrase; `nerv kaji main` shows the current one, `kaji list` marks it). The choice is signed and reaches the other bases by itself. While the main base is online, the other bases keep their own bots quiet: their cards, reminders, briefs and Misato's replies arrive through Aoba marked with the base's name (`🛰 Tabgha · …`), and a tap on such a card is decided on that base. If the main base or the line is down, each base speaks through its own bot again, so nothing is lost. Messages you send to a quiet bot wait in Telegram and are answered when that base speaks again; write to Aoba instead. Requests are handled by the main base's Misato too: what you write to Aoba, and what you ask on another base (its dashboard chat or `nerv chat`) while the main base is online; the answer says *answered by Neo Tokyo-3*, and any card it needs is decided on Aoba or on the main base's dashboard. If the main base cannot be reached, the base you asked answers itself; if the request reached the main base but its answer is late, you are told so and it is not repeated. **Actions on another base.** A base can let the main base run some of its actions there: on that base, `nerv kaji offer reminders.add reminders.list` (`nerv kaji offer` shows the list, `nerv kaji offer none` clears it; nothing is offered by default). While it is online, Misato on the main base can then use those actions there when you ask for it ("remind me on Tabgha to…"): every such action first asks you on the main base (an approval card with the base, the action and its arguments), then goes over the Kaji line, and the other base runs it through **its own** gate (its MAGI and Scrolls: it may run it, refuse it, or ask you again with its own card, which arrives on Aoba). The result comes back to you as a message. Each request has an id the other base remembers, so a resend after a restart never runs it twice. Only the main base can send actions; the other bases cannot send actions to it.

**The other bases vote too.** For every action on the main base that is not Green, or that cancels or forgets something, the main base also asks each other online base's Casper (on that base's own local model) at the same time as its own. These seats are **veto-only**: a reject can stop the action, an approve never makes one pass. A base that does not answer in time abstains, so it never blocks you. Every base starts in **shadow**: its vote is not counted and never makes you wait: the decision is taken as soon as Casper (and any veto base) has voted; a shadow vote already in is shown on the card (*Other bases: Tabgha ✗ (shadow)*), one that comes later is added to the sortie's trace (*MAGI · NERV-02 (shadow, after the decision)*). A veto base is waited for, up to its time limit. When you trust it, on the main base: `nerv kaji seat NERV-02 veto` (`shadow` to go back, `off` to stop asking it; `nerv kaji seat` lists them).

**Each base's health.** Every heartbeat also carries the sender's own health: *online*, or *degraded* with up to three reasons (the same ones its `doctor` gives, for example a model route that is down). The other bases show it in the NERV bases panel (badge **DEGRADED** and the reasons) and as a yellow pin on the map; it is only ever what that base said about itself, never passed on by a third base. A base still on an older version sends no health and shows online/offline only, with a note.

The first time, your firewall may ask whether Node may accept incoming connections: allow it. On **Windows**, if Tabgha stays offline from Neo Tokyo-3, allow the port on the Tailscale interface only, in an administrator PowerShell: `New-NetFirewallRule -DisplayName "NERV Kaji" -Direction Inbound -Protocol TCP -LocalPort 4320 -InterfaceAlias Tailscale -Action Allow`. The service log says `Kaji: listening on …`, `… reachable` when a base answers again, and `… unreachable (…); 3 heartbeats missed` only after three heartbeats in a row failed (90 seconds, when the dashboard marks it offline): a single slow or missed heartbeat is not logged.

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

**The easy way.** `npm start -- init` looks for Ollama on this machine (`http://127.0.0.1:11434`, or the address in `NERV_OLLAMA`) and, when nothing is set yet, puts Misato and Casper on its largest model. After that:

- `npm start -- models` shows each role's route and model, the cloud route, whether its key is saved, and the models Ollama has;
- `models set misato MODEL`, `models set casper MODEL` pick a local model (it must be one Ollama has); `models set misato cloud` moves Misato to Claude once `models cloud on` has turned that route on;
- `models key` asks for the Claude API key at a hidden prompt and saves it to `anthropic-key` (readable only by you): it is never typed on the dashboard, a command line or in `config.json`;
- `models set consultant MODEL` (or `off`; the same as `pilots generic MODEL`) picks a **consultant**: a local model asked once per request, before Misato plans, for a few sentences of advice (what you most likely want, what to check, what could go wrong). It never acts and never votes; the advice goes into Misato's context as data, it is kept in the sortie's trace (Comms, and the Gevurah node lights up), and it is used only when Misato is on the local route. Off by default;
- `pilots` manages **pilots**, your permanent specialists (F-045). The consultant above is the **generic pilot**, for anything no specialist covers. Add a specialist with `pilots add printer --name "Print Master" --domain "3D printing" --keywords "filament, 3D print, slicer" --model gemma4:12b` (a model Ollama has). Before Misato plans, the pilot whose keywords the request contains advises instead of the generic one: a pinned pilot first (`pilots pin ID`), then the one with the most keywords matched, then the later stage (`--stage prototype|test|production`). `pilots retire ID` keeps it in the list but never asks it, `restore` brings it back, `set ID --keywords …` changes it; changes apply to the next request without a restart. Pilots only advise for now: the advice is data in Misato's prompt, recorded in the trace with the pilot's name, never a vote or an action. In the dashboard’s Pilots panel, the generic fallback and every specialist have independent model selectors. Apply changes one pilot, using a currently installed local Ollama model; the next request uses it without a restart. Cloud/other-provider pilot routing remains planned. **New pilots are proposed for you:** when no specialist fits, the generic pilot also names the request's field (*image editing*); labels sharing a significant whole word count together (for example, *file system access* and *file management*); after three such requests in 30 days, the Marduk Institute sends you a card to create a pilot for it (name, domain, keywords, on the generic pilot's model, at Prototype), with the requests behind it. Approve it and the next request in that field goes to the new pilot; overlapping fields share one pending card; turn it down and an overlapping field is not proposed again for 30 days. You can also ask Misato for one (*make me a pilot for photo editing*): same card.
- the dashboard's **Models** panel offers the same choice for Misato, Casper and the consultant, and turns the cloud route on or off; it says when the key is missing.

Every change is checked before it is written and the running service uses it at once, without a restart. You can also edit the settings by hand:

Without the commands above, NERV Agency has no model route until you add one to `config.json` in the data home (`doctor` prints it):

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

**After a restart.** A request NERV was still working on when the service stopped (not one waiting for your approval) is closed as *interrupted*, and you are told what had run before; it is not carried on by itself, so ask again if you still want it. Requests waiting for your approval pick up where they were once you decide.

**When a route is down (Dummy Plug).** The brain tracks each route from real calls and, for the local route, a TCP check every minute (no model call). When a route cannot be reached, `doctor` and `/api/status` show `routes` and a `degraded` reason, the dashboard shows *degraded* with the reason, the daily brief lists it, and the service log prints one line (`NERV: S² local route down: …`). Reminders, the gate and rule-based actions keep running; a request that needs a model fails with that reason (Aoba replies *I could not finish: …*), and a local-only request never moves to the cloud. When the route answers again it is marked reachable on its own, and the log prints `NERV: S² local route back after N min.`

## Memory (Lilith)

Misato remembers facts about you that you confirmed: tell it "remember that my dentist is Dr. Rossi" and it proposes the fact as an approval card (Telegram buttons, `approve`, or the dashboard); nothing is stored until you approve. From then on, facts that match a request are offered to Misato with it, in any conversation. Facts are local-only: they are never sent to a cloud model unless marked shareable.

```bash
npm start -- memory list
npm start -- memory add "I drink coffee at 8"
npm start -- memory edit ID "I drink tea at 8"
npm start -- memory forget ID
npm start -- memory history ID
```

**Instrumentality.** Add `"instrumentality": {"at": "03:00"}` (your time zone) or `{"when": "idle"}` (after an hour without requests, at most once in 20 hours, only when there is something new) to `config.json`: Misato's model reads the conversations since the previous run, writes a short summary (`npm start -- memory episodes`) and proposes lasting facts you stated (about one per two conversations, 3 to 10 at most), each as a normal approval card (Telegram buttons, `approve`, dashboard). Facts already known, or already waiting on a card, are skipped; one-off tasks are not facts. The ledger is never changed. `npm start -- instrumentality` runs it now. If the model's reply is unreadable twice, that scheduled attempt fails visibly; it can make one later attempt after an hour in the same local-day slot.

The dashboard's **Terminal Dogma · Lilith** panel lists your facts with **Edit**, **Forget** and **Local-only / Shareable**, each fact's history, an add box and the latest Instrumentality summaries. Changes there are recorded as yours. A shareable fact may be offered to a cloud model; every fact starts local-only.

**What Misato is given (the LCL).** With each request Misato gets the facts that match it and up to two of Instrumentality's summaries of earlier days that match it, then the most recent exchanges of the conversation, within a size budget (smaller on the cloud route, which costs per token); what does not fit is left out whole. Summaries come from your own conversations, so like local-only facts they never reach a cloud model.

**Facts proposed together.** When Instrumentality proposes several facts in one night, Telegram shows them as one message with a ✅/❌ row per fact; each fact is still approved on its own, and a tap removes only that fact's row.

Facts you add yourself are active at once. Forgetting removes a fact from recall and lists; its history (created, edited, forgotten, by whom) is kept. IDs can be shortened to their first characters.

## Dashboard

`npm start -- open dashboard` opens **http://127.0.0.1:4317/dashboard/** signed in, with this service's real data, refreshed every 3 seconds: your recent sorties, the selected sortie's flow, ballot and trace (requests, MAGI verdicts, cards, decisions, Misato's replies), the cards waiting for you with working **Approve once** and **Reject** buttons, the pending reminders, health from `doctor`, and TOKYO-3 (this machine) on the map. Typing in the dashboard sends the request to Misato. **Reload models** (Health panel) applies `config.json` changes without a restart and shows the roles in use; **Spear this sortie** (sortie detail, after a confirmation) revokes its unused grants and stands down its cards, and lists what already ran; **While you were away** counts what finished, failed or was stopped and the reminders delivered since you last pressed *Mark as read* (remembered in that browser only). **Terminal Dogma · Lilith** shows and edits your memory (see Memory). **EVA cages** shows the one real executor today, EVA-02 inside the scheduler (not sandboxed yet), with a heartbeat when an action runs. Panels without real data yet (budget, pilot trust, other bases) say *planned · not connected yet*. After a reload the page is still live but not signed in: run `nerv open dashboard` again, or paste the access token into the bar (kept in that tab's memory only). The simulation with invented data appears only when the file is opened from disk (`web/public/dashboard/index.html`) or with `?demo` in the address.

In **Sorties**, the search box (or <kbd>/</kbd>) filters by ID, title, reply and the one-line *why*, and the service also searches every older sortie's title; **Load older sorties** pages back through history, 50 at a time. **Coming up** lists every pending reminder with **Edit** (title and time) and **Cancel**. On a card waiting for you, <kbd>a</kbd> approves once and <kbd>r</kbd> rejects, each in two presses: the first says what the second will do, <kbd>Esc</kbd> cancels. The API behind them: `GET /api/sorties?q=…&before=…`, `PATCH /api/reminders/ID` with `title` and/or `due`, `DELETE /api/reminders/ID`.

**Staying signed in.** `open dashboard` signs the page in with a dashboard session, not your admin token. The session survives a reload in that tab and ends when you close the tab, after 12 hours, when the service restarts, or for every open dashboard at once with `npm start -- sessions revoke`; then run `open dashboard` again.

## Telegram (Aoba)

Aoba is a Telegram bot that only you can use: write to Misato from your phone, approve or reject actions with buttons, and receive due reminders. It makes outgoing HTTPS requests only, so it needs no open port, VPN or second machine.

1. In Telegram, message **@BotFather**, send `/newbot`, and choose a name (for example `Aoba`) and a username ending in `bot`.
2. Store the token it gives you: `npm start -- telegram token` (or `nerv telegram token`). Paste the token at the prompt (it is not shown) and press Enter; it checks the format and saves it privately in the data home (`~/.nerv/telegram-token`, on Windows `%USERPROFILE%\.nerv\telegram-token`). Never paste the token into a chat or a file in the repository. If it leaks, send `/revoke` to BotFather and store the new one the same way.
3. Send `/start` to your bot, then run `npm start -- telegram link`. It finds that `/start` and saves your chat ID in `config.json` (if several chats sent `/start`, it lists them: `telegram link CHAT_ID`).
4. Restart the service. `serve` prints `Aoba (Telegram): linked, listening.`

If `telegram link` finds no `/start`, it says why: the bot has a **webhook** (messages go to that address instead: if nothing else uses the bot, remove it by opening `https://api.telegram.org/bot<TOKEN>/deleteWebhook` once, or the PowerShell/curl equivalent, never sharing the token), **nothing is waiting** (the `/start` went to another bot — open the chat with exactly the `@username` it names — or another program reads this bot: give each base its own bot), or **other updates** are waiting (type `/start` yourself in the private chat). If the base is already linked it says so; `telegram link --relink` links another chat.

If `telegram link` or Aoba reports `fetch failed` while `curl https://api.telegram.org` works, your network inspects HTTPS with a certificate your Mac trusts but Node does not: `npm start` and the service units run Node with `--use-system-ca` for that reason; reinstall the service (`npm start -- service install`) after updating.

Aoba ignores every other chat and every button pressed by another account, and logs it. A message older than 10 minutes (sent while the service was down) is not run; Aoba asks you to send it again. Approval cards arrive once, with **✅ Approve once** and **❌ Reject**; a tap uses the same decision path as `approve`, so the action runs once and a second tap changes nothing. Due reminders arrive here as well as in the local inbox; reminders delivered before Aoba was linked are not replayed. Its progress (last update, cards sent, last reminder) is in `telegram-state.json` in the data home.

### Hyuga's daily brief

You can also just tell Misato: "move the brief to 9", "brief at 8:30", "turn the brief off", "run Instrumentality when I'm idle". It changes only these two schedules (no card, reversible), and the change applies within a minute without a restart. Models, Telegram, the Scrolls and the base identity are never changeable by chat.

Add `"brief": {"at": "08:00"}` to `config.json` (your time zone, 24-hour) and restart: once a day at or after that time NERV writes a short summary into its inbox, and every channel delivers it from there once (Aoba on Telegram, the menu-bar app, and the dashboard's Debrief panel, which keeps the latest one) — even on a base without Telegram. The summary is in your configured language — cards waiting for you, reminders due in the next 24 hours, what finished or failed since the previous brief, approvals that expired without your decision (nothing ran), and health; every item carries its sortie's short ID (`S-1A2B`), the one the dashboard shows, to find its trace. It is built from the ledger, not by a model, so it is quick and invents nothing. A part it could not read says so (*could not be read for this brief*), never *nothing* or *all checks pass*. It is sent once per day (also across restarts; if the service starts after the time, it is sent then). `npm start -- brief` prints it now.

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

## Tools (MCP servers)

NERV can use tools from MCP servers, beyond its own reminders and memory. **Deny by default:** a server's tools are offered to Misato only after you grant them, one by one.

- `nerv tools add files npx -y @modelcontextprotocol/server-filesystem ~/NERV-files` adds a server (here the reference file-system server, limited to one folder). `npx -y package` fetches the newest version each time NERV starts the server; name a version (`package@x.y.z`) to run the code you checked: a grant notices a tool whose description changed, not one whose code changed. If `npx` fails, `nerv tools` shows the server's own error line; use the full path of a working `npx` (for example `/usr/local/bin/npx`). Servers run only under NERV's tools process, never in the scheduler or the brain, with only PATH, HOME and LANG from your environment.
- `nerv tools` lists each server's tools, marked *read-only* or *destructive* when the server says so, and whether each is granted.
- `nerv tools grant files/read_text_file` grants one tool as a **read** (Pattern Green: it runs without a card); `--eva 00|01|02|03` names the EVA class it belongs to: it runs under that EVA, or a stricter one when the stage asks for it (EVA-03, quarantine, does not run until sandboxes exist). A tool the server marks destructive cannot be granted as a read. Writes come later, with approval cards.
- A grant is **pinned to the tool's description**: if the server changes it (an update), the grant is suspended and Misato no longer sees the tool until you grant it again. `nerv tools revoke files/read_text_file` removes a grant, `nerv tools remove files` a server and its grants.
- Each call goes through the gate like any other action: a ballot, a single-use grant, the result recorded on the sortie. The result is data for Misato, never instructions.

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

`npm run dev` uses **4318**, proxies API calls to **4317** and is only needed for editing the frontend. The installed service serves the production build directly on 4317. Port 4200 is not used. After `npm run build`, run `npm run test:browser` for bilingual, responsive and axe acceptance against a temporary in-memory backend. Chrome/Chromium is required (`CHROME_BIN` overrides its executable); `NERV_BROWSER_ARTIFACTS` keeps screenshots. See the [scoped browser evidence](acceptance/angular-2026-11-06.md).

## Native menu-bar companion — development preview

SwiftUI MenuBarExtra without Electron now includes pairing, Keychain storage, read-only status/reminders and a workspace shortcut. Run native-init, restart the daemon, then pair. Native TLS defaults to 4319; the web workspace remains 4317. Full commands, app build steps, revocation and limits are in [the native guide](../native/README.md). Notifications, guarded start/stop controls and companion launch-at-login selection are now implemented; distribution signing and actual OS permission/login/menu checks remain F-011. No native app is installed on this execution host.

## Isolated child lifecycle

The same launchd/systemd definition starts the supervisor, which starts its two children. A CPU stall or failure in the execution boundary does not stop the scheduler. Scheduler death stops the gateway with failure so the OS supervisor can recover it. The authenticated API doctor reports process PIDs and execution-boundary availability; it does not claim model readiness. Child environment isolation avoids inheriting root/API tokens but does not sandbox processes running under your user. Do not run untrusted tools before the later execution policy/sandbox work. Local native WebSocket reads require an Authorization header; browser use of /rpc remains rejected. Native pairing uses a separate TLS REST flow; client-scoped WebSockets are not implemented.

### Telegram routing visibility

The dashboard’s bases panel shows each base’s own Telegram route check: via main, local fallback, local channel, unavailable (not configured), or unknown. Aoba’s existing local-bot fallback still runs when main cannot deliver. Signed Kaji heartbeats share the route, destination base, checked time and last send route/result/time without bot tokens, chat identifiers or message contents. Reports older than the 90-second online window, future checks beyond the clock tolerance, or offline/revoked bases read unknown; the last report remains visible. Older bases that omit telemetry show state not reported. A send accepted by main or the Bot API does not establish phone receipt. A standalone base shows its own state without Kaji enrolment.

Midori (Telegram on the map) reports recent Bot API checks separately from route checks and message activity. Listener startup alone is not a live check; phone receipt stays unknown. Each configured bot continues to accept owner messages while outgoing inbox delivery uses main. `/status`, `/status BASE-ID-or-name`, `/help` and a narrow “Ask Tabgha his /status” alias answer from recorded state before model planning; unknown slash commands show supported-command help. Status for another base is its last signed report, not a fresh remote diagnostic; the reply says so. Full command coverage and menu registration remain F-056. Update all bases to publish the new API-check/inbound fields; older telemetry cannot establish those checks. Models and Battery now share tabs; Battery still says cost tracking planned. Angular CLI analytics is explicitly disabled in angular.json.

## Configuration bill of materials

Run `nerv bom > runtime.cdx.json` for a CycloneDX snapshot of configured model roles/digests and granted MCP tools. It works without the service, makes an optional local Ollama tags read and emits no credentials, owner content, endpoints or command arguments. It is current configuration, not execution history. CI separately publishes the lock-only dependency SBOM. See [bills of materials](security/bill-of-materials.md).

### Scheduled Instrumentality recovery

At its configured local time (or the next service tick after it), Instrumentality claims a durable local-day slot before asking the model. A failed attempt is visible in service health/doctor and the next Hyuga brief, using a fixed reason rather than raw provider error text. It can retry once after an hour in that slot; a restart cannot reset the two-attempt limit. The existing immediate retry of an unreadable digest belongs to one attempt, so each local-day slot has at most four digest calls for this path. Successful recovery is reported as such; a run with no new exchanges is explicitly skipped. An attempt cut off before its outcome is saved stays pending/unknown and may use the same bounded later attempt. After both attempts fail, the next scheduled day can try again. Manual `nerv instrumentality` is separate from the scheduled attempt limit.

The digest still uses its existing bounded exchange/history window; this change does not claim an unlimited historical export or replay. Candidate facts remain owner-approved cards. Model outage never authorizes cloud fallback and does not stop local reminders.
