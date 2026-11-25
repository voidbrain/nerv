# B-123: Update now shows the updater's status

Owner steps for [B-123](https://github.com/voidbrain/nerv/blob/backlog-views/docs/BACKLOG.md#b-123) (step B-123-T02). Run every command in a Terminal on the owner's Mac (NERV-01); the dashboard steps are in the browser on the same Mac. The check needs an update to install, so run it when the dashboard's Health card shows **Update now**.

## 1. The installed service has the fix and is the one serving

```bash
git -C ~/.nerv-app merge-base --is-ancestor b125a8bb HEAD && echo included
launchctl print gui/$(id -u)/io.nerv.agent | grep -E '^\s*state ='
```

Expected: `included`, then `state = running`. Without `included`, run `nerv update` once (it installs the fix) and start again at step 1. If the service is not running, follow the [B-122 page](b122-update-from-foreground-2026-11-24.md) first.

## 2. Press Update now

```bash
nerv open
```

In the dashboard, Health card, row **Update availability**: press **Update now**.

Expected: under that row, "Update in progress · <step>" (fetch, plan, stop or install) with the local time; the button reads Updating…. The page may stop answering for a moment while NERV restarts.

## 3. The outcome stays after a reload

When the dashboard answers again, reload it (Cmd-R).

Expected: "Update completed · now on <revision>" with a **Dismiss** button, still there after the reload. If the updater refused or failed instead, the row reads "Update refused" or "Update failed" with its reasons and what to do: note them in the record; that is a result too.

## 4. The file agrees

```bash
grep -E '"(state|revision)"' ~/.nerv/updater-status.json
nerv inbox | head -n 5
```

Expected: `"state": "completed"` (or the state the row showed) and the revision from step 3; the inbox lists the updater's result once.

## 5. Dismiss

Press **Dismiss**, then reload.

Expected: the status line is gone and stays gone after the reload.

Tell the agent the outcome of each step (or paste the output of step 4); it records the evidence in B-123 and closes it.
