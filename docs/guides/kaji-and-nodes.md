# Kaji Line, Remote Workers, and Node Setup

## Enrolling bases (Kaji line)

Trust comes from your offline **Key of Nebuchadnezzar**; Tailscale carries signed messages on port `4320`.

1. Install **Tailscale** on every base and note `tailscale ip -4` (`100.x.y.z`).
2. On the main base: `nerv key init` (writes `~/.nerv/key-of-nebuchadnezzar.enc`, prints root fingerprint; back up to USB or pass `--out`).
3. Enrol main: `nerv kaji enrol NERV-01 "Neo Tokyo-3" self 100.x.y.z`.
4. On each peer: run `nerv base pubkey`, then on main: `nerv kaji enrol NERV-02 "Tabgha" <PUBKEY> 100.x.y.z`.
5. On main: `nerv kaji export bases.json`; on peer: `nerv kaji import bases.json --root <ROOT_FINGERPRINT>`.
6. Verify with `nerv kaji list`; revoke lost bases with `nerv kaji revoke ID`.

- **Live link & health:** bases heartbeat every 30 s (`online` within 90 s, `degraded` with doctor reasons, `offline` after 3 missed beats). On Windows, allow TCP `4320` on the `Tailscale` interface.
- **Single Telegram channel:** `nerv kaji main NERV-01` routes peer replies/cards through Aoba on main while main is online (peers fall back to their own bots if main is unreachable).
- **Remote actions & MAGI voting:** peers opt in with `nerv kaji offer reminders.add reminders.list`; non-Green actions on main also query online peers' Casper in `shadow` (non-blocking) or `veto` (`nerv kaji seat NERV-02 veto`).

## Enrolled worker operations

Before enabling cross-base execution, review [worker protocol](../decisions/worker-protocol.md). Inspect or reconcile durable jobs with:
`nerv workers pending | history | result ID | held | release ID --confirmed-stopped --reason "…" | retry-outbox ID --confirmed-not-run --reason "…" | abandon-outbox ID --reason "…" | cancel ID --reason "…" | cancel-outbox ID --reason "…"`.

## Discover, inspect and bootstrap node candidates

```bash
nerv nodes discover --inventory selected-targets.json   # or --ssh-config, --tailscale-live, --registry
nerv nodes inspect --ssh selected-alias --out remote-inspection.json
nerv nodes plan --inspection remote-inspection.json --revision FULL_SHA --checkout /path/src --home /path/data --base BASE-02 --name Harbor --out bootstrap-preview.json
nerv nodes apply --plan bootstrap-preview.json --confirm FULL_PLAN_DIGEST
nerv nodes status --plan bootstrap-preview.json
nerv nodes release --plan bootstrap-preview.json --confirm FULL_PLAN_DIGEST --confirmed-stopped --reason "…"
```

- Discovery/inspection never scan a LAN automatically or trust unpinned host/registry keys.
- `nodes plan` is review-only until confirmed by digest; `--additional-profile` avoids overwriting an existing default profile and cannot install a second service. See [bootstrap contract](../decisions/node-bootstrap.md).

## Service lifecycle and local Mac updates

- **Review-only contracts:** `nerv nodes lifecycle-plan --input FILE` and `nerv nodes lifecycle-recovery-check --receipt FILE --evidence FILE` validate supplied evidence ([input/recovery contract](../decisions/node-lifecycle.md)). See [the roadmap](../ROADMAP.md) for platform support and open work.
- **Local Mac default profile:**

```bash
nerv nodes lifecycle-inspect --action install|update|start|stop|uninstall --out service-plan.json
nerv nodes lifecycle-apply --plan service-plan.json --confirm PLAN_DIGEST
nerv nodes lifecycle-status --digest PLAN_DIGEST
```

- For `update --revision FULL_SHA`: fetch the commit first (`git fetch origin FULL_SHA`); **never `git pull` the live service checkout**. Updates take a consistent backup, rehearse the candidate reader on a private copy (`nerv nodes upgrade-rehearse --backup DIR`), then advance, install (`--ignore-scripts`), build, and verify. See [upgrade decision](../decisions/node-upgrades.md).
- Unresolved operations lock mutations until inspected and released (`nodes lifecycle-release --receipt FILE --evidence FILE` after verifying handler and descendants stopped).

## Explicit Kaji root migration

Upgrade both bases to the root-generation-aware reader and stop both runtimes before activating a replacement root ([root-migration decisions](../decisions/node-root-migration.md)):

```bash
nerv root-migration plan --bundle replacement-public-registry.json --new-key /PRIVATE/PATH/replacement.enc --out activation.json
nerv root-migration apply --plan activation.json --confirm EXACT_DIGEST --confirmed-stopped --backup-confirmed
nerv root-migration status --digest EXACT_DIGEST
```

Peers omit `--new-key`. Migration enables `kaji.rootBinding: true` (schema 6). Interrupted migrations lock mutations until resumed with `--resume --reason "…"`.
