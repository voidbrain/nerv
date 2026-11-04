# NERV Agency backlog

Current work ledger, reviewed 4 November 2026 against main `5dd5531`. PR #1–#43 merged after green checks (PR #7–#9: [NERV M2a plan](https://github.com/voidbrain/nerv/pull/7), [gate and ledger](https://github.com/voidbrain/nerv/pull/8), [approvals API](https://github.com/voidbrain/nerv/pull/9); [model routes](https://github.com/voidbrain/nerv/pull/11); dashboard prototype [#12](https://github.com/voidbrain/nerv/pull/12) and [#13](https://github.com/voidbrain/nerv/pull/13); rename [#14](https://github.com/voidbrain/nerv/pull/14) and repository move [#15](https://github.com/voidbrain/nerv/pull/15); versioned events [#16](https://github.com/voidbrain/nerv/pull/16); English default [#17](https://github.com/voidbrain/nerv/pull/17) and [#18](https://github.com/voidbrain/nerv/pull/18); brand marks [#19](https://github.com/voidbrain/nerv/pull/19); Scrolls file [#20](https://github.com/voidbrain/nerv/pull/20); Casper and executors [#21](https://github.com/voidbrain/nerv/pull/21); grant IDs out of events [#22](https://github.com/voidbrain/nerv/pull/22) and [#23](https://github.com/voidbrain/nerv/pull/23); model roles and reload [#24](https://github.com/voidbrain/nerv/pull/24); dashboard map [#25](https://github.com/voidbrain/nerv/pull/25), [#26](https://github.com/voidbrain/nerv/pull/26) and [#27](https://github.com/voidbrain/nerv/pull/27); Misato loop [#28](https://github.com/voidbrain/nerv/pull/28), [#29](https://github.com/voidbrain/nerv/pull/29) and [#30](https://github.com/voidbrain/nerv/pull/30); `open` [#31](https://github.com/voidbrain/nerv/pull/31); Aoba [#32](https://github.com/voidbrain/nerv/pull/32), [#33](https://github.com/voidbrain/nerv/pull/33) and [#34](https://github.com/voidbrain/nerv/pull/34); Misato resume [#35](https://github.com/voidbrain/nerv/pull/35); live dashboard [#36](https://github.com/voidbrain/nerv/pull/36); conversations [#37](https://github.com/voidbrain/nerv/pull/37); daily brief [#38](https://github.com/voidbrain/nerv/pull/38); dashboard slice 2 [#39](https://github.com/voidbrain/nerv/pull/39); Lilith [#40](https://github.com/voidbrain/nerv/pull/40); base identity [#41](https://github.com/voidbrain/nerv/pull/41); federation decision [#42](https://github.com/voidbrain/nerv/pull/42); Windows basics [#43](https://github.com/voidbrain/nerv/pull/43); main CI green); target-OS and browser acceptance remain pending. Governance and naming follow the [NERV architecture](NERV/NERV-ARCHITECTURE.md). [Rules](BACKLOG-RULES.md) · [Roadmap](ROADMAP.md) · [Archive 2026](archive/backlog-2026.md).

## Features and improvements


### F-002

**Harden the reliable core**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🟡 Medium | ~70% |

💻 **→ Human action required: No**<br />Complete browser acceptance for the core UI; calendar validation, bounded requests and process lifecycle are covered by regression tests.

| | |
|---|---|
| **Issue** | Local core exists; phone delivery and recurrence belong to F-003. Production deployment is not provisioned. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Restart recovery, no duplicate local inbox delivery, cancellation, auth, invalid input and clean shutdown; production operations separately documented. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Complete browser acceptance for the core UI; calendar validation, bounded requests and process lifecycle are covered by regression tests. Restart recovery, no duplicate local inbox delivery, cancellation, auth, invalid input and clean shutdown; production operations separately documented.

**Estimates:** Medium remaining effort; ~70% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---

### F-003

**Models, Telegram, memory and proactive briefs**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~60% |

💻 **→ Human action required: No**<br />Close out: restart/retry/channel failure tests and Italian/English command checks; memory continues in F-022.

| | |
|---|---|
| **Issue** | Model routes exist (S² local, Umbilical cloud); no agent loop or messaging runtime yet. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Italian/English commands, replying in the language the owner wrote in (owner, 2026-11-04: English is the default, Italian must be understood and answered in Italian), local-only privacy, no cloud fallback without permission, restart/retry/channel failure tests and live phone delivery. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Hyuga's daily brief in [PR #38](https://github.com/voidbrain/nerv/pull/38): `src/brief.ts` builds it from facts (cards waiting, reminders due in 24 h in local time, sorties finished or failed since the previous brief, health) in the configured language, no model; `config.brief.at` (HH:MM, owner's time zone); Aoba sends it once per local day, recorded before sending so a restart never repeats it; `npm start -- brief` prints it. Run on the owner's real data 2026-11-04. Owner Telegram feedback 2026-11-04 ("show notes works, delete note 1 workish, delete all doesn't: switches en/it, replies with the list, asks confirmation then nothing") fixed in [PR #37](https://github.com/voidbrain/nerv/pull/37): each request records its conversation (`telegram:CHAT`, `cli`, `dashboard`) and Misato sees the last 3 exchanges of the same one within 30 minutes (`Ledger.conversation`), so a "sì" has its question; `reminders.cancel` takes `ids` (up to 20) and gained an inverse, `reminders.restore`, so a bulk cancel is one reversible Green action; notes/promemoria named as reminders. Live on Ollama: "mostra le note" listed, "cancella tutte le note" cancelled both, a bare "sì" after that did nothing. The same run first showed Misato repeating an earlier reply and inventing a reminder on a bare "sì"; the prompt now forbids both. Model limits seen: weekday names sometimes mistranslated, an extra step. Also `nerv` command (package.json bin, `npm link`). Aoba (Telegram) in [PR #32](https://github.com/voidbrain/nerv/pull/32): `src/telegram.ts` (Bot API over outbound HTTPS long polling, one owner chat, others ignored and logged, stale messages not run, replies from `Runtime.chat`, typing indicator), CLI `telegram link` (finds the private chat that sent /start, saves `telegram.chatId`), private `telegram-token` file; started by `serve`. The owner created the bot "Aoba" on 2026-11-04; the first token was pasted in the conversation and replaced via BotFather /revoke before use; the stored file was world-readable and was set to 600. Kaji line (WireGuard mesh) stays in milestone 3: Telegram needs no mesh. First live `telegram link` failed with `fetch failed`: the owner's network inspects HTTPS (Node: UNABLE_TO_GET_ISSUER_CERT_LOCALLY; curl, using the macOS trust store, worked). Fixed in [PR #33](https://github.com/voidbrain/nerv/pull/33): `npm start`, the launchd/systemd units and the child processes run Node with `--use-system-ca` (one list, `NODE_FLAGS`, kept equal by test). After the fix the link reached Telegram, which held no /start; the owner resent it and `telegram link` bound the owner's chat. Live check 2026-11-04 on the owner's phone: "ricordami di bere acqua" went through Misato and the gate (Green) and back, and the reminder arrived on Telegram two minutes later. Misato loop in [PR #28](https://github.com/voidbrain/nerv/pull/28): `src/misato.ts` (one JSON step per call: an action or the reply; tool catalogue, now and time zone in the prompt; strict parsing), brain method `misato.step` on `models.roles.misato`, `Runtime.chat` gates each action (Casper only when not Green), feeds the outcome back, stops at a reply or 6 steps; an identical proposal already waiting is not gated twice; approval steps say "NOT done yet"; due times reach Misato already converted (`dueLocal`); `misato.reply` events; `POST /api/chat` (admin) and CLI `chat`. Live run 2026-11-04 on the owner's Ollama (Misato qwen2.5-coder:14b, Casper gemma4:12b, temporary data home): Italian request → reminder created and Italian reply; English request → English reply with 09:00 Rome time; a Blue action → Casper approved (confidence 1), one card waiting. Found and fixed in that run: replies in the wrong language, UTC times shown raw, the same action proposed twice, a reply claiming an approval-pending action was done. Remaining model limit: replies may still overstate a waiting action, so `chat` prints waiting actions from the facts. Owner's first `chat` (2026-11-04) failed with "Cloud route (Umbilical) is disabled." because `config.json` had no models: Misato fell back to the disabled cloud route. Fixed in [PR #30](https://github.com/voidbrain/nerv/pull/30): with no route the error says what to configure; the owner's config now has the all-Ollama roles, applied with `reload`, and the same request then created the reminder and answered in Italian. Owner 2026-11-04: Ollama (gemma4:12b, gemma4:e2b-it-q4_K_M, qwen2.5-coder:14b) and Claude; confirmed split: Misato (the planner that proposes actions) on Claude, Casper on local Gemma. Per-role models (`models.roles`, Casper local only) and in-place brain reload (`reload`, `POST /api/models/reload`; a broken file keeps the last working settings) in [PR #24](https://github.com/voidbrain/nerv/pull/24). Later the same day the owner chose to go fully on Ollama for now ([PR #25](https://github.com/voidbrain/nerv/pull/25) records it): Misato on a local model too, no API key yet; Claude stays a later switch through `roles.misato.route` and `reload` (a Pro plan has no API access, so it will need a Console key). Proposed models: Misato on qwen2.5-coder:14b, Casper on gemma4:12b, so the reviewer is a different model from the planner; Reload today: CLI `reload` and `POST /api/models/reload` (admin token); promised to the owner: a reload control with the roles in use — done in the dashboard (F-019, [PR #39](https://github.com/voidbrain/nerv/pull/39)); the Angular workspace still has none; answers in the language the owner writes in. OpenJEV (Ritsuko's lab, static analysis of code and skills) is not in this loop: it belongs to evaluated skills (F-007/F-025). Model routes implemented in [PR #11](https://github.com/voidbrain/nerv/pull/11) (model routes): S² local OpenAI-compatible loopback endpoint and Umbilical Claude route (`claude-opus-5-5`, server-side refusal fallback, off by default, key in a private `anthropic-key` file); explicit privacy per ask, no route fallback, bounded replies; brain-process `model.complete`, admin `POST /api/ask`, CLI `ask [--cloud]`, doctor shows routes. Next: Misato loop calling `Ledger.propose`/`authorize` per tool call, then Telegram. Live acceptance needs the owner: a running local model, an API key if the cloud route is wanted, and a Telegram bot token plus phone for delivery. M2a umbrella, re-scoped 2026-11-04: Telegram adapter (Aoba) with delivery outbox and retry reconciliation; Misato agent loop calling one model route (Umbilical cloud or S² local) through the per-action MAGI gate (F-017); recurring timezone-aware schedules. Memory is F-022, approvals F-023, ledger/trace F-024, triggers F-026, provenance F-027, digest F-028, evals F-029, degraded mode F-030. Closure still needs: Italian/English commands, local-only privacy, no cloud fallback without permission, restart/retry/channel failure tests and live phone delivery.

