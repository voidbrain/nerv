# Nodo area notes

## Local core

Node 24 runs erasable TypeScript directly. `src/store.ts` owns SQLite state; `src/server.ts` owns authenticated loopback HTTP; `src/cli.ts` owns process lifecycle; `src/config.ts` owns private per-user configuration and `src/service.ts` renders/manages user services. Validate untrusted input before writes. Do not expose arbitrary SQL, shell execution or tools through chat. Keep delivery creation and reminder completion in one transaction. `npm test` covers restart, duplicates, cancellation and HTTP authentication. These are Nodo's current conventions, not a published reusable Node harness profile.

## Action gate and ledger

`src/policy.ts` is the pure per-action ballot (F-017) and `src/ledger.ts` the sortie ledger, grants, approvals and events (F-024, F-023) in the same SQLite file, owned by A during serve. Names follow docs/NERV/NERV-ARCHITECTURE.md; code keeps plain names. Every agent action goes through `Ledger.propose` and every executor call through `Ledger.authorize`; never execute a tool from a ballot result alone. Unregistered tools are irreversible (Pattern Blue). Melchior and Balthasar stay deterministic; only Casper's verdict may come from a model and its absence escalates to the owner, never to a grant. Extra seats are veto-only. Grants are single-use, short-lived and bound to the canonical argument hash. Decisions apply once; expiry and the Spear never approve. Events are append-only (enforced by triggers): record corrections as new events. Executed effects are reported by the Spear, never assumed undone. Over the API, approval cards and sortie events are readable by read-only clients and the socket; deciding is REST-only for the admin token (`approvals.decide` is not on the interface edge). Grant IDs never leave the coordinator. Card arguments are capped at 8 KB and pages at 5 cards so a page fits one IPC frame.

## Frontend

Read the style guide. Angular renders registered components, never model-generated JavaScript. The frontend access token remains only in component memory; the backend token is in a mode-0600 file under NODO_HOME. Italian is the default interface language, with English switching. CLI command names and raw diagnostic messages remain English. Planned cards must say planned; no simulated live devices. Current UI uses typed reminder data and a registered Web Component status surface; model-generated selection is not implemented. PWA installation/offline caching and browser acceptance remain F-004.

## Distributed contracts

`src/contracts.ts` declares version 1 intentions only; it is not an implemented network protocol. Agent role, model endpoint and execution location remain independent. Node trust requires enrolment; discovery grants no permission. A future broker must enforce privacy, fencing, lease expiry, idempotency and exclusive resources before remote operations. A timeout does not prove that an external action failed. Inspect device state before replaying physical actions. Never silently send local-only input to cloud inference.

### Model routes

`src/model.ts` owns route selection and the two adapters; the brain process is the only caller. Privacy is explicit on every ask and defaults to local-only at the API. Route choice never falls back: a failed or missing route is reported, and local-only text never reaches the cloud adapter (`test/model.test.ts` proves both with a fake provider that counts requests). The cloud key lives in a private file read by the brain, never in env, argv, config, logs or doctor. `model.complete` is a coordinator→brain edge only: the socket cannot ask, REST asks need the admin token. Replies are bounded to `MAX_REPLY_BYTES`.

## Headless installation

Serve built Angular assets and the API from one loopback process on 4317. Development uses 4318; both values must agree with README and tests. Service definitions contain no token, use absolute paths and run as the current user. Never install system services or enable linger on the execution host as part of a code change. Test service rendering and real process lifecycle; distinguish those from launchd/systemd acceptance on a user machine. Keep Quit companion separate from Stop Nodo in the future native SwiftUI companion. Read docs/INSTALL.md before changing service lifecycle.

## Isolated runtime and protocol

Read docs/decisions/runtime-boundaries.md. A owns database/ticks during serve; B must not receive the root/provider secrets; C owns API/static/network and child lifecycle. Same-user child processes are workload boundaries, not sandboxes. All IPC methods have schemas and directed authorization in src/rpc.ts. Remote workers, browser ticket pairing and mutation RPC are not implemented; do not turn the local read endpoint into an execution tunnel. Bound frames/queues and fail explicitly on oversize replies. Test a blocked/killed B and A shutdown/recovery separately. Shared surface data is validated in shared/surface.ts; web/src/status-card.ts owns executable code and must use textContent for model/server text. No arbitrary HTML, module URLs or event handlers.

## Native companion and credentials

Read native/README.md and the current pairing decision. Never ship root/provider credentials to the companion, its URL, argv, UserDefaults, logs or Brain. Native TLS is opt-in and pinned before a ticket/client token is sent; no blanket trust bypass or global trust-store installation. NativeAuth owns a small separate private verifier database in C; it must not hold reminder transactions. Tickets are two-minute/single-use, client credentials read-only and revocable with 30-day expiry. Swift tests/build run on macOS CI; Linux does not establish native acceptance. Keychain prompts, menu interaction, notifications and service login/logout need explicit evidence. Keep local Forget pairing distinct from server revocation. Build artifacts are ad-hoc signed previews, not notarized installers.

## Native notifications and OS actions

Read the native guide before changing cursor or permission semantics. Enable establishes a current-head baseline; checkpoints contain sequence plus delivery UUID and are private/atomic, never message content or credentials. Validate whole pages before posting; advance after OS acceptance/reconciliation, never on an error. Do not claim exactly-once banners. History restore resets require an explicit visible warning; corrupt local state must not silently replay old reminders. Every notification request is opt-in; tests use fake sinks and do not prompt CI.

Service commands are fixed user launchctl actions with timeouts and a separate Stop confirmation. A paired runtime must match local plist NODO_HOME. SMAppService mainApp owns companion login only; display real requiresApproval/enabled states. Do not register or modify actual OS services/login items in repository tests. CI validates pure command plans, simulated notification outcomes, pinning and compilation; live Mac permission/banner/login acceptance remains separate.

Native background polling uses `/api/status`, never a recurring full doctor/SQLite integrity scan. Keep an authenticated runtime ping distinct from explicit database diagnostics, and test that polling cannot call quick_check indirectly.
