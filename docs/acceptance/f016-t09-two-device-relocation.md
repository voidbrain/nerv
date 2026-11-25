# F-016-T09: two-device coordinator relocation

Owner steps for [F-016](../BACKLOG.md#f-016) (step F-016-T09, with the live check of B-120). A planned move of the coordinator from Neo Tokyo-3 (`NERV-01`, the main, with the root key) to Tabgha (`NERV-02`), then back. The commands follow the [relocation guide](../guides/kaji-and-nodes.md#relocating-the-coordinator) and [the decision](../decisions/coordinator-relocation.md), section 4. Paste one block at a time and **stop at the first unexpected result or refusal**: note its text in F-016 and do not work around it (never `kaji main`, never a copied store). Keep the relocation and receipt files outside Git, under `~/.nerv-private/relocation` on NERV-01 and `$HOME\.nerv-private\relocation` on NERV-02.

## 0. Before you start

Both bases on `main` at `2627d483` or later (B-124 and B-125 included). NERV-03 is offline as of 2026-11-25 and runs the older reply format; a planned move goes on without its answer, but if it is online and refuses (`reply_unbound` or `bad signature`), update it first ([B-125 page](b125-nerv03-update.md)).

On NERV-01 (Terminal):

```bash
mkdir -p ~/.nerv-private/relocation
nerv kaji list
nerv kaji standby
```

Expected: `NERV-01 … enrolled  (this base)  (main)` and `NERV-02 … enrolled`; then `Standby: NERV-02` and a replication status. If it reads `No standby named.`, run `nerv kaji standby NERV-02` and expect `Standby: NERV-02. The lease renews through it from the next renewal (every 15 s).` (or a line that it seeded NERV-02's standby store first).

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
