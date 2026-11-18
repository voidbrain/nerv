# F-083-T04: a real saved recipe, owner procedure

Checks that NERV saves a recipe verbatim, shows it back unchanged and works out a scaled quantity only from the saved values. Use one of your own recipes; it stays local. About 5 minutes; Telegram works the same as the commands below.

```bash
# 1. Save it (an approval card asks first: approve it).
nerv chat "Salva questa ricetta nella categoria ricette: Pancake. 200 g farina, 300 ml latte, 2 uova, 10 g zucchero."
nerv approvals
```
Expected: one pending card for `docs.save`. Approve it (`nerv approve <ID>` or ✅ in Telegram).

```bash
# 2. Recall it, then ask for a scaled quantity.
nerv chat "Mostrami la ricetta Pancake"
nerv chat "Quanto latte serve nella ricetta Pancake per 100 g di farina?"
```
Expected: the first reply quotes the recipe exactly as saved; the second says 150 ml and shows the working from the saved values (300 ml × 100 / 200). An invented ingredient or a number not derived from the saved text is a failure.

Paste the replies of step 2 back; the agent records them and closes F-083-T04. To remove the test recipe: `nerv chat "Dimentica la ricetta Pancake"`.
