# Desktop replay owner check

Runs on the owner's Mac (NERV-01) after NERV has updated to a version with F-092-T05 (`nerv doctor` shows a `desktopControl` entry). Use Calculator as the harmless test window, type nothing during the check, and do not commit the recording or window details. NERV records the mouse only (moves and clicks, never keys) and changes no privacy setting itself.

1. See what the service needs, then grant it. In Terminal:

   ```bash
   nerv doctor | grep -A3 '"desktopControl"'
   plutil -extract ProgramArguments.0 raw ~/Library/LaunchAgents/io.nerv.agent.plist
   ```

   Expected: `"available": false` and `"detail": "desktop control not available: grant Accessibility to /…/node in System Settings > Privacy & Security > Accessibility, then try again. …"`; the second command prints the same `/…/node` path (the node the service runs from `~/.nerv-app`). Open System Settings > Privacy & Security > Accessibility, click **+**, press Cmd+Shift+G, paste that exact path, choose **Open**, and turn the new `node` entry on. Then:

   ```bash
   launchctl kickstart -k gui/$(id -u)/io.nerv.agent
   sleep 10; nerv doctor | grep -A3 '"desktopControl"'
   ```

   Expected: `"available": true` and `"detail": "desktop control available: Accessibility is granted to /…/node."`.
2. Prepare the window: `open -a Calculator`, press **AC** so the display shows `0`, and leave the Calculator window where it is for the whole check (the replay checks its position and size).
3. Record. In the dashboard chat, send:

   ```text
   Record my mouse for 8 seconds as calc-seven
   ```

   Expected: a Blue approval card for `desktop.record` with `{"id": "calc-seven", "seconds": 8}`; nothing is recorded before you approve. Approve it, then within 3 seconds click the Calculator title bar. During the 8 seconds: move the pointer around over Calculator, click **7** once, then keep still. The first time, macOS may ask to let `node` control System Events: choose **Allow**. Expected reply: a summary with `"id": "calc-seven"`, an `events` count, `"app": "Calculator"`, `"window": "Calculator"` and the display size; no coordinates. Then in Terminal:

   ```bash
   ls -l ~/.nerv/recordings/calc-seven.json
   grep -c keyCode ~/.nerv/recordings/calc-seven.json
   ```

   Expected: `-rw-------` (local, owner-only) and `0` (no key was recorded).
4. Replay. Press **AC** (display `0`). In the chat, send:

   ```text
   Replay the desktop recording calc-seven
   ```

   Expected: a Blue card for `desktop.replay` naming `"id": "calc-seven"`, `"app": "Calculator"`, `"window": "Calculator"`, the display, the event count, the length in seconds and a `sha256`; the pointer does not move before you approve. Approve, then within 3 seconds click the Calculator title bar and let go of mouse and keyboard. Expected: the pointer retraces the recorded path, Calculator shows `7`, and the reply says `"status": "completed"`, `replayedEvents` equal to `totalEvents`, and an `afterSummary` that includes `7`.
5. Mismatch. Press **AC**, send the same replay message and approve, but leave the browser in front. Expected: no pointer movement and the reply `Replay precondition mismatch: expected frontmost app Calculator (com.apple.calculator), got …`.
6. Interruption. Press **AC**, send the replay message, approve, click the Calculator title bar, and once the pointer starts moving, move the mouse yourself. Expected: the replay stops at once with `"status": "stopped"`, `"stopReason": "owner-input"` and `replayedEvents` lower than `totalEvents`; no mouse button stays pressed.

To undo: `rm ~/.nerv/recordings/calc-seven.json`, and turn the `node` entry off in System Settings > Privacy & Security > Accessibility.

Record pass/fail per step and the date in F-092; keep window contents private.
