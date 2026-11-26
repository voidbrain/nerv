# F-120: the model-pack cases the new system runners made pending

Owner decision for [F-120](https://github.com/voidbrain/nerv/blob/backlog-views/docs/BACKLOG.md#f-120) (step F-120-T15). Nothing runs before your answer.

## What happened

F-120-T02 ([#843](https://github.com/voidbrain/nerv/pull/843)) added seven NERV system cases, each with its own entry in `evals/gauntlet/runners.json`. The run identity of every model case (`releaseSourceKey` in `tools/gauntlet.mjs`) includes a hash of that whole file, so 12 model cases recorded before now count as changed although nothing they run changed: `cad-3d` (4), `coding` (4) and `embedded` (4).

To see them (it calls no model):

```bash
cd ~/Projects/NERV/NERV && node tools/gauntlet.mjs pending | grep -E '^(cad-3d|coding|embedded)/'
```

Expected: 12 lines, each ending in `(source-changed)`.

## The question

Pick one:

- **(a) Rerun them now.** The agent runs the 12 cases once on `gemma4:12b` on the Mac (NERV-01), in a development worktree, never `~/.nerv-app`, and not while you use the local model. The coding cases take up to 180 s each.
- **(b) Fix the key first.** A new step makes the run identity hash only the runners the model packs use, so a new system case no longer marks model cases as changed. The key changes once, so the same 12 cases still need one rerun after it.
- **(c) Not now**, with a reason.

## Answer

Paste one of these in chat:

- `F-120-T15 a: rerun ok`
- `F-120-T15 b: fix the key first`
- `F-120-T15 not now: <reason>`

The agent records your answer with its date in F-120 and opens the step that follows from it.
