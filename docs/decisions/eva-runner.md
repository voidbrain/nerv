# EVA isolated runner contract and threat model

Contract specification, 13 November 2026 (`F-049-T01`). This defines the NERV-owned deterministic runner/warden boundary, admission rules, host enforcement requirements, protected grading/ledger invariants and pre-execution test gate. **No OS confinement or `eva-03` execution is implemented by this decision**; existing runtime refusals (`src/policy.ts`, `src/runtime.ts`) remain active until `F-049-T02`–`F-049-T05` land and pass on supported hosts.

## Purpose and authority boundary

NERV executes untrusted or partially trusted work (MCP servers in `src/tools-process.ts`, third-party skill scripts, candidate code patches, and tainted local context) inside per-job ephemeral EVA instances rather than inside the coordinator or same-user child processes.

- **Single authority:** NERV's existing gate (`Ledger.propose` / `Ledger.authorize`, MAGI ballot in `src/policy.ts`, and `Store` grants) remains the sole decision authority. The deterministic runner/warden consumes an issued grant and job specification; it never approves actions, widens scopes, extends TTLs, or acts as a second approval authority.
- **No model enforcement:** A model may advise or plan; only deterministic host/runtime code enforces admission, mounts, network egress, credentials, deadlines, and resource bounds.
- **Least EVA class:** A job runs in the most permissive EVA class allowed by neither its request nor its pilot's trust stage or tool grant (`stricter(executorOf(action, effect), tool?.eva)` in `src/policy.ts`, `pilotExecutor` in `src/pilots.ts`, ordered `'eva-03' < 'eva-00' < 'eva-01' < 'eva-02'`). Any job requesting a less confined class than its grant or pilot stage permits, or lacking required host enforcement, is refused fail-closed (`blocked: 'isolation'`). Never substitute a Git worktree or an unconfined same-user subprocess.

## Threat model and fixed job admission

The runner assumes candidate code, MCP tool responses, and tainted inputs may attempt:

1. Reading or corrupting NERV state (`nerv.sqlite`, `native-auth.sqlite`), Kaji Ed25519 keys, provider API keys, or user home credentials (`~/.ssh`, `~/.aws`, Keychain).
2. Exfiltrating data or reaching unapproved hosts/LAN/metadata endpoints over outbound network connections.
3. Tampering with hidden graders, evaluation fixtures, or promotion/ledger state.
4. Exhausting host CPU, memory, file descriptors, disk, or IPC frame budgets, or leaving orphan background processes after cancellation/timeout.
5. Replaying or duplicating external side effects across process restarts, crashes, or worker reconnects.

Every admitted job must bind:

- **Grant identity:** Valid, unexpired, single-use NERV grant matching the exact `tool`, canonical `args` digest, and (for MCP tools) granted tool `fingerprint`.
- **EVA class and pilot prerequisites:** Declared EVA class (`eva-03` quarantine, `eva-00` shadow, `eva-01` bounded, `eva-02` full grant) bounded by the pilot's trust stage (`F-045` / `F-025`: `prototype -> eva-00`, `test -> eva-01`, `production -> eva-02`; `eva-03` for tainted/untrusted local work).
- **Fixed execution plan:** Exact executable/entry, bounded arguments, hard wall-clock deadline, resource limits, and per-job ephemeral workspace path.

## Per-job enforcement boundaries (supported hosts)

Supported hosts are **macOS** (primary local base; mechanism chosen in `F-049-T03`) and **Linux** (mini PC / headless worker; `F-049-T10`). Unsupported hosts or missing enforcement primitives fail closed before launch. Each job receives a fresh instance discarded on completion; no mutable workspace or temp state carries across jobs.

