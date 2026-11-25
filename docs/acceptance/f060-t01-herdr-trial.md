# F-060-T01: herdr-core trial, owner procedure

Owner procedure for [F-060-T01](../BACKLOG.md#f-060-t01): use [herdr-core](https://github.com/herdrdev/herdr-core) (`hc`) as your coding workspace for a few working days, then answer the five questions of [F-060](../BACKLOG.md#f-060). Commands are from the herdr-core README (read 2026-11-18). Work in a NERV worktree, never in `~/Projects/NERV/NERV` (the live service runs from it).

## 1. Install (read the script first)

```bash
curl -fsSL https://releases.herdr.dev/core/install.sh -o ~/hc-install.sh && less ~/hc-install.sh
sh ~/hc-install.sh && hc --version
```
Expected: the script only downloads and places the `hc` binary; then a version line. Anything else in the script (sudo, shell profile edits you did not expect): stop and paste it.

## 2. Three terminals, each in its own worktree

```bash
cd ~/Projects/NERV/NERV && git fetch -q
for w in impl review test; do git worktree add -q ../NERV.worktrees/hc-$w origin/main --detach; done
cd ../NERV.worktrees/hc-impl   && hc run --bg --keep --name impl claude
cd ../hc-review                && hc run --bg --keep --name review codex
cd ../hc-test                  && hc run --bg --keep --name test zsh
hc ls
```
Expected: `hc ls` lists `impl`, `review` and `test`. Note whether a status column shows anything for Claude Code and Codex (question 2).

## 3. Daily use (over the trial days)

- Attach: `hc attach impl`; detach with **Ctrl+\\**. Read without attaching: `hc read review --lines 100`.
- Delegate: `hc send review "Review the diff in ../hc-impl and list blocking issues."`, then `hc read review --lines 100`.
- Watch: `hc events` in a spare terminal.

## 4. Recovery checks (once, near the end)

```bash
hc ls > ~/hc-before.txt
# Quit the viewer, then restart the Mac. After login:
hc ls; diff ~/hc-before.txt <(hc ls) && echo same
hc read impl --lines 20
```
Expected per the README: `--keep` terminals come back as fresh shells and the task is not rerun. Note what you see (question 3).

## 5. Reply to the agent

Paste five short answers: (1) switching, reviewing and recovering sessions easier than today, yes/no and why; (2) status shown for Claude Code / Codex, yes/no; (3) what came back after the restart; (4) anything surprising about the API or security; (5) any record (F-012, F-019, F-045, F-048, F-049) where it helps. Then clean up:

```bash
cd ~/Projects/NERV/NERV && for w in impl review test; do git worktree remove ../NERV.worktrees/hc-$w; done
```
The agent records the outcome in F-060-T02 and F-060-T03.
