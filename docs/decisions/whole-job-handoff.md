# Whole-Job Handoff Contract (`F-050-T01`)

Contract specification, 15 November 2026 (`F-050-T01`). Defines the capability-first signed Kaji handoff for forwarding a whole sortie to another base, after inspecting the `F-045` remote capability prerequisite (`src/pilots.ts`, `src/kaji.ts`, `src/worker-jobs.ts`). **No runtime whole-job delegation is authorized by this contract task**; implementation waits on `F-050-T02`.

## 1. Bounded worker actions vs. delegated whole sorties

| Dimension | Bounded worker action (`worker-jobs.ts` / slice 3b) | Delegated whole sortie (`F-050`) |
|---|---|---|
| **Planning & gate** | Main base runs Misato, MAGI ballot, and owner approval before dispatch | Receiving base runs the entire sortie with its own Misato, pilot, and MAGI gate (never looser than the main base's Scrolls) |
| **Execution unit** | Single tool action (`WorkerLease`, `fence`, `owner`, `sequence`, `epoch`) | Whole sortie with a unique signed `jobId` (idempotent: runs at most once) |
| **Approval cards** | Issued on the main base before worker execution | Raised by the receiving base's gate and delivered to the owner through Aoba |
| **Context boundary** | Action arguments only | Only non-tainted, non-local-only context permitted by the main base's Scrolls |

## 2. F-045 remote capability prerequisite inspection

Inspected `src/pilots.ts`, `src/kaji.ts`, and `src/worker-jobs.ts`:
- `F-045` (`PilotRegistry`, `pilotExecutor`, `EVA_CLASSES`) defines local pilot identities, trust stages (`prototype`, `test`, `production`), and offered tools/skills/models.
- `WorkerJobs` (`src/worker-jobs.ts`) currently binds single-action leases (`WORKER_LEASE_MS = 300_000`, `worker_key`, `owner_key`, `fence`, `epoch`, `sequence`), not whole-sortie capability advertisements or cross-base Scroll floor checks.
- Therefore, `F-050-T02` must:
  1. Select a target base **capability-first** (matching advertised pilot, model, tool, or attached device), falling back to load/locality only when capability and Scroll privacy rules permit.
  2. Refuse forwarding whenever the job contains `local-only` or `tainted` data, or when the receiving base's Scrolls are looser than the main base's.
  3. Sign the handoff payload with Kaji (`jobId`, canonical `args` digest, capability claim, Scroll floor digest, `expires`).

## 3. Unknown outcomes & reconciliation invariant

- **Silence never proves execution stopped:** If the receiving base disconnects, misses heartbeats, or times out after accepting a signed `jobId`, the main base's ledger marks the delegated sortie **`uncertain`** (`held`), preserving its durable job receipt and resource lock.
- **No automatic retry or reassignment:** The main base must never re-send or reassign a held `jobId` to another base until the receiving base reconciles its durable receipt (confirming either `not-started`, `running`, `completed`, or `failed`).
- **Ledger provenance:** The main base records which base executed the sortie, why it was selected (capability, load, or locality), and the final reconciled outcome.
