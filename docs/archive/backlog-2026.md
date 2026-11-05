# Backlog archive 2026

Closed records in closing-date order. Dated evidence, not current status.

## Closed 2026-11-04

### F-039

**Dashboard stays signed in across a reload, with a session instead of the admin token**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by the owner and closed.

| | |
|---|---|
| **Issue** | Owner report 2026-11-04: a dashboard opened with `nerv open dashboard` signs out on every reload, because the token lived only in the tab's memory (the F-034 rule, archived in docs/archive/backlog-2026.md). Owner decision 2026-11-04: a tab session that survives a reload, instead of storing the admin token. |
| **Reproduce** | `nerv open dashboard`, then reload the page. |
| **Check** | The login code is swapped for a random dashboard session, never the admin token; it signs a reload in the same tab back in; it ends after 12 h, on a service restart, with `sessions revoke`, or when the tab closes; it cannot mint login codes or revoke, so it never renews itself; an admin token pasted by hand is never stored; the Angular workspace still signs in with `open`. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #76](https://github.com/voidbrain/nerv/pull/76): `/api/session/exchange` returns `{token: session, expiresInMs}` (32 random bytes, at most 20 live, in the service's memory); requests with a live session count as the admin, except `/api/session/codes` and `/api/session/revoke` (403), which need the admin token; `nerv sessions revoke` ends them all; the dashboard keeps the session in its tab's sessionStorage (`nerv.dashboard.session`), resumes it on reload and drops it with a clear message on a 401. Checked: test/session.test.ts (exchange returns a session, not the token; it acts as the owner, cannot mint or revoke, expires, is revoked), test/headless.integration.ts (open → session signs doctor in → `sessions revoke` → 401), headless Chrome against a throwaway service (signed in after a reload; after `sessions revoke` the page says the session ended and nothing is kept).

