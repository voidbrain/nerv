# F-114-T05: FPV Pack Off-and-On Toggle Check

Date: 2026-11-22  
Operator: Agent (`antigravity`)

## Scope

Verified toggling `packs.fpv` on → off → on in an isolated NERV home (`config.json` + `Runtime` + `GET /api/packs` + `builtinPackRegistry.filterToolDocs`) with an invented battery fixture:

1. **FPV on (`packs.fpv: true`)**: Seeded `Fixture Pack 1` (`1` battery in SQLite). `GET /api/packs` reports `fpv.enabled: true` and `batteries` panel visible (`fpvPanelVisible: true`); `filterToolDocs` exposes FPV tools (`fpvToolsPresent: true`); `batteryCount: 1`.
2. **FPV off (`packs.fpv: false`)**: `GET /api/packs` reports `fpv.enabled: false` and omits the `batteries` panel (`fpvPanelVisible: false`); `filterToolDocs` removes all FPV tools (`fpvToolsPresent: false`); `batteryCount: 1` remains intact in SQLite.
3. **FPV on again (`packs.fpv: true`)**: `GET /api/packs` restores `fpv.enabled: true` and the `batteries` panel (`fpvPanelVisible: true`); `filterToolDocs` restores FPV tools (`fpvToolsPresent: true`); `batteryCount: 1` remains intact.

## Validation Commands

- `node --test test/packs.test.ts`
- Isolated `Runtime` + `makeServer` + `GET /api/packs` + `filterToolDocs` toggle run (`step1` → `step2` → `step3`) — passed.
