# Channels, Dashboard, and Proactive Watches

## Dashboard

`nerv open dashboard` opens **http://127.0.0.1:4317/dashboard/** using a short-lived dashboard session (12 h, tab close, service restart, or `nerv sessions revoke`). Demo data only loads when opened from disk or with `?demo`.

`nerv open --phone` prints a one-use pairing code (`XXXX-XXXX`, 5 minutes) for a phone. `POST /api/device/pair` with `{code, name}` swaps it once for a device credential that the phone sends as its bearer: same powers as a dashboard session, stored only as a hash in `devices.json` (mode 0600), lapsing after 90 days without use, revocable per device (`GET`/`DELETE /api/devices`, admin token) and ended by rotating the admin token. Failed codes are limited to 5 a minute per client; 20 a minute in all lock pairing for a minute, doubling up to an hour and back to a minute after an equally long quiet period. Pending pairing and login codes end when the admin token rotates, and both code exchanges take `Content-Type: application/json` only (415 otherwise).

- **Sorties & search:** `/` filters loaded sorties; **Load older sorties** pages history in chunks of 50 (`GET /api/sorties`).
- **Approvals:** `a` approves once and `r` rejects in two presses (`Esc` cancels). **Spear this sortie** stands down cards and revokes unused grants.
- **Reminders & Memory:** edit/cancel pending reminders (`PATCH`/`DELETE /api/reminders/ID`), manage Lilith facts, and reload `config.json` from the Health panel.
- **Models & Battery:** share one panel with tabs; Battery pages recorded model accounting and estimated cost snapshots.

## Telegram (Aoba)

Aoba uses outgoing HTTPS polling only (no open ports). Note that Telegram bot chats are not end-to-end encrypted on Telegram's servers.

1. Create a bot with **@BotFather** (`/newbot`).
2. Save the token privately: `nerv telegram token`.
3. Send `/start` to your bot, then run `nerv telegram link` (or `nerv telegram link --relink`).
4. Restart the service (`Aoba (Telegram): linked, listening.`).

- Messages older than 10 minutes are ignored (asks you to resend). Approvals arrive with single-execution **Approve once** / **Reject** buttons and clean up buttons when decided elsewhere.
- `/status`, `/status BASE`, and `/help` answer from recorded state before planning.
- If `fetch failed` occurs behind a corporate/system CA while `curl` works, reinstall the service (`nerv service install`) so Node runs with `--use-system-ca`.
- **Map & routing visibility:** Midori shows recent Bot API checks separately from route checks (`via main`, `local fallback`, `local channel`, `unavailable`, `unknown`).

## Hyuga's daily brief & base chronicle

- Add `"brief": {"at": "08:00"}` in `config.json` (or ask Misato: *"brief at 8:30"*, *"turn the brief off"*) for a once-daily ledger-built summary delivered to the inbox, Telegram, dashboard Debrief, and companion. Run on demand with `nerv brief`.
- `nerv chronicle` (or `chronicle 365`) prints daily milestone history from SQLite and the signed registry: base enrollments/revocations, Kaji outages (>90 s), route outages (>1 min), pilot stage promotions, and first remote actions.

## Proactive watches (Hyuga)

Add an optional `watch` block to `config.json` (`serve` re-reads it every minute):

```json
{
  "watch": {
    "triggers": [
      {
        "id": "morning-check",
        "request": "Read my pending reminders and give me a short summary.",
        "schedule": { "at": "08:00" },
        "maxActions": 1,
        "maxSteps": 3
      }
    ],
    "quietHours": { "from": "22:00", "until": "07:00" }
  }
}
```

- **Schedules:** `{"at": "HH:MM"}`, `{"everyMinutes": 1..1440}`, or `{"event": "sortie.failed" | "sortie.done"}` (max 20 triggers, 20 pending attempts; missed slots are not replayed).
- **Budgets & stages:** `maxActions` and `maxSteps` (1–6, actions ≤ steps) reserve durably across restarts. Planning uses the local route only. Optional `"pilot": "id"` binds a pilot; non-Production watches are read-only.
- **Quiet hours:** `from` (inclusive) to `until` (exclusive, midnight-crossing supported) defer new watch briefs and notifications while keeping existing inbox items and due reminders active.
