# Mac service lifecycle review — 10 November 2026

F-005-T04, independent fresh-context report-only review. Reviewer did not edit, approve, merge or perform OS effects. Scope: default-profile ownership, durable receipts/fencing, recovery, startup and restricted updates.

Candidatecea582a had two P1 blockers: normal CLI startup ignored retained lifecycle uncertainty, and update compatibility relied on textual markers. Three committed failing regressions8683354 precede fixes6eda9b7. They remain unchanged. Read-only actual Mac inspection also exposed the standard public-key644 convention; credentials remain private and key identity is now verified.

Follow-updf1a8e8 independently passed21 tests and confirmed the startup fix, but reproduced an executable rename into docs bypassing the metadata filter. Committed failing regressiond330735 precedes unchanged-test fix2ab189f, which disables rename detection so both deleted and added paths are examined.

Exact2ab189fbd347958bc9749f5238cbaf3071c31975 follow-up independently passed22 lifecycle tests and reports no remaining blockers within current-code operations and identical executable/dependency/configuration trees. Production command fixtures cover manager/process parsing, authenticated doctor and actual backup files. Positive real launchd startup is still target acceptance. Executable/schema upgrades remain explicitly unimplemented under T06.

Local full validation atdf1a8e8:552 pass/2 skip; build and headless5 pass/1 platform skip. Narrow rename fix:22/22, typecheck/conventions pass. Final required CI and actual OS lifecycle remain pending. Read-only Mac preflight confirms schema6, GUI session, settled work and absent current/legacy definitions/registrations; it installed nothing.

Consistency review covers INSTALL, lifecycle decision, owning records/tasks and generated views. No style token, shared UI component or governing rule changed. Re-review on ownership, startup, journal/recovery or supported-update changes.

## Integration and target acceptance

PR253 full CI42874665479 passed at6f21738; merged12a9cfd tree matches. [Actual Mac acceptance](../acceptance/node-service-2026-11-10.md) confirms the positive launchd startup permit and selected lifecycle/recovery/data/backup checks. This is operator evidence after review, not an independent reviewer claim of OS execution. T06 remains unimplemented.
