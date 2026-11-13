# Memory, Chat, Tools, and Gate Rules

## Talking to Misato

After `npm link`, commands run as `nerv <cmd>` (or `npm start -- <cmd>`):

```bash
nerv chat "Remind me to renew car insurance on 2030-01-15 at 9:00"
nerv chat "What reminders do I have?"
```

- CLI, each Telegram chat, and the dashboard are separate conversations (last 3 exchanges within 30 minutes are included for follow-ups).
- Misato plans one step at a time (max 6 steps), passing each proposed action through the gate before seeing the result.
- Actions requiring approval pause until decided (`nerv approve ID` / `reject ID`, Telegram button, dashboard, or expiry), then Misato resumes and records the follow-up across restarts.
- Times are converted to your configured IANA `timeZone` before Misato sees them.

## Memory (Lilith)

Misato proposes lasting facts as approval cards (*"remember that my dentist is Dr. Rossi"*); nothing is saved until you approve.

```bash
nerv memory list
nerv memory add "I drink coffee at 8"
nerv memory edit ID "I drink tea at 8"
nerv memory forget ID
nerv memory history ID
```

- **Local-only by default:** facts never go to a cloud model unless marked shareable in **Terminal Dogma · Lilith** on the dashboard.
- **Instrumentality:** configure `"instrumentality": {"at": "03:00"}` or `{"when": "idle"}` in `config.json` (or run `nerv instrumentality`) to summarize conversations (`nerv memory episodes`) and propose 3–10 lasting facts as approval cards. Failed scheduled runs retry once after an hour in the same local-day slot.
- **LCL context:** each request includes matching facts, up to two matching Instrumentality summaries (local-only), and recent conversation turns within a route-sized token budget.

## Tools (MCP servers)

MCP servers are **deny-by-default** and run in NERV's isolated `tools` process (`PATH`, `HOME`, `LANG` only):

```bash
nerv tools add files npx -y @modelcontextprotocol/server-filesystem@x.y.z ~/NERV-files
nerv tools
nerv tools grant files/read_text_file --eva 01
nerv tools revoke files/read_text_file
nerv tools remove files
```

- Pin package versions (`package@x.y.z`); NERV pins grants to the tool's description fingerprint and suspends a tool if its description changes.
- Only non-destructive read tools can be granted as Pattern Green (`EVA-03` remains disabled until sandboxing ships).

## Gate rules (the Scrolls)

Every action passes the deterministic gate and (for non-Green or cancel/forget actions) Casper's local intent check. Customize via `~/.nerv/scrolls.json` (`chmod 600`; unknown keys or permissive permissions refuse startup):

```json
{ "deny": ["mail.send"], "blue": ["calendar.delete"], "syncThreshold": 80, "maxRejects": 3, "budget": 1 }
```

Test an action directly through the gate:

```bash
nerv act "What is due?" reminders.list
nerv events SORTIE_ID
```

## Configuration bill of materials

Run `nerv bom > runtime.cdx.json` for a privacy-filtered CycloneDX snapshot of configured model roles/digests and granted MCP tools. See [bills of materials](../security/bill-of-materials.md).
