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
- **Keep the model warm:** every local call asks Ollama to keep that model loaded for `models.local.keepAlive` afterwards (default `30m`; from `1m` to `24h`, for example `"keepAlive": "2h"` next to `model`), so the next reply after a pause does not wait for the model to load. `"alwaysLoaded": true` keeps it loaded until Ollama stops (it holds the model's memory, about 16 GB for `gemma4:26b`). Both are in the dashboard Settings. Why and how: [keep the local model warm](../decisions/keep-model-warm.md).
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
- **Thinking now** (top of the Pilots panel): while a model call runs, a line names who is thinking, in which role and on which model, for which sortie, and for how long: *Generic pilot · Consultant (gemma4:26b) · S-19EE · thinking 12 s*; Misato planning and Casper checking show the same way (Simple theme: *Planner*, *Review*). The pilot's card carries a THINKING badge (a consultant not in the roster marks the generic pilot), and the sortie card shows the same line. It comes from `GET /api/thinking` (same access as `GET /api/pilots`), re-read when the dashboard's existing change feed says something changed; the seconds are counted by the browser. The line goes when the call ends, fails or times out, when the brain process stops, and after a service restart (the list lives in memory only). It is not an EVA job (the EVA cages count only those), not an activity log, and carries no prompt or answer text.

## Skills (Kaji's watermelons)

A skill is a versioned procedure package a pilot uses. `nerv skills stage <package.json>` stores a version, `nerv skills evaluate` measures it against the same cases without the skill, and `nerv skills promote` makes it active only with your approval; `nerv skills list` and `nerv skills inspect` read the store.

- The dashboard **Kaji's watermelons** panel shows the real store, read-only, through `GET /api/skills` (names, versions and evaluation numbers, never instructions or scripts): one row per version on its tab. **Seed** is staged and not evaluated yet, **Sprout** staged and evaluated, **Ripe** active, **Dropped** retired or rolled back (in the Simple theme: Create, Try, Use, Dropped).
- With no skills the panel says: "No skills yet. Create one with nerv skills stage <package.json>".
- **In chat, only an active (Ripe) version applies.** Its manifest lists `triggers`, phrases you would type (for example `"triggers": ["controlla se è richiesta un'altra dose", "need a dose"]`, up to 20, 120 characters each); a request that contains one, as whole words in any case and with any punctuation, follows that skill. When several active skills match, the longest trigger wins. A skill without triggers never applies, and Seed, Sprout and Dropped versions never do. The domain is shown, not matched: your phrases rarely name it.
- An applied skill's instructions go to Misato with the request, and she is offered only the tools in its `requiredCapabilities`; any other tool she proposes goes back to her before the gate, and the tools she uses still pass the gate. A skill applies only when each of its tools is granted (or enabled) now and is a read: otherwise it is refused, and the sortie's trace says why (for example "Skill … not applied: it needs grover.grover_readings, which is not granted or not enabled now"). Instructions longer than 8000 characters are refused too, never cut. A version is bound to the files it was staged with: if any stored file of a promoted version changes afterwards, it is refused ("its stored files changed since it was staged") and cannot be promoted again; stage, evaluate and promote a new version instead. A version staged before NERV recorded these digests is refused the same way until you stage it again as a new version. The panel still shows such a version as Ripe; the sortie's trace shows the refusal.
- The reply ends with the line `Skill: <title> (<id> <version>)`, written by NERV, not the model, and the Comms trace shows `Skill: <title> · <id> <version> · tools …`. Watches never apply skills.
