# Update NERV-01 when it runs as a foreground `nerv launch`, 24 November 2026

Owner steps for [B-122](../BACKLOG.md#b-122). Run every command in a Terminal on the owner's Mac (NERV-01). They work on the state seen on 2026-11-24, before the B-122 fix is installed, and after it.

**What was seen:** the dashboard's Update now was refused twice with "Service or runtime ownership is unknown or belongs elsewhere." The launchd service `io.nerv.agent` was not registered (stopped with `nerv service stop`); port 4317 was served by a foreground `nerv launch` started from a VS Code terminal, through the global `nerv` link into the development checkout. The updater never stops a process the service manager did not start, so it refused, correctly, but without saying why. The service definition written by `nerv service move` was still the expected one (`~/.nerv-app`), and an update after the move had completed on 2026-11-23.

## 1. Stop the foreground NERV

In the terminal where `nerv launch` runs, press Ctrl-C. Then check that nothing listens on 4317:

```bash
lsof -nP -iTCP:4317 -sTCP:LISTEN
```

Expected: no output.

## 2. Start the installed service

```bash
nerv service start
launchctl print gui/$(id -u)/io.nerv.agent | grep -E '^\s*(state|pid|working directory) ='
```

Expected: `nerv service start` prints nothing; then `state = running`, a `pid = …` line and `working directory = /Users/<you>/.nerv-app`.

## 3. Update

Either press **Update now** in the dashboard (open it signed in with `nerv open`), or from the terminal:

```bash
nerv update
```

Expected from `nerv update`: `Install folder: /Users/<you>/.nerv-app`, `… is behind origin/main by N commits`, then `Outcome: completed. NERV was stopped, updated, started and verified at <sha> from /Users/<you>/.nerv-app.` After Update now, the dashboard shows Updating… and comes back; the result is in the inbox.

## 4. Check

```bash
git -C ~/.nerv-app rev-parse --short HEAD
tail -n 30 ~/.nerv/updater.log | grep '"outcome"'
```

Expected: the new revision (the current `origin/main`), and `"outcome": "completed"` as the last outcome when Update now was used.

## From now on

With the service installed, open the dashboard with `nerv open`, not `nerv launch`: `launch` runs a second, foreground NERV from whichever checkout the `nerv` command points to, and an update refuses while it serves the base.

## After the B-122 fix is installed

Repeat the B-122 situation once to see the new reason: `nerv service stop`, then `nerv launch` in a terminal, then press Update now. Expected in the inbox and in `~/.nerv/updater.log`: a refusal that says NERV is running in the foreground (`nerv launch` or `nerv serve`, with its pid) and to stop it and run `nerv update`, not "ownership is unknown". Then do steps 1 to 4.
