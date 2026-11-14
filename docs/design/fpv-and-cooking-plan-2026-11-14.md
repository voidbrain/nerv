# FPV fleet and cooking: owner requirements and decisions (2026-11-14)

Owner request 2026-11-14, recorded as F-008, F-098–F-101 and new F-083 steps. The earlier standalone app (`~/Projects/one-more-battery`, Angular, local storage) is the starting point for the battery data model; NERV replaces it rather than adapting to it.

## Batteries (F-008)

- **Identity**: a number plus an optional colour series (red, yellow, blue…), so "batteria 7 blu" is one battery; type (today LiPo 6S, LiHV 3S), brand, capacity (mAh), purchase date. Carried over from one-more-battery: brand, series with colour, type, cell count, label, mAh, date; usage records (charged / stored / discharged); per-cell resistance records.
- **Charge state by chat**: "carica le batterie 7 e 8 blu" → charged; "ho usato / scarica" → discharged; "messe a storage" → stored. A cycle is counted on charged → discharged.
- **Resistance checks**: required when a battery is registered (values per cell in order, e.g. `3, 3.4, 4.1` mΩ), then due again by the interval below.
- **Storage reminders**: a battery left charged or discharged gets a reminder in the evening, and another after N days, until it is stored.
- **Health advice**: compare a battery's resistance records per cell; advise when one cell grew too much or reached the retirement value; show cycles.

### Defaults proposed for the owner's decision (F-008-T01)

| Setting | Proposed default | Why |
|---|---|---|
| Resistance check interval | every 90 days, or every 30 cycles, whichever comes first | usage matters more than time for a flown pack |
| First storage reminder | 21:00 the same day | "at evening" |
| Second storage reminder | 5 days later, then every 5 days until stored | owner's "after ... 5 days" |
| Cell growth alert | a cell ≥ 50 % above its first record, or ≥ 30 % above the pack's other cells | catches one weak cell early |
| Retirement value | LiPo 6S: any cell ≥ 12 mΩ; LiHV 3S: any cell ≥ 10 mΩ | placeholders: the owner sets real values per pack type |

## Fleet diary (F-098)

"Ho crashato Smoke, motore sinistro inferiore rotto. Quale avevo rotto l'ultima volta? Quanti ne sono rimasti di scorta (nuovi/usati)? La batteria 7 blu presenta danni ma sembra ancora buona." Drones by name, parts by position, spares new/used, a crash log, damage notes on batteries, and photos from Telegram or the dashboard attached to a crash, a part or a battery.

## Build knowledge and blackbox (F-099, F-100)

- "Smoke FC is iFlight BLITZ Mini F7 V1.2 and the ELRS receiver is BetaFPV SuperD: what is the wiring?" The owner keeps a component library and the wiring in a diyfpv.com build (`https://builder.diyfpv.com/build/b4ee9ef3fb8c`) and can export the whole project as a PNG. Feasibility first: what NERV can read from the build or the PNG, and which manufacturer sources a wiring answer cites. No invented wiring.
- "Smoke vibrates and shakes; props changed, problem stays; frame seems fine: frame, motors or ESC? Analyse the blackbox." Feasibility first: decode Betaflight blackbox logs locally and read the gyro spectrum per axis and motor.

## Sharing outside NERV (F-101)

The owner wants to send the battery manager to friends and FPV pilots ("look at this FPV battery management tool"), some of whom use Claude, possibly on the phone. Options for the decision, after F-075 in the harness (self-contained skills for Agensi):

| Shape | Reaches | Limits |
|---|---|---|
| A Claude skill (a zip: `SKILL.md` plus scripts) | Claude apps that support skills, Agensi listing, a direct zip to a friend | the skill holds the procedure; the pilot's data needs a home of its own (a file they keep, or a store the skill writes to) |
| A small standalone package or repository owning the battery core | anyone, any assistant; NERV consumes it | a second codebase to release and keep in step |
| An MCP server | assistants that support MCP | setup is harder for a casual pilot |

The battery core would live once (in NERV or a separate repository) and the shareable shapes wrap it; nothing is duplicated.

## Cooking (F-083, new steps)

- At the supermarket: "quante uova servivano per gli special brownie?" → "2; attento, l'ultima farina l'hai comprata 6 mesi fa e potrebbe essere scaduta." Needs a purchase log with dates and a shelf-life per item that the owner confirms; NERV says "might be expired" from the purchase date, never asserts it is.
- At home, hands-free: ingredients, then one step at a time ("vai col primo step", "avanti", "ripeti il passaggio", "next"), timers set and stopped by voice, a timer announcing itself in the middle of a step, and "dimmi quando pronto che avvio il timer" where a step needs it. Text in Telegram first; voice through F-007.
