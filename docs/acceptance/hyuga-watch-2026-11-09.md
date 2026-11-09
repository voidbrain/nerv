# Hyuga watch acceptance, 2026-11-09

Scope: F-026-T02 on baseline main5c7997b, following accepted T01 PR #239 / full CI42624083120. This original implementation report records automated fixture acceptance; final acceptance is appended below. It does not establish live-model qualification, actual EVA isolation, phone/banner receipt or an audit baseline.

| Join | Observed result | Evidence / limit |
|---|---|---|
| Explicit configuration → serve → A/B/C → inbox | Local planner runs an opt-in heartbeat once; concurrent polls share one attempt; actual CLI restart preserves the delivered identity | `test/watch-runtime.test.ts`, `test/watch.integration.ts`; loopback fake provider, no real model |
| Gate/stage/action budget | Non-Production writes stay rejected even when a planner ignores its catalogue; Production reservations stay bounded beyond retry limits | Admission/gate tests plus runtime tests; count budgets, not monetary/token guarantees |
| Planning budget → approval → restart | Reservation is durable before model dispatch; owner approval resumes with remaining steps and no direct callback notification | Runtime one-step approval/restart case; ordinary owner authority unchanged |
| Process loss / cancellation / changed pilot | Interrupted work is not re-dispatched; stopping a waiting watch clears capacity; missing/retired/demoted/model-replaced authority is revoked | Runtime/admission tests; prior effects never assumed undone |
| Remote dispatch authority | Current frozen binding checked at transport callback, even without a poll and after planner completion; withdrawn/interrupted work gets durable cancellation intents | `test/worker-outbox.test.ts`; prior attempted work stays uncertain until reconciled |
| Quiet hours → inbox → Telegram | New watch briefs/cards/resumed/remote follow-ups wait; due reminders and existing deliveries continue; later publication is once per identity | Runtime and fake Bot API tests; API acceptance is not observed phone receipt |
| Watch brief → daily brief / memory | Watch notices preserve daily checkpoint/history identity and do not become owner-stated consolidation input | Runtime SQL/IPC regressions; source labels remain available in the ledger |
| Existing browser and protocol consumers | Build and bilingual browser/axe passed; briefs retain the existing inbox kind for native compatibility | Local browser fixture; final CI supplies exact-revision cross-platform result |

Local broad suite:500 tests,498 passed, two platform skips. Later authority-dispatch changes passed36 focused admission/runtime/outbox/Kaji regressions. Actual `serve`/restart passed, as did fake Telegram quiet/resume delivery, typecheck and convention/integration checks. New tests use invented inputs and temporary private homes; no service installation, model download or live model campaign occurred.

Fresh-context P1 review found a missing source-authority join for queued remote dispatch. The fix revalidates at the actual transport callback, persists cancellation before refusal, and retains attempted uncertainty. Independent recheck passed32 watch/runtime/outbox tests with no further blocker. Final full CI was required before merge/closure; its outcome is appended below.

Configuration, rationale and limits: [installation](../INSTALL.md#proactive-watches-hyuga), [decision](../decisions/hyuga-watch.md). Current status: [F-026 closure](../archive/backlog-2026.md#f-026). Quiet hours apply to new proactive publications; an existing inbox item remains eligible for its channel's normal checkpoint/retry behavior. Cross-system notification submission/dismissal windows retain the native delivery limits already recorded under F-011/F-023.

## Final acceptance, 9 November 2026

2026-11-09 Unit/integration: PR #240 exact head `6acac44` / [CI42635119338](https://github.com/voidbrain/nerv/actions/runs/42635119338) passed plan, validate, Windows, native-macos and full-suite; merged main `0968262`. Linux coverage, Windows full tests/service lifecycle, browser/axe/headless and macOS Swift/TLS/package checks passed. Local joins and fresh-context review establish the recorded trigger/budget/quiet-delivery contract; no live-model qualification, OS confinement or phone receipt claimed.

Initial PR240 CI42633909320 attempt1 failed the unchanged expired-worker-approval test on Windows with `No outbound worker session`; the exact isolated Mac test passed. A failed-job-only retry was requested but canceled by the separately required suite-version metadata push. Preserve that attempt under B-046; no worker fix, timeout change or assertion weakening was made. The final revision above passed.

F-026 is verified and closed on this automated contract. Actual EVA isolation remains F-049, enforced egress F-027-T02, broader pilot lifecycle F-045 and physical notification acceptance F-011/F-023.
