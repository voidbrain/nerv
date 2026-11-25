# Local Mac node bootstrap acceptance, 8 November 2026

[PR #210](https://github.com/voidbrain/nerv/pull/210) merged at `958d82c9b39ad1b4e0fed2fa8892381504285a64`. [CI 42488053148](https://github.com/voidbrain/nerv/actions/runs/42488053148) completed successfully: plan, validate, windows, native-macos and full-suite. Independent report-only reviews resolved model-setup and concurrent receipt/resource findings before merge. The 22 focused discovery/bootstrap/race contracts passed locally; the committed failing regressions precede their fixes. No broad local evaluation campaign or model call was run.

## Actual local acceptance

The owner selected the local Mac first and deferred remote targets. A fresh read-only local probe observed macOS arm64, Node 26.12.0, Git 2.54.0 and npm 12.2.2, plus existing default configuration. A newly generated additional-profile manifest pinned the merged source above and selected separate, previously absent checkout/data directories. It had no service step or blocker. Its exact confirmed digest was `264f8ed6dda8b466f0d82eabb1fea2277348f4d2ebe5c3bf18918f47575fac5e`.

The actual executor completed all eight steps: clone, fetch pinned commit, detached checkout, source verification, locked dependencies with engine checks, build, fresh model-free initialization and public identity. The receipt reported `completed`, `service: not-installed`, `pairing: required`. A subsequent independent CLI status invocation read the durable completed receipt. This establishes successful actual files-only installation on this Mac, including the actual repository/dependency/build/initialization joins.

The private inspection, manifest, apply response and status response remain outside git. They include host identity and paths; no machine-specific identity, credential, token or generated private key is committed. The retained profile is non-running and unenrolled; its files are retained for inspection rather than silently removed.

## Acceptance still pending

F-005 remains Open. This trial does not establish service ownership/update/uninstall, signed enrollment, worker startup, remote SSH access, mini PC/Pi support, physical effects or full revocation/lease/fencing/reconnect/recovery acceptance. Those require their own reviewed implementation and target-specific checks. No remote target was contacted, and no OS service was installed by this plan.
