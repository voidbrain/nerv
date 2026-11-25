# F-006 placement P2–P4: owner procedure

Run these blocks from the NERV install on Tabgha (`NERV-02`, `C:\Projects\nerv`) in PowerShell. They use the running NERV service and invented text only. `placement plan` selects the route without calling a model; `placement run` calls a model only with the explicit `--execute` flag. No command enables cloud inference or executes a tool.

Paste one block at a time and stop at the first unexpected result. Keep the JSON results outside Git under `$HOME\.nerv-private\placement`.

## 1. Prepare the three bounded probes

```powershell
Set-Location C:\Projects\nerv
New-Item -ItemType Directory -Force "$HOME\.nerv-private\placement" | Out-Null
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText("$HOME\.nerv-private\placement\p2.json", '{"placement":"P2","prompt":"Reply with exactly READY.","maxOutputTokens":512}', $utf8NoBom)
[System.IO.File]::WriteAllText("$HOME\.nerv-private\placement\p3.json", '{"placement":"P3","endpoint":"mac","prompt":"Reply with exactly READY.","maxOutputTokens":512}', $utf8NoBom)
[System.IO.File]::WriteAllText("$HOME\.nerv-private\placement\p4.json", '{"placement":"P4","endpoint":"mac","prompt":"Reply with exactly READY.","waitBudgetMs":5000,"timeoutMs":20000,"maxOutputTokens":512}', $utf8NoBom)
```

Expected: no output or error. These files contain no address, credential or private request.

## 2. Plan P2, P3 and P4 — zero model calls

```powershell
node src/cli.ts placement plan "$HOME\.nerv-private\placement\p2.json"
node src/cli.ts placement plan "$HOME\.nerv-private\placement\p3.json"
node src/cli.ts placement plan "$HOME\.nerv-private\placement\p4.json"
```

Expected:

- P2 selects `inference.kind: "local"` and `worker.kind: "local"` on NERV-02.
- P3 and P4 select `inference.kind: "remote"`, `endpoint: "mac"`, `baseId: "NERV-01"`, and `worker.kind: "local"` on NERV-02.

Planning never invokes inference. If P3/P4 says the endpoint is not configured, not enrolled, not granted or not on Tailscale, stop; do not replace it with a URL or expose Ollama beyond loopback.

## 3. P2 — mini PC local baseline probe

Keep Tabgha at its normal baseline load, then run:

```powershell
node src/cli.ts placement run "$HOME\.nerv-private\placement\p2.json" --execute | Tee-Object "$HOME\.nerv-private\placement\p2-result.json"
```

Expected: `placement: "P2"`, local inference and execution on NERV-02, then `inference.text: "READY"`. A different answer is retained as a model outcome, not edited into a pass.

## 4. P3 — mini PC worker with Mac remote inference

On Neo Tokyo-3, leave the NERV service and its loopback model running under the ordinary moderate workload. On Tabgha:

```powershell
node src/cli.ts placement run "$HOME\.nerv-private\placement\p3.json" --execute | Tee-Object "$HOME\.nerv-private\placement\p3-result.json"
```

Expected: execution remains local on NERV-02; inference provenance names NERV-01, `remote`, endpoint `mac`, and the configured Mac model; the text is `READY`. There is no HTTP connection to the Mac's Ollama and no fallback route.

## 5. P4 — Mac unavailable, expiry, then recovery

First stop the NERV Agency service on Neo Tokyo-3 with its normal service command. On Tabgha:

```powershell
node src/cli.ts placement run "$HOME\.nerv-private\placement\p4.json" --execute
```

Expected after about five seconds: an `endpoint unavailable` error. It must not print a local or cloud inference result.

Start the NERV Agency service again on Neo Tokyo-3 and wait until `node src/cli.ts kaji list` on Tabgha shows NERV-01 online. Then:

```powershell
node src/cli.ts placement run "$HOME\.nerv-private\placement\p4.json" --execute | Tee-Object "$HOME\.nerv-private\placement\p4-recovered.json"
```

Expected: remote inference provenance names NERV-01 and endpoint `mac`, local execution remains NERV-02, and the text is `READY` within the 20-second probe timeout.

Return the four command summaries (P2, P3, P4 unavailable, P4 recovered). Keep the private JSON files on their originating base.

## 6. Role-sized probes: put both bases on the same revision (F-006-T28)

A probe may carry `system` (at most 24,576 bytes) beside `prompt` (at most 32,768 bytes), so Casper's and Misato's own system messages (Misato's is about 18 KB) travel unchanged. WorkerLink checks the system bound on the receiving base too: a base on a revision before PR #714 refuses a system message over 8 KiB with `Remote inference system prompt exceeds 8192 bytes.` (no fallback). The P3 role rerun therefore needs NERV-01 and NERV-02 both on a `main` revision that includes PR #714 (and PR #708, B-119).

Update both bases before any role-sized probe: a base on earlier code that receives a body over its old bound closes the WorkerLink session ("Invalid worker envelope"), failing every request in flight on it until it reconnects.

On Neo Tokyo-3 (`NERV-01`): its install (`~/.nerv-app`) has the dashboard's **Update now** (B-108, B-110), which hands the update to its own job outside the service (backup, rehearsal, build, start, verify). Open the dashboard, go to **Health**, and once the availability line shows a newer `main` revision that includes PR #714, press **Update now**.

Expected: the button reads "Updating…", the dashboard reconnects after the restart, and the inbox and Health report the update `completed` with the new revision. If it reports `refused` or `uncertain`, stop and paste the message and its recovery lines. To check by hand afterwards:

```bash
git -C ~/.nerv-app log -1 --format='%h %s'
launchctl print gui/$(id -u)/io.nerv.agent | grep -E '^\s*(state|pid) ='
```

Expected: the new revision and `state = running`.

On Tabgha (`NERV-02`), in PowerShell. Its install is `C:\Projects\nerv`, a checkout on a detached `HEAD` that predates `nerv update`, so it takes this manual update; `git pull` does not apply to a detached `HEAD`:

```powershell
Set-Location C:\Projects\nerv
node src/cli.ts service stop
Copy-Item $HOME\.nerv\nerv.sqlite "$HOME\.nerv-private\nerv-before-f006-t28.sqlite"
git fetch origin
git checkout --detach origin/main
npm ci --ignore-scripts
npm run build
node src/cli.ts service start
node src/cli.ts doctor
node src/cli.ts kaji list
```

Expected: the service stops and starts without error; `doctor` reports the new revision with no revision skew; `kaji list` shows NERV-01 and NERV-02 online. Reply `F-006-T28 done` with the two revisions; the agent then runs the P3 role rerun (F-006-T29) under the Mac's machine lock.

