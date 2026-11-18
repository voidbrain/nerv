# F-005-T15: forward-migrating update, owner trial

Owner procedure for [F-005-T15](../BACKLOG.md#f-005-t15): one lifecycle update of the Mac service to a revision whose reader raises the database schema, as the [upgrade decision](../decisions/node-upgrades.md#admission-beyond-documentation) describes. Use a local Terminal on the Mac (not SSH), on power. Paste each block, compare with the expected result, and stop at the first difference: paste the output back to the agent. Do not retry.

## 0. Is there a candidate to try?

The trial needs a revision on `main` whose `readerSchema` is above the live schema. Until one exists there is nothing to run.

```bash
cd ~/Projects/NERV/NERV && git fetch -q origin main
git show origin/main:src/upgrade-contract.ts | grep -o 'readerSchema: [0-9]*'
node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.env.HOME+"/.nerv/nerv.sqlite",{readOnly:true});console.log(d.prepare("PRAGMA user_version").get().user_version)'
```
Expected: `readerSchema: N` and the live schema `M` (a number). The schema is read with Node, read-only: a `sqlite3` other than `/usr/bin/sqlite3` on the PATH failed to open the file on 2026-11-18.
- `N` equal to `M` (on 2026-11-18 both are 6): **stop here** and reply `F-005-T15: no schema-raising candidate yet`. The step stays open until a reviewed migration reaches `main`.
- `N` greater than `M`: go on.

## 1. Variables and the running build

```bash
N=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' ~/Library/LaunchAgents/io.nerv.agent.plist); echo "$N"
T=$(git rev-parse origin/main); echo "$T"
mkdir -m 700 -p ~/nerv-t15 && ls ~/nerv-t15
git rev-parse HEAD; git status --porcelain
git merge-base --is-ancestor HEAD "$T" && echo descends
```
Expected: the nvm Node path, a 40-character commit, an empty `~/nerv-t15`, the installed revision with no `git status` output, then `descends`.

## 2. Update plan

```bash
"$N" --use-system-ca src/cli.ts nodes lifecycle-inspect --action update --revision "$T" --out ~/nerv-t15/update-plan.json
"$N" -p 'const p=require(process.argv[1]);[p.digest,JSON.stringify(p.blockers),p.before.schema,p.nextRevision].join(" ")' ~/nerv-t15/update-plan.json
```
Expected: `{"saved": …, "execution": "none"}`, then `DIGEST [] M <T>`. Non-empty blockers: stop and paste them.

## 3. The update (a few minutes; prints only at the end)

```bash
D=$("$N" -p 'require(process.argv[1]).digest' ~/nerv-t15/update-plan.json); echo "$D"
caffeinate -i "$N" --use-system-ca src/cli.ts nodes lifecycle-apply --plan ~/nerv-t15/update-plan.json --confirm "$D" | tee ~/nerv-t15/update-receipt.json
```
Expected: `"state": "completed"`; steps `backup`, `fetch`, `rehearse`, `checkout`, `dependencies`, `build`, `start`, `verify`, each `:completed`; `rehearsal.blockers` is `[]`; `forwardOnly` is `true`; `source.schema` is `M` and `result.schema` is `N`.

## 4. After-checks (read-only)

```bash
git rev-parse HEAD; git status --porcelain
launchctl print gui/$(id -u)/io.nerv.agent | grep -E '^\s*(state|pid) ='
sqlite3 -readonly ~/.nerv/nerv.sqlite 'PRAGMA quick_check; PRAGMA user_version;'
```
Expected: `HEAD` is `<T>` with a clean tree, `state = running`, then `ok` and `N`. Paste everything back; the agent records it and verifies the step.

**If the receipt says `refused`:** nothing changed. Paste `rehearsal.blockers`.

**If it fails or says `uncertain`:** do not retry and never start the previous revision. Paste the output and `"$N" src/cli.ts nodes lifecycle-status --digest "$D"`. The agent prepares the evidence file for the owner-invoked recovery (`nodes lifecycle-recover --receipt FILE --evidence FILE --confirm-backup-restore DIGEST`) in the order the [upgrade decision](../decisions/node-upgrades.md) gives for forward-migrating updates.
