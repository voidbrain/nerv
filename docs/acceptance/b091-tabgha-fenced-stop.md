# B-091: a fenced stop on Tabgha completes its receipt

Owner step B-091-T02. The fix ([#742](https://github.com/voidbrain/nerv/pull/742), main `2627d483`) is merged; NERV-02 last ran `e05aae22` (2026-11-25, F-006-T30), which predates it. Run this from **Tabgha's desktop session** (PowerShell, not SSH: fenced start, stop and update on Windows run there, B-087), in the same sitting that updates every base (Kaji replies need one release on all bases).

## Steps

1. Put NERV-02 on `main` with the manual update of the [F-006 page](f006-placement-p2-p4.md#6-role-sized-probes-put-both-bases-on-the-same-revision-f-006-t28) (backup first), then check it contains the fix:

```powershell
Set-Location C:\Projects\nerv
git merge-base --is-ancestor 2627d483 HEAD; $LASTEXITCODE
```

Expected: `0`.

2. A fenced stop, then its receipt:

```powershell
node src/cli.ts nodes lifecycle-inspect --action stop --out $HOME\.nerv-private\b091-stop.json
$d = (Get-Content $HOME\.nerv-private\b091-stop.json | ConvertFrom-Json).digest
node src/cli.ts nodes lifecycle-apply --plan $HOME\.nerv-private\b091-stop.json --confirm $d
node src/cli.ts nodes lifecycle-status --digest $d
```

Expected: no `disk I/O error`; the status receipt is complete (not `uncertain`, not stuck at `stop:started`).

3. Start it again: `node src/cli.ts service start; node src/cli.ts kaji list` (NERV-02 online).

Reply `B-091-T02 done` with the `lifecycle-status` output; on a failure, paste the error and the receipt.
