# Nodo roadmap

| Milestone | Scope | Acceptance |
|---|---|---|
| 0 — Harness and contracts | v3.1.1 core + Angular adoption; project Node conventions; protocol and privacy boundaries | Harness checks, current review evidence, explicit upstream Node gap F-001 |
| 1 — Reliable local core | CLI, SQLite reminders, local inbox, cancellation, doctor, restart recovery | Restart and duplicate regression tests; authenticated API; F-002 tracks remaining hardening |
| 1a — Headless and bilingual workspace | Single process on 4317, dev 4318, private configuration, Italian/English UI, launchd/systemd user services | Local process/restart and configuration tests; actual OS service acceptance F-009; localization F-010 |
| 1b — Native macOS companion | SwiftUI MenuBarExtra; no Electron; independent lifecycle, health, reminders, notification and service controls | Build/sign/package on macOS; Quit companion leaves service running; F-011 |
| 2 — Useful assistant | Claude/Ollama adapters, Telegram, editable memory, recurring schedules, briefs | Local-only never leaves machine; model outage does not stop reminders; phone delivery reconciles retries; F-003 |
| 3 — Multi-node foundation | Discovery, inspection, enrolment, SSH bootstrap, outbound workers | Mac + mini PC + Pi, disconnect/reconnect, revoked identity, lease expiry, uncertain results and exclusive resources; F-005 |
| 4 — Angular PWA and GenUI | Stable workspace, registered generated surfaces, onboarding and doctor | Browser/accessibility checks, schema rejection, install/push tests on real phones; F-004 |
| 5 — Distributed agents/models | Independent role/model/node routing, coding workers, delegation | Gemma on Mac serves mini PC worker; optional Claude route; Pi capabilities; privacy/budget/cancellation; F-006 |
| 6 — Voice and evaluated improvement | Push-to-talk, STT/TTS, voice client; evaluated skills and rollback | Italian/English command evaluation, no silent physical activation, rejected privilege changes; F-007 |

FPV battery/crash integration is F-008 and can proceed after typed tool/model boundaries. WhatsApp remains an optional channel after Telegram. Dedicated always-listening hardware and replicated coordinators require separate feasibility acceptance; neither is assumed necessary for the first release.

Current implementation step: 1a. It does not replace model/channel milestone 2. Service render/process tests are not an actual macOS/systemd installation trial. Italian natural-language and voice acceptance remain in F-003/F-007; F-010 is interface localization only.

## Waiting and resuming external jobs (F-012)

Example: “When this web-chat or Claude Code job resets its token limit in three hours, resume it once and notify me.” Durable scheduling belongs to milestone 2; enrolled browser/editor execution to milestones 3/5. A timer alone cannot guarantee availability. Recheck the exact session/job and ready state, apply expiry and bounded retries, and reconcile uncertain effects before repeating. An asleep worker, closed tab, logged-out session or changed job produces a waiting/expired/needs-attention result. Resume permission never approves unrelated dialogs or bypasses the provider limit. Prefer a supported command/API; browser or desktop automation requires an explicit adapter and host permissions. Not available in the current release.
