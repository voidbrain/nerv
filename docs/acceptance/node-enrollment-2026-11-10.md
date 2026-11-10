# Isolated local Mac enrollment preparation, 10 November 2026

Baseline main `77b22da`, after [PR #245](https://github.com/voidbrain/nerv/pull/245). [CI42775093119](https://github.com/voidbrain/nerv/actions/runs/42775093119) passed plan, validate, Windows, native-macos and full-suite at exact head `a965a10`. This accepts F-005-T01's review-only lifecycle contracts and portable service rendering, not actual lifecycle operations.

The owner chose enrollment testing with the isolated profile retained from the [8 November files-only bootstrap](node-bootstrap-2026-11-08.md). Existing-default service management and remote targets remain deferred. This continues F-005 in bounded task context; no host thread-reset capability was invoked or claimed. Source token counters remain unavailable; the private development usage job is registered.

## Observed read-only checks

- Opened the target-local bootstrap journal read-only and found the original digest's completed receipt, all eight steps and no held bootstrap resource.
- Compared the isolated profile's public key with the receipt: exact match. The target key stays on the target; no private key or administrative/provider credential was copied into the handoff or git.
- Verified the retained checkout is clean at the original pinned source `958d82c9b39ad1b4e0fed2fa8892381504285a64`.
- Verified the isolated base identity matches the accepted profile and has no pinned Kaji root. It has no application database yet.
- Read the coordinator's registry through a read-only SQLite connection and verified every record's signature against its already-pinned root. The proposed test base ID, public key and explicit local-only Kaji address are unused.
- Observed that the coordinator's encrypted root-key file exists. It was not unlocked or copied; no passphrase was requested through chat or an agent tool.

Actual paths, base/public fingerprints, signed/public registry data and the prepared manifest remain private outside git. The proposed Kaji address is loopback-only with a distinct explicit port; no remote host was probed. Enrollment alone does not start a listener.

## Concrete terminal handoff, not executed enrollment

A private mode-0700 Node handoff and mode-0600 manifest were created outside the checkout. The default `--review` mode rechecks source/profile/root/receipt/resource and all registry signatures without invoking a target or service command. Syntax validation and the actual read-only review passed. A non-terminal `--sign-and-import` trial refused before signing; comparing target configuration and coordinator registry record count confirmed no change.

The owner-run `--sign-and-import` mode requires an actual local terminal. It adds only the reviewed isolated identity/address to the coordinator's signed registry, using the existing CLI's hidden passphrase prompt, then exports signed public registry/root material to an exclusive private file. It imports that material through the retained target CLI with the independently read coordinator root fingerprint, then verifies target signatures and exact enrollment identity/address. A matching existing enrollment is inspected/reused rather than blindly appended after a lost reply; conflicts/revocation/root changes stop the flow.

The handoff rechecks that reviewed source files remain unchanged against main `77b22da`; later code changes require a fresh handoff. Package/runtime/model installation, root-key creation, runtime startup, capability offers, service commands and remote target calls are absent. It does not grant an action or claim an effect was undone. If a command fails after signing, inspect actual coordinator/target registry state before retrying.

## Pending acceptance

**Signing and import have not run.** The owner must run the prepared local command and type the existing root passphrase only in that terminal. Do not paste it into chat, argv or environment. F-005-T02 remains implemented preparation with real enrollment pending; F-005 remains Open.

The isolated profile still has the default HTTP port from fresh initialization. Do not start it alongside the existing runtime without a separately reviewed distinct loopback port/configuration plan. No second service is permitted. Signed enrollment/import, worker startup, authenticated link, harmless capability execution, revocation, leases/fencing/locks, cancellation, reconnect and uncertain physical outcomes remain unverified. No mini PC/Pi or remote-device acceptance is claimed.

## Subsequent owner unlock attempt, 10 November 2026

The owner ran the prepared terminal handoff. The existing CLI rejected root-key unlock with its combined incorrect-passphrase/damaged-key error before signing. No passphrase was supplied to the agent. A subsequent actual read-only review confirmed the coordinator registry record count still equals the prepared baseline, all signatures remain valid, the test base is absent, and the isolated profile still has neither a pinned root nor an application database. No signing/import success is claimed.

The existing encrypted key envelope has the expected version/KDF fields and salt/IV/tag lengths, a nonempty encrypted payload and the expected public root. This structural check cannot establish ciphertext integrity or distinguish a mistyped/unavailable passphrase from payload damage. Retry only with the original passphrase in the local terminal. If unavailable, inspect the owner's known offline recovery copy through a separately reviewed recovery plan; do not create or replace a root or change the pinned trust. Enrollment and all later acceptance remain pending.

## Root access unavailable, 10 November 2026

The owner subsequently confirmed neither the original root passphrase nor a recovery backup is available. Existing-root signing and isolated import are therefore blocked. Read-only registry inspection found two currently enrolled bases and no test-base enrollment. Existing signed trust remains unchanged.

The next decision distinguishes a separately scoped disposable test root/profile (isolated signed-enrollment evidence only, no pairing with the existing bases), leaving enrollment blocked, and preparing a reviewed trust-migration plan for the two existing bases. No new root, key replacement, deletion, pinned-root reset, registry rewrite or migration is authorized or performed by this report. The original terminal handoff remains a prepared existing-root path, not a way around missing root access.

## Superseding owner migration authorization, 10 November 2026

After considering another candidate passphrase and pausing disposable test trust, the owner explicitly requested real migration/root regeneration. [F-005-T03 preparation](../decisions/node-root-migration.md) now stages the replacement encrypted root and signed registry through owner-local new-passphrase input. Neutral generation/snapshot/refusal fixtures and actual read-only review pass; the production key has not been regenerated by the agent. Current trust remains unchanged. Live activation/history-preserving storage, backup/worker quiescence and Tabgha access/acceptance remain pending. Earlier no-authorization/choice statements above are dated history superseded by this explicit request, not current permission limits.

## Replacement stage and selected Tabgha inspection, 10 November 2026

Owner-generated replacement stage has now been verified read-only: four new-root signatures, exact existing public identities plus the isolated profile/main choice, encrypted key mode0600, and Mac old-root trust unchanged. Selected-host SSH password authentication succeeded through a target-restricted private helper authorized by the owner; no credential content entered chat/argv/environment/logs/git. Actual Windows x64/default NERV-02 inspection used existing absolute Node24.22.2 outside SSH PATH. Its public root/key and all three existing registry signatures match the migration snapshot. Generic/quoting probes initially failed without requested changes; the explicit runtime probe passed. No Node install, remote service/trust write, actual activation or worker effect occurred. npm was not detected, not proven absent.

Owner selected the Mac default NERV-01 profile for service acceptance; current/legacy service files/registrations absent and configured API not responsive in the read-only check. Testing service management is part of F-005 acceptance, but modifying a default installation specifically is not required; it is this owner-selected target. Supported activation/backup/worker recovery and service execution remain T05/T04.
