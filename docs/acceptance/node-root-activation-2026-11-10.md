# Root activation acceptance — 10 November 2026

F-005-T05, owner-authorized real replacement-root migration on the selected Mac and Windows bases. Independent encrypted-root backup is owner-attested; no external backup device inspection or knowledge of its passphrase is claimed. Credentials, actual addresses/accounts/paths, public registry bodies and operational scripts remain private outside git.

PR252 full CI42823700687 passed at94228b0; mergedmainc3a550b is tree-identical. Independent exact-ee8501f review passed67 migration/auth/CLI/Kaji/worker tests with no unresolved code blockers in scope. Review findings and earlier rejected candidate are retained in [the implementation report](../reviews/2026-11-10-root-activation.md). Linux coverage/browser/accessibility/headless and native checks passed. Windows attempt1 failed an existing worker-approval test on its unchanged150ms heartbeat; the failed job passed at the identical head on attempt2. No test assertion or production timeout was changed to obtain green.

Both runtimes were quiesced before migration. An unresponsive API was not treated as proof of descendant death: a follow-up process inventory verified the selected Windows CLI and both children exited. Its existing task was temporarily disabled to prevent restart. Mac current/legacy services were absent and no matching runtime existed. Both worker/outbox inventories were settled. Exact old root/key/registry/base snapshots matched the original reviewed stage.

The clean canonical Windows checkout advanced by fast-forward to the reviewed commit. Initial helper command-length and installer-time-limit failures were inspected before retry; neither changed trust. No installer descendants remained. A retained SSH session then completed locked engine-strict dependencies and build with private phase/status/log evidence. Detached Windows SSH child lifetime was not assumed. No Node installation was needed.

Each host generated/applied its own digest-bound plan, with the encrypted new root supplied only on the root-holder Mac. Both receipts completed at fence1. Private consistent database/config backups and the old encrypted root were retained. Before restarting either runtime, comparisons established:

- Both configurations pin the staged replacement root and require root-bound peer authentication.
- Both databases are schema6 and pass quick_check; all43 non-registry business tables preserve row content/counts.
- Base private/public keys, admin/provider/channel credentials checked, and configuration outside root/binding retain their content.
- All three original registry rows retain exact IDs, bodies, signatures and received timestamps. Each database has seven rows: three original plus four replacement-signed records, with immutable generation bindings.

Both runtimes then reported commitc3a550b, each observed the other online and the coordinator recorded an outbound worker connection at protocol1. A live registry read using the retained base key was refused with HTTP403 for missing/old-root binding; new-root authentication returned200, its signed response verified and all four current records verified. Normal old-root CLI import was also refused. These are actual root/trust/connectivity checks, not approval of a new worker action.

The Windows task's other definition fields were compared before and after restoration; enabled state returned true, its limited-user runtime is running. No replacement task/service was installed there. The Mac currently runs a temporary foreground runtime for acceptance; a durable Mac service is not yet delivered. F-005-T04 owns that workflow.

The isolated MAC-ACCEPTANCE profile imported the current CLI public export with rootBinding1, verified all four records and retained its own identity. No private root, runtime or service was added. Its original pinned checkout remains unchanged; a runnable-reader/source upgrade is not claimed by public-trust enrollment. T02 closes as files-only enrollment; broader worker/device acceptance remains open.

One exact harmless capability test was proposed for explicit owner approval: create one neutral future test reminder on the enrolled Windows worker, verify its receipt, then cancel it. No such action has run while that question is pending. Service work remains independently authorized. F-005 stays open for that check, service execution and remaining platform/device acceptance.
