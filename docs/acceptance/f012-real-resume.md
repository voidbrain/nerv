# Real web-chat resume check

Run this on the worker that owns the authenticated web-chat tab. Use a disposable, non-sensitive prompt and do not approve unrelated provider or security prompts.

1. Start a job, let it reach a provider-limit pause, and record the visible job identity and reported reset time privately.
2. Ask NERV to resume only that named job after the reset. Expected: it waits for the deadline, rechecks the same tab/job and clicks resume once.
3. Before a second run, close or log out of the tab. Expected: NERV reports unavailable/expired and does not click another page.
4. Repeat with the worker asleep across the deadline, then wake it. Expected: it rechecks current identity before one bounded attempt; it never duplicates a confirmed resume.
5. Change the target content or leave the job already running. Expected: NERV refuses the stale target or reports that no resume is needed.

Record only the dated outcomes in F-012; keep account, tab, prompt and provider details private.
