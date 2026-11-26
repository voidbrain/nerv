# Keep the local model warm (F-144-T01)

**Decided by the owner on 2026-11-26** in chat: "ollama a+b, c as option in dashboard". A: keep the role models loaded longer after their last use; B: warm them at known moments; C: an optional "keep loaded always" setting in the dashboard, off by default.

## How the keep-alive reaches Ollama

Ollama unloads a model some minutes after its last request (5 by default) unless the request carries `keep_alive`. NERV calls the local route through Ollama's OpenAI-compatible `/v1/chat/completions`, whose documentation does not list `keep_alive`, so it was probed live.

**Probe, 2026-11-26 on the owner's Mac** (Ollama 0.40.16, `gemma4:e2b-it-q4_K_M`, one-token replies, then `ollama stop`): `/v1/chat/completions` with `"keep_alive": "17m"` left the model loaded "16 minutes from now" in `ollama ps`; with `-1`, "Forever"; streamed with `"3h"`, "3 hours from now".

**Choice: `keep_alive` in the same `/v1/chat/completions` request**, on the local route only.

- No second request and no change to the streamed call, its structured outputs (B-136) or its reply parsing.
- The alternative, a prompt-less `POST /api/generate {model, keep_alive}` after each reply, was built first and dropped: a second request per reply, and it confused every test double that answers each request as a chat reply. The same prompt-less request remains the right tool for warming a model at known moments (part B, F-144-T03), where there is no chat call to carry it.
- The cloud route never carries it. A local route that is not Ollama (LM Studio, for example) receives one unknown field.

## The settings

In `config.json`, under `models.local`:

- `keepAlive`: whole seconds, minutes or hours (`90s`, `30m`, `2h`), from 1 minute to 24 hours; default `30m`. Any other value is refused when the configuration is read, so no free string reaches Ollama.
- `alwaysLoaded`: `true` sends `keep_alive: -1`, so the model stays loaded until Ollama stops or something unloads it. Off unless set; turning it off keeps `keepAlive`. A pinned model holds its memory (about 16 GB for `gemma4:26b`) against virtual machines and image runs.

Both apply to every role on the local route (Misato on the local route, Casper and the consultant), because they share the same local call. The dashboard Settings and `PUT /api/models` (`warm: {keepAlive, alwaysLoaded}`) change them without a restart.

## Reconsider when

Ollama drops `keep_alive` from `/v1`, NERV moves its local calls to the native API, or a local route that is not Ollama refuses the field.
