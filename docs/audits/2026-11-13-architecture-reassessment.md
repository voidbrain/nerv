# Architecture reassessment — 13 November 2026

Scoped review at NERV main `a4081d5` (full revision in the manifest), requested by the owner after the full audit of the same day. It follows the [architecture reassessment procedure](../agents/architecture-review.md) and compares what changed since the [8 November reassessment](2026-11-08-architecture-reassessment.md) (`1869340`; 155 first-parent merges since). It is not a full audit and resets no full-audit area.

## Scope and evidence

- **Inspected:** `src/cli.ts` (the `serve` composition, lines 1245–1512), `src/runtime.ts`, `src/kaji-link.ts` and `src/kaji-auth.ts` (peer handlers, signed requests), `src/model.ts` (`models.local`, `models.remote`), `tools/evaluate.mjs` and `tools/gauntlet.mjs` (evaluation source identity), `.github/workflows/ci.yml`, and the decision and backlog records named below.
- **Measured:**
  - The read-only hardware and model inventory of both bases ([inventory](../evaluations/2026-11-13-model-inventory.md)).
  - How many merges since `1869340` change the Gauntlet system source key: 100 of 155.
  - Most-changed modules since `1869340`: `runtime.ts` in 28 merges, `cli.ts` 15, `store.ts` 14, `kaji-link.ts` 11.
  - Module sizes: `runtime.ts` 2,963 lines; `cli.ts` 1,512.
- **Ran:** the seven `nerv-system-flows` cases, 7/7 passing after B-058 (PR #376). No model was called and no live base was changed.
- **Excluded:**
  - model quality (F-078);
  - live device, printer and companion acceptance;
  - a security test of the Kaji line beyond reading its verification code and tests;
  - dependency upgrades (F-077-T02).

## Decisions

| Choice | Problem and constraints now | Original assumptions; still true? | Alternatives | Retain or change | Reconsider when |
|---|---|---|---|---|---|
| TypeScript coordinator, one durable coordinator | Unchanged requirements; F-045 added the Kaji line, peer seats, outbox and remote sortie inspection inside the same process | Yes: the new distributed work landed as typed contracts without a rewrite | Python/backend rewrite; second coordinator | **Retain** (as on 8 November) | A representative benchmark shows an unmet requirement; F-016 relocation work |
| Inference endpoint separate from worker and base | 8 November listed remote inference as unmet. `models.remote` now names endpoints by enrolled base ID, never a URL, and loopback stays mandatory for `models.local` | The privacy guard holds; the remote path exists | Direct URLs to another host's Ollama (rejected: bypasses enrolment and signing) | **Retain**; it is also the answer for Tabgha (below) | A base needs a model no enrolled base serves |
| Which base runs which model | F-078 planned a `qwen2.5-coder:14b` campaign on Tabgha | **No:** Tabgha is an Intel N97 with 12 GB and no usable GPU; it has only `qwen2.5:1.5b`, and the 14b model is on Neo Tokyo-3 | Run 14b on Tabgha anyway (exceeds memory, a few tokens per second); buy hardware; use Neo Tokyo-3's models over `models.remote` with a small local fallback | **Change, proposed:** Tabgha's roles use Neo Tokyo-3 over `models.remote` while it is online, and a 1.5–4B local model when it is not. Owner decides in F-078-T02 | A GPU or more memory on a peer base |
| Whole-tree evaluation source key | One hash over `src`, `test`, `shared`, `web`, `evals` and the evaluation tools decides whether any recorded system case still covers main | Partly: it is safe, never claiming coverage of changed code, but 100 of 155 merges invalidated all seven cases, including stress and browser, so the ledger is stale almost all the time; and it hashed Git-ignored files (B-058, fixed in PR #376) | Per-case input scopes with the whole tree as fallback; rerun pending cases on main after merges (F-076); keep as is | **Experiment** (F-079): a case may declare the paths it exercises; undeclared cases keep the whole-tree key | The experiment shows a scoped case missing a real regression, then return to the whole-tree key for that case |
| Peer-facing policy in the `serve` wiring | `onSortie`, `onChat`, `onRelay` and `onDecide` are defined inline in `cli.ts` `serve`. The F-051 scope question lived there, covered only by a cross-base test | The composition root was meant to be wiring only; it now holds peer policy (what a peer may read or decide) | Leave as is; move peer handlers into a tested module (`src/peer-handlers.ts`) that `serve` wires | **Change, small:** F-080 moves the handlers out without behaviour change. A split of `runtime.ts` is **deferred**: it is the most-changed file, but no measured defect or conflict cost yet | Repeated merge conflicts in `runtime.ts`, or a peer-policy defect that a unit test would have caught |
| Verifying main after merges | Required checks run on the PR only, with `strict` off and no push trigger | No: with 155 merges in five days, combinations reach main untested | Options in [F-076](2026-11-13-full.md#f076-options) | **Owner decision** (F-076); at this rate the merge queue (option 3) fits best | Merge rate drops to a few a day (option 2 suffices) |

## Findings

| # | Kind | Finding | Evidence | Next |
|---|---|---|---|---|
| 1 | Confirmed defect, fixed | Ignored files (a Finder `.DS_Store`) changed the evaluation source key and marked every recorded run stale | Same commit: key `541fadb9…` clean, `d6c2673c…` with `web/.DS_Store` | B-058, PR #376 |
| 2 | Confirmed defect | Without a web build the browser case is recorded as a failed critical case instead of an unmet requirement | First F-075 run on 2026-11-13 | B-059 |
| 3 | Plan assumption wrong | Tabgha cannot host any of the four candidate models | [Inventory](../evaluations/2026-11-13-model-inventory.md) | F-078-T02 (owner) |
| 4 | Design cost | The whole-tree key invalidates all system cases on most merges | 100 of 155 merges | F-079 (experiment) |
| 5 | Design drift | Peer policy lives in the composition root | `cli.ts` 1431–1458 | F-080 |
| 6 | Delivery gap | Main is not tested after merges | full audit finding 3 | F-076 (owner) |
| 7 | Stale statement corrected | "Remote inference is an unmet capability" (8 November) no longer holds: `models.remote` is implemented | `src/model.ts` 146–196 | This report; the 8 November report stays as history |

## Representative path: a request on Tabgha while Neo Tokyo-3 sleeps

1. A request reaches Tabgha. While the main base is online, requests go to its Misato (`cli.ts` dispatch).
2. Neo Tokyo-3 is asleep, so the dispatch hook returns nothing (`cli.ts` 1484–1486) and Tabgha's own Misato plans with its local model.
3. Today that model is `qwen2.5:1.5b`, the only one that fits. Nothing has measured its planning quality (F-078).
4. The reverse case is covered: when the main base asks a sleeping peer's Casper for a vote, no answer in time counts as an abstain (`kaji-link.ts` 752), so a sleeping base never blocks a vote.

The weak point is step 3: the fallback planner is unmeasured. This is why the Tabgha proposal measures the small local model on purpose instead of assuming it.

## Limits

Source reading establishes structure, not runtime behaviour on real hosts. The proposals are not migrations: F-079 is an experiment with a fallback, F-080 is a move without behaviour change, and F-078-T02 and F-076 wait on the owner. Earlier reports are not rewritten.
