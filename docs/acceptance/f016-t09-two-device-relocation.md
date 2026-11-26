# F-016-T09: two-device coordinator relocation

Owner steps for [F-016](https://github.com/voidbrain/nerv/blob/backlog-views/docs/BACKLOG.md#f-016) (step F-016-T09, with the live check of B-120). A planned move of the coordinator from Neo Tokyo-3 (`NERV-01`, the main, with the root key) to Tabgha (`NERV-02`), then back. The commands follow the [relocation guide](../guides/kaji-and-nodes.md#relocating-the-coordinator) and [the decision](../decisions/coordinator-relocation.md), section 4. Paste one block at a time and **stop at the first unexpected result or refusal**: note its text in F-016 and do not work around it (never `kaji main`, never a copied store). Keep the relocation and receipt files outside Git, under `~/.nerv-private/relocation` on NERV-01 and `$HOME\.nerv-private\relocation` on NERV-02.

## 0. Before you start

Both bases on `main` at `2627d483` or later (B-124 and B-125 included). NERV-03 (Calvary) is on `eff68a3a` since 2026-11-25 (B-125 closed); if a base still refuses (`reply_unbound` or `bad signature`), update it first ([B-125 page](b125-nerv03-update.md)).

On NERV-01 (Terminal):

```bash
mkdir -p ~/.nerv-private/relocation
nerv kaji list
nerv kaji standby
```

Expected: `NERV-01 … enrolled  (this base)  (main)` and `NERV-02 … enrolled`; then `Standby: NERV-02` and a replication status. If it reads `No standby named.`, run `nerv kaji standby NERV-02` and expect `Standby: NERV-02. The lease renews through it from the next renewal (every 15 s).` (or a line that it seeded NERV-02's standby store first).

## 0b. Once only: adopt NERV-01's store as the first coordinator (B-170)

Do this only if step 0 answered `This base holds no coordinator state to name a standby for.` (`nerv kaji standby NERV-02`) or `No standby named.` with no replication status (`nerv kaji standby`): NERV-01 was named main before relocation existed, so its store has no coordinator state (2026-11-26). Needs NERV-01 on `main` with B-170 merged, updated by `nerv update`.

Backup outside Git first (on NERV-01, Terminal; the service may keep running):

```bash
mkdir -p ~/.nerv-private/relocation
sqlite3 ~/.nerv/nerv.sqlite ".backup '$HOME/.nerv-private/relocation/nerv-before-adopt.sqlite'"
sqlite3 -readonly ~/.nerv-private/relocation/nerv-before-adopt.sqlite "PRAGMA quick_check"
```

Expected: `ok`.

Adopt (it asks for the passphrase of the Key of Nebuchadnezzar):

```bash
nerv kaji adopt
```

Expected, two lines:

```
Backup: /Users/<you>/.nerv/backups/nerv-before-adopt-<time>.sqlite
Adopted this base's store as coordinator epoch 1 (active, no lease yet); signed main NERV-01 at coordinator epoch 1. Told NERV-02, NERV-03 the epoch. Next: name a standby with kaji standby NERV-02.
```

If a base was offline the line says `Not reached now: …`; that is fine for NERV-03, but NERV-02 must have been told before the next command (run `nerv kaji adopt` again once it is on: it only pushes again and says `This base already holds coordinator state at epoch 1 (active): nothing to adopt.`). Any other answer is a refusal: nothing was changed; stop and note its text in F-016.

Verify:

```bash
nerv kaji list
nerv kaji standby NERV-02
nerv kaji standby
```

Expected: `NERV-01 … (this base)  (main)`; then `Seeded NERV-02's standby store from this main at seq S.` and `Standby: NERV-02. The lease renews through it from the next renewal (every 15 s).`; then `Standby: NERV-02` and a replication status. From now on NERV-01 renews its lease through NERV-02: if NERV-02 is off or asleep for more than a minute, NERV-01 stops coordinator work until NERV-02 answers again.

Undo (only if something above went wrong; restores the store as it was before 0b):

```bash
nerv service stop
cp ~/.nerv-private/relocation/nerv-before-adopt.sqlite ~/.nerv/nerv.sqlite
rm -f ~/.nerv/nerv.sqlite-wal ~/.nerv/nerv.sqlite-shm
nerv service start
nerv kaji standby
```

Expected: `No standby named.` and NERV-01 works as before. The other bases keep the epoch 1 record naming NERV-01; that is harmless. A later `nerv kaji adopt` works again once every base answers, unless `kaji standby NERV-02` had already succeeded (NERV-02 then acked a lease, and adopt refuses): note that in F-016 and stop.

## 1. Sign the move (NERV-01)

```bash
nerv kaji relocate NERV-02 ~/.nerv-private/relocation/to-nerv02.json
nerv kaji list
```

Expected: `Signed main NERV-02 at coordinator epoch N into …/to-nerv02.json.` with the planned next steps; `kaji list` still shows NERV-01 as `(main)`: nothing was pushed.

## 2. Drain the old main (NERV-01)

```bash
nerv kaji drain ~/.nerv-private/relocation/receipt-nerv02.json --relocation ~/.nerv-private/relocation/to-nerv02.json
```

Expected: `Final batch: the standby holds seq S of S.` and `Drained epoch E at seq S for NERV-02 at epoch N; receipt written to …`. If the drain is refused, NERV-01 stays `draining`: run it again, or `nerv kaji drain --cancel` to return it to active, and stop here.

Copy `to-nerv02.json` and `receipt-nerv02.json` to `$HOME\.nerv-private\relocation\` on NERV-02 (the same way you copy other private files; never through Git).

## 3. Promote the new main (NERV-02, PowerShell)

```powershell
Set-Location C:\Projects\nerv
node src/cli.ts kaji promote --drain-receipt "$HOME\.nerv-private\relocation\receipt-nerv02.json" --relocation "$HOME\.nerv-private\relocation\to-nerv02.json"
node src/cli.ts kaji list
node src/cli.ts doctor
```

Expected: promote stops the service, promotes, removes `coordinator-promotion.json` and starts the service again (B-120: no marker left behind, the service starts); `kaji list` shows `NERV-02 … (this base)  (main)`; `doctor` reports no problem.

## 4. Both sides agree (NERV-01)

```bash
nerv kaji list
nerv chat "ricordami di bere acqua tra 5 minuti"
nerv inbox | head -n 5
```

Expected: `NERV-02` shown as `(main)`, NERV-01 runs no coordinator work; the reminder is created and arrives once, through NERV-02.

## 5. Move back

Repeat steps 1 to 4 with the roles swapped: on NERV-01 (the root key is there) `nerv kaji relocate NERV-01 ~/.nerv-private/relocation/to-nerv01.json`, copy it to NERV-02; drain on NERV-02 (`node src/cli.ts kaji drain "$HOME\.nerv-private\relocation\receipt-nerv01.json" --relocation "$HOME\.nerv-private\relocation\to-nerv01.json"`), copy the receipt back; promote on NERV-01 (`nerv kaji promote --drain-receipt ~/.nerv-private/relocation/receipt-nerv01.json --relocation ~/.nerv-private/relocation/to-nerv01.json`), and name NERV-02 as its standby again (`nerv kaji standby NERV-02`).

Expected: NERV-01 is `(main)` again at a higher epoch, with `Standby: NERV-02`. Record the epochs, the times of each step and every message in F-016.
