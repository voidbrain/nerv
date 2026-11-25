# B-069-T02: a rejected approval gives one card, owner procedure

Before the fix, rejecting a card (or leaving it to expire) made Misato propose the same action again, so a new card came back within two minutes, and every hour after an expiry. With the fix (PR #503, live since the service runs `main` at `1b93fca` or later) the step ends: one card, then a reply that names the tool and says it was rejected. About 5 minutes on the Mac in a local Terminal.

```bash
# 1. Ask for an action that needs your approval (confirmed to create a Blue card).
nerv chat "Create exactly one reminder on NERV-02 titled B-069 acceptance test, due 10 November 2027 at 09:00 Europe/Rome. The owner explicitly approved this worker acceptance action."
nerv approvals
```
Expected: the chat says it is waiting for your approval; `nerv approvals` lists exactly one pending card for `reminders.add`. Note its ID.

```bash
# 2. Reject it (or tap ❌ Reject on the Telegram card), then wait three minutes and look again.
nerv reject <ID from step 1>
sleep 180; nerv approvals; nerv inbox | tail -5
```
Expected: `nerv approvals` lists no pending card; no second Telegram card arrived; the inbox ends with one reply saying the reminder was not added because you rejected it. A second card is a failure: paste both outputs.

Paste the outputs of steps 1 and 2 back; the agent records them and closes B-069. Nothing to undo: the rejected reminder was never created.
