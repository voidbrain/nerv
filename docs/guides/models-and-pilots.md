# Models and Pilots

## Model routes

`npm start -- init` checks Ollama on `http://127.0.0.1:11434` (or `NERV_OLLAMA`) and assigns Misato and Casper to its largest available model when unset.

- `npm start -- models` — list role routes/models, cloud status, and installed Ollama models.
- `npm start -- models set misato MODEL` / `models set casper MODEL` — pick a local Ollama model.
- `npm start -- models cloud on` and `models set misato cloud` — route Misato through Claude.
- `npm start -- models key` — store the Claude API key in `~/.nerv/anthropic-key` (hidden prompt, `chmod 600`; never via env/CLI/config).
- `npm start -- models set consultant MODEL` (or `off`; alias `pilots generic MODEL`) — set the generic fallback adviser (local-only, runs before Misato plans, never votes or acts).

Every command validates before writing and updates the running service without a restart.

### Manual `config.json` setup

```json
{
  "models": {
    "local": { "baseUrl": "http://127.0.0.1:11434/v1", "model": "gemma4:12b" },
    "cloud": { "provider": "anthropic", "enabled": true },
    "roles": {
      "misato": { "route": "cloud" },
      "casper": { "model": "gemma4:12b" }
    }
  }
}
```

- **S² (local):** any loopback OpenAI-compatible endpoint (Ollama `11434/v1`, LM Studio `1234/v1`).
- **Umbilical (cloud):** Claude (defaults to `claude-opus-5-5`). Only Misato may use cloud; Casper always stays local because it inspects action arguments.
- `npm start -- ask "text"` uses S² only; `npm start -- ask --cloud "text"` uses Claude. NERV never falls back to cloud when S² is down.
- After manual edits to `config.json` or `anthropic-key`, run `npm start -- reload`.

### Getting a Claude API key

Claude Pro/Max subscriptions do not include API access. Add billing at [console.anthropic.com](https://console.anthropic.com), create an API key, and store it without shell history:

```bash
read -rs KEY && printf '%s\n' "$KEY" > ~/.nerv/anthropic-key && chmod 600 ~/.nerv/anthropic-key && unset KEY
```

### Restarts and route outages (Dummy Plug)

- In-flight requests at shutdown are closed as *interrupted*; requests waiting on an approval card resume once decided.
- The brain tracks each route from live calls and a 1-minute local TCP probe. When a route is down, `doctor`, `/api/status`, the dashboard, and the daily brief report `degraded`; reminders and rule-based actions continue, while model requests fail with the route reason.

## Pilots (Marduk Institute)

Specialists advise Misato when a request matches their keywords (advice only, recorded in the trace, never a vote or action):

- `pilots add printer --name "Print Master" --domain "3D printing" --keywords "filament, 3D print, slicer" --model gemma4:12b`
- `pilots pin ID`, `pilots retire ID`, `pilots restore ID`, `pilots set ID --keywords …`, `pilots set ID --stage prototype|test|production`
- Priority: pinned pilot → most matched keywords → later stage → generic fallback.
- When no specialist fits, the generic pilot tags the request field; after three matching requests in 30 days, Marduk proposes a new specialist card (or ask Misato: *"make me a pilot for photo editing"*).
- The dashboard **Pilots** panel updates each pilot's local Ollama model independently. Only local Ollama models are supported for pilots today; see [the roadmap](../ROADMAP.md) for planned routing work.
