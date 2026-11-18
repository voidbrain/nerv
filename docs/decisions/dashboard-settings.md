# Dashboard settings for fixed values (F-110-T01)

Owner decision, open since 2026-11-18. Tick the values that should become dashboard settings; the rest stay as they are.

| Value | Where it is set today | Default | Proposed |
|---|---|---|---|
| Automatic update mode: apply after notice, or notify only | fixed (`src/update-scheduler.ts`) | apply after notice | setting |
| Update check time | fixed | 20:00 | setting |
| Update apply time | fixed | 03:00 | setting |
| No-apply window | fixed | 08:00–23:00 | setting |
| Morning brief time | `config.json` `brief.at` | 08:00 | setting |
| Time zone | `config.json` | Europe/Rome | stays in config |
| A watch's quiet hours | per watch, when created in chat | none | stays per watch |
| Sync Ratio threshold (MAGI) | policy default | 80 % | stays in policy |
| Telegram freshness window | fixed | 90 s | stays fixed |

Expected result once decided: F-110-T02 builds the update schedule settings, T03 the panel, T04 any other chosen value.
