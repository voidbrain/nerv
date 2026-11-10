# Service lifecycle ownership and recovery (F-005-T01)

2026-11-10, baseline main `d869d8c`. This extends the [bootstrap contract](node-bootstrap.md) with implemented **review-only** install/update/uninstall and recovery decisions. It does not extend `nodes apply`, modify existing `service` commands, observe a host, write a receipt or operate an OS service. Fresh-files bootstrap remains the only automated target mutation in `nodes`.

## Why a separate contract

The existing `service` commands render known runtime paths, refuse overwriting a current definition and retain data on uninstall. They also replace legacy Nodo definitions during install and have no fenced lifecycle journal. Reusing them unconditionally in bootstrap would lose the fresh-profile promise and allow another profile's service to be changed. Keep their manual operating procedure unchanged; a future adapter must enforce this contract before reaching them or implement its own fixed service steps.

Alternatives considered: automatically adopt an existing definition by its filename; reject because names prove neither profile nor user ownership. Automatically replace legacy services; reject because migration needs a separate review. Treat a dead PID or lease expiry as permission to retry; reject because descendants/effects can survive. Make this first slice a live installer; defer until target/profile intent and an independently reviewed execution adapter are available. Reconsider exact-byte comparison when supporting older renderers or externally managed definitions, through an explicit versioned ownership adapter rather than a relaxed path match.

## Review interfaces and supplied evidence

`nerv nodes lifecycle-plan --input FILE [--out FILE]` validates a bounded JSON input and returns a canonical digest, expected service-definition digest, blockers, ordered effect descriptions and recovery requirements. The returned `execution` is always `adapter-not-implemented`, even with no blockers. It runs no target, Git, model, database or service command. Its input contains:

| Field | Contract |
|---|---|
| `inspection` | Existing validated local/SSH `nodes inspect` report, at most 24 hours old |
| `action` | `install`, `update` or `uninstall` |
| `checkout`, `home`, `node` | Canonical absolute Unix paths; separate checkout/data below inspected user home; bootstrap journal excluded |
| `revision` | Reviewed installed source's full 40-character commit; the adapter must observe it, not trust its format |
| `nextRevision` | Required only for update; distinct reviewed full commit; compatibility must be checked before mutation |
| `additionalProfile` | Explicit boolean; true blocks every service action |
| `evidence.current`, `evidence.legacy` | `{ "state": "absent" }`, `{ "state": "unknown" }` or `{ "state": "file", "digest": "64 lowercase hex characters", "uid": 501, "mode": 384 }`; mode is numeric permission bits (384 = 0600) |
| `evidence.session` | `available`, `unavailable`, `unknown`; actual current-user service session, never inferred from OS alone |
| `evidence.registration` | `absent`, `matching`, `other`, `unknown`; manager state, separate from on-disk definition |
| `evidence.runtime` | `stopped`, `running`, `unknown`; includes handler and descendants, never inferred from a missing definition |
| `evidence.profile` | `matching`, `other`, `unknown`; selected config/base/private path ownership, including no symlinks |
| `evidence.source` | `clean`, `dirty`, `unknown`; checkout and installed revision evidence |
| `evidence.pending` | `none`, `unresolved`; target-local per-user journal/resource evidence |

These are **supplied attestations**, not an implemented evidence collector or authenticated proof. All evidence must describe the same target/user and observation as `inspection`. Do not fill unknowns with optimistic defaults. The current generic probe does not collect this lifecycle evidence. Actual reports/inputs and stopped-process reasons stay private outside git; outputs use exclusive mode-0600 files. Unknown/private extra fields are discarded, never incorporated into the plan.

macOS and Linux compare existing definitions against the exact current `renderService` output for the selected data/checkout/Node paths, plus matching unprivileged UID and private permissions. Tests exercise the actual renderer/ownership join on both managers. The resource is target-local `user-service:UID:PLATFORM`; different profiles on one target contend for the same service. The plan digest also binds the target locator, inspected identity and every validated evidence field. Another manager registration, legacy definition, unknown ownership, dirty checkout, live runtime or unresolved operation blocks planning. Install requires both current definition and registration absent; update/uninstall require an exact owned definition. A stopped unloaded owned definition may be reconciled when manager registration is absent.

Windows Task Scheduler ownership is deliberately unsupported here: a task XML references a separate launcher, and matching a unit/plist digest would not establish that join. Existing Windows manual service support remains unchanged. No remote target is selected.

## Execution adapter acceptance, still unimplemented

An adapter must freshly inspect same-user paths/ownership without symlinks, current/legacy definitions and manager registration, and validate the authenticated runtime/base/revision. It must distinguish unavailable sessions/permissions from absence. It must compare exact observations under the target-local lifecycle resource before each effect, not replay saved command text. Pin source/lifecycle protocol compatibility and validate builds/dependencies before registration. No root/system service, automatic linger, second-profile service or legacy migration is authorized.

