# Lightweight status polling — scoped review, 1 November 2026

Baseline `2a8b9013859a73644b4ad5f1ebfeca66b8f4557a` plus this branch. Confirmed finding: native background refresh called /api/doctor every 15 seconds, transitively running SQLite quick_check in the scheduler. This becomes unnecessary recurring work as the database grows. F-013 owns the finding and remaining load limits.

Changed native background/enablement reads to authenticated /api/status backed by runtime.ping. The endpoint explicitly says integrityCheck=not-run, retains native identity/home metadata and read-only authorization, and does not invoke Store.doctor. Full integrity diagnostics remain explicit. Added a cross-HTTP regression test and extended the Swift TLS test to exercise the new read endpoint. App and daemon should be updated together.

Inspected code/logic/security joins, test assertions, README/architecture/area/backlog/native guide consistency and project maintenance evidence. No generic harness or master API authority changed. Local TypeScript/backend/build/process checks and macOS CI are distinct; no live notification permission, service or login operation is performed by this fix. This scoped report does not reset unrelated full-audit claims or close outstanding native acceptance.
