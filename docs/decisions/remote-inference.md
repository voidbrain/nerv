# Remote inference endpoints

**Status: agreed, 13 November 2026 (F-006-T01).** F-006-T06 (configuration validation) is implemented; F-006-T02 (selection contract) and F-006-T08 (waiting and expiry) build on it.

## Problem

Today a model call has two routes: S², an OpenAI-compatible server on loopback of the same machine, and Umbilical, the Claude cloud route, off until the owner enables it (`src/model.ts`). F-006 needs a third case: a role on one base (for example a coder job on the mini PC) uses inference served by another enrolled base (the Mac). Three questions must be settled before any configuration or code: what identifies that endpoint, which data may reach it, and what happens when it is not there.

## Decision

### 1. Identity: an enrolled base, never a URL

A remote inference endpoint is named by its **enrolled base ID** in the Gehirn registry, plus a model name. It is never a free-form URL.

- Requests travel over the existing [signed worker channel](worker-protocol.md) to that base. The serving base calls its **own loopback** S² server and returns the bounded reply. Its model server keeps listening on loopback only; nothing asks the owner to expose Ollama or LM Studio on a network address.
- Authority is the registry: enrolment, the pinned root and current keys. Revocation, key rotation or a changed main record ends the endpoint immediately, as for worker jobs. Tailscale reachability or discovery grants nothing.
- `models.local.baseUrl` stays loopback-only, exactly as validated today. A non-loopback URL remains a configuration error. The loopback guarantee is not relaxed to make remote inference possible.
- Inference is a new, separately negotiated capability on the worker channel (a method offered in `worker.hello`, with its own size bounds for prompt and reply). A peer that does not negotiate it has no remote inference. There is no fallback to plain HTTP and no arbitrary method forwarding.
- Both sides opt in. The calling base names the endpoint in its configuration. The serving base lists which bases it serves and which local models it offers, off by default. A model the serving base does not list is refused, and a reply whose returned model differs from the requested one is an error, because qualification evidence binds the exact model.

### 2. Permitted data: a third privacy class, granted per base

The privacy classes become three. Nothing existing is reclassified:

| Class | May reach | Default for |
|---|---|---|
| `local-only` | This base only. Unchanged meaning. | Every ask without an explicit class, as today; Casper (action arguments) |
| `owner-bases` | This base, or an enrolled base the owner explicitly granted inference data for | Nothing by default; set per role in configuration |
| `any` | The above, or the cloud route when enabled | Unchanged |

- Owning both machines does not make data `owner-bases` (as [configuration qualification](configuration-qualification.md) already says). The class is set per role by the owner. A per-base grant (`base ID → allowed`) is also required, so a newly enrolled base receives nothing until the owner names it.
- What travels: the system prompt, the prompt and the requested model. Never credentials (the cloud key, root or base keys, admin or client tokens), never tool grants or tools, and never the ability to act. Inference returns text only. Any action a reply proposes still goes through the calling base's own ledger, policy and Casper.
- The serving base keeps no prompt or reply text. It records metadata only: job ID, requesting base, model, token counters, duration and outcome. This matches what `model-usage.ts` records locally.
- Transport: the worker channel signs but does not encrypt. `owner-bases` data is sent only to an enrolled address in the Tailscale ranges (`100.64.0.0/10` or `fd7a:115c:a1e0::/48`). Any other address is refused for inference. The address range is a configuration check, not proof of encryption. It narrows the case where a plain LAN address carries private prompts.
- Context taint (F-027) travels with the request's provenance on the calling base, unchanged. Remote inference neither clears nor adds taint.
- Peer Casper seats (`POST /kaji/verdict`) already send an action to other bases for a veto-only verdict. That existing flow is not changed or widened by this decision.

### 3. When the endpoint is unavailable: wait within a budget, then expire

- **No silent fallback, ever.** A role bound to a remote endpoint is never switched to the local route, another base or the cloud. This keeps the existing rule that a failed route reports failure, and the rule that local-only text never leaves its host.
- **Not online at selection:** the request waits for that base, bounded by the caller's deadline. Interactive chat waits at most the existing brain budget (`MODEL_TIMEOUT_MS`, 120 s), then answers that the endpoint is unavailable. A background job waits until its own deadline, then expires with an explicit `endpoint unavailable` outcome. Nothing waits without a deadline.
- **Sent, no reply:** inference has no external effect, so a bounded retry **to the same endpoint** is allowed. It counts against the same token and time budget, and the attempt count is recorded. Any effect that follows a reply goes through the normal ledger path once, on the calling base.
- **Sleeping Mac:** NERV does not wake a base implicitly. Wake-on-LAN, where it exists, is a separate explicit capability (runtime boundaries, "Overlay and sleeping workers").
- **Health:** an unavailable endpoint is a `degraded` reason on the calling base (route health, F-030), never a reason to switch routes.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Point `models.local.baseUrl` at the Mac's Ollama over Tailscale | Ollama has no authentication: any tailnet device could use it, and the Mac would have to listen beyond loopback. NERV enrolment, revocation and fencing would not apply. It also breaks the loopback guarantee. |
| Trust Tailscale identity (tailnet ACLs) instead of enrolment | Transport identity is separate from NERV enrolment and authorization ([runtime boundaries](runtime-boundaries.md)). A tailnet change must not grant model access to private prompts. |
| Widen `local-only` to "any base the owner owns" | It silently changes the meaning of every existing ask and of Casper's privacy promise. A new explicit class keeps old data where it was. |
| Fall back to local or cloud when the remote endpoint is down | It contradicts the no-fallback rule, can send data to a host it was not granted for, and changes the model behind qualification evidence. |
| A separate inference daemon or a new port | A second authenticated surface to secure and supervise. The worker channel already has signing, sessions, bounds and reconciliation. |

## Consequences and open points for the next steps

- F-006-T06 adds the configuration shape (remote endpoint by base ID and model, per-base data grant, serving-base allow list) with validation and regressions. The loopback-only check on `models.local` stays and gets a regression that a remote address is still refused there.
- F-006-T02 states the selection contract: the role, the inference endpoint and the execution worker are chosen independently, and none falls back.
- F-006-T08 implements waiting and expiry, the cloud path under policy, and the Pi capability route.
- The prompt and reply size limits for the inference method are set in F-006-T06 against current `MAX_REPLY_BYTES` (16 KiB) and the worker frame limit (64 KiB). Job arguments are capped at 8 KiB, which is too small for prompts, so inference needs its own bound.
- Not decided here: which models or bases are used (that is measured placement, F-006-T04/T05), and whether a Pi serves inference. A Pi may advertise a small model, subject to evaluation.

Reconsider when: the worker protocol changes version or authentication, Tailscale is no longer the overlay, a third-party (non-owner) host is proposed, or measured placement shows the waiting budgets are wrong.
