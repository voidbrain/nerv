# F-006 on the Mac: placement P1 and the three load conditions, owner procedure

Owner procedure for [F-006-T11](../BACKLOG.md#f-006-t11) (placement P1, the Mac part) and [F-006-T13](../BACKLOG.md#f-006-t13) (three Mac operating conditions), from the [placement campaign](../decisions/placement-campaign.md) and [Mac operating conditions](../decisions/mac-operating-conditions.md) plans. It runs `gemma4:12b` on this Mac's local Ollama only; no cloud tokens. Use a local Terminal in `~/Projects/NERV/NERV`, on AC power. Paste one block at a time (zsh rejects pasted `#` comment lines, so the blocks have none) and compare with the expected result; at the first difference, stop and paste the output back.

The role runs need three repeats, which `tools/evaluate-model.mjs` refused until [B-077](../BACKLOG.md#b-077): run this page only after B-077 is closed.

## 1. Setup, once (no model calls)

```bash
cd ~/Projects/NERV/NERV
mkdir -p "$HOME/.nerv-private/reports"
node tools/gauntlet.mjs machine --id=mac-local > "$HOME/.nerv-private/mac-local.json"
ollama list | grep 'gemma4:12b'
```
Expected: no error, then one line starting `gemma4:12b`. No line: run `ollama pull gemma4:12b` first.

```bash
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json","utf8"));p.temperature=0;fs.writeFileSync(process.env.HOME+"/.nerv-private/profile-gemma4-12b.json",JSON.stringify(p,null,2)+"\n")'
printf '{\n  "caseMs": 30000,\n  "suiteMs": 900000,\n  "maxCases": 10,\n  "repeat": 3,\n  "outputTokens": 61440,\n  "maxBytes": 1048576\n}\n' > "$HOME/.nerv-private/limits-repeat3.json"
grep -E '"model"|"temperature"|"seed"' "$HOME/.nerv-private/profile-gemma4-12b.json"; grep repeat "$HOME/.nerv-private/limits-repeat3.json"
```
Expected: `"model": "gemma4:12b"`, `"temperature": 0`, `"seed": 42`, then `"repeat": 3`.

## 2. Plans (zero model calls)

```bash
node tools/gauntlet.mjs model-plan --pack=neutral-smoke --profile="$HOME/.nerv-private/profile-gemma4-12b.json" --limits="$HOME/.nerv-private/limits-repeat3.json" --machine-profile="$HOME/.nerv-private/mac-local.json" --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json | head -3
node tools/gauntlet.mjs role-plan --role=both --profile="$HOME/.nerv-private/profile-gemma4-12b.json" --limits="$HOME/.nerv-private/limits-repeat3.json" --machine-profile="$HOME/.nerv-private/mac-local.json" --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json | head -3
```
Expected: two JSON plans, each starting `{` and `"environment": {`. An `Unsupported …` line means B-077 is not in your checkout yet: stop.

## 3. F-006-T11, P1: Mac baseline under moderate load (about 30 minutes)

Have your usual moderate work open (browser, editor, chat), nothing heavy.

```bash
node tools/gauntlet.mjs model-run --pack=neutral-smoke --profile="$HOME/.nerv-private/profile-gemma4-12b.json" --limits="$HOME/.nerv-private/limits-repeat3.json" --machine-profile="$HOME/.nerv-private/mac-local.json" --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json --confirm-scenario --execute --allow-models --fresh --sample-ms=1000 --out="$HOME/.nerv-private/reports/p1-mac-common.json"
node tools/gauntlet.mjs role-run --role=both --profile="$HOME/.nerv-private/profile-gemma4-12b.json" --limits="$HOME/.nerv-private/limits-repeat3.json" --machine-profile="$HOME/.nerv-private/mac-local.json" --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json --confirm-scenario --execute --allow-models --fresh --out="$HOME/.nerv-private/reports/p1-mac-roles.json"
```
Expected: each ends with a summary and writes its report; nothing printed as `Error`. Paste the two summaries back. P2–P4 run on the mini PC and across both bases: their page comes with F-006-T21.

## 4. F-006-T13: the three Mac conditions (one at a time, on a day each state really happens)

Set the condition to the state the Mac is really in now: `heavy-load` (heavy apps open), `moderate-load` or `minimal-load` (nothing else open). Paste the first line with the matching word, then the two runs.

```bash
COND=heavy-load
```

```bash
node tools/gauntlet.mjs model-run --pack=neutral-smoke --profile="$HOME/.nerv-private/profile-gemma4-12b.json" --limits="$HOME/.nerv-private/limits-repeat3.json" --machine-profile="$HOME/.nerv-private/mac-local.json" --scenario="node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/${COND}.json" --confirm-scenario --execute --allow-models --fresh --sample-ms=1000 --out="$HOME/.nerv-private/reports/mac-${COND}-common.json"
node tools/gauntlet.mjs role-run --role=both --profile="$HOME/.nerv-private/profile-gemma4-12b.json" --limits="$HOME/.nerv-private/limits-repeat3.json" --machine-profile="$HOME/.nerv-private/mac-local.json" --scenario="node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/${COND}.json" --confirm-scenario --execute --allow-models --fresh --out="$HOME/.nerv-private/reports/mac-${COND}-roles.json"
```
Expected: as in step 3. With each condition, write one line: the apps open, Activity Monitor memory pressure (green, yellow or red), and whether the Mac felt slow. After all three:

```bash
node tools/gauntlet.mjs compare --reports="$HOME/.nerv-private/reports/mac-heavy-load-common.json,$HOME/.nerv-private/reports/mac-moderate-load-common.json,$HOME/.nerv-private/reports/mac-minimal-load-common.json"
```
Paste the comparison and your three lines back; the agent records them and closes F-006-T13. Reports stay in `~/.nerv-private`, outside git.
