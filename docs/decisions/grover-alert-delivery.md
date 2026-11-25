# Grover alert delivery

Assessment date: 2026-11-25. Baseline: NERV main `e05aae22`, with the remote MCP registry of F-123-T01 (PR #746, open when this was written); Grover main `b62a29b`. Scope: F-122-T01 design. F-122-T02 builds it; F-122-T03 is the owner's check on the rig. Nothing here is implemented yet. Owner decisions 2026-11-25 (see [Owner decisions](#owner-decisions)) settle the four questions the design left open; Grover main `db0a4c9` was read for the alert kinds and levels.

## What Grover offers

Grover's hub keeps the list of things that need the owner (`apps/hub/src/alerts.ts`) in its own SQLite table and publishes it in three places: its dashboard, `GET /api/alerts` and the MCP tool `grover_alerts` on `/mcp` (streamable HTTP, stateless, on the tailnet). The tool takes no arguments, is annotated read-only and answers with the alerts that are **open now**, newest first:

```json
[{ "key": "probe:tank-water:below", "roomId": "tent-a", "potId": null, "level": "warn",
   "message": "Water tank low (12, alert below 15): refill it. Feeds that need it are refused until then.",
   "since": 1764064800000 }]
```

- `key` is stable while the condition lasts (`probe:<id>:below|above`, `feed:<pot>`, `agent:<id>`). `since` is set when the hub raises it and stored with it, so it survives a hub restart.
- A raise of a key that is already open is ignored by the hub (it only refreshes `message` and `level`); a clear deletes the row. So `(key, since)` names one **episode**: the same key raised again after a clear has a new `since`.
- There is no history, no alert id beyond the key, no cursor and no MCP notification. A clear is visible only as the key's absence.
- Hysteresis is the hub's job (Grover F-008-T02, ready, not built yet): a threshold alert will clear only once the reading is back past a margin. Until it lands, a reading sitting on a threshold can raise and clear repeatedly.

## Decision

### Source: the granted `grover_alerts` tool through the F-123 registry

The owner registers the hub once (`nerv tools add grover https://<machine>.<tailnet>.ts.net/mcp`) and grants `grover/grover_alerts` and `grover/grover_overview` as `read` (Green); the overview gives each probe's kind, which quiet hours need (see [Quiet hours](#quiet-hours)). NERV's alert poller calls that tool through the same registry connection Misato uses, so it inherits F-123's rules: deny by default, the URL as registered (no redirects), a grant pinned to the tool's description (a changed description suspends it), and unreachable servers reported rather than hidden.

The poller is deterministic code in A (the scheduler process), not a planner request: no model reads the alert text to decide whether to send it. It runs only where Telegram's outbound deliveries run (the coordinator, F-036/F-016), so two bases never poll and deliver the same hub. Without a granted `grover_alerts` the poller does nothing and `nerv doctor` says why. The configuration names the registered server id, so a later second hub is a second entry, not new code:

```json
"grover": { "server": "grover", "pollSeconds": 60, "unreachableMinutes": 15, "quietHours": { "from": "22:00", "until": "07:00" } }
```

The window and the 15 minutes are the owner's decisions of 2026-11-25; `pollSeconds` is bounded 30–600.

Answering `nerv chat "ci sono allarmi Grover?"` needs no new code: Misato calls the same granted read tool (F-123). The poller adds proactive delivery only.

### Polling, not subscription

Grover's MCP endpoint is stateless and offers no `resources/subscribe` or notifications, so there is nothing to subscribe to. Its live WebSocket (`/api/live`) does carry `alert` events, but it is not MCP: it would bypass the registry, its grant and its reachability reporting, and add a second long-lived connection to a Raspberry Pi. Rejected. NERV polls `grover_alerts` every `pollSeconds` (default 60) and diffs the snapshot against its own ledger.

Consequence, accepted: an episode that is raised and cleared between two polls (under a minute) is never seen. Grover's hysteresis makes such episodes rare and they are, by definition, already over. If the owner later wants them, Grover would add an alert history with a cursor; that is Grover's backlog, not this one.

### The ledger: one row per episode, in NERV's SQLite

A new A-owned table, replicated with the coordinator tables (`REPLICATED_COORDINATOR_TABLES`, next to `deliveries`), so a coordinator handover does not deliver twice:

```sql
CREATE TABLE IF NOT EXISTS grover_alerts(
  server TEXT NOT NULL, alert_key TEXT NOT NULL, since INTEGER NOT NULL,
  room_id TEXT NOT NULL, pot_id TEXT, level TEXT NOT NULL, message TEXT NOT NULL,
  seen_at TEXT NOT NULL, raised_delivery TEXT UNIQUE REFERENCES deliveries(id),
  absent_polls INTEGER NOT NULL DEFAULT 0, cleared_at TEXT, cleared_delivery TEXT UNIQUE REFERENCES deliveries(id),
  PRIMARY KEY(server, alert_key, since));
CREATE TABLE IF NOT EXISTS grover_poll(server TEXT PRIMARY KEY, ok_at TEXT, failing_since TEXT, unreachable_delivery TEXT);
```

Each successful poll runs in one SQLite transaction:

1. **New episode** (a `(key, since)` with no row): insert the row and one `deliveries` row of kind `grover_alert`, with a deterministic id (`grover:<server>:<key>:<since>:raised`, `INSERT OR IGNORE`). The alert is delivered once.
2. **Open episode still present**: reset `absent_polls`, keep the latest `message` and `level` for the clear's text. Nothing is sent: a refreshed message or level is not a new alert.
3. **Open episode absent**: increment `absent_polls`. At **2** consecutive successful polls without it, set `cleared_at` and insert one clear delivery (`…:cleared`). The clear is delivered once. If the same `(key, since)` comes back before that, the episode simply continues and nothing was sent.
4. A failed poll (unreachable, timeout, suspended grant, not an MCP answer) changes no episode: absence from a failed poll is never a clear.

Channels send from `deliveries`, never from the poll, so a crash between the poll and a send loses nothing and repeats nothing: on restart the ledger already holds the episode (no second delivery row) and each channel resumes from its own durable position (Telegram's persisted inbox cursor; push per F-004-T09's delivery record).

Rows of cleared episodes are kept 30 days, then pruned with the deliveries they point to left untouched.

### No resend inside the hub's hysteresis

NERV does not re-derive thresholds or margins: Grover owns the ranges. While the hub holds an alert inside its margin, the episode keeps its `(key, since)` and step 2 sends nothing, however many polls see it. The two-poll clear confirmation is not a second hysteresis: it only absorbs a key that vanishes for one poll. Until Grover F-008-T02 lands, a value flapping at a threshold produces separate episodes, each delivered once; that is the hub's flapping, recorded as a Grover gap, and NERV does not hide it.

### While the hub is unreachable

- Open episodes stay open; nothing is cleared and nothing is re-sent. The poller keeps trying at the normal interval.
- `grover_poll.failing_since` records the start. After `unreachableMinutes` (15, owner decision 2026-11-25) without contact, one delivery says the hub is unreachable and why (F-123's reason: unreachable, certificate, HTTP status, timeout, suspended grant). When a poll succeeds again, one delivery says it is back; both are once per outage. Unreachable is never a clear: no episode closes because the hub could not be asked. The Tools panel already shows the suspended tools (F-123).
- The first successful poll after an outage is diffed like any other: alerts raised meanwhile are delivered once, alerts already delivered before the outage are not sent again, alerts gone are cleared after the second poll confirms. An episode raised and cleared entirely within the outage is not seen.
- A NERV restart is the same case from NERV's side: the ledger carries the state across it.

### First poll of a hub

Owner decision 2026-11-25: the alerts already open at the first successful poll of a server with no ledger rows are **delivered once, not recorded silently**. They go out as one message listing them, so registering a hub with five open alerts rings once, not five times; each still gets its own ledger row, inbox entry and later clear. The same holds after a long reconnect: an alert first seen on the poll after an outage is delivered once (it has no ledger row yet), an alert already delivered before it is not. With several new episodes on one poll, the same single listing message is used.

### Channels

Owner decision 2026-11-25 (F-004-T09): **push first, Telegram as fallback**.

- **Inbox** always, at once: the `deliveries` row is the durable record (dashboard Comms, `nerv inbox`, companion), shown during quiet hours too.
- **Phone push** first (Web Push through `store-push`, payload encrypted end to end to the device).
- **Telegram** (Aoba) only when the push fails, no device is subscribed, or the alert is not opened on the phone within about 10 minutes: F-004-T09's rule, applied to `grover_alert` deliveries as to reminders. A clear follows the route its alert took: a clear of an alert that reached Telegram also goes to Telegram; otherwise push and inbox only.
- Replies stay where they are today: the owner asks Misato on Telegram or in the app; Fusing Midori's Telegram and the PWA into one conversation is F-124, not this record.

Text, plain and short (no Markdown parse mode on Telegram; control characters stripped; message capped at 300 characters):

- `Grover · tent-a: Water tank low (12, alert below 15): refill it.`
- `Grover · tent-a cleared after 2 h 10 min: Water tank low.`

The hub's message is untrusted remote text: it is shown, never put into a planner prompt by the poller, and an entry that does not match the shape above (`key`, `roomId`, `level` of `warn|bad`, `message`, numeric `since`) is skipped and counted in `nerv doctor`, without blocking the valid ones.

Privacy: alert text (room names, sensor values) leaves the base only through the channels the owner already uses; push payloads are encrypted to the device, Telegram bot chats are not end-to-end encrypted (as for every Telegram delivery today).

### Quiet hours

Owner decision 2026-11-25: quiet hours are **22:00–07:00** local. During the window the inbox row is written at once. A **serious** alert, and its clear, goes out at once as outside the window. A **minor** one is held from push and Telegram; at 07:00 the held alerts and clears of that night go out as one message (an alert raised and cleared inside the window reads as one line, "raised 02:10, cleared 03:40"), so each alert and each clear still reaches each channel once. The window uses the owner's IANA timezone and the same clock rules as Hyuga watch (`watchQuiet`).

**Serious is defined by alert kind, not by Grover's `level`.** Grover's alerts do carry a severity field (`level`: `warn` or `bad`), but it does not follow the owner's split: a pH or EC reading out of range is raised as `warn`, an agent going offline as `bad` (Grover `db0a4c9`, `apps/hub/src/alerts.ts` and `feeder.ts`). Using it would hold pH alerts overnight and ring for an agent blip, the opposite of the decision. So the poller classifies by the key, explicitly:

| Alert (key shape) | Grover's level | Class at night |
|---|---|---|
| `probe:<id>:below` / `probe:<id>:above` where the probe's kind is `ph` or `ec` (pH or EC out of range) | `warn` | **Serious**: breaks through |
| `feed:<pot>` raised as `bad` (a feed stopped mid-run, everything switched off: a pump or driver fault) | `bad` | **Serious**: breaks through |
| `probe:<id>:below` / `:above` for `air_temperature`, `water_temperature` or `water_level` (for example a supply tank low) | `warn` | Minor: waits until 07:00 |
| `feed:<pot>` raised as `warn` (a feed refused before it started, for example a tank low or the agent refusing) | `warn` | Minor: waits until 07:00 |
| `agent:<id>` (an agent offline, the tent on its own schedules) | `bad` | Minor: waits until 07:00 |
| Any other key shape, or a probe whose kind cannot be read | — | **Serious**: breaks through, and `nerv doctor` names the unknown kind |

The probe's kind comes from `grover_overview` (`probes[].id`, `kind`), read on the first poll and again whenever a probe alert names an id NERV has not seen; a failed or ungranted overview leaves the kind unknown, which counts as serious. The `feed:<pot>` split uses the level because Grover raises both cases under the same key. Unknown kinds break through rather than wait so that an alert kind Grover adds later (a dedicated driver fault, for example) is not silenced overnight before this table names it; a new kind is added here and in the classifier's test in the same change. The clear of an alert follows its alert's class.

## Alternatives rejected

- **Subscribe to `/api/live`**: outside the MCP registry and its grant, a long-lived socket per hub; no restart cursor either.
- **Deduplicate by `key` alone**: a re-raised alert after a real clear would be swallowed.
- **Deduplicate in memory**: a NERV restart would resend every open alert.
- **Ask a model whether to notify**: no judgement is needed, and the alert text is untrusted input.
- **Change Grover to add alert ids or history**: not needed for the acceptance; this repository does not change Grover (one repository, one backlog).

## Owner decisions

The owner answered the four questions on 2026-11-25; the sections above apply the answers.

1. **First poll and long reconnects**: the alerts already open are delivered once, as one message listing them, not recorded silently ([First poll of a hub](#first-poll-of-a-hub)).
2. **Quiet hours**: 22:00–07:00 local. Serious alerts always break through (pH or EC out of range, pump or driver faults); minor ones, such as an agent briefly offline, wait until morning. Grover's `level` does not match that split, so serious is defined by alert kind, listed in [Quiet hours](#quiet-hours). The question had proposed "`bad` breaks through"; the owner's answer replaces it.
3. **Unreachable hub**: one message after 15 minutes without contact, one when contact returns; unreachable is never a clear ([While the hub is unreachable](#while-the-hub-is-unreachable)).
4. **Order**: F-122-T02 is built after F-004-T09 is live and owner-checked, that is after F-004-T10; it uses the push-first router and does not ship its own channel order first.

## Test plan for F-122-T02

One test across the join, in `test/grover-alerts.test.ts`: a **fake Grover MCP server** (an HTTP server on `127.0.0.1` answering streamable HTTP JSON-RPC `initialize`, `tools/list` and `tools/call grover_alerts` from a scripted sequence of snapshots, the same pattern as F-123's `test/mcp-remote.test.ts`) → the real F-123 registry and HTTP client → the real poller and a real Store on a temporary SQLite file → **fakes** for push (the store's push fetch), Telegram (the Bot API stub of `test/telegram.test.ts`) and the inbox read back with `inboxPage`. Clock and poll ticks are driven by the test, not timers. Invented data only: room `tent-a`, probe `tank-water`, agent `agent-1`.

| # | Script | Expected |
|---|---|---|
| 1 | `[A]` polled three times | one inbox row, one push, no Telegram |
| 2 | `[A]`, `[]`, `[]`, `[]` | one clear after the second empty poll, nothing after |
| 3 | `[A]`, `[]`, `[A]` (same `since`) | no clear sent |
| 4 | `[A since 1]`, `[]`, `[]`, `[A since 2]` | alert, clear, alert again: three deliveries |
| 5 | `[A]`; close and reopen the Store on the same file, new poller; `[A]` | no second delivery, Telegram sends nothing new |
| 6 | Crash after the ledger commit, before any send (stop the poller after the transaction) | after restart each channel sends the alert exactly once |
| 7 | `[A]`, server stopped for longer than `unreachableMinutes`, restarted with `[B]` | A stays open while down; one unreachable and one back message; then B delivered, A cleared after two polls |
| 8 | Clock inside quiet hours, `[agent:agent-1]`, `[]`, `[]`; clock moves past 07:00 | inbox at once; one push at 07:00 with "raised … cleared …" |
| 8a | Clock inside quiet hours, `[probe:ph-1:below]` (overview: kind `ph`), `[feed:pot-1 bad]`, `[probe:tank-water:below]` (kind `water_level`), `[probe:x:above]` (unknown kind) | the pH, the bad feed and the unknown-kind alert pushed at once; the tank alert held to 07:00; doctor names the unknown kind |
| 9 | Push fake answers 500, then no device subscribed | Telegram sends the alert once in each case (F-004-T09 rule) |
| 10 | Tool not granted; grant suspended by a changed description | no poll call, no delivery, doctor names the reason |
| 11 | A malformed entry next to a valid one; a 2 000-character message with Markdown | the valid one delivered; message capped and sent as plain text; doctor counts the skipped entry |
| 12 | Store opened as a standby base | it does not poll |
| 13 | First poll with two open alerts; then an outage past `unreachableMinutes` and a reconnect with one alert already delivered and one new | first poll: one message listing both, two inbox rows; after the reconnect: only the new one delivered, none cleared during the outage |

## Reconsider when

Grover adds alert history, ids or MCP notifications; a second hub or another MCP source needs the same delivery; F-004-T09 or F-124 changes the channel order; the owner reports missed short alerts.