| Boundary | Requirement |
|---|---|
| **Filesystem mounts** | Ephemeral per-job writable workspace/scratch directory, discarded on teardown. Explicit read-only mounts only for pinned inputs and required runtime binaries. Explicit denial of NERV data/SQLite directories, Kaji/provider/native keys, user credential stores, and grader/promotion directories. |
| **Network egress** | Default-deny for `eva-03` and `eva-00` (no outbound TCP/UDP/DNS; bounded coordinator IPC only over an explicit pre-opened channel). For `eva-01` / `eva-02`, allow only endpoints/ports explicitly matching the admitted grant; deny link-local, cloud metadata, and local admin ports (`4317`, `4319`) unless explicitly granted. |
| **Credentials** | Zero ambient credentials in `env`, `argv`, mounted config files, or Keychain/token stores (extending `src/process-client.ts`). Any credentialed external call remains outside the sandbox in an authorized host boundary or behind a single-action scoped proxy. |
| **Cancellation & deadlines** | Hard wall-clock deadline per job. Timeout or Spear/owner cancellation terminates the entire process group / sandbox instance (`SIGTERM`, bounded grace, `SIGKILL` + instance teardown) and verifies no orphan processes or open handles remain. |
| **CPU, memory & output** | Bounded CPU shares/time, memory cap, process/FD limits, and capped stdout/stderr/artifact sizes compatible with NERV's IPC limits (`MAX_FRAME_BYTES`). Coordinator enforces per-machine concurrency caps (CPU, memory, model slots; `F-049-T06`) before spawning. |

## Protected grading, promotion, and ledger invariants

- **Candidate/grader separation (`F-006` join):** Candidate execution cannot read hidden grader tests/oracles or write to grader inputs, evaluation outputs, or promotion records. Grading executes in a separate read-only/isolated step against an immutable digest of the candidate's produced artifact.
- **Promotion authority:** Passing an evaluation permits owner-gated promotion consideration (`pilots.promote`, `F-045` / `F-006`); it never grants runtime execution authority or bypasses the MAGI gate.
- **Failed attempts and uncertain effects:** Pre-execution intents, rejections, failures, timeouts, cancellations, and uncertain external outcomes are appended to the NERV ledger (`src/events.ts`, `Store`) and never erased. Discarding an ephemeral sandbox removes local candidate files only; it **never** claims rollback of external effects.
- **Worker recovery join (`worker-protocol.md`):** Remote or local fenced execution binds durable receipts, leases, and exclusive resource locks before running. A timeout, disconnect, or process kill leaves an unfinished external operation **uncertain** and retains its lock until reconciled; no automatic replay or lock release occurs.

## Required test gate before enabling execution (`F-049-T05`)

Execution in `eva-03` (and subsequently `eva-00`–`eva-02`) must not be enabled until the following join tests across runtime, ledger, and runner pass on supported hosts, **with each confinement test proven to fail when enforcement is disabled in a test fixture**:

1. **Filesystem escape:** Attempts to read/write outside the job mount (NERV SQLite, key files, `$HOME`, symlink/hardlink traversal) are denied.
2. **Network egress:** Unpermitted outbound TCP/UDP/DNS connections and loopback admin-port probes fail inside `eva-03` / `eva-00`.
3. **Credential denial:** Environment, `argv`, mounted files, and host credential stores expose no provider, Kaji, or admin secrets.
4. **Grader tampering:** Candidate attempts to read hidden grader data or alter grader/promotion outputs fail.
5. **Timeout and cancellation:** Hung or forking children terminate within the deadline or Spear cancellation window with zero surviving orphans and an explicit ledger timeout/cancel event.
6. **Recovery join:** Mid-job crash/disconnect preserves durable receipt and uncertain lock, blocks duplicate replay, and reconciles cleanly on restart.

## Sequencing and prerequisites

- **Prerequisites:** `F-045` (pilot roster, `PilotRegistry`, `pilotExecutor`) and `F-025` (watermelon trust stages, automatic demotion, owner-only Production promotion) are closed on `main`.
- **Next steps:** `F-049-T02` defines EVA-00–03 classes and least-class admission as data in `src/`; `F-049-T03` benchmarks candidate macOS enforcement mechanisms against this contract for owner selection; `F-049-T04`–`T05` move `src/tools-process.ts` into per-job `eva-03` instances and verify the test gate above.
