# B-091: a fenced stop on Tabgha completes its receipt

Owner step B-091-T02. The fix ([#742](https://github.com/voidbrain/nerv/pull/742), main `2627d483`) is merged; NERV-02 last ran `e05aae22` (2026-11-25, F-006-T30), which predates it. Run this from **Tabgha's desktop session** (PowerShell, not SSH: fenced start, stop and update on Windows run there, B-087), in the same sitting that updates every base (Kaji replies need one release on all bases).

## Steps

1. Put NERV-02 on `main` with the manual update of the [F-006 page](f006-placement-p2-p4.md#6-role-sized-probes-put-both-bases-on-the-same-revision-f-006-t28) (backup first), then check it contains the fix:

```powershell
Set-Location C:\Projects\nerv
git merge-base --is-ancestor 2627d483 HEAD; $LASTEXITCODE
```

Expected: `0`.

2. A fenced stop, then its receipt. The plan file name carries the time, so an earlier plan file is never reused (`lifecycle-inspect` refuses an existing file with `EEXIST`, and the apply would then read the stale plan):

```powershell
$stop = "$HOME\.nerv-private\b091-stop-$(Get-Date -Format yyyyMMdd-HHmmss).json"
node src/cli.ts nodes lifecycle-inspect --action stop --out $stop
$d = (Get-Content $stop | ConvertFrom-Json).digest
node src/cli.ts nodes lifecycle-apply --plan $stop --confirm $d
node src/cli.ts nodes lifecycle-status --digest $d
```

Expected: no `disk I/O error`; the status receipt is complete (not `uncertain`, not stuck at `stop:started`).

3. Start it again with a fenced start. On Windows the fenced stop removes the Task Scheduler task (`unregister`), so `service start` would answer "NERV Agency service is not installed":

```powershell
$start = "$HOME\.nerv-private\b091-start-$(Get-Date -Format yyyyMMdd-HHmmss).json"
node src/cli.ts nodes lifecycle-inspect --action start --out $start
$s = (Get-Content $start | ConvertFrom-Json).digest
node src/cli.ts nodes lifecycle-apply --plan $start --confirm $s
node src/cli.ts nodes lifecycle-status --digest $s
node src/cli.ts kaji list
```

Expected: the start receipt is `completed` and `kaji list` shows NERV-02 online. If the start plan is blocked, `node src/cli.ts service install` (run with the same Node as the service) registers and starts the task again.

Reply `B-091-T02 done` with the `lifecycle-status` output; on a failure, paste the error and the receipt.