Before effects, atomically accept a digest-bound operation and acquire a monotonic fence/nonce. Record each started effect before running it and each observed completion afterwards. A crash between effect and receipt is uncertain. Persist terminal completion and release ownership in one transaction. Return cached receipts for replay; never restart uncertain, completed or released digests. Bound commands/output, preserve narrow environments and never expose credentials in commands or reports. A failed service install must not delete a changed/foreign definition during cleanup.

Update requires a consistent private data backup and migration/rollback compatibility review; it retains configuration, keys and logs. Build failure or missing post-start acceptance is uncertainty, not success or permission to downgrade. Database rollback remains F-062. Uninstall removes only the exact owned service definition after observed unregistration and stopped descendants; data, checkout, keys and logs remain. No automatic rollback, recursive deletion or credential revocation follows uninstall.

## Recovery decision, no journal mutation

`nerv nodes lifecycle-recovery-check --receipt FILE --evidence FILE [--out FILE]` returns `execution: none` and a decision. Receipt fields are `digest`, target-local `resource`, positive safe-integer `fence`, 32-lowercase-hex `nonce` and `state` (`accepted`, `running`, `completed`, `uncertain`, `released`).

For a nonterminal receipt, evidence must match all four ownership fields exactly. Missing explicit `handlerStopped`, `descendantsStopped` or `operatorConfirmed: true` retains ownership. A release recommendation also requires a nonempty bounded single-line `reason`. Lease expiry, PID absence or elapsed timeout is insufficient. Completed/released receipts only return their stored state, never authorize new effects.

A future durable adapter must compare the returned **entire snapshot** in a transaction against the current receipt/resource and only then mark released. This pure decision does not perform that compare-and-swap, check process liveness, stop descendants or release a lock. Release preserves historical receipts and observed effects; a stale decision must fail after another operation changes the fence/nonce/state. A new plan needs fresh evidence and reconciliation, not an automatic retry.

## Acceptance and next decision

Neutral automated tests establish validation, exact-renderer/profile ownership, canonical digest sensitivity, private CLI file handling, no target commands and recovery recommendations. They do not establish actual launchd/systemd ownership, process liveness, durable lifecycle execution or any device/pairing result. F-005 remains open.

For the next local Mac acceptance slice, the owner must choose whether to pair the already-created isolated files-only profile or work toward service management of the existing default installation. The former remains non-running without an explicit foreground/pairing plan and can never install a second service; the latter needs separate existing-service evidence and the execution adapter above. No pairing, service replacement or remote host is authorized by this contract.

## Local Mac execution slice — 10 November 2026

The owner subsequently selected this Mac's existing default profile and authorized service work. `lifecycle-inspect/apply/status/release` now implement that local slice; the earlier `lifecycle-plan/recovery-check` commands retain their review-only contract. No additional profile, system daemon, automatic legacy replacement, linger or Windows/Linux execution adapter is added.

Actual collection binds canonical source/Node/profile paths, private configuration/token/base identity, schema, clean revision, GUI session, exact rendered definition, manager arguments/environment, process tree and authenticated doctor revision. Public base.pub retains its standard644 convention; credentials remain private and key halves must match. A private per-user journal records monotonic fencing and started/completed effects. Uncertain/released/completed replay never restarts effects, and normal startup consults the same retained resource. Its own start requires the exact manager PID/definition, current source/profile and matching live handler birth/argv identity; ownership is checked again after asynchronous verification.

Independent review rejected missing ordinary-startup fencing and marker-only update compatibility. Committed failing regressions8683354 precede their fixes6eda9b7. The supported update boundary now compares the actual schema and every changed Git path with rename detection disabled. Only documentation/README changes are admitted; all executable/dependency/configuration changes remain blocked under F-005-T06. A rename bypass has committed failing regressiond330735 and unchanged-test fix2ab189f. This deliberately limited update path does not establish arbitrary application migrations or rollback compatibility.

Neutral fixtures exercise the production command adapter, manager/process parsing, authenticated doctor and real SQLite/credential backups, alongside real handler interruptions, concurrent writers, stale recovery and cached replay. Exact2ab189f independent follow-up reports no remaining blockers within the restricted scope,22/22 tests passing. Actual launchd startup and full target lifecycle acceptance remain separate; see [review](../reviews/2026-11-10-mac-service.md). F-005 remains open for application updates and platform/device acceptance.

Actual selected Mac acceptance now passes under PR253/full CI42874665479: [dated service evidence](../acceptance/node-service-2026-11-10.md). This supersedes the pending target check above only for its named operations; executable/schema and other platform/device acceptance remain open.
