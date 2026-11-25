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
- **Sortie inspection:** any enrolled base can read any sortie of another enrolled base by ID, with up to 100 of its events, including local-only and tainted ones (the owner's choice, 2026-11-13: every base is the owner's). Unknown and revoked bases are refused by the signed link. Revoke a base you no longer trust.
- **Remote actions & MAGI voting:** peers opt in with `nerv kaji offer reminders.add reminders.list`, or a granted MCP tool by its name (`nerv kaji offer notes.read_note`): it runs on that base only while its grant still matches the tool and that base's gate grants it without asking (one its gate would send to the owner is refused, and that card rejected); its output marks the asking sortie as outside content; non-Green actions on main also query online peers' Casper in `shadow` (non-blocking) or `veto` (`nerv kaji seat NERV-02 veto`).

## Enrolled worker operations

Before enabling cross-base execution, review [worker protocol](../decisions/worker-protocol.md). Inspect or reconcile durable jobs with:
`nerv workers pending | history | result ID | held | release ID --confirmed-stopped --reason "…" | retry-outbox ID --confirmed-not-run --reason "…" | abandon-outbox ID --reason "…" | cancel ID --reason "…" | cancel-outbox ID --reason "…"`.

## Printing on another base

The part library stays on the base that holds it; a print request sends the part to the slicing base over the Kaji line, only when that base does not already hold the same file. On the library base add `"prints": {"slicer": "NERV-02"}` to `config.json`; on the slicing base add `"prints": {"accept": ["NERV-01"]}`, its own `slicer-profiles.json`, and offer the hand-off with `nerv kaji offer <current offers…> bambu.handoff`. Details: [print hand-off decision](../decisions/bambu-print-handoff.md), section 3.

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
- **Update every base together.** Since B-125 a Kaji reply is signed for the request it answers: until all bases run the same release, an older base refuses an updated base's replies (`bad signature`) and an updated base refuses an older one's (`reply_unbound`), so heartbeats, relays and `kaji promote` fail between them. Update all bases in one sitting ([decision](../decisions/coordinator-relocation.md), section 5).
- Unresolved operations lock mutations until inspected and released (`nodes lifecycle-release --receipt FILE --evidence FILE` after verifying handler and descendants stopped).

## Explicit Kaji root migration

Upgrade both bases to the root-generation-aware reader and stop both runtimes before activating a replacement root ([root-migration decisions](../decisions/node-root-migration.md)):

```bash
nerv root-migration plan --bundle replacement-public-registry.json --new-key /PRIVATE/PATH/replacement.enc --out activation.json
nerv root-migration apply --plan activation.json --confirm EXACT_DIGEST --confirmed-stopped --backup-confirmed
nerv root-migration status --digest EXACT_DIGEST
```

Peers omit `--new-key`. Migration enables `kaji.rootBinding: true` (schema 6). Interrupted migrations lock mutations until resumed with `--resume --reason "…"`.

## Relocating the coordinator

`nerv kaji relocate BASE-ID FILE [--revoke OLD-ID]` (on the base holding the root key) signs the move into FILE and tells no base: copy FILE to the new main and run `nerv kaji promote --relocation FILE` there, which checks every base first and only then stores and pushes the new epoch. Planned: first `nerv kaji drain RECEIPT --relocation FILE` on the old main, then `nerv kaji promote --drain-receipt RECEIPT --relocation FILE`. `kaji import` refuses a relocation file. If the target is refused after the old main was drained or fenced, sign the old main again (`nerv kaji relocate OLD-ID FILE2`) and run `nerv kaji promote --relocation FILE2` on it: it takes its own state back once every other unrevoked base answers with no later epoch, and never when a main named after its state was revoked (that one may have run: promote its verified standby or use an owner-approved cold restore). `kaji main` names the first main only; later moves use `kaji relocate`. `nerv kaji standby BASE-ID` names the standby. An unplanned move needs every other unrevoked base to acknowledge the new epoch, and, without the old main's own ack, a revoke of the old main signed with the root key: keep its offline backup (USB copy of `key-of-nebuchadnezzar.enc` and the passphrase). Details and recovery: [coordinator relocation](../decisions/coordinator-relocation.md), section 4.

