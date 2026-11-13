# Local Core & Action Gate

## Local core

- Node 24 runs erasable TypeScript directly: `src/store.ts` owns SQLite state, `src/server.ts` owns authenticated loopback HTTP, `src/cli.ts` owns process lifecycle, `src/config.ts` owns private per-user configuration, and `src/service.ts` renders/manages user services.
- Validate untrusted input before writes. Never expose arbitrary SQL, shell execution, or tools through chat.
- Keep delivery creation and reminder completion in one transaction. The inbox (`deliveries`, schema 5) holds reminders and Hyuga's briefs (`kind`); its rowids are the cursors of every channel, so migrations keep them; the scheduler writes the brief and channels only deliver inbox items so nothing is sent twice.
- `npm test` covers restart, duplicates, cancellation, and HTTP authentication.

## Action gate and ledger

- `src/policy.ts` is the pure per-action ballot and `src/ledger.ts` is the sortie ledger, grants, approvals, and events in the same SQLite file, owned by process A during `serve`. Names follow `docs/architecture/vocabulary.md`; code keeps plain names.
- Every agent action goes through `Ledger.propose` and every executor call through `Ledger.authorize`; never execute a tool from a ballot result alone. Unregistered tools are irreversible (Pattern Blue).
- The Scrolls come from `scrolls.json` in the data home (`readScrolls` in `src/config.ts`, validated by `validatePolicy`); both the CLI and scheduler load it, and an invalid or others-writable file stops startup rather than falling back to defaults.
- Casper (`src/casper.ts`) runs in the brain process on the local route only and sees the owner's request and the exact action, never planner reasoning; a failed or unreadable reply is no verdict, never an approval. The coordinator (`Runtime.act`) asks Casper only when `Ledger.preview` says the action is not Green.
- Executors (`src/executors.ts`) live in the scheduler process next to the grant: `Store.runAction` and `Store.decide` call `authorize` and then the executor, so grant IDs never leave that process and a repeated decision never runs a tool twice.
- Misato (`src/misato.ts`) plans in the brain process, one JSON step per model call, and never executes: `Runtime.chat` gates each proposed action, feeds the outcome back, and stops at a reply or `MAX_STEPS`. Facts the model handles badly are computed in code (`dueLocal`, waiting steps are not done, identical waiting proposals never reach the gate twice). Reply language follows the request.
- Lilith (`src/memory.ts`, schema 4) holds facts with provenance and an append-only history; recall is FTS5 with user words quoted so no input becomes an FTS operator. `memory.remember` is an `owner` tool (always Pattern Blue). The coordinator offers matching facts with each request (only shareable ones on the cloud route).
- Instrumentality (`src/instrumentality.ts`, `Runtime.consolidate`) turns exchanges since the last episode into a stored summary and candidate facts proposed as `memory.remember` cards in an `instrumentality` sortie (Casper not asked; closed when every card is decided); facts already active or waiting are skipped (`factKey`).
- `settings.schedule` is the only settings tool (changes brief/Instrumentality schedule in `config.json`, Green, reversible); `serve` re-reads both every minute. Security-relevant settings stay out of chat's reach.
- Loop requests, steps, and waits are `misato.*` events, so `Runtime.sweep` resumes a sortie from the ledger alone once every approval is decided (`Ledger.claimResume` hands each resume out once).
- Aoba (`src/telegram.ts`) runs in the coordinator during `serve` only when `telegram-token` and `config.telegram.chatId` exist, using outbound HTTPS long-polling for the single owner chat; `stop` waits for in-progress deliveries. Requests carry the token in the URL, so errors never echo it and the API base is Telegram's or loopback (tests).
- Melchior and Balthasar stay deterministic; only Casper's verdict may come from a model and its absence escalates to the owner. Extra seats are veto-only. Grants are single-use, short-lived, and bound to canonical argument hashes. Decisions apply once; expiry and the Spear never approve. Events are append-only (triggers enforce it). Executed effects are reported by the Spear, never assumed undone. Over the API, approval cards and sortie events are readable by read-only clients and the socket; deciding is REST-only for the admin token (`approvals.decide` is not on the interface edge). Grant IDs never leave the coordinator (redacted on read for event schema 1).
- Card arguments are capped at 8 KB and pages at 5 cards. `src/events.ts` owns the single event schema (`EVENT_SCHEMA_VERSION`), 16 KB payload cap, 500-char model verdict reasons, 50 listed Spear effects (with exact count), and 32 KB event page limit.
- Agency record questions ("why S-1A2B …?") go to `sorties.explain` and `explainRecord` (`src/why.ts`) before Misato is asked.
- Tools carrying `removes` stay intent-checked (`intentChecked` in `src/policy.ts`) and always go to Casper; no verdict means the owner decides, a reject refuses it. Green is not a licence for side tasks: Misato's prompt forbids changing anything the request does not ask for.
- Casper gets the last three conversation exchanges (`earlier`) as data; peer seats get the request alone. For `kaji.run`, Casper, consultant, and pilots get `baseNames` as data. Peer seats wire via `Runtime.usePeerSeats`; the gate waits only for Casper and veto seats (shadow votes record `ballot.shadow` without changing outcomes).
- On restart, open Misato sorties not waiting for owner approval are closed as interrupted (`Runtime.closeInterrupted`); sorties waiting for approval resume normally.
- MCP tools are deny-by-default (`tools.grants`, reads only until `EVA-03` sandboxing ships). An offered tool outside `tools.grants` returns to Misato as invalid, never as an owner card.

## Context provenance & proactive planner binding

- Monotonically increasing sortie taint flows through `Ledger.intake` and append-only `context.intake` events. MCP dispatch marks taint before returning to the coordinator. Recalled facts/summaries and conversation turns keep source/taint; owner approval and duplicate facts never clear taint.
- Outside code requiring `EVA-03` is refused until isolation ships; an application URL check is not process confinement (see [the roadmap](../../ROADMAP.md) for network allowlisting and sandbox work). Legacy summaries and recalled reminder text without reliable provenance are conservatively tainted. <!-- project -->
- Explicit owner-configured watches bind local planner model/stage from a named pilot, with immutable budgets and existing Ledger authority (distinct from general executable pilot/EVA lifecycles; ordinary chat uses pilots for advice only). See [watch contract](../../decisions/hyuga-watch.md). <!-- project -->