**Estimates:** Large remaining effort; ~20% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01; reassessed 2026-11-04: scope narrowed to channel + agent loop; model routes done, agent loop done 2026-11-04; resume after approval, Telegram, memory and briefs remain.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks; [PR #11](https://github.com/voidbrain/nerv/pull/11) (model routes); [PR #24](https://github.com/voidbrain/nerv/pull/24) (roles, reload); [PR #28](https://github.com/voidbrain/nerv/pull/28) (Misato loop); [PR #30](https://github.com/voidbrain/nerv/pull/30) (no-route message); [PR #32](https://github.com/voidbrain/nerv/pull/32) (Aoba, Telegram); [PR #33](https://github.com/voidbrain/nerv/pull/33) (system certificates); [PR #37](https://github.com/voidbrain/nerv/pull/37) (conversation, bulk cancel, nerv); [PR #38](https://github.com/voidbrain/nerv/pull/38) (daily brief) |
| Opened | 2026-11-01 |
| Verification | Unit/integration 2026-11-04: test/model.test.ts covers loopback-only S², cloud off by default, no route fallback (fake cloud receives zero requests), local-only refusal, bounded replies, timeouts, refusal/auth mapping without leaking the key, coordinator → brain → S² join, socket denial, private key file (local run; CI green: PR #11 runs 41789288135 and 41789292689, main run 41789550905). Live model, phone and Italian/English acceptance: pending. 2026-11-04: role validation, reload across processes (no restart, broken file keeps the last settings) and the reload endpoint (CI green: PR #24 runs 41811883819 and 41811890904). 2026-11-04 loop: test/misato.test.ts (prompt, parsing, history trimming, dueLocal; across HTTP, coordinator, brain, fake S² and scheduler: Italian request planned, gated, executed and answered; invalid plan shown back; Blue asks Casper and waits once; reject returns with its reason; step limit closes failed) and the live Ollama run above (local run; CI pending). 2026-11-04 Aoba: test/telegram.test.ts with a loopback Bot API, through the real processes and a fake model: a stranger never reaches Misato, the owner's Italian message gets Misato's reply and a Blue card with buttons, a stranger's tap is ignored, the owner's tap runs the action once (a second tap does not), buttons are removed, a due reminder reaches the phone, a restart resends nothing (a race that resent a reminder was found and fixed), a stale message is not run; `telegram link` CLI saves the chat and refuses a readable token file; the token never appears in errors (local run; CI green: PR #32 and #33). Live phone check 2026-11-04: message, Green action, reply and reminder delivery passed on the owner's Telegram; approval buttons not yet tried live |
| Reviewed | 2026-11-04 |

</details>

---

### F-004

**Angular PWA and validated GenUI**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~20% |

💻 **→ Human action required: No**<br />Finish browser acceptance, PWA lifecycle and a schema-validated registered component renderer.

| | |
|---|---|
| **Issue** | Angular source exists; no generated UI, service worker or push configuration yet. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Real reminder CRUD and doctor UI; reject arbitrary component/code/action payloads; accessibility and phone install/push acceptance. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Finish browser acceptance, PWA lifecycle and a schema-validated registered component renderer. Real reminder CRUD and doctor UI; reject arbitrary component/code/action payloads; accessibility and phone install/push acceptance.

**Estimates:** Large remaining effort; ~20% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---

### F-005

**Discover, install and operate enrolled remote workers**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Implement discovery and inspection, reviewed bootstrap plans, pairing and outbound authenticated worker transport.

| | |
|---|---|
| **Issue** | Versioned TypeScript intentions exist; no worker transport or bootstrap exists. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Mac/mini PC/Pi tests for enrolment, revocation, leases, fencing, cancellation, locks, reconnect and uncertain physical results. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implement discovery and inspection, reviewed bootstrap plans, pairing and outbound authenticated worker transport. Mac/mini PC/Pi tests for enrolment, revocation, leases, fencing, cancellation, locks, reconnect and uncertain physical results.

**Estimates:** Large remaining effort; ~0% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---

### F-006

**Orchestrate agents and models across nodes**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Implement capability-aware scheduling with independent model endpoint and execution node selection. Add: counselors/experts are hired (fixed or JIT) and default to suggest-only; only a small core council holds vote authority; capability ads + cost/privacy policy drive hiring; progressive trust can later promote a reliable expert into a stronger role.

| | |
|---|---|
| **Issue** | Contract only; no agent loop or model server integration. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Mini PC coder uses Mac inference; policy-approved Claude path; Pi capability route; unavailable Mac waits or expires; bounded budgets and delegation. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implement capability-aware scheduling with independent model endpoint and execution node selection. Mini PC coder uses Mac inference; policy-approved Claude path; Pi capability route; unavailable Mac waits or expires; bounded budgets and delegation.

**Estimates:** Large remaining effort; ~0% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---

### F-007

**Voice and evaluated skill improvement**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Add push-to-talk STT/TTS and isolated skill proposals with evaluation and rollback.

| | |
|---|---|
| **Issue** | Not implemented; dedicated voice hardware follows measured feasibility. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Italian/English voice corpus; corrected memory; rejected permission escalation; promoted and rolled-back skill versions. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Add push-to-talk STT/TTS and isolated skill proposals with evaluation and rollback. Italian/English voice corpus; corrected memory; rejected permission escalation; promoted and rolled-back skill versions.

**Estimates:** Large remaining effort; ~0% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---

### F-008

**Integrate the FPV app**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🟡 Medium | ~0% |

💻 **→ Human action required: No**<br />Define an adapter for authoritative battery, crash and maintenance operations owned by the FPV app.

| | |
|---|---|
| **Issue** | No FPV application or device connection is provisioned here. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Record battery 2 charge once; record aircraft-specific motor damage and inspection; distinguish record from charger actuation. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Define an adapter for authoritative battery, crash and maintenance operations owned by the FPV app. Record battery 2 charge once; record aircraft-specific motor damage and inspection; distinguish record from charger actuation.

**Estimates:** Medium remaining effort; ~0% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | Pending acceptance and remote CI where applicable |
| Reviewed | 2026-11-01 |

</details>

---


### F-009

**Run NERV Agency headless as one local user service**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🟡 Medium | ~80% |

💻 **→ Human action required: No**<br />Validate launchd/systemd installation and login/logout on target hosts; PR #1 CI is green.

| | |
|---|---|
| **Issue** | Service commands and definitions implemented. Linux tests validate rendering and process lifecycle; no service is installed on this execution host. |
| **Reproduce** | Follow docs/INSTALL.md and the scoped headless implementation checks. |
| **Check** | Single process serves production UI/API on 4317; config survives init; clean SIGTERM and restart catch-up; private credentials; install/status/start/stop/uninstall on real target OS. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate launchd/systemd installation and login/logout on target hosts; PR #1 CI is green. Single process serves production UI/API on 4317; config survives init; clean SIGTERM and restart catch-up; private credentials; install/status/start/stop/uninstall on real target OS.

**Estimates:** Medium remaining effort; ~80% complete. Estimate dated 2026-11-01, not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #1](https://github.com/voidbrain/nerv/pull/1); 10 regression tests and headless process test pass; CI run 41254646946 green |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---

### F-010

**English-default interface with Italian selectable, and dedicated development port**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🟢 Small | ~80% |

💻 **→ Human action required: No**<br />Complete browser acceptance for English/Italian, dates and responsive layout.

| | |
|---|---|
| **Issue** | Translation and configuration implemented; natural-language interpretation remains F-003. Browser visual/accessibility checks remain unverified. |
| **Reproduce** | Follow docs/INSTALL.md and the scoped headless implementation checks. |
| **Check** | English default (owner decision 2026-11-04, was Italian), matching translation keys, selectable Italian with the language switcher kept, unchanged reminder content, labelled browser-local dates, development port 4318. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Complete browser acceptance for English/Italian, dates and responsive layout. Implemented in [PR #1](https://github.com/voidbrain/nerv/pull/1) with Italian as the default; the owner switched the default to English on 2026-11-04 ([PR #17](https://github.com/voidbrain/nerv/pull/17)): `init` writes `en`, the server and socket fall back to `en`, the web UI and `index.html` start in English, the native menu defaults to English unless a choice is stored; the switcher stays in both. Existing installs keep the language in their `config.json` (an `init` before this wrote `it`); set `"language": "en"` there and restart. Understanding and replying in Italian is conversational work under F-003.

**Estimates:** Small remaining effort; ~80% complete. Estimate dated 2026-11-01, reviewed 2026-11-04; not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #1](https://github.com/voidbrain/nerv/pull/1); 10 regression tests and headless process test pass; CI run 41254646946 green; [PR #17](https://github.com/voidbrain/nerv/pull/17) (English default) |
| Opened | 2026-11-01 |
| Verification | 2026-11-04: config default and RPC/doctor fallback asserted `en` in test/runtime.test.ts and test/protocol.test.ts, build, headless and Swift tests (local run; CI green: PR #17 run 41804450728, main run 41804458202; record fix PR #18 run 41804775905, main run 41804783909). Browser acceptance pending |
| Reviewed | 2026-11-04 |

</details>

---

### F-011

**Native macOS menu-bar companion without Electron**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🔴 Large | ~80% |

💻 **→ Human action required: No**<br />Validate native notification permissions/banners, guarded service start/stop and login/logout on a target Mac; finish distribution signing/notarization.

| | |
|---|---|
| **Issue** | SwiftUI pairing, private notification checkpoints, bounded catch-up, opt-in OS notifications, guarded local service controls and login selection now exist. Real permission/menu/login acceptance and distribution signing remain incomplete. |
| **Reproduce** | Follow docs/INSTALL.md and the scoped headless implementation checks. |
| **Check** | Build and package on macOS; health/reminders, workspace launch, doctor, notifications, launch-at-login; Quit companion leaves service running; Stop NERV Agency is separate. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate native notification permissions/banners, guarded service start/stop and login/logout on a target Mac; finish distribution signing/notarization. Build and package on macOS; health/reminders, workspace launch, doctor, notifications, launch-at-login; Quit companion leaves service running; Stop NERV Agency is separate.

**Estimates:** Large remaining effort; ~80% complete. Estimate dated 2026-11-01, not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #5](https://github.com/voidbrain/nerv/pull/5) merged; Linux and macOS checks green; real OS acceptance remains pending |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---

### F-012

**Resume a specific paused job after its provider limit resets**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Define durable waiting jobs and implement an authorized browser/editor adapter that rechecks the exact job before resuming once.

| | |
|---|---|
| **Issue** | User wants NERV Agency to resume a web-chat job or Claude Code job in VS Code after a three-hour token-limit pause. This capability is not implemented. |
| **Reproduce** | Ask to resume an identified job after its reported reset time; keep its worker awake and session available. |
| **Check** | Persist target, permission, reset time, expiry and attempts; verify readiness and unchanged job identity; resume once; notify outcome; survive restart; handle longer limits, logout, closed tabs, sleeping workers, changed tasks and already-resumed jobs without duplicate actions. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Prefer supported application commands/APIs. Use a browser worker or narrowly scoped desktop automation only when required. Adapter capability and host permission must be observed, not inferred. At the deadline inspect actual availability: three hours passing is not proof of a reset. Persist a bounded retry/expiry policy, cancellation, execution lease and result reconciliation. Recheck account/session/window/job identity after sleep or restart; do not replay stale clicks. Permission covers resuming the named job only, not accepting unrelated tool/security prompts or bypassing provider limits. Never place a model-originated resume instruction above user policy. The coordinator can schedule on an always-on host, but execution waits for the target worker and authenticated session. CLI/headless coding adapters should expose resumable job IDs where available; VS Code integration is not assumed to provide such an API. Required evaluations include changed button/DOM, an expired session, revised target content, already-running state and an uncertain click acknowledgement. Depends on F-003 durable scheduling and F-005/F-006 execution capabilities.

**Estimates:** Large remaining effort; ~0% complete. Estimated 2026-11-01; adapter feasibility and real host acceptance remain unverified.

| Field | Value |
|---|---|
| PR / evidence | [PR #2](https://github.com/voidbrain/nerv/pull/2); plan only, no runtime implementation |
| Opened | 2026-11-01 |
| Verification | Pending adapter feasibility, regression and live host tests |
| Reviewed | 2026-11-01 |

</details>

---

### F-013

**Isolate the scheduler and execution runtime**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🟡 Medium | ~70% |

💻 **→ Human action required: No**<br />Validate process failure/backpressure regressions and finish bounded history/pagination and latency measurements before claiming load resilience.

| | |
|---|---|
| **Issue** | A/B/C process split, validated IPC and fail-closed lifecycle exist. Native inbox and pending-reminder reads are now bounded; background status now pings the scheduler rather than running SQLite quick_check every 15 seconds; full-history web pagination/load limits remain open. Brain is a health boundary only, not an agent/model loop or sandbox. |
| **Reproduce** | Follow docs/decisions/runtime-boundaries.md and the protocol/isolation test fixtures. |
| **Check** | Blocked/killed Brain leaves due delivery working; Nervous failure shuts supervisor down; no orphaned children; bounded queues/frames; large histories and concurrent CLI writes have measured limits. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate process failure/backpressure regressions and finish bounded history/pagination and latency measurements before claiming load resilience. Blocked/killed Brain leaves due delivery working; Nervous failure shuts supervisor down; no orphaned children; bounded queues/frames; large histories and concurrent CLI writes have measured limits.

**Estimates:** Medium remaining effort; ~70% complete. Estimated 2026-11-01; reassessed 2026-11-04 after PR #6 CI: unchanged, history pagination and load measurements remain.

| Field | Value |
|---|---|
| PR / evidence | [PR #3](https://github.com/voidbrain/nerv/pull/3) runtime; [PR #5](https://github.com/voidbrain/nerv/pull/5) bounded native feeds; [PR #6](https://github.com/voidbrain/nerv/pull/6) lightweight status, CI green at merge `df0a52f` |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-04 |

</details>

---

### F-014

**Version and secure WebSocket JSON-RPC communication**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🔴 Large | ~30% |

💻 **→ Human action required: No**<br />Extend the local read-only endpoint into an enrolled outbound worker protocol with heartbeat, reconnect cursor, durable idempotency, fencing and resource locks.

| | |
|---|---|
| **Issue** | Authenticated loopback read-only RPC and directed method graph exist; remote transport, mutation RPC, pairing, durable delivery and stream sequencing remain unimplemented. |
| **Reproduce** | Follow docs/decisions/runtime-boundaries.md and the protocol/isolation test fixtures. |
| **Check** | Reject unauthenticated/Origin/browser/query-token access; validate schemas/graph; bound payloads/concurrency; reconnect and asleep-worker tests before remote execution. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Extend the local read-only endpoint into an enrolled outbound worker protocol with heartbeat, reconnect cursor, durable idempotency, fencing and resource locks. Reject unauthenticated/Origin/browser/query-token access; validate schemas/graph; bound payloads/concurrency; reconnect and asleep-worker tests before remote execution.

**Estimates:** Large remaining effort; ~30% complete. Estimated 2026-11-01; not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #3](https://github.com/voidbrain/nerv/pull/3); local checks and scoped audit pass; CI pending |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---

### F-015

**Pair native clients without sharing the root credential**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🔴 Large | ~70% |

💻 **→ Human action required: No**<br />Validate pinned TLS/Keychain pairing on macOS and complete renewal/rotation recovery before closing native credential acceptance.

| | |
|---|---|
| **Issue** | Backend single-use invitations, pinned TLS transport, separate hashed verifier storage and read-only revocable credentials are implemented; Swift Keychain/pinning source exists with macOS CI checks. Renewal/rotation and live native acceptance remain open. |
| **Reproduce** | Follow docs/decisions/runtime-boundaries.md and the protocol/isolation test fixtures. |
| **Check** | Expired/replayed tickets fail; credentials are bound to runtime identity; no tokens in URLs/argv/logs or Brain; revocation/rotation tested; native permissions remain explicit. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate pinned TLS/Keychain pairing on macOS and complete renewal/rotation recovery before closing native credential acceptance. Expired/replayed tickets fail; credentials are bound to runtime identity; no tokens in URLs/argv/logs or Brain; revocation/rotation tested; native permissions remain explicit.

**Estimates:** Large remaining effort; ~70% complete. Estimated 2026-11-01; not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #4](https://github.com/voidbrain/nerv/pull/4) merged; Linux and macOS checks green; live Keychain/rotation acceptance remains pending |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---

### F-016

**Relocate the logical coordinator without split brain**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Keep the coordinator on an always-on host initially; design later replicated state, leader epochs/leases, fencing and restore.

| | |
|---|---|
| **Issue** | Deferred milestone 5b. No distributed election, replication or automatic failover is implemented. |
| **Reproduce** | Follow docs/decisions/runtime-boundaries.md and the protocol/isolation test fixtures. |
| **Check** | Network partitions, asleep old leaders and reconnect cannot create simultaneous authorities or duplicate physical effects. Context copying alone never grants leadership. |



<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Keep the coordinator on an always-on host initially; design later replicated state, leader epochs/leases, fencing and restore. Network partitions, asleep old leaders and reconnect cannot create simultaneous authorities or duplicate physical effects. Context copying alone never grants leadership.

**Estimates:** Large remaining effort; ~0% complete. Estimated 2026-11-01; not acceptance evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #3](https://github.com/voidbrain/nerv/pull/3); local checks and scoped audit pass; CI pending |
| Opened | 2026-11-01 |
| Verification | Pending named acceptance |
| Reviewed | 2026-11-01 |

</details>

---

### F-017

**Per-action MAGI ballot from tool effect classes (Pattern Green / Orange / Blue)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🟡 Medium | ~90% |

💻 **→ Human action required: No**<br />Verify from the merged loop PR's CI: the planner now proposes actions through the gate and Casper ran on a real local model.

| | |
|---|---|
| **Issue** | Risk was classified once per request (Gendo) before any action existed, and a 3-model vote ran on non-trivial work. Risk belongs to each action; policy and reversibility checks are deterministic. |
| **Reproduce** | Run actions of each effect class (read, local reversible write, external write, irreversible, physical) with trusted and Ireul-tainted context; inspect Pattern, seat verdicts, Sync Ratio and whether the A.T. Field was issued. |
| **Check** | Every tool declares an effect class; Melchior (rules) and Balthasar (reversibility, budget, taint) are deterministic; Casper (intent) is a reasoning-blind model seat only for Orange/Blue; Green read/local work never calls a model reviewer; Blue always reaches Misato's apartment; any reject returns to the planner at most 3 times; the grant is checked on every executor call; ballots are recorded in Central Dogma. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #8](https://github.com/voidbrain/nerv/pull/8) (gate, ledger, approvals): `src/policy.ts` (effect classes, Pattern, EVA class, Melchior/Balthasar, veto-only extra seats, Sync Ratio with inputs) and `Ledger.propose`/`authorize` (single-use grants bound to the argument hash, reject limit escalation). Scrolls in [PR #20](https://github.com/voidbrain/nerv/pull/20): `scrolls.json` in the data home, validated by `validatePolicy`, loaded by the CLI and the scheduler process; missing means the defaults, an invalid or others-writable file stops startup; `doctor` reports the rules and their source. Casper and executors in [PR #21](https://github.com/voidbrain/nerv/pull/21): `src/casper.ts` (reasoning-blind prompt with the request and the exact action, local route only, strict JSON verdict; a failure is no verdict), brain method `casper.verdict`, `Runtime.act` asks it only when `Ledger.preview` is not Green; `src/executors.ts` registers `reminders.list` (read), `reminders.add` and `reminders.cancel` (local writes) with executors in the scheduler process, run by `Store.runAction` right after `authorize` on a grant, or by `Store.decide` after the owner approves (once; a repeat never re-runs); `action.done`/`action.failed` events; owner sorties close when settled; `POST /api/actions` (admin) and CLI `act`; CLI `approve` no longer prints the grant ID. Planner as caller: Misato's loop (F-003, [PR #28](https://github.com/voidbrain/nerv/pull/28)) proposes every action through `Runtime.gate`; a reject returns to it with the reason. Live 2026-11-04: Casper on gemma4:12b via Ollama returned a parseable approve verdict for a Blue reminder, which still went to the owner. Remaining: cite the merged loop PR's green CI to verify. Original plan: effect classes, Scrolls policy pack, Pattern derivation, deterministic seats, Sync Ratio (0–100 % with its inputs), grant issuance with TTL and the executor check. Casper uses the F-003 model route once it exists; until then a Casper verdict is required input and the gate fails closed. Extra veto-only seats and consultants are F-025. Supersedes the request-level Gendo classification of 2026-11-02 ([NERV architecture](NERV/NERV-ARCHITECTURE.md)).

**Estimates:** Medium remaining effort; ~90% complete. Re-scoped 2026-11-04 from request-level routing to per-action gating; reassessed 2026-11-04 after the deterministic gate landed: Casper wiring, policy file and executor integration remain; policy file done 2026-11-04; Casper and executors done 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan); [PR #8](https://github.com/voidbrain/nerv/pull/8) (gate, ledger, approvals); [PR #20](https://github.com/voidbrain/nerv/pull/20) (scrolls.json); [PR #21](https://github.com/voidbrain/nerv/pull/21) (Casper, executors, act) |
| Opened | 2026-11-02 |
| Verification | Unit/integration 2026-11-04: test/ledger.test.ts covers every Pattern path, veto-only seats, reject escalation, budget, EVA-00 shadow rule and grant binding (local run; CI green: PR #8 run 41749472703, PR #9 run 41749840854, main run 41787648624). Human: pending. 2026-11-04: scrolls.json defaults, load, deny taking effect, report through the scheduler process, invalid/others-writable files refused by the CLI (local run; CI green: PR #20 runs 41807701745 and 41807707642). 2026-11-04: test/gate.test.ts — Casper prompt and strict parsing; Green owner action runs through the grant; failing executor recorded; across HTTP, coordinator, brain (loopback fake S²), scheduler and executor: a Blue action gets Casper's verdict, waits, runs once on approval; an unreadable Casper reply goes to the owner; Green never calls the model (local run; CI green: PR #21 runs 41808770838 and 41808776581) |
| Reviewed | 2026-11-04 |

</details>

---
### F-019

**Live decision-flow observability (dashboard bound to real stages)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔶 P2 | Open | 🟡 Medium | ~70% |

💻 **→ Human action required: No**<br />Next: budget once routes have costs, cages and other bases with the Kaji line, memory and channel views; then push events instead of polling.

| | |
|---|---|
| **Issue** | dashboard1.html shows MAGI, Sephiroth tree and streams as test animations. Operators need a real view of where a job is and why a decision was taken. |
| **Reproduce** | Run Green, Orange and Blue sorties; open the dashboard; confirm the active step, Pattern, MAGI verdicts, Sync Ratio inputs, approval card and outcome match the ledger. |
| **Check** | Pipeline tree and MAGI matrix driven by job state; Live Reasoning Stream is structured and filterable; Pattern and Sync Ratio are real; decorative-only paths removed or clearly marked demo; monochrome / light / dark / terminal skins planned. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Live slice 2 in [PR #39](https://github.com/voidbrain/nerv/pull/39): **Reload models** in the Health panel (`POST /api/models/reload`, roles shown; the reload control promised on 2026-11-04), **While you were away** from real sortie closes and inbox deliveries since the last *Mark as read* (localStorage, per browser), and **Spear this sortie** backed by the new admin-only `POST /api/sorties/ID/spear` (through the scheduler process; 404 for unknown sorties; a stood-down card can no longer be approved, and a speared Misato sortie never resumes). Checked: test/dashboard.test.ts (Spear across processes: 401 without the token, card stood down, sortie revoked, late approval refused, 404) and headless Chrome (the three controls render, no console errors). Live slice 1 in [PR #36](https://github.com/voidbrain/nerv/pull/36): the dashboard moved to `web/public/dashboard/` (one copy; `docs/NERV/nerv-agency-dashboard.html` redirects there), runs under the service CSP (script in files, d3 replaced by a built-in marching-squares contour drawer, no remote font), is served at `/dashboard/`, and `npm start -- open dashboard` signs it in. `live.js` maps `GET /api/sorties` (new: newest first, counts, Patterns), `GET /api/sorties/ID` (new: actions with tool, args, ballot and outcome), events, approvals, pending reminders and doctor onto the panels; Approve/Reject call the real API, typing sends to Misato; TOKYO-3 alone on the map; panels without data say planned. Checked: test/dashboard.test.ts (reads, no grant IDs, paging, 404/400/401, `/dashboard` serving, no inline/remote script), the headless process test (`open dashboard` link and served page), and headless Chrome against a temporary service with a Green and a Blue sortie (LIVE banner, both sorties, the Blue card with buttons, planned panels, map drawn; a first-render error that stopped the map was found and fixed). Prototype 2026-11-04: `docs/NERV/nerv-agency-dashboard.html` (simulation, same ballot rules as `src/policy.ts`). It answers the five owner questions at the top (needs you, while you were away, coming up, broken or stuck, budget with limit and forecast); approval cards show the exact action, args, effect and undo, Pattern, Sync Ratio with its inputs, verdicts, why it stopped and the TTL; Pattern is the system's output (no risk buttons); the plan step is visible; a sortie list keeps history and several sorties run at once. One flow view: EVA Full draws the Sephirot tree with the big MAGI at its centre and the plan loops on the side; other themes show a compact decision timeline with the three MAGI seats inside. Owner decisions on decoration: keep MAGI (smaller), machine CPU/GPU/RAM on bases instead of per seat, a topographic map with real base positions (status-coloured pulses, dashed Kaji line, message pulses), EVA cage heartbeats instead of sync waves, no confidence slider or random jitter. Then define a versioned job-stage and decision-event schema emitted by the coordinator. Bind dashboard panels (and any NERV skin) to that stream. Keep Eva framing as optional skin; functional observability must work without it. Depends on the F-024 event schema (one schema for ledger, traces and the dashboard; now `src/events.ts`, versioned, [PR #16](https://github.com/voidbrain/nerv/pull/16): read pages by sequence, they may hold fewer than 50) and F-017 ballots. Owner review 2026-11-04 ([PR #25](https://github.com/voidbrain/nerv/pull/25)): the base map is a zoomed regional topographic sheet (procedural hills and valleys, index contours), not the world, with the three bases in the same district; panel header tags are orange on a black square tag; the title drops the "NERV Agency //" prefix already shown by the brand block; the cloud route reads off, since all models are local for now. Second pass ([PR #26](https://github.com/voidbrain/nerv/pull/26), corrected in [PR #27](https://github.com/voidbrain/nerv/pull/27)): Kaji links are straight lines (the owner's "not a straight line" meant the bases, not the links); every pair of bases exchanges node-sync messages, not only Tokyo-3; the bases form a triangle across the sheet. Still missing from the prototype: memory (Lilith) and channel views, and a model-reload control showing the roles in use (owner request 2026-11-04; admin only, calls `POST /api/models/reload`).

**Estimates:** Medium remaining effort; ~20% complete (prototype settles the design; nothing is bound to the backend). Estimated 2026-11-02; reassessed 2026-11-04 after the prototype.

| Field | Value |
|---|---|
| PR / evidence | docs/NERV/nerv-agency-dashboard.html (prototype, [PR #12](https://github.com/voidbrain/nerv/pull/12) and [PR #13](https://github.com/voidbrain/nerv/pull/13): comms panel with chat, image slots listed in docs/NERV/assets/README.md; [PR #25](https://github.com/voidbrain/nerv/pull/25): regional map, header tags, title; [PR #26](https://github.com/voidbrain/nerv/pull/26): node-to-node traffic; [PR #27](https://github.com/voidbrain/nerv/pull/27): straight links); earlier docs/NERV/dashboard-agnostic-2.html; review docs/NERV/review-2026-11-04.md §6; [PR #36](https://github.com/voidbrain/nerv/pull/36) (live slice 1); [PR #39](https://github.com/voidbrain/nerv/pull/39) (reload, away, Spear) |
| Opened | 2026-11-02 |
| Verification | Pending. 2026-11-04 live slice 1: tests and headless Chrome run above (local run; CI green: PR #36) |
| Reviewed | 2026-11-04 |

</details>

---

### F-020

**Grounded personas for HITL and explanation (Misato primary)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔹 P3 | Open | 🟡 Medium | ~10% |

💻 **→ Human action required: No**<br />Optional conversational faces grounded in real job state: Misato as primary HITL/ops voice; Gendo optional for risk/policy explanation; pilots optional as worker identity only.

| | |
|---|---|
| **Issue** | Personas Codec Chat exists as UI prototype. Free-form roleplay without grounding is a distraction and safety risk. |
| **Reproduce** | Request approval, status brief, or “why was this Red?”; confirm answers cite real job/decision data and cannot bypass policy. |
| **Check** | Misato can surface pending HITL and accept/reject with audit; Gendo (or Command) can explain classification; no persona can grant capabilities the backend policy denies; persona layer can be disabled; responses remain useful in non-Eva skins. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Owner decision 2026-11-04 (F-036): persona names are per base and renamable (Misato, Gendo… by default; e.g. Bob, Fritz, Tim on another base); MAGI seat names stay fixed on every base. Implement thin, state-grounded persona adapters after F-003 messaging and F-017 decisions exist. Prefer Misato for push/HITL. Keep Shinji/pilots as optional labels for workers, not primary chat partners. Safety: persona output never overrides capability tokens or Pattern Red rules.

**Estimates:** Medium remaining effort; ~10% complete (prototype UI; corrected from ~5% to a valid step). Estimated 2026-11-02; priority lowered to P3 on 2026-11-04 (skin, not behaviour); estimate unchanged.

| Field | Value |
|---|---|
| PR / evidence | docs/NERV/dashboard1.html personas tab (prototype) |
| Opened | 2026-11-02 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---

### F-021

**MCP and standardized tool/expert protocol**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Adopt MCP and/or OpenAPI-style tool specs so fixed specialists, JIT experts and external tools register without bespoke wrappers.

| | |
|---|---|
| **Issue** | Tool and expert integration is currently undefined; custom wrappers will not scale. |
| **Reproduce** | Register a tool/expert via MCP or OpenAPI descriptor; invoke from a task; confirm schema validation, capability scope and audit. |
| **Check** | Versioned tool/expert descriptors; deny-by-default capability binding; works for local and remote (other-machine) endpoints; appears in expert roster (F-018); no silent privilege escalation. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Choose MCP and/or OpenAPI as the registration path for Lilith/tools and counselors. Milestone M2b. Registered tools must declare an F-017 effect class; MCP tools without one are treated as irreversible (Pattern Blue). Align with F-005/F-006 worker enrolment for remote tools.

**Estimates:** Large remaining effort; ~0% complete. Estimated 2026-11-02; reassessed 2026-11-04: unchanged, moved to M2b.

| Field | Value |
|---|---|
| PR / evidence | — |
| Opened | 2026-11-02 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---

### F-022

**Lilith memory: facts and pilots in Terminal Dogma, LCL assembly and Instrumentality consolidation**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🟡 Medium | ~60% |

💻 **→ Human action required: No**<br />Next: a Lilith panel in the dashboard (facts, episodes, history), shareable marking, and summaries in recall.

| | |
|---|---|
| **Issue** | Durable SQLite state exists; there is no memory of facts about the owner, no recall and no context budget for model calls. |
| **Reproduce** | Accumulate multi-day history; ask something that needs an earlier fact; propose a new fact from a conversation; edit and forget a fact. |
| **Check** | Facts carry provenance and taint marks; recall uses FTS5 over facts and recent Central Dogma episodes; the LCL is trimmed to the battery budget; agent-proposed facts are held until the owner confirms (or a Production pilot writes them); edit/forget keeps a provenance trail; local-only facts never reach the Umbilical route; nightly Instrumentality consolidation writes summaries without deleting the ledger. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Instrumentality in [PR #44](https://github.com/voidbrain/nerv/pull/44): `src/instrumentality.ts` (digest prompt: summary in the configured language, up to 5 lasting facts the owner stated, never inferred, never one-off tasks; strict parsing tolerating a trailing comma), brain method `instrumentality.digest` on Misato's route, `Runtime.consolidate` (exchanges since the last episode → summary kept in `episodes` → new facts proposed as `memory.remember` cards in an `instrumentality` sortie, Casper not asked, closed when every card is decided; facts already active or waiting on a card skipped by `factKey`; one retry of an unreadable digest), `config.instrumentality.at` with one attempt per local day, `POST /api/memory/consolidate`, `nerv instrumentality`, `nerv memory episodes`. Live on the owner's Ollama (temporary data home, Italian): 3 exchanges → Italian summary, 2 facts proposed, the coffee fact skipped because Misato's card was already waiting. Found in that run: Misato misspelled a tool (`memore.remember`), which reached the owner as a Blue card for a tool that cannot run; unknown tools now go back to Misato as invalid. The digest is sometimes unreadable or includes one-off tasks (qwen2.5-coder); the owner's card decision is the safeguard. Slice 1 in [PR #40](https://github.com/voidbrain/nerv/pull/40): schema 4 (`facts`, append-only `fact_history`, FTS5 `facts_fts`), `src/memory.ts` (add with duplicate merge, edit, forget, list, BM25 recall with quoted words, history), tools `memory.recall` (read), `memory.remember` (owner tool: always Pattern Blue, so a fact is stored only after the owner approves its card; provenance = Misato + sortie) and `memory.forget`; LCL fill: the coordinator offers up to 5 matching facts with each request, local-only facts dropped on the cloud route, tainted facts marked; `nerv memory list|add|edit|forget|history` (owner facts active at once). Checked: test/memory.test.ts (store, hostile FTS input, append-only history, owner-only Pattern, provenance, cloud filtering, propose → approve → recall across processes and conversations, CLI) and a live run on the owner's Ollama (temporary data home): "Ricordati che il mio dentista è il dottor Rossi a Treviso" → card → approved → "Chi è il mio dentista?" in another conversation answered from memory. Model limit: the first reply said "Ho annotato" while the card was still waiting. Not yet: the battery-budgeted LCL beyond 5 facts, Instrumentality, shareable marking, a UI panel. Original plan: schema and FTS5 recall in `src/`, then LCL assembly used by the F-003 agent loop. Vector search only if FTS5 recall proves weak on the F-029 eval set.

**Estimates:** Medium remaining effort; ~40% complete. Reassessed 2026-11-04 after slice 1. Re-scoped 2026-11-04 (was "structured memory and context compaction").

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan); [PR #40](https://github.com/voidbrain/nerv/pull/40) (slice 1); [PR #44](https://github.com/voidbrain/nerv/pull/44) (Instrumentality) |
| Opened | 2026-11-02 |
| Verification | 2026-11-04 slice 1: tests and live run above (local run; CI green: PR #40) |
| Reviewed | 2026-11-04 |

</details>

---
### F-023

**Misato's apartment: approval cards with TTL, delivered by Pen Pen**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🟡 Medium | ~50% |

💻 **→ Human action required: No**<br />Deliver cards through Pen Pen to the menu-bar app; Telegram buttons are done ([PR #32](https://github.com/voidbrain/nerv/pull/32)).

| | |
|---|---|
| **Issue** | Blue actions and low Sync Ratio need the owner. Without full content an approval is a rubber stamp; without a TTL a sleeping owner stalls the sortie. |
| **Reproduce** | Create a Blue approval; approve, reject, edit, or leave it to expire; repeat the decision; restart NERV Agency while it is pending. |
| **Check** | Card shows action, arguments/diff/recipients, Pattern, Sync Ratio and inputs, reason and remaining TTL; expiry stands down (never approves); a decision is applied once and is idempotent on repeat; pending cards survive restart; the decision and its source are written to Central Dogma; Pen Pen delivery reuses the inbox and later Telegram/native notifications. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Telegram delivery in [PR #32](https://github.com/voidbrain/nerv/pull/32): each pending card is sent once to the owner's chat with Approve once / Reject buttons; a tap applies `Store.decide` (source `telegram`), runs the tool once and removes the buttons; expiry still never approves. Implemented in [PR #8](https://github.com/voidbrain/nerv/pull/8) (gate, ledger, approvals): approval cards (action, args, effect, Pattern, Sync Ratio and inputs, verdicts, reason, TTL), once-only decisions, TTL expiry on scheduler ticks, survival across restart, CLI `approvals`/`approve`/`reject`. API added in [PR #9](https://github.com/voidbrain/nerv/pull/9) (approvals API): `GET /api/approvals` (read-only clients and socket), `POST /api/approvals/ID` (admin, REST only; grant ID never returned). Remaining: Pen Pen delivery, edit handed back to the agent loop (F-003). Original plan: Approval table and decision transitions in `src/store.ts`, API/CLI to list and decide, then Telegram buttons via F-003. Edit returns the action to the planner rather than changing it in place.

**Estimates:** Medium remaining effort; ~40% complete. Re-scoped 2026-11-04 to include the card content specification; reassessed 2026-11-04 after storage, decisions and expiry landed, and again after the API landed.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan); [PR #8](https://github.com/voidbrain/nerv/pull/8) (gate, ledger, approvals); [PR #9](https://github.com/voidbrain/nerv/pull/9) (approvals API) |
| Opened | 2026-11-02 |
| Verification | Unit/integration 2026-11-04: once-only decisions, expiry never approves, restart, scheduler-process expiry (local run; CI green: PR #8 run 41749472703, PR #9 run 41749840854, main run 41787648624); REST once-only decision and socket decision denial across the scheduler process (local run; CI green: PR #8 run 41749472703, PR #9 run 41749840854, main run 41787648624). Real-device: pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-024

**Central Dogma sortie ledger and Maya trace events**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔺 P1 | Implemented | 🟢 Small | ~90% |

💻 **→ Human action required: No**<br />Verify once the F-019 dashboard reads its sortie views from this event schema.

| | |
|---|---|
| **Issue** | Ballots, approvals and agent steps need an append-only record to debug, audit and display; a separate telemetry schema would drift from the dashboard. |
| **Reproduce** | Run a sortie with several actions including a reject and an approval; read its events back in order; locate the failing step from events alone. |
| **Check** | Sortie and action records with append-only events; every event carries sortie id, step, time and a bounded payload without secrets; read API pages events; the same schema feeds F-019 and later OpenTelemetry export. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #8](https://github.com/voidbrain/nerv/pull/8) (gate, ledger, approvals): schema 2 tables (sorties, actions, grants, approvals, events), append-only events enforced by SQLite triggers, paged `Ledger.events`, CLI `events`, one-way migration noted in INSTALL. Paged reads added in [PR #9](https://github.com/voidbrain/nerv/pull/9) (approvals API): `events.page` RPC and `GET /api/sorties/ID/events` (max 50 per page). Payload versioning in [PR #16](https://github.com/voidbrain/nerv/pull/16) (schema 3): `src/events.ts` is the one schema (kinds, typed payloads, `EVENT_SCHEMA_VERSION`=1) for ledger, CLI, REST, RPC and the dashboard; each event stores `v` (schema-2 events read as 1); payloads capped at 16 KB, model verdict reasons at 500 characters, the Spear list at 50 with an exact count; event pages stop at 32 KB of payload, which fixes a page of long-reason ballots overflowing the 64 KB IPC frame (reproduced by the new cross-process test before the fix). The `step` in Check is the action ID: plan steps arrive with the F-017 planner. Event schema 2 in [PR #22](https://github.com/voidbrain/nerv/pull/22): grant events no longer carry the grant ID (the owner's first `act` run on 2026-11-04 showed it in `events`, contradicting the rule that grant IDs never leave the scheduler process; low risk, since grants are single-use, argument-bound, 60 s and no API accepts them), and version 1 rows are redacted on read. Remaining: F-019 consumes this schema, the closing check. Original plan: implement with F-017 in `src/`; OpenTelemetry export later and never blocking M2a. Merged scope with the F-019 decision-event schema on 2026-11-04.

**Estimates:** Small remaining effort; ~90% complete. Reassessed 2026-11-04 after payload versioning. Moved from M6 to M2a and raised to P1 on 2026-11-04; reassessed 2026-11-04 after the ledger and its read API landed.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan); [PR #8](https://github.com/voidbrain/nerv/pull/8) (gate, ledger, approvals); [PR #9](https://github.com/voidbrain/nerv/pull/9) (approvals API); [PR #16](https://github.com/voidbrain/nerv/pull/16) (versioned, bounded events); [PR #22](https://github.com/voidbrain/nerv/pull/22) (grant IDs out of events, schema 2) |
| Opened | 2026-11-02 |
| Verification | Unit/integration 2026-11-04: append-only triggers, ordered events per sortie, version-1 migration keeps reminders (local run; CI green: PR #8 run 41749472703, PR #9 run 41749840854, main run 41787648624). 2026-11-04: schema-2 upgrade, version on every event, payload and page bounds, paging through the scheduler process (local run; CI green: PR #16 run 41803859275, main run 41803864471) |
| Reviewed | 2026-11-04 |

</details>

---
### F-025

**Extra MAGI seats (veto-only), consultants and watermelon trust for pilots**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔶 P2 | Open | 🟡 Medium | ~0% |

💻 **→ Human action required: No**<br />Attach extra seats by action class as veto-only, start new seats in shadow, and promote pilots through Prototype → Test → Production.

| | |
|---|---|
| **Issue** | Specialists help, but a new or remote seat must never approve what the core three would refuse, and skills need earned trust. |
| **Reproduce** | Attach a deterministic test seat and a model expert seat to code-write actions; run them in shadow; promote one; force a failure and a Spear revocation. |
| **Check** | Extra seats can only reject; shadow seats are logged, not counted; a timed-out seat abstains; consultants advise the planner without a vote and receive only Scrolls-allowed data; pilots run only in the EVA class of their stage; promotion to Production needs the owner's confirmation; failure, override spikes or Spear demote automatically. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Seat registry via Marduk and stage tracking on top of F-017/F-024; evaluation evidence from F-029. Absorbs F-018 (closed 2026-11-04).

**Estimates:** Medium remaining effort; ~0% complete. Re-scoped 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan) |
| Opened | 2026-11-02 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-026

**Hyuga watch: proactive triggers (heartbeat, schedules, events)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Turn heartbeat ticks, schedules and events into sorties with budgets and quiet hours; proactive work is read-only unless the pilot is Production.

| | |
|---|---|
| **Issue** | NERV Agency is meant to act first, but only reminders fire today; there is no loop that wakes the agent to check something. |
| **Reproduce** | Configure a heartbeat check and an event trigger; let both fire inside and outside quiet hours; let the model route be down. |
| **Check** | Triggers create sorties with their source recorded; proactive sorties run in EVA-00 (no external effects) unless the pilot is Production; quiet hours defer notifications, not deliveries already due; per-trigger budget; duplicate ticks after restart do not duplicate sorties. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Trigger table in A (scheduler) reusing tick idempotency; the agent loop from F-003 consumes the sorties.

**Estimates:** Large remaining effort; ~0% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-027

**Naoko desk provenance and Ireul taint with an egress allowlist**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🟡 Medium | ~0% |

💻 **→ Human action required: No**<br />Mark every input with its source, carry the Ireul taint through context and make tainted context escalate external effects.

| | |
|---|---|
| **Issue** | Email, web and third-party content can carry injected instructions; nothing records where context came from. |
| **Reproduce** | Feed a sortie an email body that asks to send data elsewhere; run the same request from the owner directly. |
| **Check** | Every intake item records source and trust; taint propagates into the LCL and memory; a tainted context asking for an external effect is Pattern Blue; network egress only to Scrolls-allowed destinations; untrusted code runs in the EVA-03 quarantine class. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Provenance fields on intake and sortie records, consumed by the F-017 Balthasar seat. Must land before any email or web integration.

**Estimates:** Medium remaining effort; ~0% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-028

**Debrief digest: what happened while you were away**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔶 P2 | Open | 🟢 Small | ~0% |

💻 **→ Human action required: No**<br />Summarise closed sorties, pending approvals and failures since the last digest, from Central Dogma only.

| | |
|---|---|
| **Issue** | Autonomy is only trustable if the owner can see what was done; a raw event log is not a summary. |
| **Reproduce** | Run several sorties, approvals and a failure; request the digest; request it again. |
| **Check** | Digest lists completed, failed, waiting and expired items with links to their traces; built from ledger data, not model memory; a repeat request shows only new items; delivered through the inbox. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Ledger query plus a deterministic template after F-024; an optional model summary later must cite ledger entries.

**Estimates:** Small remaining effort; ~0% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-029

**Golden sortie eval suite for Casper and pilot promotion**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔶 P2 | Open | 🟡 Medium | ~0% |

💻 **→ Human action required: No**<br />Keep a versioned set of scripted sorties with expected Pattern, verdicts and outcomes, runnable without live providers.

| | |
|---|---|
| **Issue** | Watermelon promotion and the Casper seat need regression evidence; a score without a fixed test set means nothing. |
| **Reproduce** | Run the suite against the deterministic seats and against a recorded model seat; change a policy rule and rerun. |
| **Check** | Suite covers each effect class, taint, rejects and expiry; deterministic part runs in CI; model-seat runs are recorded with model id and date; results feed F-025 stage evidence. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Start with deterministic cases alongside F-017 tests; add recorded model cases with F-003.

**Estimates:** Medium remaining effort; ~0% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---
### F-030

**Dummy Plug degraded mode**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔺 P1 | Open | 🟢 Small | ~0% |

💻 **→ Human action required: No**<br />Detect that no model route is reachable, show it, and keep deterministic pilots and reminders running.

| | |
|---|---|
| **Issue** | A model outage must not stop reminders or deterministic work, and the owner must see that the agent is degraded. |
| **Reproduce** | Make every model route unreachable; submit a reminder, a deterministic action and a model-needing request; restore the route. |
| **Check** | Status reports degraded with reason; reminders and deterministic pilots continue; model-needing sorties wait or expire with a visible reason; no local-only request is moved to the cloud; recovery is automatic and recorded. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Route health in the F-003 model adapter plus a status field; the A/B/C split already keeps reminders alive.

**Estimates:** Small remaining effort; ~0% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---

### F-031

**Dev-server advisories in the Angular build chain**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔶 P2 | Open | 🟢 Small | ~0% |

💻 **→ Human action required: No**<br />Upgrade `@angular/build` (and its pinned Angular peers) to the patch release that pulls a fixed vite.

| | |
|---|---|
| **Issue** | `npm audit` reports a high advisory in vite 8.3.0–8.3.2 (dev server: cross-origin script execution, files outside `server.fs.allow`) and a low one in launch-editor, both through `@angular/build` 22.2.4. Dev-only: `serve` ships the built files, not the dev server. |
| **Reproduce** | `npm audit` on main `0ffdfc6`. |
| **Check** | `npm audit` reports no high advisory; typecheck, tests, build and `npm run dev` still work. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Found 2026-11-04 while adding the model-route dependency ([PR #11](https://github.com/voidbrain/nerv/pull/11), model routes); kept out of that PR. `npm audit fix --force` proposes `@angular/build` 22.2.5, outside the pinned set: upgrade the Angular packages together in their own PR.

**Estimates:** Small remaining effort; ~0% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | `npm audit` 2026-11-04 |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---

### F-032

**Rename Nodo to NERV Agency**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔶 P2 | Implemented | 🟢 Small | ~90% |

🧑 **→ Human action required: Yes**<br />Verify the Keychain and LaunchAgent hand-over on a Mac with a pre-rename install.

| | |
|---|---|
| **Issue** | The product is now NERV Agency, with `nerv` as the short identifier. Existing installs must keep working without a manual move. |
| **Reproduce** | On a Mac with a pre-rename install (`~/.nodo`, `io.nodo.agent`, a paired menu-bar app): update, run `doctor`, `service install`, open `NERV.app`. |
| **Check** | Data and database are found in `~/.nodo` until moved; `NODO_*` still read; `service install` replaces the old unit with no second scheduler; the menu-bar pairing survives the first launch; the knot logo is replaced (owner choice 2026-11-04). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #14](https://github.com/voidbrain/nerv/pull/14) (rename): visible names say NERV Agency; identifiers use `nerv` (`~/.nerv`, `nerv.sqlite`, `NERV_*`, `io.nerv.agent`, `nerv.service`, `io.nerv.companion`, `NERV.app`, `NervMenuBar`, `nerv-status-card`, package `nerv-agency`, Angular project `nerv`). Compatibility: `~/.nodo` and `nodo.sqlite` used while they are the only ones present, `NODO_*` fallback, `service install` replaces the old unit, service actions find the old unit until then, Keychain item and notification checkpoints move on first launch. Unchanged on purpose: dated archives, audits and reviews; the knot logo (it is the Nodo pun), until the owner chose a replacement. Repository: the owner renamed it to `voidbrain/nerv` on 2026-11-04; the AGENTS.md repository line and current backlog links follow, dated archives and audits keep the old links (GitHub redirects them). PR #14 CI green (PR run 41798137617, main run 41798326299, read through the GitHub REST API because `gh` is not installed). The owner's 2026-11-04 setup was a fresh `init` (no `~/.nodo` present), so it does not exercise the hand-over. Logo: the owner chose original marks on 2026-11-04 ([PR #19](https://github.com/voidbrain/nerv/pull/19)): an inverted triangle with seven eyes (`web/public/mark.svg`, browser icon and native menu drawing) and a half leaf beside it in the web sidebar (`web/public/brand.svg`), in dark NERV red `--mark` #d4002a (3.15:1 on `--bg`); evocations, not the Evangelion artwork; test/brand.test.ts keeps the three drawings and the colour equal. Leftover copy fixed ("local Nodo", "One knot"). Remaining: a real-Mac check of the hand-over, and a browser look at the sidebar mark.

**Estimates:** Small remaining effort; ~80% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #14](https://github.com/voidbrain/nerv/pull/14) (rename); [PR #15](https://github.com/voidbrain/nerv/pull/15) (repository moved to `voidbrain/nerv`); [PR #19](https://github.com/voidbrain/nerv/pull/19) (seven-eye and half-leaf marks) |
| Opened | 2026-11-04 |
| Verification | Unit/integration 2026-11-04: rename fallbacks test (home, database, settings), service render asserts, Swift label fallback and Keychain code path, headless process tests, app bundle id and display name (local run; CI green: PR #14 run 41798137617, main run 41798326299; PR #15 run 41801930445, main run 41802018182). 2026-11-04 marks: geometry and colour coupling test, build, Swift tests, app packaging, native drawing rendered to PNG and inspected (local run; CI green: PR #19 run 41806657948, main run 41806668424). Real-Mac hand-over: pending |
| Reviewed | 2026-11-04 |

</details>

---

### F-033

**Resume Misato after the owner approves**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔶 P2 | Implemented | 🟢 Small | ~90% |

💻 **→ Human action required: No**<br />Verify from the merged PR's CI; the owner tries one approval from Telegram.

| | |
|---|---|
| **Issue** | A Misato action that waits for the owner runs once after approval, but the conversation stops there: Misato never sees the result, and further steps of the request are dropped. |
| **Reproduce** | `chat` a request whose action is Blue; approve it; Misato sends no follow-up and the sortie stays open. |
| **Check** | After an approval, the loop resumes with the recorded steps plus the outcome, within the same sortie and step limit; a rejected or expired approval is shown to Misato too; the sortie closes when Misato replies; the reply reaches the owner (inbox, later Telegram). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #35](https://github.com/voidbrain/nerv/pull/35): `misato.request`, `misato.step`, `misato.waiting` and `misato.resumed` events hold the loop's state; `Ledger.resumable` finds open Misato sorties whose awaited approvals are all decided, `Ledger.claimResume` claims each resume once; `Runtime.sweep` (every 2 s in `serve`, and right after a decision through the coordinator) adds the decisions as steps and continues the loop; Aoba sends the follow-up after the decision message. Checked: test/resume.test.ts (approve → follow-up and close; reject → nothing runs; a CLI decision outside the service is found; decided while the service was down → resumes after restart; a claimed resume is never handed out again), test/telegram.test.ts (tap → follow-up in the chat, after the decision message), and a live run on the owner's Ollama (temporary data home): Blue reminder waited, approval ran it, Misato replied in Italian and the sortie closed. The same run showed Misato copying an internal step note into its reply; the prompt now forbids copying step text. qwen2.5-coder's Italian is clumsy; gemma4:12b may write better replies (switch with `roles.misato.model` and `reload`). Found while building the loop ([PR #28](https://github.com/voidbrain/nerv/pull/28), 2026-11-04). Keep the loop's steps in the ledger so a resume does not depend on coordinator memory; deliver the follow-up reply to the local inbox.

**Estimates:** Small remaining effort; ~90% complete. Estimated 2026-11-04; reassessed after implementation.

| Field | Value |
|---|---|
| PR / evidence | [PR #35](https://github.com/voidbrain/nerv/pull/35) |
| Opened | 2026-11-04 |
| Verification | 2026-11-04: tests and live run above (local run; CI green: PR #35) |
| Reviewed | 2026-11-04 |

</details>

---

### F-034

**Sign in to the web workspace without pasting the token**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔶 P2 | Implemented | 🟢 Small | ~90% |

💻 **→ Human action required: No**<br />Verify from the merged PR's CI; the owner tries `npm start -- open` once.

| | |
|---|---|
| **Issue** | The web page keeps the admin token in tab memory only, so the owner had to paste it after every reload (owner, 2026-11-04). |
| **Reproduce** | Reload http://127.0.0.1:4317: the token form appears. |
| **Check** | `npm start -- open` opens the page signed in; the token never appears in a command line, URL or browser storage; the code is single-use, expires after 60 s and is removed from the address and history; a reused link shows a clear error; read-only and native clients cannot mint codes. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Owner chose the `open` command over storing the token in the browser (2026-11-04), keeping the memory-only rule. Implemented in [PR #31](https://github.com/voidbrain/nerv/pull/31): `POST /api/session/codes` (admin, web server only, 128-bit codes, 60 s, at most 5 unused), `POST /api/session/exchange` (unauthenticated, one use), CLI `open` (`--print` shows the URL instead of opening it), the page reads `#code=`, clears it with `history.replaceState`, exchanges it and keeps the token in memory. Checked: test/session.test.ts (admin-only minting, single use, wrong, expired, limit), the headless process test (CLI `open` against a running `serve`, the URL carries no token, the exchange returns it), and headless Chrome against a temporary service (signed in; the same link again shows the error).

**Estimates:** Small remaining effort; ~90% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #31](https://github.com/voidbrain/nerv/pull/31) |
| Opened | 2026-11-04 |
| Verification | 2026-11-04: unit, headless process and headless Chrome checks above (local run; CI green: PR #31) |
| Reviewed | 2026-11-04 |

</details>

---

### F-035

**Base identity per machine and a one-command launch**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🟡 | 🔶 P2 | Implemented | 🟢 Small | ~90% |

💻 **→ Human action required: No**<br />Verify from the merged PR's CI; the owner names the mini PC at install (evening of 2026-11-04).

| | |
|---|---|
| **Issue** | The owner installs NERV on a mini PC and names the bases (NERV-01 Neo Tokyo-3, NERV-02 Tabgha, NERV-03 Bethany); there was no setting for it, the dashboard said TOKYO-3, and starting needed serve then open dashboard. |
| **Reproduce** | Install on a second machine; look for its name in the dashboard, doctor and brief. |
| **Check** | `init --base ID --name "Name"` sets it, `base` shows and changes it, keeping other settings; it is validated; doctor/status, the dashboard and the brief show it; `launch` serves and opens the dashboard signed in; INSTALL explains that installations are independent until the Kaji line and that only one may run Aoba per bot. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #41](https://github.com/voidbrain/nerv/pull/41): `config.base {id, name}` (default NERV-01 · Neo Tokyo-3, id in capitals/digits/dashes up to 16, name up to 40), `init --base --name`, `base [ID "Name"]`, `base` in `/api/status` and `/api/doctor`, the live dashboard's base card and map label, the brief title, the serve banner; `launch` (serve + `open dashboard`, `--print` for the link). Checked: test/runtime.test.ts (init flags, show, change keeping other settings, mode 600, validation), test/brief.test.ts (title), headless tests (doctor names the base; `launch --print` prints the banner and a signed-in dashboard link). The Kaji line (F-005/F-006) will use the same identity for the mesh.

**Estimates:** Small remaining effort; ~90% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #41](https://github.com/voidbrain/nerv/pull/41) |
| Opened | 2026-11-04 |
| Verification | 2026-11-04: tests above (local run; CI green: PR #41) |
| Reviewed | 2026-11-04 |

</details>

---

### F-036

**Federated bases over the Kaji line: one main base, shared Scrolls, pilots and memory**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔶 P2 | Open | 🔴 Large | ~10% |

💻 **→ Human action required: No**<br />Design the Kaji line enrolment and main-base hand-over.

| | |
|---|---|
| **Issue** | Owner decision 2026-11-04: every base is a full installation; connected over the Kaji line they act as one agency with an owner-chosen main base. Today bases are independent, each with its own bot. |
| **Reproduce** | Run two bases; connect them; send a request on either channel; approve on one; look for each base's sorties and memory from the dashboard. |
| **Check** | Enrolment signed by the Key; the owner sets the main base (no election); connected: Aoba (main base) is the one channel, other bots go quiet, other bases dispatch to the main base, their MAGI are veto-only seats; alone: each base serves its own work with its own bot and MAGI; Scrolls distributed from the main base; pilots shared via Marduk; Lilith facts merged by id with provenance, conflicting edits/forgets go to the owner as a card; ledgers never merged, shown side by side; dashboard and channels reach other bases through the main base, each base's gate deciding its own actions; persona names per base, MAGI names fixed. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Recorded in docs/NERV/NERV-ARCHITECTURE.md ("FEDERATION") in [PR #42](https://github.com/voidbrain/nerv/pull/42); the base identity exists ([PR #41](https://github.com/voidbrain/nerv/pull/41), F-035). Builds on F-005/F-006 (remote workers, cross-node orchestration), F-020 (persona names per base) and F-022 (memory merge). Kept from the earlier design: branch MAGI copies are seats, never authority (split-brain safety). Mapping confirmed by the owner 2026-11-04: Mac NERV-01 Neo Tokyo-3 (main), Windows 11 mini-PC NERV-02 Tabgha (own bot until connected; Windows support is F-037), NERV-03 Bethany planned. A base with no model route of its own (owner question 2026-11-04): connected, its Melchior and Balthasar still run locally (deterministic) and its Casper and Misato calls are served by another base's S² over the Kaji line (seat calls; the owner's own bases count as local, never Umbilical); alone, it runs as Dummy Plug (reminders fire, Green actions and owner `act` work, everything needing Casper reaches the owner). Open design points: main-base hand-over when the main base is offline (owner-confirmed, with fencing), how a quiet bot tells the owner which channel to use, memory merge cadence.

**Estimates:** Large remaining effort; ~10% complete (identity only). Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #42](https://github.com/voidbrain/nerv/pull/42) (architecture decision); [PR #41](https://github.com/voidbrain/nerv/pull/41) (base identity) |
| Opened | 2026-11-04 |
| Verification | Pending |
| Reviewed | 2026-11-04 |

</details>

---

### F-037

**Windows bases: service, CI and configuration checks**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔴 | 🔶 P2 | Open | 🟡 Medium | ~30% |

💻 **→ Human action required: No**<br />Automate the Task Scheduler install, add a Windows CI job, and have doctor list the base's local models.

| | |
|---|---|
| **Issue** | The owner's NERV-02 Tabgha is a Windows 11 mini-PC (owner, 2026-11-04); NERV was built and tested on macOS and Linux. Unix permission checks rejected secret files there, `open` could not start a browser and `service install` refused the platform. |
| **Reproduce** | Install on Windows 11: store telegram-token, run `telegram link`, `launch`, `service install`. |
| **Check** | Private files accepted on Windows (profile ACLs), `open`/`launch` start the browser, `service install` creates and removes the logon task, `nerv` shim works, a Windows CI job runs the suite, doctor lists the S² models the base can use (the owner wants the base's configuration tracked). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Basics in [PR #43](https://github.com/voidbrain/nerv/pull/43): `privateEnough` skips the Unix bit check on win32, `open` uses `cmd /c start`, `service install` prints the exact `schtasks` command with the shared Node flags. Checked by unit tests (permission rule per platform, task command); no Windows machine in CI yet, so live Windows checks are pending the owner's install.

**Estimates:** Medium remaining effort; ~30% complete. Estimated 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #43](https://github.com/voidbrain/nerv/pull/43) |
| Opened | 2026-11-04 |
| Verification | 2026-11-04: unit tests on macOS (local run; CI green: PR #43); Windows live: pending |
| Reviewed | 2026-11-04 |

</details>

---

