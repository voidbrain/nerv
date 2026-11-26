# Keep the local model warm (F-144-T01)

**Decided by the owner on 2026-11-26** in chat: "ollama a+b, c as option in dashboard". A: keep the role models loaded longer after their last use; B: warm them at known moments; C: an optional "keep loaded always" setting in the dashboard, off by default.

## How the keep-alive reaches Ollama

Ollama unloads a model 5 minutes after its last request unless the request carries `keep_alive`. NERV calls the local route through Ollama's OpenAI-compatible `/v1/chat/completions`. Ollama's documentation of that endpoint lists no `keep_alive` field, so NERV does not rely on it. Its native API documents two ways: `keep_alive` on `/api/chat`, and a `POST /api/generate` with a model and no prompt, which loads the model and sets how long it stays.

**Choice: a prompt-less `POST /api/generate {model, keep_alive}` after each local reply.** (Checked against Ollama's API documentation, not on the owner's Mac; F-144-T08 checks it there with `ollama ps`.)

- It needs no change to the streamed `/v1` call, its structured outputs (B-136) or its reply parsing: moving every role call to native `/api/chat` would mean a second streaming parser for one setting.
- The same request is the warm-up of part B (F-144-T03): one mechanism, used after a reply and at known moments.
- It does not delay the reply: it is sent after the reply is complete, and its result is ignored. If the local route is not Ollama (LM Studio, for example), only this request fails.
- The cloud route never sends it, and a failed local reply sends none.

## The setting

`models.local.keepAlive` in `config.json`: whole seconds, minutes or hours (`90s`, `30m`, `2h`), from 1 minute to 24 hours; default `30m`. Any other value is refused when the configuration is read, so no free string reaches Ollama. The value applies to every role on the local route (Misato on the local route, Casper and the consultant), because they all go through the same local call.

"Keep loaded always" (part C, F-144-T04) will make the value Ollama's `-1`; it is not part of this setting.

## Reconsider when

Ollama's `/v1` endpoint documents `keep_alive`, NERV moves its local calls to the native API, or a local route that is not Ollama becomes common enough that the extra failed request matters.
