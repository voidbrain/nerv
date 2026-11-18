# Dashboard settings for fixed values (F-110-T01)

**Decided by the owner on 2026-11-19:** every value below becomes a dashboard setting. Defaults stay as they are today.

| Value | Where it is set today | Default |
|---|---|---|
| Automatic update mode: apply after notice, or notify only | fixed (`src/update-scheduler.ts`) | apply after notice |
| Update check time | fixed | 20:00 |
| Update apply time | fixed | 03:00 |
| No-apply window | fixed | 08:00–23:00 |
| Morning brief time | `config.json` `brief.at` | 08:00 |
| Time zone (fallback) | `config.json` | Europe/Rome |
| Sync Ratio threshold (MAGI) | policy default | 80 % |
| Telegram freshness window | fixed | 90 s |

A watch's quiet hours stay per watch, set when the watch is created.

## Settings for every base

The owner asked on 2026-11-19 whether to apply settings to every base or keep common settings. The agent's recommendation, recorded as F-110-T05 and open to the owner's change: **common settings**, edited once on the main base, signed and sent to every base over the Kaji line; a base may override a value only where it really differs (mainly the update times: Tabgha applies updates only from its desktop session). The dashboard shows, for each setting, whether a base uses the common value or its own.
