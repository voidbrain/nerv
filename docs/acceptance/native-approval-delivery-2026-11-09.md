# Durable native approval delivery

9 November 2026; F-023-T03, base main `cba3726`. Accepted automated delivery implementation after PR #232 exact head `1b23c68`, merged main `cdb4f6`, CI42588026092 passed plan, validate, Windows, native-macos and full-suite. T03 is closed; parent live acceptance remains pending. T01/T02 authority and complete previews remain unchanged.

## Contracts and evidence

Four Store/inbox tests were committed in `1a878ac` before implementation and all failed against the old behavior. They establish atomic approval/notice creation (including injected inbox failure rolling back ledger events), restart stability, repeated Telegram/API decisions executing once, expiry suppression and backfill preserving prior rowids/UUIDs. Additional native TLS tests read the actual notice using a read-only credential and observe settled metadata after the existing admin decision path. Telegram's real process/Bot API fixture drains notices without a duplicate generic send, including restart.

The additive approval_deliveries identity table links one approval to one inbox delivery; the schema-5 delivery table and its cursor identities are preserved. Constructor backfill covers still-pending old cards only. Inbox page approval metadata is an additive read contract, not a new write permission. Notification content is generic and carries no arguments/recipients/fact text or grant handles. The Swift notification engine validates the complete page before submitting anything and checks local expiry immediately before each submission. Decided/expired entries advance the cursor without a banner request.

Local evidence: Node suite 466 tests, 464 passed and two platform skips; affected Store/inbox, native TLS and Telegram joins pass. Typecheck and Angular build pass. Swift real pinned-HTTPS fixture: 19 tests passed with no skips, including actual authenticated feed decoding into the notification engine/checkpoint. Ad-hoc app packaging passed. Headless lifecycle: three passed and one Windows skip. Selected browser/axe: two cases passed (partial evaluation, artifact `artifacts/evaluations/2026-11-09T08-38-13.058Z-0c0f791f-adf8-4559-94a6-a4af12f77504.json`). Final focused checks: all five Store/inbox tests passed (including TTL before scheduler expiry); Swift/TLS rerun after duplicate-approval validation passed 20 tests without skips. The broader Node run preceded those test/Swift additions; final CI establishes the final revision. Final required CI owns the exact proposed revision and cross-platform results. No model run or production service/device activation was performed.

## Delivery and acceptance limits

The existing opt-in “from now” baseline, five-item polling page, persistent runtime/sequence/UUID cursor, OS identifier deduplication, permission failure retry and restored-history head reset remain. A decided approval can race a pending snapshot/OS submission; the generic banner directs review of current NERV state and cannot execute anything. OS acceptance and cursor persistence cannot be atomic; a dismissed notification in the documented crash window can be submitted again. Neither fixtures nor OS acceptance prove a banner was seen.

Live acceptance remains with the owner under F-023/F-011: actual paired menu and keyboard/VoiceOver review, permission denied/enabled behavior, observed banner and sleep/wake handling. F-023 stays open; no native write credential, one-click approval, private deep link or administrative-token handoff is introduced.

Consistency review: README, AGENTS/area notes, backlog rules, style guide, native authority decision and roadmap reviewed; updated capability/notification copy and runtime guide, unchanged governance/milestone sequencing. Useful architecture follow-up remains F-049/F-006/F-065 from PR231. No upstream harness/Gauntlet rule or protocol change is required.

[Independent fresh-context report](../reviews/2026-11-09-native-approval-delivery.md): no blocking runtime/security findings; one stale architecture sentence corrected. The reviewer independently ran five Store/inbox tests; Swift/CI/live limits remain explicit.

## Final CI acceptance

Authenticated `npm run ci:status -- 232` reports [CI42588026092](https://github.com/voidbrain/nerv/actions/runs/42588026092) successful for all five jobs at exact head `1b23c68f32e872ec520e5269dc6b65d8bb14c640`, merged main `cdb4f630570921c5df41d9a08515055c3ffa09b2`. Linux coverage log: 467 Node tests, 466 passed, one platform skip; headless three passed, one Windows skip. Required Windows and native-macos jobs and browser/axe acceptance passed. This accepts T03's automated delivery contract, not actual owner banner/menu/VoiceOver use. No code/assertion/timeout changes or CI retry were needed.
