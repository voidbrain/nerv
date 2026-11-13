# F-005-T24: service lifecycle on Tabgha (NERV-02, Windows)

Owner-selected target (2026-11-13): Tabgha. Run in PowerShell, in the NERV checkout on Tabgha. The fenced lifecycle commands inspect first, show a plan with a digest, and change nothing until you confirm that digest.

## 1. Current state

```powershell
npm start -- service status
npm start -- kaji list
```

Expected: the Task Scheduler service `NERV Agency` reported running; `kaji list` shows NERV-01 (Neo Tokyo-3) and NERV-02 (Tabgha) enrolled.

## 2. Stop and start through the fenced flow

```powershell
npm start -- nodes lifecycle-inspect --action stop --out stop-plan.json
npm start -- nodes lifecycle-apply --plan stop-plan.json --confirm PLAN_DIGEST
npm start -- nodes lifecycle-status --digest PLAN_DIGEST
```

`PLAN_DIGEST` is printed by `lifecycle-inspect`. Expected: the receipt state is `completed`, and `service status` says stopped. On Neo Tokyo-3 the dashboard's bases panel shows Tabgha offline within about 90 seconds.

```powershell
npm start -- nodes lifecycle-inspect --action start --out start-plan.json
npm start -- nodes lifecycle-apply --plan start-plan.json --confirm PLAN_DIGEST
```

Expected: `completed`; within 90 seconds Tabgha is online again on Neo Tokyo-3's bases panel (reconnect).

## 3. Update with backup and recovery

```powershell
npm start -- nodes lifecycle-inspect --action update --out update-plan.json
npm start -- nodes lifecycle-apply --plan update-plan.json --confirm PLAN_DIGEST
npm start -- nodes lifecycle-status --digest PLAN_DIGEST
```

Expected: the plan names the backup it takes and the target commit; the receipt ends `completed` with a passing health check, or `uncertain` with ordered recovery steps (then stop and tell the agent; nothing is retried on its own).

## Report

Paste the three receipts' `state` lines and anything unexpected. The agent records the evidence in F-005 and closes the step.
