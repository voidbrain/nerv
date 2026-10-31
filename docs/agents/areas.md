# Nodo area notes

## Local core

Node 24 runs erasable TypeScript directly. `src/store.ts` owns SQLite state; `src/server.ts` owns authenticated loopback HTTP; `src/cli.ts` owns process lifecycle. Validate untrusted input before writes. Do not expose arbitrary SQL, shell execution or tools through chat. Keep delivery creation and reminder completion in one transaction. `npm test` covers restart, duplicates, cancellation and HTTP authentication. These are Nodo's current conventions, not a published reusable Node harness profile.

## Frontend

Read the style guide. Angular renders registered components, never model-generated JavaScript. The access token remains only in component memory. Planned cards must say planned; no simulated live devices. Current UI uses typed reminder data; generated UI selection is not implemented. PWA installation/offline caching and browser acceptance remain F-004.

## Distributed contracts

`src/contracts.ts` declares version 1 intentions only; it is not an implemented network protocol. Agent role, model endpoint and execution location remain independent. Node trust requires enrolment; discovery grants no permission. A future broker must enforce privacy, fencing, lease expiry, idempotency and exclusive resources before remote operations. A timeout does not prove that an external action failed. Inspect device state before replaying physical actions. Never silently send local-only input to cloud inference.
