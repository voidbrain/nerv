# FPV core, domain packs and shared pages (F-101-T02)

**Decided by the owner on 2026-11-20.** Options compared in F-101-T01 ([design note](../design/fpv-and-cooking-plan-2026-11-14.md), "Sharing outside NERV").

## Decision

1. **One FPV core repository**, not a battery-only one: batteries, fleet (drones, parts by position), spares warehouse (new/used) and crash log, with the crash → battery-damage link inside it. It defines a storage interface and holds rules only: no NERV imports, no chat parsing, no scheduling, no authority. Builds, wiring and blackbox stay in NERV until a pilot asks for them.
2. **Extracted after F-098 settles** (F-098-T04), so two repositories do not move together while fleet and crashes still change.
3. **Pages built once as web components** in the core repository (`<fpv-batteries>`, `<fpv-fleet>`, …). NERV's dashboard and the standalone page for friends both host them and supply data through the storage interface. Styling comes in through CSS custom properties, so NERV keeps its own tokens.
4. **NERV's FPV pack is the adapter**: SQLite storage, the Italian chat phrases local models need, tools with effect classes gated by MAGI, reminders through NERV core, photos, dashboard panels.
5. **Domain packs in NERV** (F-114): FPV and Cooking become packs the owner turns on and off. Reminders, todos, timers and photos stay in the core because packs use them. Switching a pack off hides its tools and keeps its data.
6. **Sharing order**: a Claude skill first (the pilot keeps a data file; Claude draws the battery page as an artifact), an MCP server with an MCP Apps page later, when a pilot asks.
7. **Telegram**: a formatted text list; inline buttons only if typing at the field becomes a nuisance. No Telegram Mini App.

## Rejected

| Alternative | Why not |
|---|---|
| Battery-only core | The warehouse and crash log are useful to the same pilots; the original app held them together |
| All three shapes at once | The MCP server is the hardest to set up for a casual pilot and a third thing to release |
| Angular component library | Couples NERV and the core to one Angular version; every change is a version bump |
| FPV as a microservice | A second service on every base under the fenced lifecycle, MAGI and the Central Dogma ledger across a network boundary, two databases to back up; little gain for a personal hub. The MCP server is the service form if one is ever needed |
| Telegram Mini App | Needs the dashboard reachable over HTTPS from outside the owner's network |

## Ownership

The core repository is the reusable master; NERV is derived. The core never depends on NERV, and NERV's FPV work never waits on the core's release. Once created (F-101-T04) the core repository's own backlog owns its web components, Claude skill and MCP server; NERV's records own only NERV's side (F-101-T05, F-101-T06, F-114).

## Repository (F-101-T03)

**Decided by the owner on 2026-11-22:** repository name **`fpv-buddy`**, visibility **`public`**.

## Reconsider when

Pilots need builds, wiring or blackbox; a pilot needs shared or synced data rather than a file of their own; MCP write grants (F-021) make an external FPV pack usable from NERV; or two hosts start to diverge on the web components.
