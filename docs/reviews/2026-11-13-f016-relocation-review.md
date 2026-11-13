# F-016-T02: review of the coordinator relocation decision, 13 November 2026

Fresh-context design review of [the coordinator relocation decision](../decisions/coordinator-relocation.md) against main `a4081d5`. The reviewer only read source and docs; it ran no tests and changed nothing. **Result: not ready to agree or implement.** The decision is revised in F-016-T10, then reviewed again before the owner agrees.

## Blocking

1. **A partition still allows two coordinators.** The lease renews itself from local clocks and the local registry epoch. An old main cut off from the standby, but still online, keeps renewing, polling Telegram and firing reminders while the standby activates the next epoch. **Fix:** renewal needs the standby's acknowledgement, and the standby does not activate until a TTL plus a margin has passed on its own monotonic clock since its last acknowledgement. With no standby, the owner confirms the old host is down or revoked.
2. **Every base has its own agency state.** `src/nervous-process.ts` ticks reminders on every base, and the other bases send their cards, reminders and briefs through main. Importing main's snapshot, with its `deliveries.rowid` values, into the standby's own database clashes with the standby's rows, and a read-only standby would stop its own reminders. **Fix:** the decision must say whether a non-main base's state is merged, shadowed or kept separate.
3. **The cursor inventory is wrong.**
   - It names tables that do not exist: a `state` table, `telegram.cursor`, and `worker_outbox_jobs`/`events`.
   - The real Telegram `offset` and `inbox.sequence` live in `telegram-state.json`, which is not replicated.
   - Native clients keep `after` cursors against one base's rowids.
   - Tables left out: `reminder_times`, `kaji_outbox_pilots`, `watch_steps`, `watch_cursors`, the `worker_outbox_attempts`/`cancels`/`reconciliations` tables, `worker_legacy_outbox`, `provenance_migrations`, and the `worker_approvals`/`cancellations`/`releases` tables.
   - Quarantine refers to an `attempted` state, but attempts are rows in `worker_outbox_attempts`.
4. **Some effect paths have no fencing check:**
   - web push (`Store.dispatchPushReminders`);
   - the `/kaji/chat`, `/kaji/sortie`, legacy `/kaji/run` and `/kaji/approvals/pending` handlers;
   - each base's own-bot Telegram fallback;
   - direct-SQLite CLI writes (`remind`, `tick`, `approve`), which cannot see a lease held by the serve process.

## Should fix

- **Sleep:** Node's monotonic clock does not count sleep on macOS or Linux, so only the wall clock can detect it. Every effect must recheck the lease; Node cannot guarantee "expired on wake before any timer".
- **Delayed in-flight requests:** a frame from the old main can reach a worker that has not yet seen the new epoch. Before activating, push the new epoch to every base, or have frames carry a lease expiry that the destination checks.
- **Clash with the worker protocol:** it already has a session `epoch` and `worker_jobs.fence`, so names and meanings must be reconciled. `Ledger.consume` does not exist; grants use `authorize` and a `used` column.
- **Lost laptop:**
  - Relocating needs a root-signed revoke of the lost base.
  - The root key normally lives on the main base, so relocating needs the USB copy.
  - "Owner lease re-arm" says neither who signs it nor whether it needs the root key.
- **Replicated tables that must stay local:**
  - Importing `registry` from a snapshot can roll back a newer revoke the standby already holds; merge by serial instead.
  - Replicating `kaji_seen` would overwrite the standby's own nonce cache for incoming requests; keep it local to each base.

## Kept

Rejecting Raft, context-only takeover, raw file sync and trust in the registry serial alone fits the runtime boundaries. Owner-initiated relocation, the owner's stated preference, stays the direction.

## Not verified

Whether Windows timers count sleep time, whether two bots polling Telegram at once get a 409, and any behaviour on a real device.
