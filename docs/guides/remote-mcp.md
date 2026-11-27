# A Remote MCP Server on the Tailnet

NERV can use the tools of an MCP server that already runs on another machine, such as a hub on a Raspberry Pi published on your tailnet, through the same deny-by-default registry as a local server ([Tools](memory-and-chat.md#tools)). NERV talks to it over streamable HTTP: JSON-RPC by `POST` to the server's MCP URL, with the answer as JSON or as an event stream.

Nothing is sent to the server until NERV lists or calls its tools. Each call goes only to the URL you registered (redirects are refused). A tool's arguments go to that machine, so only grant tools you mean NERV to use there.

## 1. Register the server

On the server's machine, publish it on the tailnet over HTTPS (for example `sudo tailscale serve --bg 8080`), so it answers at `https://<machine>.<tailnet>.ts.net/mcp`. Then on the NERV base:

```bash
nerv tools add hub https://<machine>.<tailnet>.ts.net/mcp
nerv tools
```

- The id (`hub`) is lower-case letters and digits; it prefixes each tool's name (`hub.hub_overview`).
- The URL must be `https://`. Plain `http://` is accepted only for `127.0.0.1` or `localhost` (a server on the same machine; `localhost` is whatever `/etc/hosts` maps it to, so `127.0.0.1` is the safer choice). A user name or password in the URL is refused: `config.json` is not a secret store.
- Adding a server again under the same id replaces it and drops its old grants.
- `nerv tools` lists each tool with what the server says about it (`read-only`, `destructive`) and whether it is granted.

## 2. Grant tools, each with an effect class

No tool is offered to Misato until you grant it. The effect class you choose decides how the gate treats each call:

| Effect | Pattern | What happens on a call |
|---|---|---|
| `read` (default) | Green | runs at once |
| `write-external` | Orange | the MAGI vote; Blue after untrusted input, such as an earlier MCP result in the same request |
| `irreversible`, `physical` | Blue | you approve each call on a card; it runs once you approve |

```bash
nerv tools grant hub/hub_overview                         # a read, EVA-00
nerv tools grant hub/hub_take_cuttings --effect write-external
nerv tools grant hub/hub_run_pump --effect physical       # hardware: a card for every call
```

- Without `--effect`, a grant is a `read` (Green: it runs without asking). A tool that carries no annotations is not checked against that default, so choose its class deliberately: give anything that changes state, records or hardware the class that fits it.
- A tool the server marks as not read-only cannot be granted as `read`. A tool it marks as destructive must be `irreversible` or `physical`, so every call is yours to approve.
- `write-local` is refused for a server on another machine: its changes are outside this base.
- A change runs in EVA-01 by default (`--eva 01`); EVA-00 is shadow work and refuses outside effects. EVA-03 does not run yet.
- A grant is pinned to the tool's description. If the server changes it, the grant is suspended until you grant it again.
- `nerv tools revoke hub/hub_run_pump` withdraws a grant; `nerv tools remove hub` removes the server and its grants.
- `nerv modules off hub` turns the server off without losing anything: Misato is offered none of its tools, its dashboard cards hide and nothing calls it, while its grants stay in config.json. `nerv modules on hub` brings it back with the same grants (a tool whose description changed meanwhile stays suspended). The same switches are in the Modules panel on the full dashboard. See [Modules](#modules).

For a hub that drives hardware, a sensible start: its read tools as `read`, its record-keeping tools as `write-external`, and every tool that moves hardware as `physical`.

## 3. When the server cannot be reached

An unreachable server is reported, not hidden:

- `nerv tools` prints `could not list its tools:` with the reason: `<host> is unreachable (<code>): is that machine on, and is this one on the same tailnet?` for any failure to connect (refused, reset, closed, no route or name, a connect timeout; `<code>` is the one the system gave), a certificate this base does not trust, `HTTP 404` (check the path ends in `/mcp`), no answer in time, or not an MCP server.
- Its granted tools leave Misato's list and appear as suspended, with the same reason, in the dashboard's Tools panel (`GET /api/tools`). They come back by themselves once the server answers again.
- An action you approved while the server was unreachable does not run. Misato is told it was approved but did not run, and why.
- An approval issues a single-use grant that lasts 60 seconds. NERV normally makes the call within a few seconds of your approval. If it gets to it later (for example, the service was stopped), the call does not run and Misato says why: ask again. An approval never runs a call twice.

## The coordinator's live index

The coordinator's live index (every project's backlog, rebuilt from git) is an MCP server on the same machine, at `http://127.0.0.1:7380/mcp`. Install and start it first ([its install page](https://github.com/voidbrain/coordinator/blob/main/docs/live-index-install.md)), then register it under the id `coordinator` and grant its three read tools as reads:

```bash
nerv tools add coordinator http://127.0.0.1:7380/mcp
nerv tools grant coordinator/waiting_on_me
nerv tools grant coordinator/blocked_by
nerv tools grant coordinator/record_lookup
```

The full dashboard (open it with `nerv open full`: typing `/full` in the address bar reloads the page and asks to sign in again) then shows a card with your turn across every project, what each step unblocks, how old the index's snapshot is and the projects it could not read (their work is unknown, not none), each row linked to its source file on GitHub. The card reads the index through these grants every 5 minutes and on Refresh, and keeps no copy. It uses `waiting_on_me` and `blocked_by`; `record_lookup` is for questions in chat. Until the server and both grants exist, the card shows the commands still to run; a grant other than `read` is not used; when the index is not running it says so, never that nothing waits.

## Modules

`nerv modules` lists every module with on or off, whether it answers and how many tools it gives Misato: each MCP server, and the built-in packs. FPVBuddy is one module: today it is the built-in FPV pack (batteries, fleet); when the FPVBuddy server is registered as `fpvbuddy` it joins the same switch. Cooking is its own module.

```bash
nerv modules
nerv modules off grover
nerv modules on grover
```

Off is stored in config.json: `"off": true` on the server's entry in `tools.mcp`, or `"packs": {"fpv": false}` for a pack. Off differs from `nerv tools remove`, which deletes the server and its grants.

## Check it

1. `nerv tools`: the server's tools are listed, each granted one with its effect class and EVA.
2. Ask Misato something a read tool answers (for the hub, "How is the tent?"): she answers with no card.
3. Ask for an action you granted as `physical`: a card appears, and the call runs only after you approve it.
