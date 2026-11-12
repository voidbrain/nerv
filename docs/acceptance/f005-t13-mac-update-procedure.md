# F-005-T13: Mac service update, owner procedure

**Run 2026-11-12** by the agent with the owner's approval: [evidence](node-update-2026-11-12.md). Kept as the procedure for the next hand-run update; the digest is now read from the plan file instead of a placeholder.

Prepared 2026-11-12 for [F-005](../BACKLOG.md#f-005) step F-005-T13 (T06f), the first lifecycle update of the Mac service. [PR #287](https://github.com/voidbrain/nerv/pull/287) merged on 2026-11-12; run it once its main CI has passed. Use a local Terminal on the Mac (not SSH), with the Mac on power, and keep the Terminal open. Paste each block and compare the output with the expected result. Stop at the first difference and paste the output back to the agent. Do not retry.

```bash
# 0. Variables. N = the Node the service definition uses. T = the reviewed target: the merge commit of PR #287.
cd ~/Projects/NERV/NERV
N=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' ~/Library/LaunchAgents/io.nerv.agent.plist); echo "$N"
T=$(gh pr view 287 --repo voidbrain/nerv --json mergeCommit -q .mergeCommit.oid); echo "$T"
mkdir -m 700 -p ~/nerv-t13 && ls ~/nerv-t13
```
Expected: the nvm Node path (`…/node/v26.12.0/bin/node`), a 40-character commit, and an empty `~/nerv-t13`.

```bash
# 1. The service runs 2a3448d. Confirm it (read-only), then put the checkout back there, without restarting anything.
"$N" -e 'const fs=require("fs"),h=require("os").homedir(),c=JSON.parse(fs.readFileSync(h+"/.nerv/config.json"));fetch("http://127.0.0.1:"+(c.port??4317)+"/api/doctor",{headers:{authorization:"Bearer "+fs.readFileSync(h+"/.nerv/token","utf8").trim()}}).then(r=>r.json()).then(b=>console.log(b.build?.commit,b.base?.id))'
test -z "$(git status --porcelain)" && git checkout -q --detach 2a3448d6dca6471323758f721f57ea58a41dd452 && git rev-parse HEAD && git status --porcelain
ps -axo pid=,lstart=,args= | grep -E 'src/cli\.ts (serve|launch)' | grep -v grep
```
Expected: the doctor prints `2a3448d… NERV-01` (a different commit: stop and paste it). Then `2a3448d6dca6471323758f721f57ea58a41dd452` and no `git status` output; if the tree is dirty, nothing is checked out and nothing prints (stop and paste `git status`). Exactly one `serve` line from `~/Projects/NERV/NERV/src/cli.ts`. A second line (a worktree or test server) must be stopped first, or the plan reports the runtime as `unknown`.

```bash
# 2. Stop plan, then apply it.
"$N" --use-system-ca src/cli.ts nodes lifecycle-inspect --action stop --out ~/nerv-t13/stop-plan.json
"$N" -p 'const p=require(process.argv[1]);[p.digest,JSON.stringify(p.blockers),p.before.runtime,p.before.revision].join(" ")' ~/nerv-t13/stop-plan.json
```
Expected: `{"saved": …, "execution": "none"}`, then `DIGEST [] owned 2a3448d6…`. Non-empty blockers: stop and paste them.

```bash
D=$("$N" -p 'require(process.argv[1]).digest' ~/nerv-t13/stop-plan.json); echo "$D"
"$N" --use-system-ca src/cli.ts nodes lifecycle-apply --plan ~/nerv-t13/stop-plan.json --confirm "$D"
ps -axo pid=,args= | grep -E 'src/cli\.ts (serve|launch)' | grep -v grep; launchctl print gui/$(id -u)/io.nerv.agent 2>&1 | head -1
```
Expected: a receipt with `"state": "completed"` and steps `stop:completed`, `verify:completed`. No `serve` line. `Could not find service` (some shells print `Bad request.` instead; then `launchctl list | grep io.nerv.agent` prints nothing).

```bash
# 2b. Match dependencies and build to 2a3448d (the checkout was pulled to a later revision and its node_modules holds that revision's lockfile, e.g. Gauntlet 0.7.1 instead of 0.5.0). Only now, with the service stopped.
npm ci --ignore-scripts && npm run build && git status --porcelain && echo matched
```
Expected: `npm ci` and the build finish without errors, no `git status` output, then `matched`. This also makes the `refused` path below start 2a3448d with its own dependencies.

```bash
# 3. Bring the target commit into the checkout. The update is run by the installed 2a3448d code, whose fetch step fetches again (PR #287's local-commit fetch applies only to later updates), so keep the network up.
git fetch -q origin "$T" && git cat-file -t "$T" && git merge-base --is-ancestor HEAD "$T" && echo descends
"$N" --use-system-ca src/cli.ts nodes lifecycle-inspect --action update --revision "$T" --out ~/nerv-t13/update-plan.json
"$N" -p 'const p=require(process.argv[1]);[p.digest,JSON.stringify(p.blockers),p.before.schema,p.nextRevision].join(" ")' ~/nerv-t13/update-plan.json
```
Expected: `commit`, `descends`, then `DIGEST [] 6 <T>`.

```bash
# 4. The update. It takes a few minutes (backup, fetch, rehearsal, checkout, npm ci, build, start) and prints only at the end.
D=$("$N" -p 'require(process.argv[1]).digest' ~/nerv-t13/update-plan.json); echo "$D"
caffeinate -i "$N" --use-system-ca src/cli.ts nodes lifecycle-apply --plan ~/nerv-t13/update-plan.json --confirm "$D" | tee ~/nerv-t13/update-receipt.json
```
Expected: `"state": "completed"` and steps `backup`, `fetch`, `rehearse`, `checkout`, `dependencies`, `build`, `start` and `verify`, each `:completed`. `rehearsal.blockers` is `[]`, `source.schema` and `result.schema` are both 6, and `forwardOnly` is false. From a second Terminal, `"$N" src/cli.ts nodes lifecycle-status --digest "$D"` shows progress without changing anything.

```bash
# 5. After-checks (read-only).
git rev-parse HEAD; git status --porcelain
ps -axo pid=,lstart=,args= | grep -E 'src/cli\.ts (serve|launch)' | grep -v grep
launchctl print gui/$(id -u)/io.nerv.agent | grep -E '^\s*(state|pid|program) ='
"$N" -e 'const fs=require("fs"),h=require("os").homedir(),c=JSON.parse(fs.readFileSync(h+"/.nerv/config.json"));fetch("http://127.0.0.1:"+(c.port??4317)+"/api/doctor",{headers:{authorization:"Bearer "+fs.readFileSync(h+"/.nerv/token","utf8").trim()}}).then(r=>r.json()).then(b=>console.log(b.build?.commit,b.base?.id))'
sqlite3 -readonly ~/.nerv/nerv.sqlite 'PRAGMA quick_check; PRAGMA user_version;'
```
Expected: `HEAD` is `<T>` with a clean tree. One `serve` line started just now. `state = running`, with the plist's Node as `program`. The doctor prints `<T> NERV-01`. Then `ok` and `6`. Paste all of it back; the agent records it in T13.

**If the receipt says `refused`:** nothing changed (dependencies and build already match 2a3448d after step 2b). Paste the `rehearsal.blockers`. To bring 2a3448d back up, make a `start` plan and apply it (`lifecycle-inspect --action start`, then `lifecycle-apply`).

**If the command fails or the receipt says `uncertain`:** do not retry. Paste the output and `lifecycle-status --digest "$D"`, then follow the order in the [upgrade decision](../decisions/node-upgrades.md):
1. Stop a running candidate with `launchctl bootout gui/$(id -u)/io.nerv.agent` and check that no `serve` line remains. The installed code does not check this for you.
2. If `dependencies` failed, run `npm ci --ignore-scripts` in the checkout as it is.
3. Release the operation with `nodes lifecycle-release --receipt FILE --evidence FILE`. The evidence is the receipt's `digest`, `resource`, `fence` and `nonce`, plus `"handlerStopped": true`, `"descendantsStopped": true`, `"operatorConfirmed": true` and a one-line `reason`.
4. Run `git checkout --detach 2a3448d6dca6471323758f721f57ea58a41dd452 && npm ci --ignore-scripts && npm run build`.
5. Apply a fresh `start` plan.

The agent can prepare the evidence file from the pasted receipt.

**Procedure revised 2026-11-12 after the fresh-context review of #287's fixes (design-reviewer, no blocker):** step 1 now confirms the running build with the doctor and checks out only on a clean tree; step 2b reinstalls dependencies and rebuilds at 2a3448d once the service is stopped; step 3 says why the network must stay up. Recorded follow-up, not done: a CLI-level test that `nodes lifecycle-release` refuses while the service is registered or running (the #287 test calls `releaseObservedService` directly).
