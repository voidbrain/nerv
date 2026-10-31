# Nodo roadmap

| Milestone | Scope | Acceptance |
|---|---|---|
| 0 — Harness and contracts | v3.1.1 core + Angular adoption; project Node conventions; protocol and privacy boundaries | Harness checks, current review evidence, explicit upstream Node gap F-001 |
| 1 — Reliable local core | CLI, SQLite reminders, local inbox, cancellation, doctor, restart recovery | Restart and duplicate regression tests; authenticated API; F-002 tracks remaining hardening |
| 2 — Useful assistant | Claude/Ollama adapters, Telegram, editable memory, recurring schedules, briefs | Local-only never leaves machine; model outage does not stop reminders; phone delivery reconciles retries; F-003 |
| 3 — Multi-node foundation | Discovery, inspection, enrolment, SSH bootstrap, outbound workers | Mac + mini PC + Pi, disconnect/reconnect, revoked identity, lease expiry, uncertain results and exclusive resources; F-005 |
| 4 — Angular PWA and GenUI | Stable workspace, registered generated surfaces, onboarding and doctor | Browser/accessibility checks, schema rejection, install/push tests on real phones; F-004 |
| 5 — Distributed agents/models | Independent role/model/node routing, coding workers, delegation | Gemma on Mac serves mini PC worker; optional Claude route; Pi capabilities; privacy/budget/cancellation; F-006 |
| 6 — Voice and evaluated improvement | Push-to-talk, STT/TTS, voice client; evaluated skills and rollback | Italian/English command evaluation, no silent physical activation, rejected privilege changes; F-007 |

FPV battery/crash integration is F-008 and can proceed after typed tool/model boundaries. WhatsApp remains an optional channel after Telegram. Dedicated always-listening hardware and replicated coordinators require separate feasibility acceptance; neither is assumed necessary for the first release.