**Resolution:** Closed 2026-11-04 as Verified. The owner checked it on Neo Tokyo-3 (signed in after a reload; `sessions revoke` ended the session); merged in [PR #76](https://github.com/voidbrain/nerv/pull/76), CI green on the PR and on main (run 41925260230).

**Estimates:** Closed; ~100% complete. Closed 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #76](https://github.com/voidbrain/nerv/pull/76) |
| Opened | 2026-11-04 |
| Verification | 2026-11-04: tests and browser check (local run); owner check 2026-11-04; CI green: PR #76, main run 41925260230 |
| Reviewed | 2026-11-04 (closed) |

</details>

---

### F-033

**Resume Misato after the owner approves**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by the owner on Telegram and closed.

| | |
|---|---|
| **Issue** | A Misato action that waits for the owner runs once after approval, but the conversation stops there: Misato never sees the result, and further steps of the request are dropped. |
| **Reproduce** | `chat` a request whose action is Blue; approve it; Misato sends no follow-up and the sortie stays open. |
| **Check** | After an approval, the loop resumes with the recorded steps plus the outcome, within the same sortie and step limit; a rejected or expired approval is shown to Misato too; the sortie closes when Misato replies; the reply reaches the owner (inbox, later Telegram). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Owner test 2026-11-04 on Neo Tokyo-3 (Telegram, `Remember that I drink coffee at 8`): the Blue card arrived, **Approve once** stored the fact and Misato's follow-up ("I've added that you drink coffee at 8 to your memory.") closed the sortie. Finding: before the follow-up the owner got "Hai già confermato di bere caffè alle 8…": the ledger shows that, after the card, the loop asked the model again, it re-proposed the same action (refused as already waiting) and then wrote a waiting reply that claimed the action was already confirmed, in Italian for an English request, 20 s after the card. Fixed in [PR #74](https://github.com/voidbrain/nerv/pull/74): a card now ends Misato's turn, with a reply written by the service (`waitingReply`, in the request's language by `requestLanguage`, falling back to the conversation): it names what waits and never says it happened; Misato carries on after the decision as before. The duplicate-proposal guard it made unreachable is removed. Checked: test/misato.test.ts, test/resume.test.ts, test/telegram.test.ts (Misato asked twice, not three times), full suite 100 pass. Earlier: implemented in [PR #35](https://github.com/voidbrain/nerv/pull/35): `misato.request`, `misato.step`, `misato.waiting` and `misato.resumed` events hold the loop's state; `Ledger.resumable` finds open Misato sorties whose awaited approvals are all decided, `Ledger.claimResume` claims each resume once; `Runtime.sweep` (every 2 s in `serve`, and right after a decision through the coordinator) adds the decisions as steps and continues the loop; Aoba sends the follow-up after the decision message. Checked: test/resume.test.ts (approve → follow-up and close; reject → nothing runs; a CLI decision outside the service is found; decided while the service was down → resumes after restart; a claimed resume is never handed out again), test/telegram.test.ts (tap → follow-up in the chat, after the decision message), and a live run on the owner's Ollama (temporary data home): Blue reminder waited, approval ran it, Misato replied in Italian and the sortie closed. The same run showed Misato copying an internal step note into its reply; the prompt now forbids copying step text. qwen2.5-coder's Italian is clumsy; gemma4:12b may write better replies (switch with `roles.misato.model` and `reload`). Found while building the loop ([PR #28](https://github.com/voidbrain/nerv/pull/28), 2026-11-04). Keep the loop's steps in the ledger so a resume does not depend on coordinator memory; deliver the follow-up reply to the local inbox.

**Resolution:** Closed 2026-11-04 as Verified. The owner approved a Blue card on Telegram and Misato resumed, replied and closed the sortie; the misleading waiting message found in that test is fixed in [PR #74](https://github.com/voidbrain/nerv/pull/74) (CI green on the PR and on main, run 41921444824).

**Estimates:** Closed; ~100% complete. Closed 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #35](https://github.com/voidbrain/nerv/pull/35) |
| Opened | 2026-11-04 |
| Verification | 2026-11-04: tests and live run (local run; CI green: PR #35); owner Telegram test 2026-11-04; fix CI green: PR #74, main run 41921444824 |
| Reviewed | 2026-11-04 (closed) |

</details>

---

### F-030

**Dummy Plug degraded mode**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: merged with green checks and closed. Optional owner check on Neo Tokyo-3: `osascript -e 'quit app "Ollama"'`, wait a minute: the dashboard tile says *degraded* and Health shows *S² local route ✗ down since …*; ask Aoba `what is on today?` → *I could not finish: Local route (S²) unreachable.*; then `open -a Ollama` and within a minute Health shows *reachable* and the service log prints *back after N min*.

| | |
|---|---|
| **Issue** | A model outage must not stop reminders or deterministic work, and the owner must see that the agent is degraded. |
| **Reproduce** | Make every model route unreachable; submit a reminder, a deterministic action and a model-needing request; restore the route. |
| **Check** | Status reports degraded with reason; reminders and deterministic pilots continue; model-needing sorties wait or expire with a visible reason; no local-only request is moved to the cloud; recovery is automatic and recorded. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #72](https://github.com/voidbrain/nerv/pull/72): `src/route-health.ts` keeps each route's state (`ok`, `down`, `off`, `unknown`, since when, the last reason) from every real call in the brain process, and a TCP check of the local route every minute (no request, no model call); only outages count (unreachable, timed out, HTTP 5xx, key refused, rate limited), a bad reply does not. `runtime.ping` carries `routes`; `doctor` and `/api/status` add `routes` and `degraded` reasons; the brief lists them under Health; the service log prints one line when a route goes down and when it comes back (with how long it was down). The dashboard shows *degraded* in the Health tile and the base badge, a Dummy Plug line and one row per route. Reminders and the gate run in the scheduler process and never wait on a model; a model-needing request fails with the route's reason (Aoba: *I could not finish: …*) rather than waiting, so nothing is queued behind an outage; local-only asks never move to the cloud (selectRoute, test/model.test.ts). The cloud route has no active probe (it would spend quota): its state comes from real calls. Checked: test/dummy-plug.test.ts (state changes and reasons; through the brain process: down with reason, reminders still work, Misato fails with the reason, the route recovers on its own after the server returns), full suite 96 pass, headless process test; dashboard screenshot of a service whose local route is a dead port (tile *degraded*, Health *S² local route ✗ down since 22:03*, EVA-02 standby, base badge DEGRADED). Original plan: route health in the F-003 model adapter plus a status field; the A/B/C split already keeps reminders alive.

**Resolution:** Closed 2026-11-04 as Verified. Route health, degraded status in doctor, status, brief and dashboard, and automatic recovery merged in [PR #72](https://github.com/voidbrain/nerv/pull/72); every Check is covered by its automated tests (test/dummy-plug.test.ts through the brain process) and a dashboard check; CI green on the PR and on main (run 41913226560).

**Estimates:** Closed; ~100% complete. Closed 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan); [PR #72](https://github.com/voidbrain/nerv/pull/72) |
| Opened | 2026-11-04 |
| Verification | 2026-11-04: tests and dashboard check (local run); CI green: PR #72, main run 41913226560 |
| Reviewed | 2026-11-04 (closed) |

</details>

---

### F-031

**Dev-server advisories in the Angular build chain**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: the upgrade is merged and its checks passed.

| | |
|---|---|
| **Issue** | `npm audit` reports a high advisory in vite 8.3.0–8.3.2 (dev server: cross-origin script execution, files outside `server.fs.allow`) and a low one in launch-editor, both through `@angular/build` 22.2.4. Dev-only: `serve` ships the built files, not the dev server. |
| **Reproduce** | `npm audit` on main `0ffdfc6`. |
| **Check** | `npm audit` reports no high advisory; typecheck, tests, build and `npm run dev` still work. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #71](https://github.com/voidbrain/nerv/pull/71): `@angular/build` and `@angular/cli` 22.2.3 → 22.2.5 (exact pins), which pull vite 8.3.5; the framework packages are already on their latest patch, 22.2.4. Checked 2026-11-04 on a fresh `npm ci`: `npm audit` finds 0 vulnerabilities; typecheck, `npm test` (94 pass), `npm run build`, and `npm run dev` serving `/` (200 on port 4318). Earlier: found 2026-11-04 while adding the model-route dependency ([PR #11](https://github.com/voidbrain/nerv/pull/11), model routes); kept out of that PR. `npm audit fix --force` proposes `@angular/build` 22.2.5, outside the pinned set: upgrade the Angular packages together in their own PR.

**Resolution:** Closed 2026-11-04 as Verified. `@angular/build` and `@angular/cli` 22.2.5 (vite 8.3.5) merged in [PR #71](https://github.com/voidbrain/nerv/pull/71); `npm audit` reports 0 vulnerabilities; typecheck, tests, build and the dev server checked; CI green on the PR and on main (run 41912152261).

**Estimates:** Closed; ~100% complete. Closed 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | `npm audit` 2026-11-04; [PR #71](https://github.com/voidbrain/nerv/pull/71) |
| Opened | 2026-11-04 |
| Verification | 2026-11-04: audit, typecheck, tests, build and dev server above (local run); CI green: PR #71, main run 41912152261 |
| Reviewed | 2026-11-04 (closed) |

</details>

---

### F-034

**Sign in to the web workspace without pasting the token**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified in daily use and closed.

| | |
|---|---|
| **Issue** | The web page keeps the admin token in tab memory only, so the owner had to paste it after every reload (owner, 2026-11-04). |
| **Reproduce** | Reload http://127.0.0.1:4317: the token form appears. |
| **Check** | `npm start -- open` opens the page signed in; the token never appears in a command line, URL or browser storage; the code is single-use, expires after 60 s and is removed from the address and history; a reused link shows a clear error; read-only and native clients cannot mint codes. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Owner chose the `open` command over storing the token in the browser (2026-11-04), keeping the memory-only rule. Implemented in [PR #31](https://github.com/voidbrain/nerv/pull/31): `POST /api/session/codes` (admin, web server only, 128-bit codes, 60 s, at most 5 unused), `POST /api/session/exchange` (unauthenticated, one use), CLI `open` (`--print` shows the URL instead of opening it), the page reads `#code=`, clears it with `history.replaceState`, exchanges it and keeps the token in memory. Checked: test/session.test.ts (admin-only minting, single use, wrong, expired, limit), the headless process test (CLI `open` against a running `serve`, the URL carries no token, the exchange returns it), and headless Chrome against a temporary service (signed in; the same link again shows the error).

**Resolution:** Closed 2026-11-04 as Verified. The owner signed in with `nerv open dashboard` throughout 4 November (Neo Tokyo-3, after every restart and dashboard PR); the single-use code, its removal from the address and the memory-only token are covered by test/session.test.ts and headless Chrome (CI green: PR #31).

**Estimates:** Closed; ~100% complete. Closed 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #31](https://github.com/voidbrain/nerv/pull/31) |
| Opened | 2026-11-04 |
| Verification | 2026-11-04: unit, headless process and headless Chrome checks (local run; CI green: PR #31); owner use 2026-11-04 |
| Reviewed | 2026-11-04 (closed) |

</details>

---

### F-035

**Base identity per machine and a one-command launch**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified on the second base and closed.

| | |
|---|---|
| **Issue** | The owner installs NERV on a mini PC and names the bases (NERV-01 Neo Tokyo-3, NERV-02 Tabgha, NERV-03 Bethany); there was no setting for it, the dashboard said TOKYO-3, and starting needed serve then open dashboard. |
| **Reproduce** | Install on a second machine; look for its name in the dashboard, doctor and brief. |
| **Check** | `init --base ID --name "Name"` sets it, `base` shows and changes it, keeping other settings; it is validated; doctor/status, the dashboard and the brief show it; `launch` serves and opens the dashboard signed in; INSTALL explains that installations are independent until the Kaji line and that only one may run Aoba per bot. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #41](https://github.com/voidbrain/nerv/pull/41): `config.base {id, name}` (default NERV-01 · Neo Tokyo-3, id in capitals/digits/dashes up to 16, name up to 40), `init --base --name`, `base [ID "Name"]`, `base` in `/api/status` and `/api/doctor`, the live dashboard's base card and map label, the brief title, the serve banner; `launch` (serve + `open dashboard`, `--print` for the link). Checked: test/runtime.test.ts (init flags, show, change keeping other settings, mode 600, validation), test/brief.test.ts (title), headless tests (doctor names the base; `launch --print` prints the banner and a signed-in dashboard link). The Kaji line (F-005/F-006) will use the same identity for the mesh.

**Resolution:** Closed 2026-11-04 as Verified. The owner installed the Windows mini PC as NERV-02 · Tabgha on 4 November, started it with `nerv launch`, and enrolled it on the Kaji line by that identity ([PR #56](https://github.com/voidbrain/nerv/pull/56), [PR #57](https://github.com/voidbrain/nerv/pull/57)); the dashboard, doctor and brief show each base's name (tests and CI green: PR #41).

**Estimates:** Closed; ~100% complete. Closed 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #41](https://github.com/voidbrain/nerv/pull/41) |
| Opened | 2026-11-04 |
| Verification | 2026-11-04: tests (local run; CI green: PR #41); owner install of NERV-02 Tabgha 2026-11-04 |
| Reviewed | 2026-11-04 (closed) |

</details>

---

### F-017

**Per-action MAGI ballot from tool effect classes (Pattern Green / Orange / Blue)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: the per-action gate is verified and closed.

| | |
|---|---|
| **Issue** | Risk was classified once per request (Gendo) before any action existed, and a 3-model vote ran on non-trivial work. Risk belongs to each action; policy and reversibility checks are deterministic. |
| **Reproduce** | Run actions of each effect class (read, local reversible write, external write, irreversible, physical) with trusted and Ireul-tainted context; inspect Pattern, seat verdicts, Sync Ratio and whether the A.T. Field was issued. |
| **Check** | Every tool declares an effect class; Melchior (rules) and Balthasar (reversibility, budget, taint) are deterministic; Casper (intent) is a reasoning-blind model seat only for Orange/Blue; Green read/local work never calls a model reviewer; Blue always reaches Misato's apartment; any reject returns to the planner at most 3 times; the grant is checked on every executor call; ballots are recorded in Central Dogma. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #8](https://github.com/voidbrain/nerv/pull/8) (gate, ledger, approvals): `src/policy.ts` (effect classes, Pattern, EVA class, Melchior/Balthasar, veto-only extra seats, Sync Ratio with inputs) and `Ledger.propose`/`authorize` (single-use grants bound to the argument hash, reject limit escalation). Scrolls in [PR #20](https://github.com/voidbrain/nerv/pull/20): `scrolls.json` in the data home, validated by `validatePolicy`, loaded by the CLI and the scheduler process; missing means the defaults, an invalid or others-writable file stops startup; `doctor` reports the rules and their source. Casper and executors in [PR #21](https://github.com/voidbrain/nerv/pull/21): `src/casper.ts` (reasoning-blind prompt with the request and the exact action, local route only, strict JSON verdict; a failure is no verdict), brain method `casper.verdict`, `Runtime.act` asks it only when `Ledger.preview` is not Green; `src/executors.ts` registers `reminders.list` (read), `reminders.add` and `reminders.cancel` (local writes) with executors in the scheduler process, run by `Store.runAction` right after `authorize` on a grant, or by `Store.decide` after the owner approves (once; a repeat never re-runs); `action.done`/`action.failed` events; owner sorties close when settled; `POST /api/actions` (admin) and CLI `act`; CLI `approve` no longer prints the grant ID. Planner as caller: Misato's loop (F-003, [PR #28](https://github.com/voidbrain/nerv/pull/28)) proposes every action through `Runtime.gate`; a reject returns to it with the reason. Live 2026-11-04: Casper on gemma4:12b via Ollama returned a parseable approve verdict for a Blue reminder, which still went to the owner. Remaining: cite the merged loop PR's green CI to verify. Original plan: effect classes, Scrolls policy pack, Pattern derivation, deterministic seats, Sync Ratio (0–100 % with its inputs), grant issuance with TTL and the executor check. Casper uses the F-003 model route once it exists; until then a Casper verdict is required input and the gate fails closed. Extra veto-only seats and consultants are F-025. Supersedes the request-level Gendo classification of 2026-11-02 ([NERV architecture](NERV/NERV-ARCHITECTURE.md)).

**Resolution:** Closed 2026-11-04 as Verified. Every Check item has dated evidence: deterministic Melchior/Balthasar, Casper only for Orange/Blue (Green never calls a model), Blue always to the owner, rejects back to the planner with escalation, the grant checked on every executor call, ballots in Central Dogma — test/ledger.test.ts, test/gate.test.ts and test/misato.test.ts, green CI on [PR #28](https://github.com/voidbrain/nerv/pull/28) (main run 41815791087), with the planner loop as the caller; Casper ran live on the owner's gemma4:12b (2026-11-04). Later gate work (extra veto-only seats, pilots) is F-025/F-007.

**Estimates:** Closed; ~100% complete. Closed 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan); [PR #8](https://github.com/voidbrain/nerv/pull/8) (gate, ledger, approvals); [PR #20](https://github.com/voidbrain/nerv/pull/20) (scrolls.json); [PR #21](https://github.com/voidbrain/nerv/pull/21) (Casper, executors, act) |
| Opened | 2026-11-02 |
| Verification | Unit/integration 2026-11-04: test/ledger.test.ts covers every Pattern path, veto-only seats, reject escalation, budget, EVA-00 shadow rule and grant binding (local run; CI green: PR #8 run 41749472703, PR #9 run 41749840854, main run 41787648624). Human: pending. 2026-11-04: scrolls.json defaults, load, deny taking effect, report through the scheduler process, invalid/others-writable files refused by the CLI (local run; CI green: PR #20 runs 41807701745 and 41807707642). 2026-11-04: test/gate.test.ts — Casper prompt and strict parsing; Green owner action runs through the grant; failing executor recorded; across HTTP, coordinator, brain (loopback fake S²), scheduler and executor: a Blue action gets Casper's verdict, waits, runs once on approval; an unreadable Casper reply goes to the owner; Green never calls the model (local run; CI green: PR #21 runs 41808770838 and 41808776581) |
| Reviewed | 2026-11-04 (closed) |

</details>

---

---

### F-024

**Central Dogma sortie ledger and Maya trace events**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: the ledger and its versioned event schema are verified and closed.

| | |
|---|---|
| **Issue** | Ballots, approvals and agent steps need an append-only record to debug, audit and display; a separate telemetry schema would drift from the dashboard. |
| **Reproduce** | Run a sortie with several actions including a reject and an approval; read its events back in order; locate the failing step from events alone. |
| **Check** | Sortie and action records with append-only events; every event carries sortie id, step, time and a bounded payload without secrets; read API pages events; the same schema feeds F-019 and later OpenTelemetry export. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Implemented in [PR #8](https://github.com/voidbrain/nerv/pull/8) (gate, ledger, approvals): schema 2 tables (sorties, actions, grants, approvals, events), append-only events enforced by SQLite triggers, paged `Ledger.events`, CLI `events`, one-way migration noted in INSTALL. Paged reads added in [PR #9](https://github.com/voidbrain/nerv/pull/9) (approvals API): `events.page` RPC and `GET /api/sorties/ID/events` (max 50 per page). Payload versioning in [PR #16](https://github.com/voidbrain/nerv/pull/16) (schema 3): `src/events.ts` is the one schema (kinds, typed payloads, `EVENT_SCHEMA_VERSION`=1) for ledger, CLI, REST, RPC and the dashboard; each event stores `v` (schema-2 events read as 1); payloads capped at 16 KB, model verdict reasons at 500 characters, the Spear list at 50 with an exact count; event pages stop at 32 KB of payload, which fixes a page of long-reason ballots overflowing the 64 KB IPC frame (reproduced by the new cross-process test before the fix). The `step` in Check is the action ID: plan steps arrive with the F-017 planner. Event schema 2 in [PR #22](https://github.com/voidbrain/nerv/pull/22): grant events no longer carry the grant ID (the owner's first `act` run on 2026-11-04 showed it in `events`, contradicting the rule that grant IDs never leave the scheduler process; low risk, since grants are single-use, argument-bound, 60 s and no API accepts them), and version 1 rows are redacted on read. Remaining: F-019 consumes this schema, the closing check. Original plan: implement with F-017 in `src/`; OpenTelemetry export later and never blocking M2a. Merged scope with the F-019 decision-event schema on 2026-11-04.

**Resolution:** Closed 2026-11-04 as Verified. Append-only events with sortie id, action id, time, schema version and bounded payloads without grant IDs (schema 2); paged read API; the F-019 live dashboard reads them ([PR #36](https://github.com/voidbrain/nerv/pull/36), main run 41828578832). OpenTelemetry export, which the Check calls later, is not built; it would be its own record.

**Estimates:** Closed; ~100% complete. Closed 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan); [PR #8](https://github.com/voidbrain/nerv/pull/8) (gate, ledger, approvals); [PR #9](https://github.com/voidbrain/nerv/pull/9) (approvals API); [PR #16](https://github.com/voidbrain/nerv/pull/16) (versioned, bounded events); [PR #22](https://github.com/voidbrain/nerv/pull/22) (grant IDs out of events, schema 2) |
| Opened | 2026-11-02 |
| Verification | Unit/integration 2026-11-04: append-only triggers, ordered events per sortie, version-1 migration keeps reminders (local run; CI green: PR #8 run 41749472703, PR #9 run 41749840854, main run 41787648624). 2026-11-04: schema-2 upgrade, version on every event, payload and page bounds, paging through the scheduler process (local run; CI green: PR #16 run 41803859275, main run 41803864471) |
| Reviewed | 2026-11-04 (closed) |

</details>

---

---

### F-001

**Complete harness adoption and propose a reusable Node profile**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: harness adopted with local Node conventions; a reusable Node profile is template work, not this backlog's.

| | |
|---|---|
| **Issue** | The published template has core and Angular but no Node profile. Adoption exists; remote PR/CI evidence is not available. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | All local harness checks pass; a future upstream profile has its own owned PR and fixtures. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Validate the adopted tools, retain local Node conventions and record the missing reusable profile without modifying the upstream template in this bootstrap. All local harness checks pass; a future upstream profile has its own owned PR and fixtures.

**Resolution:** Closed 2026-11-04. Harness v3.1.1 core + Angular adopted; Node conventions kept as project lines in AGENTS.md; `check:harness` reports copied files match the template, and CI runs every harness check green on PR #7–#9 and main. The template has no Node stack; proposing one is a project-harness change and belongs in that repository's backlog (not recorded there as of this date).

**Estimates:** Closed; ~100% complete. Estimated 2026-11-01; closed 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Opened | 2026-11-01 |
| Verification | CI 2026-11-04: validate green on PR #8 run 41749472703, PR #9 run 41749840854, main run 41787648624 (harness, backlog, conventions, maintenance, audits, freshness) |
| Reviewed | 2026-11-04 |

</details>

---

### F-018

**Fixed and JIT counselors/experts (outside council, suggest-only by default)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🔴 Large | ~0% |

💻 **→ Human action required: No**<br />Support fixed local/always-on specialists and just-in-time (cloud, other-machine) experts that live outside the voting council and only suggest unless explicitly given a temporary seat.

| | |
|---|---|
| **Issue** | Specialists are needed without making every task a large multi-model committee. Hiring and authority boundaries are undefined. |
| **Reproduce** | Register a fixed specialist and a JIT expert; run tasks that should and should not hire them; inspect suggestions vs binding votes. |
| **Check** | Expert roster with capability ads, cost, privacy and availability; hiring decision is cheap/rule-based; default mode is suggest-only; structured suggestion payload (proposal, confidence, evidence, cost/risk); temporary vote seat and progressive promotion are explicit and logged; MCP/API tools can appear as experts. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Define counselor/expert registry and hiring policy in the router (Gendo). Core MAGI remains small and authoritative. Fixed and JIT experts default to suggest-only; promotion into stronger roles follows progressive-trust rules (link F-007 / F-025). Remote experts are enrolled workers (F-005/F-006), not permanent council members. Dashboard expert-pool panel reflects real roster state.

**Estimates:** Large remaining effort; ~0% complete. Estimated 2026-11-02.

| Field | Value |
|---|---|
| PR / evidence | Superseded by F-025 (veto-only extra seats and consultants) in [PR #7](https://github.com/voidbrain/nodo/pull/7) (NERV M2a plan); Closed 2026-11-04 |
| Opened | 2026-11-02 |
| Verification | Not applicable: closed unimplemented as superseded |
| Reviewed | 2026-11-04 |

</details>

---

## Closed 2026-11-05

### F-037

**Windows bases: service, CI and configuration checks**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟡 Medium | ~100% |

💻 **→ Human action required: No**<br />None: verified on Tabgha and in Windows CI, and closed.

| | |
|---|---|
| **Issue** | The owner's NERV-02 Tabgha is a Windows 11 mini-PC (owner, 2026-11-04); NERV was built and tested on macOS and Linux. Unix permission checks rejected secret files there, `open` could not start a browser and `service install` refused the platform. |
| **Reproduce** | Install on Windows 11: store telegram-token, run `telegram link`, `launch`, `service install`. |
| **Check** | Private files accepted on Windows (profile ACLs), `open`/`launch` start the browser, `service install` creates and removes the logon task, `nerv` shim works, a Windows CI job runs the suite, doctor lists the S² models the base can use (the owner wants the base's configuration tracked). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Owner test 2026-11-05 on Tabgha (Windows 11): after `git pull; npm ci; npm run build; nerv service install` the service runs (no window) and `nerv open dashboard` opens it. Implemented in [PR #81](https://github.com/voidbrain/nerv/pull/81) (2026-11-05): `service install|status|start|stop|uninstall` on Windows through Task Scheduler. The task (XML, UTF-16) starts at this user's logon with least privilege, no time limit, never a second copy, and restarts a minute after a failure; it runs a hidden VBScript launcher in the data home that sets `NERV_HOME`, starts `serve` with every Node flag and appends to `service.log`/`service-error.log`, returning serve's exit code. `stop` and `uninstall` first ask the running NERV to stop as Ctrl+C would (`POST /api/stop`, admin token only, never a dashboard session) because ending the task alone leaves Node running. `doctor` lists the models the base can use (`localModels`, from Ollama). A Windows CI job runs typecheck, build, the suite and test/windows-service.integration.ts (real `schtasks` install, status, stop, uninstall). The suite's Unix-only checks (file modes, refusing a readable file) run only where Unix modes exist (`test/fixtures/posix.ts`); the rename test sets USERPROFILE. Two timing-sensitive tests made robust on the way (idle consolidation waits until it happened; the ask test counts model calls, not doctor's model list). Live 2026-11-04 (evening): Tabgha runs `nerv launch` with its own bot (@…intercomm_bot) linked. On the way: `nerv` not found in a new PowerShell (fixed by `npm link`), EADDRINUSE from an older NERV still running (stopped by its PID), CRLF conversion blocking `git pull` (#60), and `telegram link` finding no `/start` although one was waiting; [PR #61](https://github.com/voidbrain/nerv/pull/61) makes it say why (webhook, nothing waiting, other updates) and report an existing link. On Tabgha `git pull` was blocked by `src/cli.ts` showing as changed ("LF will be replaced by CRLF"): Git's Windows line-ending conversion. Fixed for every clone in [PR #60](https://github.com/voidbrain/nerv/pull/60) with `.gitattributes` (`* text=auto eol=lf`, images and SQLite binary); all files were already LF, so no content changes. Owner's live install on Tabgha (Windows 11), 2026-11-04: the service is up. The missing-token message pointed at "(INSTALL, \"Telegram\")", which the owner typed as a command; storing the token needed a shell trick. Fixed in [PR #54](https://github.com/voidbrain/nerv/pull/54): `nerv telegram token` asks for the token without showing it, checks its format and saves it privately on any OS; missing-token and model-route messages name the real path or command and docs/INSTALL.md. Basics in [PR #43](https://github.com/voidbrain/nerv/pull/43): `privateEnough` skips the Unix bit check on win32, `open` uses `cmd /c start`, `service install` prints the exact `schtasks` command with the shared Node flags. Checked by unit tests (permission rule per platform, task command); no Windows machine in CI yet, so live Windows checks are pending the owner's install.

**Resolution:** Closed 2026-11-05 as Verified. Private files on profile ACLs, `open`/`launch`, the `nerv` shim, `service install|status|start|stop|uninstall` through Task Scheduler, a Windows CI job (suite and a real install, start, stop and uninstall) and doctor's local models, merged in [PR #81](https://github.com/voidbrain/nerv/pull/81) (CI green on the PR and on main, run 41939063858, windows job included), and the owner's install on Tabgha.

**Estimates:** Closed; ~100% complete. Closed 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | [PR #43](https://github.com/voidbrain/nerv/pull/43); [PR #81](https://github.com/voidbrain/nerv/pull/81) |
| Opened | 2026-11-04 |
| Verification | 2026-11-05: Windows CI (suite and test/windows-service.integration.ts), main run 41939063858; owner install on Tabgha 2026-11-05 |
| Reviewed | 2026-11-05 (closed) |

</details>

---

### F-022

**Lilith memory: facts and pilots in Terminal Dogma, LCL assembly and Instrumentality consolidation**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟡 Medium | ~100% |

💻 **→ Human action required: No**<br />None: verified and closed; facts written without a card by a Production pilot belong to the pilot trust stages (F-025).

| | |
|---|---|
| **Issue** | Durable SQLite state exists; there is no memory of facts about the owner, no recall and no context budget for model calls. |
| **Reproduce** | Accumulate multi-day history; ask something that needs an earlier fact; propose a new fact from a conversation; edit and forget a fact. |
| **Check** | Facts carry provenance and taint marks; recall uses FTS5 over facts and recent Central Dogma episodes; the LCL is trimmed to the battery budget; agent-proposed facts are held until the owner confirms (or a Production pilot writes them); edit/forget keeps a provenance trail; local-only facts never reach the Umbilical route; nightly Instrumentality consolidation writes summaries without deleting the ledger. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** In [PR #82](https://github.com/voidbrain/nerv/pull/82) (2026-11-05): **summaries in recall**: `episodes_fts` (FTS5 over Instrumentality's summaries, indexed on save, older ones backfilled once on open) and `Memory.recallEpisodes`; `memory.recall` returns up to two matching summaries after the facts, marked `summary` and local-only. **LCL budget**: `fillLcl` fills Misato's memory (facts in recall order, then summaries, up to 40%) and the newest exchanges within `LCL_CHARS` (6000 local, 3000 on the paid cloud route), whole items only; on the cloud route only shareable facts and never a summary. **Bundled card**: Telegram sends the fact cards of one sortie as one message with a ✅/❌ row each, after `BUNDLE_WAIT_MS` (3 s) without a new one; a tap decides that fact and keeps the other rows; pending cards are read up to 20 (`approvals.pending`, `/api/approvals?limit`, the dashboard). Checked: test/lcl.test.ts (recall and backfill; the budget, order and cloud filter; recall through the scheduler process), test/telegram.test.ts (one message for three facts, a tap stores only that fact and keeps the other two rows), suite 114 pass. Lilith panel and shareable marking in [PR #47](https://github.com/voidbrain/nerv/pull/47): admin-only `GET/POST /api/memory`, `PUT /api/memory/ID`, `POST /api/memory/ID/forget`, `POST /api/memory/ID/share`, `GET /api/memory/ID/history`, `GET /api/memory/episodes` (through the scheduler process, source owner; read-only clients get none); `Memory.share` with a `shared`/`local-only` history entry; the dashboard's Terminal Dogma · Lilith panel (live: facts with Edit/Forget/Share, history, add box keeping its draft across redraws, recent summaries; simulation: invented facts). Checked: test/dashboard.test.ts (API across processes: 401, validation, edit, share, history, forget, 404) and headless Chrome (panel, facts and buttons rendered). Owner requests 2026-11-04 in [PR #45](https://github.com/voidbrain/nerv/pull/45): Instrumentality `{"when":"idle"}` (an hour without requests, at most once in 20 hours, only with new exchanges) besides `{"at"}`; the fact limit scales with the day (`factLimit`: about one per two exchanges, 3–10) instead of a fixed 5; a bundled card with a ✅/❌ per fact is the better way to allow more. Instrumentality in [PR #44](https://github.com/voidbrain/nerv/pull/44): `src/instrumentality.ts` (digest prompt: summary in the configured language, up to 5 lasting facts the owner stated, never inferred, never one-off tasks; strict parsing tolerating a trailing comma), brain method `instrumentality.digest` on Misato's route, `Runtime.consolidate` (exchanges since the last episode → summary kept in `episodes` → new facts proposed as `memory.remember` cards in an `instrumentality` sortie, Casper not asked, closed when every card is decided; facts already active or waiting on a card skipped by `factKey`; one retry of an unreadable digest), `config.instrumentality.at` with one attempt per local day, `POST /api/memory/consolidate`, `nerv instrumentality`, `nerv memory episodes`. Live on the owner's Ollama (temporary data home, Italian): 3 exchanges → Italian summary, 2 facts proposed, the coffee fact skipped because Misato's card was already waiting. Found in that run: Misato misspelled a tool (`memore.remember`), which reached the owner as a Blue card for a tool that cannot run; unknown tools now go back to Misato as invalid. The digest is sometimes unreadable or includes one-off tasks (qwen2.5-coder); the owner's card decision is the safeguard. Slice 1 in [PR #40](https://github.com/voidbrain/nerv/pull/40): schema 4 (`facts`, append-only `fact_history`, FTS5 `facts_fts`), `src/memory.ts` (add with duplicate merge, edit, forget, list, BM25 recall with quoted words, history), tools `memory.recall` (read), `memory.remember` (owner tool: always Pattern Blue, so a fact is stored only after the owner approves its card; provenance = Misato + sortie) and `memory.forget`; LCL fill: the coordinator offers up to 5 matching facts with each request, local-only facts dropped on the cloud route, tainted facts marked; `nerv memory list|add|edit|forget|history` (owner facts active at once). Checked: test/memory.test.ts (store, hostile FTS input, append-only history, owner-only Pattern, provenance, cloud filtering, propose → approve → recall across processes and conversations, CLI) and a live run on the owner's Ollama (temporary data home): "Ricordati che il mio dentista è il dottor Rossi a Treviso" → card → approved → "Chi è il mio dentista?" in another conversation answered from memory. Model limit: the first reply said "Ho annotato" while the card was still waiting. Not yet: the battery-budgeted LCL beyond 5 facts, Instrumentality, shareable marking, a UI panel. Original plan: schema and FTS5 recall in `src/`, then LCL assembly used by the F-003 agent loop. Vector search only if FTS5 recall proves weak on the F-029 eval set.

**Resolution:** Closed 2026-11-05 as Verified. Facts with provenance and taint, owner-confirmed cards, edit/forget history, local-only facts kept from the cloud, Instrumentality summaries, recall over facts and summaries, the LCL budget and bundled cards are all in place and tested ([PR #82](https://github.com/voidbrain/nerv/pull/82), CI green on the PR and on main, run 41979532101). The Check's clause "or a Production pilot writes them" needs pilots with trust stages, which F-025 owns.

**Estimates:** Closed; ~100% complete. Closed 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan); [PR #40](https://github.com/voidbrain/nerv/pull/40) (slice 1); [PR #44](https://github.com/voidbrain/nerv/pull/44) (Instrumentality); [PR #47](https://github.com/voidbrain/nerv/pull/47) (Lilith panel, shareable) |
| Opened | 2026-11-02 |
| Verification | 2026-11-05: test/lcl.test.ts and test/telegram.test.ts (local run); CI green: PR #82, main run 41979532101 |
| Reviewed | 2026-11-05 (closed) |

</details>

---

### F-038

**Set up model routes from the CLI, the install and the dashboard, finding Ollama and its models**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟡 Medium | ~100% |

💻 **→ Human action required: No**<br />None: verified by the owner on Tabgha and Neo Tokyo-3 and closed.

| | |
|---|---|
| **Issue** | Owner report 2026-11-04: Tabgha shows DEGRADED with "Misato not set · Casper local route not configured" because it has no model routes, and the only way to set them is editing config.json by hand. The owner asks for a way from the CLI and the dashboard, as a step of a base's installation, for local models and APIs, finding Ollama on its default port and listing the models it has. |
| **Reproduce** | Install a new base (Tabgha) with Ollama running; open its dashboard: degraded, no route; nothing offers the installed models. |
| **Check** | `nerv models` (and `init`) probe `http://127.0.0.1:11434` and list the installed models (Ollama `/api/tags`), let the owner pick Misato's and Casper's, write `models` in config.json and reload without a restart; the dashboard shows the routes and, for the admin, the same choice; the cloud route is enabled with its model while the key is only ever entered in a terminal prompt or file, never in the browser, a command line or config; a probe that finds nothing says how to install or start Ollama; validation is the same as config.json's. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Owner test 2026-11-05: on Tabgha, `nerv models set misato MODEL` with an empty Ollama said *Installed: none*; after `ollama pull`, the dashboard's Models panel applied *Misato local (gemma4:12b) · Casper local (gemma4:12b)*, Tabgha came ONLINE, and a reminder went through card, approval, run and delivery. Follow-ups fixed in [PR #79](https://github.com/voidbrain/nerv/pull/79): an empty Ollama now says which model to pull; *The NERV service is not running … Start it with: nerv launch*; Casper's options say *(local)* like Misato's. Implemented in [PR #78](https://github.com/voidbrain/nerv/pull/78), all three slices: `src/model-setup.ts` (`detectOllama` reads `/api/tags`; `planModels` changes roles and the cloud route through `validateModels` before anything is written and refuses a local model Ollama does not list, Misato on the cloud without the route on, or the route off under Misato; `setupAtInit`; `effectiveRoles`, `modelsReport`); CLI `models`, `models set misato|casper …`, `models cloud on|off`, `models key` (hidden prompt, `anthropic-key` 0600); `init` puts both roles on Ollama's largest model when nothing is set (`NERV_OLLAMA` overrides the address); `GET`/`PUT /api/models` (admin or a dashboard session; the key is never accepted or returned, only whether it is saved) reload the brain in place; the dashboard's Models panel picks each role from Ollama's list, keeps an unapplied choice across refreshes, and turns the cloud route on or off. Checked: test/model-setup.test.ts (detection, planning and refusals, init, the CLI with a fake Ollama, the API through the brain process: roles switch without a restart), suite 107 pass, headless 3 pass; headless Chrome against a throwaway service on the real Ollama: the panel listed its three models, a Casper change survived a refresh and Apply wrote config.json and switched the running brain. Owner decision 2026-11-04: a cloud API key is entered only at a hidden terminal prompt (`nerv models key`) and written straight to its private file; the dashboard can turn the cloud route on and pick its model but never takes the key. Planned 2026-11-04 (owner request). Slices: (1) `nerv models` with Ollama detection and model choice for Misato and Casper, reload in place; (2) a step in `init` and in INSTALL for a new base; (3) a dashboard Models panel (admin) with the detected models and the cloud route's state. Related: F-037 asks doctor to list a base's local models (Windows), and F-030 reports a route that is down.

**Resolution:** Closed 2026-11-05 as Verified. Model setup from the CLI, `init` and the dashboard ([PR #78](https://github.com/voidbrain/nerv/pull/78), CI green on the PR and on main, run 41927867065), checked by the owner on both bases; the wording follow-ups are in [PR #79](https://github.com/voidbrain/nerv/pull/79).

**Estimates:** Closed; ~100% complete. Closed 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-04; [PR #78](https://github.com/voidbrain/nerv/pull/78) |
| Opened | 2026-11-04 |
| Verification | 2026-11-04: tests and browser check (local run); CI green: PR #78, main run 41927867065; owner test on Tabgha and Neo Tokyo-3 2026-11-05 |
| Reviewed | 2026-11-05 (closed) |

</details>

---

### F-028

**Debrief digest: what happened while you were away**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by the merged PR's green CI and closed.

| | |
|---|---|
| **Issue** | Autonomy is only trustable if the owner can see what was done; a raw event log is not a summary. |
| **Reproduce** | Run several sorties, approvals and a failure; request the digest; request it again. |
| **Check** | Digest lists completed, failed, waiting and expired items with links to their traces; built from ledger data, not model memory; a repeat request shows only new items; delivered through the inbox. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: every acceptance check is automated and passed in the merged [PR #89](https://github.com/voidbrain/nerv/pull/89)'s CI (https://github.com/voidbrain/nerv/actions/runs/41988197043: validate, native-macos, windows). The optional owner check on the bases stays a check, not a condition. Inbox delivery in [PR #89](https://github.com/voidbrain/nerv/pull/89) (2026-11-05): schema 5 rebuilds `deliveries` once with a `kind` column and an optional reminder, keeping every rowid (the inbox cursors of Telegram and the menu-bar app); `Store.addBrief`/`lastBrief`, scheduler calls `inbox.brief` and `inbox.lastBrief`; `Runtime.startBrief` writes the brief into the inbox once a local day at its time, with or without Telegram (the schedule is read every minute; the brief Telegram sent the old way is read once so the upgrade day gets no second one); Telegram no longer sends a brief of its own and delivers inbox briefs without the reminder mark; the dashboard counts only reminders as delivered and shows the latest brief under Debrief. Checked: test/ledger.test.ts (schema 4 → 5 keeps rows and rowids, an old cursor stays valid, briefs and reminders both go in), test/telegram.test.ts (the brief goes into the inbox once a day, Telegram delivers it once, also across a restart of both; on the upgrade day a brief already sent is not repeated), headless Chrome (the brief under Debrief). In [PR #80](https://github.com/voidbrain/nerv/pull/80) (2026-11-05): the brief lists approvals that expired without a decision since the previous brief (nothing ran), and every item (waiting card, expired approval, failed sortie) carries its sortie's short ID, the one the dashboard shows (`sortieRef`, coupled with live.js `short()` in .harness.json and asserted by test/brief.test.ts); `approvals.expired` reads them through the scheduler process. Checked: test/brief.test.ts (layout and both languages; through the scheduler process, an approval expired since the last brief appears with its sortie). Remaining: delivery through the inbox as well as Telegram, which needs the deliveries table to hold more than reminders (a schema migration) and Telegram to stop sending the brief directly; owner decision 2026-11-05: yes, after F-036's dispatch slice (the deliveries table holds briefs as well as reminders, Telegram sends the brief from the inbox so it is never sent twice, and the menu-bar app and dashboard get it too). Reviewed 2026-11-04: most of this exists. Hyuga's daily brief (F-003, src/brief.ts) is built from the ledger, not a model, and lists waiting cards, done and failed sorties since the previous brief and health; the dashboard's Debrief panel lists what ended since your last visit with links to each trace. Remaining for this Check: expired approvals in the brief, a trace reference per item (the sortie's short ID), and delivery through the inbox as well as Telegram. Small; next time the brief is touched. Original plan: ledger query plus a deterministic template after F-024; an optional model summary later must cite ledger entries.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | 2026-11-05: merged PR CI https://github.com/voidbrain/nerv/actions/runs/41988197043 |
| Reviewed | 2026-11-04 |

</details>

---
### F-040

**Misato never runs an approved action twice, and reports what ran instead of "could not finish"**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by the merged PR's green CI and closed.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05: after approving a card made on Tabgha (small model), the follow-up relayed through Aoba was *I could not finish: Step limit (6) reached*, although the fact was stored. Resumed after the decision (F-033, archived in docs/archive/backlog-2026.md), the small model kept proposing the action that had just run until the step limit. |
| **Reproduce** | A Misato loop whose model proposes the same action again after it ran, directly or after an approval. |
| **Check** | An action identical (tool and arguments) to one that already ran in the sortie is never run again: the turn ends with the service's *Done: …* in the request's language; at the step limit, actions that ran are reported as done instead of *could not finish*; nothing ran → still *Step limit*. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: every acceptance check is automated and passed in the merged [PR #88](https://github.com/voidbrain/nerv/pull/88)'s CI (https://github.com/voidbrain/nerv/actions/runs/41983067223: validate, native-macos, windows). The optional owner check on the bases stays a check, not a condition. Implemented in [PR #88](https://github.com/voidbrain/nerv/pull/88): the planner loop stops on a repeat of an action that already ran (`argsHash` of tool and arguments against the sortie's granted steps) with `doneReply`, and at the step limit reports what ran (`doneReply`) when anything did. Checked: test/misato.test.ts (a repeat ends with *Done: reminders.add (“Stretch”)* and runs once; at the limit after a list, *Fatto: reminders.list.*; nothing ran, still *Step limit*), test/resume.test.ts (after an approval, a re-proposed action is not run again and the follow-up says it is done), suite 120 pass.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-05; [PR #88](https://github.com/voidbrain/nerv/pull/88) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: merged PR CI https://github.com/voidbrain/nerv/actions/runs/41983067223 |
| Reviewed | 2026-11-05 |

</details>

---

### B-001

**Windows CI: a test file with two bases never exits, holding the PR for hours**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: the windows job finishes in minutes on the PRs and on main; closed.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05: the windows job ran for an hour (and the main run for #90 over three). Its log: both tests of test/kaji-run.test.ts passed within seconds, then the file ran 11,931 s and was cancelled: something kept its process alive after the tests. The Kaji link's requests used fetch with its keep-alive pool, so idle connections between the two test bases (and to the fake model) stayed open; on Windows they held the process. The same would hold a service shutdown. |
| **Reproduce** | The windows CI job on main since #90 (runs 41989325553 and later): `npm test` never finishes. |
| **Check** | test/kaji-run.test.ts and test/kaji-seats.test.ts finish on Windows; the windows job completes in minutes; no CI job can run past its time limit. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: the windows job passed in under 2 minutes on #95 and #96 (runs 42016782570, 42018792543) and on main after #95 (42017118895) and after #96 (42019073784, whose first attempt failed three timing tests that time, now B-007, and passed on rerun); no job ran past its limit. Second cause found 2026-11-05 after #95: the full suite still hung now and then locally in test/kaji-run.test.ts (both tests passed, the process never exited; alone it finishes in under a second). A heartbeat tick under way when `KajiLink.stop()` ran, still looking up this base's address, then opened a new listener (and `start()` could set its timer) after the stop, which nothing closed. Fixed in [PR #96](https://github.com/voidbrain/nerv/pull/96): the link remembers it was stopped and a late tick opens nothing; test/kaji-link.test.ts reproduces the race (fails without the fix). Checked: three full local suite runs in 17–20 s, 130 pass, no hang. Fixed in [PR #95](https://github.com/voidbrain/nerv/pull/95): the Kaji link sends each request with `node:http` and no connection pool (`agent:false`), so the connection closes when the answer is in (errors keep fetch's shape, so "never sent" and "may have arrived" stay distinguishable); the test fakes close their open connections too (after the `KajiLink.stop()` fix in [PR #92](https://github.com/voidbrain/nerv/pull/92)); every CI job has a time limit (validate 20, windows 25, native-macos 30 minutes). Checked locally: suite 129 pass in 12 s; the windows job result on #95 closes it.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | CI runs 41989325553, 42000654005, 42001015693; [PR #95](https://github.com/voidbrain/nerv/pull/95) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: CI runs 42016782570, 42018792543, 42017118895, 42019073784 |
| Reviewed | 2026-11-05 |

</details>

---

### F-032

**Rename Nodo to NERV Agency**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: closed by the owner without the hand-over check.

| | |
|---|---|
| **Issue** | The product is now NERV Agency, with `nerv` as the short identifier. Existing installs must keep working without a manual move. |
| **Reproduce** | On a Mac with a pre-rename install (`~/.nodo`, `io.nodo.agent`, a paired menu-bar app): update, run `doctor`, `service install`, open `NERV.app`. |
| **Check** | Data and database are found in `~/.nodo` until moved; `NODO_*` still read; `service install` replaces the old unit with no second scheduler; the menu-bar pairing survives the first launch; the knot logo is replaced (owner choice 2026-11-04). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05 by owner decision ("close F-032. no need to test"): the Keychain and LaunchAgent hand-over on a Mac with a pre-rename install was not checked by hand and is waived; the automated checks below stand. Implemented in [PR #14](https://github.com/voidbrain/nerv/pull/14) (rename): visible names say NERV Agency; identifiers use `nerv` (`~/.nerv`, `nerv.sqlite`, `NERV_*`, `io.nerv.agent`, `nerv.service`, `io.nerv.companion`, `NERV.app`, `NervMenuBar`, `nerv-status-card`, package `nerv-agency`, Angular project `nerv`). Compatibility: `~/.nodo` and `nodo.sqlite` used while they are the only ones present, `NODO_*` fallback, `service install` replaces the old unit, service actions find the old unit until then, Keychain item and notification checkpoints move on first launch. Unchanged on purpose: dated archives, audits and reviews; the knot logo (it is the Nodo pun), until the owner chose a replacement. Repository: the owner renamed it to `voidbrain/nerv` on 2026-11-04; the AGENTS.md repository line and current backlog links follow, dated archives and audits keep the old links (GitHub redirects them). PR #14 CI green (PR run 41798137617, main run 41798326299, read through the GitHub REST API because `gh` is not installed). The owner's 2026-11-04 setup was a fresh `init` (no `~/.nodo` present), so it does not exercise the hand-over. Logo: the owner chose original marks on 2026-11-04 ([PR #19](https://github.com/voidbrain/nerv/pull/19)): an inverted triangle with seven eyes (`web/public/mark.svg`, browser icon and native menu drawing) and a half leaf beside it in the web sidebar (`web/public/brand.svg`), in dark NERV red `--mark` #d4002a (3.15:1 on `--bg`); evocations, not the Evangelion artwork; test/brand.test.ts keeps the three drawings and the colour equal. Leftover copy fixed ("local Nodo", "One knot"). Remaining: a real-Mac check of the hand-over, and a browser look at the sidebar mark.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | [PR #14](https://github.com/voidbrain/nerv/pull/14) (rename); [PR #15](https://github.com/voidbrain/nerv/pull/15) (repository moved to `voidbrain/nerv`); [PR #19](https://github.com/voidbrain/nerv/pull/19) (seven-eye and half-leaf marks) |
| Opened | 2026-11-04 |
| Verification | Unit/integration 2026-11-04: rename fallbacks test (home, database, settings), service render asserts, Swift label fallback and Keychain code path, headless process tests, app bundle id and display name (local run; CI green: PR #14 run 41798137617, main run 41798326299; PR #15 run 41801930445, main run 41802018182). 2026-11-04 marks: geometry and colour coupling test, build, Swift tests, app packaging, native drawing rendered to PNG and inspected (local run; CI green: PR #19 run 41806657948, main run 41806668424). Real-Mac hand-over: pending |
| Reviewed | 2026-11-05 |

</details>

---
