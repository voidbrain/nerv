# F-120: first run of the nerv-planner pack

Owner decision for [F-120](https://github.com/voidbrain/nerv/blob/backlog-views/docs/BACKLOG.md#f-120) (step F-120-T13). The agent runs it afterwards (F-120-T14); nothing runs before your answer.

## What it is

`nerv-planner` is NERV's own Gauntlet pack (`evals/gauntlet/nerv-planner-v1.json`): 36 cases, 18 requests each in Italian and in English ("ricordami di bere acqua tra 5 minuti", "accendi la luce della tenda", "quante batterie devo caricare?", "aggiungi Rocca Calascio al trip di agosto"…). Each case sends the model the prompt Misato gets for that request over NERV's real tool list and checks its decision: the tool and its required arguments, a question back, or a reply without an action. Nothing is executed; the data is invented.

## The question

May the agent run the 36 cases once on `gemma4:12b` on the Mac (NERV-01)? One model call a case, at most 30 s each and about 18 minutes in all, at most 73,728 output tokens; in a development worktree, never `~/.nerv-app`, and not while you use the local model.

To see the plan first (it calls no model):

```bash
cd ~/Projects/NERV/NERV && node tools/gauntlet.mjs model-plan --pack=nerv-planner --profile=node_modules/@voidbrain/gauntlet-protocol/examples/profiles/gemma4-12b.json
```

Expected: JSON for pack `nerv-planner` with 36 cases, limits `"caseMs": 30000`, `"suiteMs": 1080000` and `"outputTokens": 73728`, and `"modelCallsAuthorized": false` (each case says it needs the explicit opt-in your answer gives).

## Answer

Paste one of these in chat:

- `nerv-planner first run ok`
- `nerv-planner not now: <reason>`

The agent records your answer with its date in F-120, then runs the pack and records the result in `evals/gauntlet/ledger.json`.
