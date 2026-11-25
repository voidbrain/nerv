# Desktop replay owner check

Run on the Mac with Accessibility permission already granted by the owner. Use a harmless test window and type no secrets.

1. Start a short recording, move and click inside the test window, then stop. Expected: recording is bounded and stays local.
2. Request replay. Expected: a Blue approval card names the display and frontmost-window preconditions; nothing replays before approval.
3. Approve without changing the window. Expected: the sequence runs once and NERV reports what ran and its readback.
4. Repeat, but change the front window or display geometry before approval. Expected: replay refuses before input is emitted.
5. Repeat and provide owner input during replay. Expected: replay stops immediately and reports the interruption.

Record only dated outcomes in F-092; do not commit the recording or private window details.
