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
