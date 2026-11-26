# F-006-T35: make NERV-01 unavailable for the auditor-route check, then restore it

This short owner procedure pairs with `F-006-T36` (`mac-coder-mini-auditor` unavailable-Mac check). The agent never stops or edits `NERV-01`'s live install (`~/.nerv-app`, `~/.nerv`). Stopping `NERV-01` drops its signed `WorkerLink` so `NERV-02`'s `endpoint: "mac"` coder call waits within `waitBudgetMs` and expires with `endpoint unavailable`, with zero local or cloud fallback.

## 1. Stop NERV-01 for the expiry window

Run on Neo Tokyo-3 (`NERV-01`):

```bash
node --use-system-ca ~/.nerv-app/src/cli.ts service stop
launchctl print gui/$(id -u)/io.nerv.agent | grep -E '^\s*state =' || true
```

Expected: the service stops (`state = running` no longer appears). Reply `F-006-T35 stopped` in chat. The agent then runs the single bounded `F-006-T36` expiry case (about 5 seconds, zero model calls while stopped) and asks you to restore `NERV-01`.

## 2. Restore NERV-01 and verify NERV-02 sees it online

Once the agent confirms the expiry check finished, run on Neo Tokyo-3 (`NERV-01`):

```bash
node --use-system-ca ~/.nerv-app/src/cli.ts service start
launchctl print gui/$(id -u)/io.nerv.agent | grep -E '^\s*(state|pid) ='
```

Expected: `state = running`. Then on Tabgha (`NERV-02`) in PowerShell (after ~10 seconds for `WorkerLink` reconnect):

```powershell
Set-Location C:\Projects\nerv
node --use-system-ca src/cli.ts kaji list
node --use-system-ca src/cli.ts doctor
```

Expected: `kaji list` shows `NERV-01` enrolled/online, and `doctor` reports no revision skew. Reply `F-006-T35 restored` in chat so `F-006-T36` runs the single recovery case and `F-006-T37` updates the placement evidence and report.
