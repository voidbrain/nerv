# Nodo area notes

## Local core

Node 24 runs erasable TypeScript directly. `src/store.ts` owns SQLite state; `src/server.ts` owns authenticated loopback HTTP; `src/cli.ts` owns process lifecycle; `src/config.ts` owns private per-user configuration and `src/service.ts` renders/manages user services. Validate untrusted input before writes. Do not expose arbitrary SQL, shell execution or tools through chat. Keep delivery creation and reminder completion in one transaction. `npm test` covers restart, duplicates, cancellation and HTTP authentication. These are Nodo's current conventions, not a published reusable Node harness profile.

## Frontend

Read the style guide. Angular renders registered components, never model-generated JavaScript. The frontend access token remains only in component memory; the backend token is in a mode-0600 file under NODO_HOME. Italian is the default interface language, with English switching. CLI command names and raw diagnostic messages remain English. Planned cards must say planned; no simulated live devices. Current UI uses typed reminder data and a registered Web Component status surface; model-generated selection is not implemented. PWA installation/offline caching and browser acceptance remain F-004.

## Distributed contracts

`src/contracts.ts` declares version 1 intentions only; it is not an implemented network protocol. Agent role, model endpoint and execution location remain independent. Node trust requires enrolment; discovery grants no permission. A future broker must enforce privacy, fencing, lease expiry, idempotency and exclusive resources before remote operations. A timeout does not prove that an external action failed. Inspect device state before replaying physical actions. Never silently send local-only input to cloud inference.

## Headless installation

Serve built Angular assets and the API from one loopback process on 4317. Development uses 4318; both values must agree with README and tests. Service definitions contain no token, use absolute paths and run as the current user. Never install system services or enable linger on the execution host as part of a code change. Test service rendering and real process lifecycle; distinguish those from launchd/systemd acceptance on a user machine. Keep Quit companion separate from Stop Nodo in the future native SwiftUI companion. Read docs/INSTALL.md before changing service lifecycle.

## Isolated runtime and protocol

Read docs/decisions/runtime-boundaries.md. A owns database/ticks during serve; B must not receive the root/provider secrets; C owns API/static/network and child lifecycle. Same-user child processes are workload boundaries, not sandboxes. All IPC methods have schemas and directed authorization in src/rpc.ts. Remote workers, browser ticket pairing and mutation RPC are not implemented; do not turn the local read endpoint into an execution tunnel. Bound frames/queues and fail explicitly on oversize replies. Test a blocked/killed B and A shutdown/recovery separately. Shared surface data is validated in shared/surface.ts; web/src/status-card.ts owns executable code and must use textContent for model/server text. No arbitrary HTML, module URLs or event handlers.

## Native companion and credentials

Read native/README.md and the current pairing decision. Never ship root/provider credentials to the companion, its URL, argv, UserDefaults, logs or Brain. Native TLS is opt-in and pinned before a ticket/client token is sent; no blanket trust bypass or global trust-store installation. NativeAuth owns a small separate private verifier database in C; it must not hold reminder transactions. Tickets are two-minute/single-use, client credentials read-only and revocable with 30-day expiry. Swift tests/build run on macOS CI; Linux does not establish native acceptance. Keychain prompts, menu interaction, notifications and service login/logout need explicit evidence. Keep local Forget pairing distinct from server revocation. Build artifacts are ad-hoc signed previews, not notarized installers.
