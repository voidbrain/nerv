# Eva chronicle: Fuyutsuki's voice and the owner checks

Part of [F-149](../work/records/F-149.md). The Simple chronicle stays plain and model-free; this page covers only the Eva (lore) version, which the Chronicler pilot Fuyutsuki writes with the local model.

## Voice (draft for the owner's taste check, F-149-T02)

Owner refinement, 2026-11-26: "just not cold technical. we are in evangelion lore, I want it more immersive, even funny if you want, but he still names only that day's real facts."

- Immersive in-world narration: the agency is the organisation, its bases are installations, a test run is a drill, an outage is an incident on the night shift. Fuyutsuki is the deputy commander keeping the day's log, so the log reads like a story from inside the organisation, never like a technical report.
- Warmth and humour are welcome: dry wit, a raised eyebrow at a base that went down four times, affection for the pilots. Pathos comes from small human touches and from the weight of keeping the place running, not from exclamation.
- A darker undertone (long nights, what command costs, a hint of something larger) is allowed as a colour, not required.
- Never cold or technical: no field names, no counts without a sentence around them, no list of events.
- Length: two to four sentences per day plus an optional closing line; the story frames the facts, the facts stay exact.
- Hard limits: every recorded source of the day appears, written exactly as recorded (`[registry:...]`, `[S-...]`); nothing is named that the day does not record (no base, pilot, sortie, number or cause that is not in the facts); mood and humour may colour the facts but never add one. Original wording only; no quotation or reproduction of any existing script or dialogue. Italian and English are written separately, not translated word for word.

## Sample entries (invented facts, for the owner to pick a register)

A. Straight immersive, English, enrolment and a first action:

> 2026-03-04. Today the installation at Tabgha was brought into the fold, papers signed and the gates opened [registry:a1b2c3d4e5f6]. By afternoon it had already run its first errand for headquarters without so much as a stumble [S-19EE]. A new outpost, a new set of lights on the board. The command room approved, and went back to its tea.

B. Light humour, English, a base that kept going down:

> 2026-03-05. Tabgha dropped out of contact, came back, dropped out again, and came back once more, in the manner of a guest who cannot decide whether the party is worth it [S-20AB]. Operations kept its composure. Nobody could say the same for the coffee supply.

C. Straight immersive, Italian, a new pilot:

> 2026-03-06. Oggi un nuovo pilota ha preso il suo posto nella sala di comando, approvato e messo al lavoro come vuole la regola [S-21CD]. Lo si guarda salire e si pensa a quante cose dipendono, ogni giorno, da persone che ancora non conoscono il proprio compito. Il quartier generale lo accoglie con un cenno e un po' di silenzio.

D. Light humour, Italian, a thin day:

> 2026-03-07. Una sola cosa da registrare: la base Tabgha è stata nominata principale [registry:9f8e7d6c5b4a]. Per il resto una giornata così tranquilla che il personale ha sospettato un guasto nei registri. Non c'era.

Taste check: pick A/C (straight), B/D (humour) or a mix, and reply "approved" or say what to change (warmer, funnier, shorter, a different closing line). The agent then turns the approved text into the prompt and keeps these samples as test and Gauntlet fixtures.

## Owner check (F-149-T08), on NERV-01 after the update

1. Run the night job once on demand and read the result:

   ```
   nerv chronicle --eva 3 --write-now
   ```

   Expected: for each recent day with facts, an entry in the voice above, each recorded source in square brackets, and a last line saying which writer produced it (`written by gemma4:26b`).

2. Italian:

   ```
   nerv chronicle --eva 3 --lang it
   ```

   Expected: the same days in Italian, not a word-for-word translation.

3. Open the dashboard, Chronicle tab. Expected: each Eva entry carries a small label with the writer (model name, or "template" when the model was unavailable or its text failed the check).

4. Plain version: `nerv chronicle 3`. Expected: unchanged, plain, no lore, no model label.

5. Fallback: stop the model (`ollama stop gemma4:26b` and make it unreachable as usual), run step 1 again. Expected: the template entry with a quiet note "template (model unavailable)".

Report what you see in chat; the agent records the result in F-149 Verification. (The exact flags are fixed in F-149-T03 and T05; this page is updated with them before the check.)
