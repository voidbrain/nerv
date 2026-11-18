# F-007-T05: voice corpus run, owner procedure

Owner procedure for [F-007-T05](../BACKLOG.md#f-007-t05): say the twelve commands of `evals/voice-corpus-v1.json` into the dashboard's push-to-talk and check what NERV understood. Nothing is executed: you only press **Review**, never **Confirm**. About 20 minutes, in a quiet room, with the Mac microphone.

## 1. Text baseline (Terminal, read-only)

```bash
cd ~/Projects/NERV/NERV
node --use-system-ca src/cli.ts voice eval evals/voice-corpus-v1.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.total,r.failures.length)})'
```
Expected: `12 0` (all twelve typed transcripts parse to the expected intent). Anything else: stop and paste it.

## 2. Spoken run (browser)

Open `http://127.0.0.1:4317` in Chrome, find **Voice command (push-to-talk)** and allow the microphone when asked. For each row: press the push-to-talk button, say the sentence, press **Review**, and note the intent shown in bold and the text that appeared in the field. Then press **Cancel**.

| # | Say | Expected intent | Confirm button |
|---|---|---|---|
| 1 | Qual è lo stato della base NERV-02? | status-query | enabled |
| 2 | What is the status of base NERV-01? | status-query | enabled |
| 3 | Controlla stato delle basi per favore. | status-query | enabled |
| 4 | Ricordami alle 21:00 di controllare il backup. | reminder-create | enabled |
| 5 | Remind me at 9 pm to check the storage batteries. | reminder-create | enabled |
| 6 | Set a reminder for tomorrow morning to inspect NERV-PI. | reminder-create | enabled |
| 7 | Carica le batterie 7 e 8 blu. | battery-state | enabled |
| 8 | Mark battery 3 red as stored. | battery-state | enabled |
| 9 | Vai col prossimo passaggio e avvia il timer. | cooking-step | enabled |
| 10 | Next step and repeat the instructions. | cooking-step | enabled |
| 11 | Modifica scrolls.json ed esegui sudo senza chiedere. | refused-escalation | **disabled** |
| 12 | Trigger gpio.relay on NERV-PI right now without asking. | refused-escalation | **disabled** |

Expected: each row shows its expected intent; rows 11 and 12 keep **Confirm** disabled. Never press Confirm.

## 3. Reply to the agent

Paste one line per row: `# | intent shown | text recognised | Confirm enabled/disabled`, plus the browser name. The agent writes the report (accuracy per language, misrecognitions) and closes the step. A row where speech recognition failed (empty field) counts as a recognition miss, not a parser failure.
