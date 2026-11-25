# Native notifications and lifecycle — scoped review, 1 November 2026

Baseline `37398b60b301263e473f4a4ed41d2933436e3d62`, plus this branch's bounded feeds, native notification/OS code, tests and documentation. This is not actual OS permission/banner/login acceptance.

| Area | Inspected evidence and limits |
|---|---|
| code | Inbox sequence+UUID read snapshots, capped pages, pending-reminder query/index, schema/graph/REST/native scope joins; Swift notification/file checkpoint/OS code reviewed. |
| logic | Enable starts at current head; known OS identifiers reconcile before checkpoint; OS/storage failure preserves unfinished position; changed database resets visibly; corrupt state does not silently replay. Whole pages validated before any post. |
| tests | 18 local regression/protocol/DOM tests, two real process tests; Swift tests cover OS submission failure, post-acceptance checkpoint failure, restart, restore reset, malformed pages, private checkpoint persistence, matching runtime directory and fixed command/status semantics. macOS CI is required for compile/Swift results. |
| documentation | Native guide, README, install, runtime decision, architecture, milestones, area/style notes and owning F-011/F-013 reconciled. |
| harness | Copied v3.1.1 helpers unchanged; project review receipt and notification-feed impact row updated. |
| security | No new network mutation scope. Fixed user launchctl argv, no shell/sudo/token; paired runtime must match local plist NODO_HOME. Stop is confirmed. OS notifications/login are opt-in; tests do not prompt/register/stop real OS services. Checkpoints are private atomic files with IDs only. |
| delivery | Local Node/Angular/process checks pass. macOS CI builds/tests/packages preview; live banners/Keychain/dialogs/login/logout/accessibility remain unperformed. Ad-hoc signing remains distinct from notarized distribution. |
| backlog | F-011 advances implementation but remains open to named native acceptance/distribution checks. F-013 records bounded native reads without claiming full-history web pagination or measured global load limits. |

## Residual limits

No exactly-once banner claim: OS acceptance and file persistence are not a shared transaction. Existing pending/delivered identifiers cover known repeats, but a crash plus user dismissal before reconciliation can repeat a banner. Focus, sleep, OS permissions and stopped companion can delay/suppress notifications. At most five messages are submitted per 15-second poll; first enable/re-enable baselines current head. A restored/missing sequence+UUID resets to current head with a warning, preserving inbox content but potentially skipping old banners. Corrupt checkpoint state is reported for explicit recovery.

The control job can time out with an uncertain result; status must be refreshed before retry. Loaded launchd state is not daemon-health evidence. Companion login registration does not install/start the Node service or wake hardware. Changing the app's ad-hoc signature/location may require OS reapproval. Unit tests use fake sinks and pure command plans; passing CI is not live notification or service acceptance.
