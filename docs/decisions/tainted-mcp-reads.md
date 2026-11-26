# Granted MCP reads after a tool result

**Status: decided 26 November 2026 (B-175-T02): the owner, in chat, "B-175 ok": the recommendation below, option 2 now, then option 4.** Security-relevant: it changes what runs after untrusted text has entered a conversation (F-027 quarantine, [EVA runner](eva-runner.md)).

## Problem, in plain words

When a tool result (for example an MCP answer from Grover) enters a conversation, NERV marks the conversation *tainted*: text in that result could try to steer Misato. Every later read or local write in a tainted conversation is sent to EVA-03, the isolated class. EVA-03 isolation exists only for code jobs; for MCP tools it does not exist, so the call is refused: `balthasar: EVA-03 outside code requires isolation; it does not run.` (`src/policy.ts`, `executorOf` and `isolationDenied`; the same rule in `src/eva-classes.ts`, `minimumClassForJob`).

So after the first MCP answer, every next MCP read is refused, even reads the owner granted as Pattern Green, EVA-00: the second call of the same sortie, and every call in the next sorties of that conversation. Misato then says only that there was "a technical error (EVA-03 isolation)".

How long the taint lasts today: Misato's context takes the last 3 exchanges of the same conversation within 30 minutes (`Ledger.conversation`, defaults `withinMs = 30 min`, `limit = 3`). A sortie that takes a tainted exchange becomes tainted itself, so the taint passes on from question to question: in practice it ends only after 30 minutes without a question in that conversation. The dashboard chat always posts conversation `dashboard` (`web/public/dashboard/live.js`, the `api("chat", …)` call) and has no "new conversation" control, so the owner has no way out there; only `nerv chat` (conversation `cli`) or Telegram start clean.

## Options

1. **Allow granted read-only MCP tools at EVA-00 even when the conversation is tainted.** A read does not act on anything. Leftover risk: text planted in an earlier result could make Misato put data into a read call's arguments and so send it to that MCP server; this is limited to the owner's own servers and tools the owner already granted. Changes the F-027 rule "tainted local outside code fails closed" (`test/provenance.test.ts`), a deliberate requirement change.
2. **Keep refusing, but say so clearly.** The refusal tells the owner in plain words why and what to do (start a new conversation, or wait 30 minutes), Misato stops at the first such refusal instead of retrying, and the dashboard gets a "new conversation" control. Safe and small; the owner still cannot use a second MCP read in one conversation.
3. **Build EVA-03 isolation for MCP reads.** Run such calls in an isolated helper that cannot reach other tools or the owner's data. Keeps the strict rule and makes the read work; larger work (a new runner class for MCP, F-049 scope).
4. **Per-grant opt-in "allow in a tainted conversation".** The owner ticks it on a read grant (for example Grover strains and plants); only those tools run at EVA-00 when tainted, everything else is refused as today, with option 2's message. The owner decides tool by tool.
5. **Taint that expires or does not carry forward from the owner's own granted reads** (raised with the dashboard finding). Results of read-only tools the owner granted would not taint the next question, or the taint would expire sooner than 30 minutes. Weakens the same F-027 protection as option 1, for the following questions rather than the current one.

## Recommendation

Option 2 now (small, safe, fixes "refused without telling me" and gives the dashboard a way out), then option 4 as the policy: default stays fail-closed, and the owner opts in only for read tools on servers they run. Option 3 only if a tool that reads third-party content (mail, web) needs to work in tainted conversations. Options 1 and 5 are simplest but turn the protection off for every granted read at once.

## Decision

Accepted as recommended. Stage 1 (option 2, B-175-T03): the refusal says to start a new conversation, Misato stops at the first isolation refusal and the service replies in the owner's language, and the dashboard chat has a **New conversation** button. Stage 2 (option 4, B-175-T05 to T07): a per-grant opt-in for read-only tools; without it the stage 1 refusal stays.

## Owner check

Stage 1, after NERV-01 runs the release that has it (B-175-T04). In the dashboard chat (a new browser tab starts in the usual `dashboard` conversation):

1. Send: `quali genetiche ho?` — expected: Misato answers from Grover (the first Grover read runs). If she calls a second Grover tool in the same answer, that one is refused: the reply still gives what the first one returned, then says which tool could not be used and to ask for it on its own in a new conversation.
2. Within 30 minutes, send: `e quali piante sto coltivando?` — expected: a reply that starts `Non ho usato grover.` and says to press «New conversation» or to wait 30 minutes; Misato does not try the call again (the sortie shows one refused step, not five).
3. Press **New conversation** next to Send — expected: the trace shows `New conversation: Misato no longer sees the earlier messages.`
4. Send again: `e quali piante sto coltivando?` — expected: the Grover read runs and Misato answers.
