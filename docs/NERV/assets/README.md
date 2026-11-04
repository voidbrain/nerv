# Dashboard image slots

`../nerv-agency-dashboard.html` loads these files when they exist. Until then it draws an original pixel placeholder (abstract pattern plus initial or unit number). Images show only in the EVA Basic and EVA Full themes and are drawn with `image-rendering: pixelated`, so small pixel art stays crisp.

Use only images you have the rights to use (your own drawings, commissioned or licensed art). Official Evangelion artwork is copyrighted; do not commit it to this repository.

## Avatars — `avatars/`, square PNG, 16×16 or 32×32

| File | Who | Appears in |
|---|---|---|
| `misato.png` | Misato, operations agent (planner) | plan node, chat replies, debriefs |
| `ritsuko.png` | Ritsuko, operates MAGI and signs A.T. Fields | Entry Plug node |
| `maya.png` | Maya, monitoring and trace | trace lines in comms |
| `aoba.png` | Aoba, comms (Telegram, CLI, apps) | detection node, Aoba detections |
| `hyuga.png` | Hyuga, watch (reminders, cron, triggers) | detection node, Hyuga triggers |
| `gendo.png` | Gendo, router | Gendo node, routing and Spear lines |
| `naoko.png` | Naoko, intake desk | Naoko node, provenance and taint lines |
| `kaji.png` | Kaji, watermelons (pilot trust) | promotion and demotion lines |
| `penpen.png` | Pen Pen, notifier | Misato's apartment node, approval cards |
| `magi.png` | MAGI system mark | MAGI title, ballot lines |
| `you.png` | You, the owner | chat input, your messages, apartment node |

## EVA units — `eva/`, PNG 24×16 (or 48×32), transparent background

| File | Unit | Role |
|---|---|---|
| `eva-00.png` | EVA-00 Prototype | shadow / dry run |
| `eva-01.png` | EVA-01 Test Type | bounded writes |
| `eva-02.png` | EVA-02 Production Model | full grant |
| `eva-03.png` | EVA-03 | quarantine for tainted content |
