# Memory, Chat, Tools, and Gate Rules

## Talking to Misato

After `npm link`, commands run as `nerv <cmd>` (or `npm start -- <cmd>`):

```bash
nerv chat "Remind me to renew car insurance on 2030-01-15 at 9:00"
nerv chat "What reminders do I have?"
```

- CLI, each Telegram chat, and the dashboard are separate conversations (last 3 exchanges within 30 minutes are included for follow-ups). The dashboard chat's **New conversation** button starts a clean one.
- Once a tool result (for example an MCP answer) has entered a conversation, NERV runs no further outside tools in it: Misato says so once and stops. Start a new conversation, or write again after 30 minutes without messages there.
- Misato plans one step at a time (max 6 steps), passing each proposed action through the gate before seeing the result.
- Actions requiring approval pause until decided (`nerv approve ID` / `reject ID`, Telegram button, dashboard, or expiry), then Misato resumes and records the follow-up across restarts.
- Times are converted to your configured IANA `timeZone` before Misato sees them.

## Memory (Lilith)

Misato proposes lasting facts as approval cards (*"remember that my dentist is Dr. Rossi"*); nothing is saved until you approve. If one request contains facts about several subjects, they appear together on one card: edit or remove any fact, then approve the remaining facts together.

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

## Tools

MCP servers are **deny-by-default** and run in NERV's isolated `tools` process (`PATH`, `HOME`, `LANG` only; the node folder is added to `PATH` only for a server started as `node`, `npx` or `npm`):

```bash
nerv tools add files npx -y @modelcontextprotocol/server-filesystem@x.y.z ~/NERV-files
nerv tools
nerv tools grant files/read_text_file --eva 01
nerv tools revoke files/read_text_file
nerv tools remove files
```

- `nerv tools` lists NERV's built-in tools and configured MCP tools through one registry. Every descriptor has a stable version; changing a name, effect, description or argument schema changes that version.
- A bare `node`, `npx` or `npm` runs from the folder of the node that runs NERV, so it works under the service's short PATH; any other bare command is looked up in the service PATH, never through a shell. When it is not found, the error names the folders searched: set the command's absolute path instead. `nerv doctor` lists each server under `mcp` with its tool count or why it cannot start (the service starts the servers, so it needs the service running). A grant on a server that cannot start shows as suspended and comes back by itself once the server starts.
- After a tool result enters a conversation, no outside tool runs there (see above). For a read on a server you run yourself, you can allow it anyway: add `"allowTainted": true` to that read grant in `config.json` (`tools.grants`). Only read grants accept it, and the read still runs no less confined than its grant's EVA class. The risk you accept: text planted in an earlier result could make Misato put data into that read's arguments, which the server then receives.
- Pin package versions (`package@x.y.z`); NERV pins grants to the tool's description fingerprint and suspends a tool if its description changes.
- A grant names an effect class (`--effect read` by default): a read is Pattern Green; `write-external` is Orange; `irreversible` and `physical` are Blue, a card for every call, which runs once you approve it. A tool the server marks as destructive must be `irreversible` or `physical` (`EVA-03` is currently disabled; see [the roadmap](../ROADMAP.md) for planned isolation work).
- A server already running on another machine, such as a hub on the tailnet, is added by its URL: `nerv tools add hub https://<machine>.<tailnet>.ts.net/mcp`. See [A remote MCP server on the tailnet](remote-mcp.md).

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
