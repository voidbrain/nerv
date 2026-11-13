# Backlog archive 2026

Closed records in closing-date order. Dated evidence, not current status.

**2026-11-06 source-path note:** The canonical architecture moved to [docs/NERV-ARCHITECTURE.md](../NERV-ARCHITECTURE.md); the dated review is preserved in [audits](../audits/2026-11-04-rebrand-review.md). Historical docs/NERV references remain evidence of the [pinned source snapshot](https://github.com/voidbrain/nerv/tree/7c0b61964a1827681f83c10dd36c762b525a1911/docs/NERV); see the [retirement mapping](../audits/2026-11-06-brainstorm-retirement.md). Original archived record lines are unchanged.

<!-- archive-recap:start -->
## Weekly closure recaps

Closed records in this archive, grouped by closing date (Monday–Sunday). Links open the first section for that week; current status stays in the active backlog.

| Closing week | Features closed | Bugs closed |
|---|---:|---:|
| [2026-11-09 – 2026-11-15](#archive-week-2026-11-09) | 10 | 12 |
| [2026-11-02 – 2026-11-08](#archive-week-2026-11-02) | 41 | 42 |
<!-- archive-recap:end -->

<a id="archive-week-2026-11-02"></a>
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

### F-041

**Consultants by topic, offered by any base (the 3D expert on Tabgha)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟡 Medium | ~0% |

💻 **→ Human action required: No**<br />None: superseded by F-045 and closed.

| | |
|---|---|
| **Issue** | Owner request 2026-11-05: a base (Tabgha) has a 3D expert others should use when it fits; today the only consultant is one general local model on the main base (F-025). |
| **Reproduce** | Offer a consultant on Tabgha for 3D printing; ask Aoba a 3D printing question; look for its advice in Comms. |
| **Check** | A consultant declares a name, topics and keywords and its model, on any base; bases offer theirs first-hand in the heartbeat and the main base keeps a catalogue; a request matching a topic's keywords brings in that topic's consultant, the general consultant stays the default when none matches; at most one consultant per topic is asked by default, chosen by the owner's pin, else the main base's own, else the best record (answered in time, gave advice), with the next one as fallback when it does not answer; "ask both" per topic gives Misato every advice, each labelled with its source; Comms shows which consultant advised and from which base; advice stays data, never a vote or an action, and local-only rules hold (a peer consultant sees only what the Scrolls allow to leave the main base). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05, superseded by [F-045](../BACKLOG.md#f-045) (owner, 2026-11-05: consultants become pilots asked only for advice); its rules are kept there. Nothing was implemented here. Planned 2026-11-05 (owner decisions above). Builds on the local consultant (F-025, [PR #92](https://github.com/voidbrain/nerv/pull/92)) and the Kaji line's offers (F-036). Later: experts that also act (their actions offered as in F-036 slice 3b) and agents running on the offering base.

**Estimates:** No remaining effort here (superseded); ~0% implemented. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner request 2026-11-05 |
| Opened | 2026-11-05 |
| Verification | Pending |
| Reviewed | 2026-11-05 |

</details>

---

### B-007

**A first call to a starting child process can time out on a slow machine**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by CI and closed.

| | |
|---|---|
| **Issue** | Found 2026-11-05: the windows job on main after #96 (run 42019073784) failed three tests that call the brain process right after starting it (test/misato.test.ts, test/model-setup.test.ts, test/model.test.ts), each with "Request timed out; outcome may be unknown" after about 5 s; a rerun of the same commit passed. `ProcessClient` starts a call's timer when it sends, so the child's own start-up (node, type stripping, loading modules) counts against the call. On a busy or slow machine (the Windows runner, the Tabgha mini PC right after boot) the first requests after a start can fail the same way. |
| **Reproduce** | Run the suite on the windows runner a few times; or start a Runtime with the CPU busy and call the brain at once. |
| **Check** | A child process says when it is ready; calls wait for that (with their own start-up limit, reported as "brain process not ready" if it passes) and only then start their timer; a test with a child that is slow to start passes; the windows job passes repeatedly. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: the windows job passed on [PR #100](https://github.com/voidbrain/nerv/pull/100) (runs 42026911418, 42026903748) and on main after it (42027212041) and after #101 (42028614954). Fixed in [PR #100](https://github.com/voidbrain/nerv/pull/100): each child process sends READY (`rpc.ts`) once it handles requests; `ProcessClient.call` sends nothing before it and starts the call's timer only then; a child that is not ready within 30 s fails the call as "not ready; nothing was sent" (a known outcome, unlike a timeout). The stand-in busy brain of test/isolation.test.ts says READY too. Checked: test/process-client.test.ts (a child slow to start answers a call with a timeout four times shorter than its start-up; a child that never says ready fails the call with nothing sent; the real brain says ready), both fail without the fix; full suite 134 pass in 13 s. Found 2026-11-05.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | CI run 42019073784 (failed, then passed on rerun); [PR #100](https://github.com/voidbrain/nerv/pull/100) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: CI runs 42026911418, 42027212041, 42028614954 |
| Reviewed | 2026-11-05 |

</details>

---
### B-004

**"Why was S-… approved?" gets an invented answer**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟡 Medium | ~100% |

💻 **→ Human action required: No**<br />None: verified by CI and closed.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05: asked "why S-D263 approved?", Misato answered in Italian with made-up lore ("Sync Ratio 100%") instead of the ballot that approved it. Misato has no tool to read a sortie's record, so it guessed. |
| **Reproduce** | `nerv chat "why S-D263 approved?"` (any existing sortie ID). |
| **Check** | A "why" question about a sortie is answered from its record (the same explanation the dashboard's "why" line uses, src/why.ts): the decision, the ballot (each seat and its vote), any peer seats and consultant advice, who approved and when, in the request's language; an unknown ID says so; nothing is invented. The wider ability to read the agency is F-042. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: every acceptance check is automated and passed in the merged [PR #101](https://github.com/voidbrain/nerv/pull/101)'s CI (42028274531) and on main (42028614954). The owner's look on Aoba stays optional, not a condition. Fixed in [PR #101](https://github.com/voidbrain/nerv/pull/101): a question with why / how come / explain / perché / come mai / spiega and a short sortie ID (`S-1A2B`) is answered from the ledger (`sorties.explain` in the scheduler, `explainRecord` in src/why.ts), never by the model: the sortie and its status, the consultant's advice if any, then each action with its Pattern and outcome, every seat's vote and reason (shadow seats marked as not counted), the owner's decision with when and where (or that it waits or expired), and whether it ran or failed; in the request's language; an unknown or ambiguous ID says so. The question is its own sortie, like any request. Checked: test/resume.test.ts (through every process: approved on Telegram, then asked in English and Italian, and an unknown ID; the model is not asked), test/why.test.ts (the question words in both languages, shadow seats, waiting, expired, failed, an ambiguous ID); full suite and build pass. Reported 2026-11-05.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-05; [PR #101](https://github.com/voidbrain/nerv/pull/101) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: merged PR CI 42028274531, main 42028614954 |
| Reviewed | 2026-11-05 |

</details>

---

### B-006

**The brief says "All checks pass" when it could not read health**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by CI and closed.

| | |
|---|---|
| **Issue** | Found 2026-11-05 reviewing the brief against Anthropic's automation guidance (a source that failed is not "nothing new"): `gatherBrief` (src/brief.ts) turns a failed health read into an empty report, which the brief prints as "All checks pass", and a failed read of expired approvals into none. It also counts only the latest 50 sorties, so a busy day is undercounted. |
| **Reproduce** | Make `store.health()` throw in a test of `gatherBrief`; the brief reads "Health: All checks pass." |
| **Check** | A source the brief could not read is named ("health unavailable for this brief") and never shown as fine or empty; sorties since the previous brief are all counted; tests cover a failed health read, a failed expired read and more than 50 sorties. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: every acceptance check is automated and passed in the merged [PR #102](https://github.com/voidbrain/nerv/pull/102)'s CI (42028753538) and on main (42029095302). Fixed in [PR #102](https://github.com/voidbrain/nerv/pull/102): `gatherBrief` reads each source on its own; one that fails is listed in `unavailable` and the brief prints *could not be read for this brief* (Italian: *non leggibile per questo brief*) in that part, never *nothing* or *all checks pass*; a failed read no longer throws out of the brief's timer. Sorties closed since the previous brief are counted by the scheduler (`sorties.closedSince`: done and failed counts and the latest five failures), not taken from the newest 50. Checked: test/brief.test.ts (approvals, health and expired unreadable: named in English and Italian, the rest still written; through the scheduler process 62 closed sorties counted as 59 done and 3 failed), both fail without the fix; full suite 136 pass, build, headless. INSTALL notes the behaviour. Found 2026-11-05.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Code review 2026-11-05 (src/brief.ts); [PR #102](https://github.com/voidbrain/nerv/pull/102) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: merged PR CI 42028753538, main 42029095302 |
| Reviewed | 2026-11-05 |

</details>

---
### B-003

**The same reminder appears twice in Coming up**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by CI and closed.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05: "Chiamare il dentista" is shown twice, identical, under Coming up. |
| **Reproduce** | Look at Coming up on the owner's base; `nerv reminders list` shows whether there are one or two records. |
| **Check** | One stored reminder is listed once; asking for a reminder with the same title and time as a pending one says it already exists instead of adding a second; a test covers both. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: every acceptance check is automated and passed in the merged [PR #103](https://github.com/voidbrain/nerv/pull/103)'s CI (42028610938) and on main (42029169512). The two reminders stored before the fix stay until the owner cancels one. Cause found 2026-11-05 (read-only look at the owner's ledger): two reminders were stored, not one listed twice. The same request was sent four times within 16 minutes on 4 November, each its own sortie, and two were approved, so two identical reminders were added; nothing checked for a pending one. (The year 2030 was in the request itself, a test date, not misread.) Fixed in [PR #103](https://github.com/voidbrain/nerv/pull/103): adding a reminder with the same title (ignoring case and outer spaces) and the same moment as a pending one returns that one, marked `existing`, and the action's result tells Misato it already existed; a cancelled or delivered one does not count; another time is another reminder. Checked: test/core.test.ts (the store; through the scheduler process the same action twice adds one), both fail without the fix; full suite 136 pass, build, headless. Reported 2026-11-05. Not yet known whether two requests each added one (Telegram and dashboard, or a retry) or the list repeats a record.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-05; [PR #103](https://github.com/voidbrain/nerv/pull/103) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: merged PR CI 42028610938, main 42029169512 |
| Reviewed | 2026-11-05 |

</details>

---
### B-005

**The chat placeholder suggests a command that gives a vague answer**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by CI and closed.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05: the chat field suggests "status"; on the live base it gives a vague reply, because the examples were written for the simulation. |
| **Reproduce** | Type "status" in the live dashboard chat. |
| **Check** | Every example in the placeholder gives a useful answer on a live base; "status" answers with this base's health, the cards waiting and the next reminder (or the placeholder stops suggesting it). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: its check is automated and passed in the merged [PR #104](https://github.com/voidbrain/nerv/pull/104)'s CI (42029130633). Fixed in [PR #104](https://github.com/voidbrain/nerv/pull/104): in live mode the chat placeholder says *Ask Misato: remind me to … at … · why S-1A2B? · what are my reminders?* (each answered on a live base: a request, the ledger answer of B-004, a reminders.list); the simulation keeps its demo commands. A real "status" answer is F-042. Checked: test/dashboard.test.ts (the live hint names no demo-only command and is set when live mode starts). Reported 2026-11-05.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-05; [PR #104](https://github.com/voidbrain/nerv/pull/104) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: merged PR CI 42029130633 |
| Reviewed | 2026-11-05 |

</details>

---

### B-002

**Sortie list: older sorties show only the time, not the day**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by the owner and closed.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05: the sortie list shows hh:mm for every sortie, so one from yesterday reads like one from this morning. |
| **Reproduce** | Open the dashboard with sorties from earlier days; their cards show only hh:mm. |
| **Check** | Today's sorties show hh:mm; yesterday's "yesterday hh:mm"; older ones the date and time in the owner's language and time zone; a test covers the three cases. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: the owner checked the dashboard ("B-002 ok"); the automated check passed in [PR #104](https://github.com/voidbrain/nerv/pull/104)'s CI (42029130633). Fixed in [PR #104](https://github.com/voidbrain/nerv/pull/104): `dayTime()` in web/public/dashboard/dashboard.js gives today's time alone, "yesterday HH:MM", "3 Nov HH:MM", and the year when it differs, in browser local time (style guide); used on sortie cards and both "while you were away" lists (simulation and live). Checked: test/dashboard.test.ts (today, yesterday, earlier this year, another year, midnight, yesterday across a year), fails without the fix; full suite and build pass. Not yet seen in a browser: the owner's look closes it. Reported 2026-11-05.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-05; [PR #104](https://github.com/voidbrain/nerv/pull/104) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: owner's visual check; PR CI 42029130633 |
| Reviewed | 2026-11-05 |

</details>

---

### F-047

**Dashboard looks: Theme (Eva, Simple) × Mode (dark, light) × Colour**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟡 Medium | ~100% |

💻 **→ Human action required: No**<br />None: verified by the owner and closed.

| | |
|---|---|
| **Issue** | Owner request 2026-11-05: two themes, "Simple" and "Eva", and a colour menu: dark or light, and orange (the current EVA Full), blue, green, violet or ochre. The dashboard had five fixed themes (EVA Full, EVA Basic, dark, light, terminal); light mode kept dark-mode status colours, several glows were fixed orange, and white on the danger red failed AA. |
| **Reproduce** | Open the dashboard and look for a colour choice: there is one THEME menu with five fixed looks. |
| **Check** | THEME (Eva: lore labels, square panels, filled headers, CRT; Simple: plain), MODE (dark, light) and COLOUR (five) are independent and remembered in the browser; Eva · Dark · Orange is unchanged from EVA Full; every text and focus colour reaches WCAG AA on every background in all 20 combinations (test); glows, the Sephirot lines, the MAGI seats and the EVA cages follow the mode and colour; an older saved theme maps to its nearest; a look by the owner in a browser. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: the owner checked the menus in a browser ("F-047 ok"); the automated checks passed in [PR #108](https://github.com/voidbrain/nerv/pull/108)'s CI. Implemented in [PR #108](https://github.com/voidbrain/nerv/pull/108) (2026-11-05): `palette(theme, mode, accent)` in web/public/dashboard/dashboard.js gives every colour token, applied on the body; the stylesheet's `:root` is Eva · Dark · Orange (a coupling kept by test); three labelled menus replace the theme menu; the old theme classes are gone (EVA Full and EVA Basic fold into Eva, Terminal into Simple · Dark · Green); fixed orange glows, black-mixed backgrounds, white-on-red and fixed MAGI seat colours now use tokens; light mode gets its own deeper status colours; planned EVA cages are no longer faded (the dashed border and PLANNED say it). Checked: test/dashboard.test.ts (WCAG contrast of text, muted, accent, status, header, brand, button and cage colours on every background, all 20 combinations; the default equals the palette; old choices mapped; each menu labelled); headless Chrome screenshots of five combinations reviewed (Eva dark orange and ochre, Eva light blue, Simple dark green, Simple light violet and ochre). Not automated: an axe run in a browser (the project has no axe tooling) and the owner's look.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner request 2026-11-05; [PR #108](https://github.com/voidbrain/nerv/pull/108) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: owner's look; PR #108 CI |
| Reviewed | 2026-11-05 |

</details>

---

### B-009

**Misato cancelled a reminder nobody asked to cancel, without a card**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟡 Medium | ~100% |

💻 **→ Human action required: No**<br />None: verified by CI and closed. On Tabgha, check `nerv list` for the reminder cancelled on 2026-11-05 and add it again if you still want it.

| | |
|---|---|
| **Issue** | Owner test on Tabgha 2026-11-05, Neo Tokyo-3 off: *remind me to eat in 30 minutes* (S-A090) ran reminders.add and then reminders.cancel, both Pattern Green, granted without a card; Misato replied that "the previous reminder has been cancelled". The owner did not ask for a cancel. Green actions skip Casper's intent check, and reminders.cancel is Green because it can be undone (reminders.restore), so an action outside the request passed the gate. |
| **Reproduce** | On Tabgha, `nerv events` for S-A090 (or the dashboard trace) shows both actions; `nerv list` shows which reminder is cancelled. |
| **Check** | An action that the request does not ask for is not run without the owner: either Casper checks intent for every action that changes or removes something (not only non-Green ones), or a cancel or edit of an item the request does not name needs a card; the reply never reports an unrequested change as done; the cancelled reminder is restorable and the owner is told; a test with a planner that adds and then cancels reproduces it and fails before the fix. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: every acceptance check is automated and passed in the merged [PR #111](https://github.com/voidbrain/nerv/pull/111)'s CI (42082501459). The owner's checks on the bases stay optional, not conditions. Fixed in [PR #111](https://github.com/voidbrain/nerv/pull/111): tools that cancel or forget (`reminders.cancel`, `memory.forget`) carry `removes`; they stay Green (undoable) but always get Casper's intent check (`intentChecked`, the ballot and the runtime gate, also the other bases' seats), so a removal the request did not ask for is refused, and without a verdict the owner decides; Casper's prompt says an unrequested removal is a reject; Misato's prompt forbids changing anything the request does not ask for. Checked: test/misato.test.ts (through every process: *remind me to eat* followed by a cancel of another reminder, Casper refuses, nothing is cancelled, Casper asked only about the cancel), test/gate.test.ts (the ballot for a Green removal: no verdict, reject, approve; a Green add unchanged), both fail without the fix; three tests changed deliberately for this requirement (a removal now needs Casper: the store test gives an approving verdict, two tests find Misato's prompts by role); full suite 149 pass, build, headless. A requested cancel costs one Casper call; a short confirmation ("sì") of a cancel needs Casper to see the conversation: B-010. Reported 2026-11-05. First: which reminder was cancelled, and what Misato saw (the step history) when it proposed the cancel.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner test on Tabgha 2026-11-05; [PR #111](https://github.com/voidbrain/nerv/pull/111) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: merged PR CI 42082501459 |
| Reviewed | 2026-11-05 |

</details>

---
### B-011

**After an approved action on another base, the follow-up never arrives and the sortie stays open**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by CI and closed.

| | |
|---|---|
| **Issue** | Owner test on Tabgha 2026-11-05 (F-036 slice 3b): *Remind me on NERV-02 tomorrow at 9 am to water the plants* (S-3BFF) asked for approval of kaji.run; after approving on Telegram the trace showed *EVA-02: kaji.run done* and *Misato: resuming after your decision*, the reminder is in `nerv list` on Tabgha, but no *Tabgha ran reminders.add* follow-up came and the sortie shows no *Debrief: done*. |
| **Reproduce** | Repeat the slice 3b check: approve a kaji.run and wait for Aoba's follow-up. |
| **Check** | Once the other base has run the action, its result comes back (outbox, kaji.verdict of the run) and Misato's follow-up says what ran there; the sortie closes as done (or failed with the reason); a two-base test covers the approved path end to end. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: every acceptance check is automated and passed in the merged [PR #112](https://github.com/voidbrain/nerv/pull/112)'s CI (42082978289). The owner's checks on the bases stay optional, not conditions. Cause found 2026-11-05 (read-only, Neo Tokyo-3's ledger, S-3BFF): the sortie did finish (Misato's reply at 18:37:22 local, 23 s after *resuming after your decision*, then sortie.done) and Tabgha ran the action (outbox done at 18:37:00, outcome grant); the owner's copy was taken before the reply. The real gap: the other base's result was sent only to the follow-up listeners (Telegram), never recorded on the sortie, so the trace, the dashboard and the why answer could not show it; and the follow-up was raw JSON (*Tabgha ran reminders.add: {"id":…}*). Fixed in [PR #112](https://github.com/voidbrain/nerv/pull/112): the result is recorded once as a `kaji.result` event on the sortie (base, tool, outcome, the text the owner reads), shown in the dashboard trace (*Kaji line · …*) and in the why answer (*Kaji: …*); the follow-up is plain (*Tabgha ran reminders.add (“Water the plants”).*). Checked: test/kaji-run.test.ts (two bases: the follow-up text, the recorded event, the why answer), fails without the fix; full suite 147 pass, build, headless. Reported 2026-11-05. The remote run happened (the reminder exists); the result path back to the sortie is the suspect.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner test on Tabgha 2026-11-05; [PR #112](https://github.com/voidbrain/nerv/pull/112) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: merged PR CI 42082978289 |
| Reviewed | 2026-11-05 |

</details>

---
### B-010

**Casper judges a follow-up without the earlier exchange and refuses a confirmed request**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by CI and closed.

| | |
|---|---|
| **Issue** | Owner test on Tabgha 2026-11-05: after *Remind me on Tabgha tomorrow at 9 to water the plants*, the owner answered *Am. Yes on Tabgha*; Casper rejected kaji.run (Pattern Blue, reject): "The action to add a plant watering reminder does not correspond to the request regarding 'Tabgha'." Casper saw only the short follow-up, not the request it confirms. |
| **Reproduce** | Ask for something that makes Misato ask a question, answer briefly ("yes", "am"); the action Misato then proposes is refused by Casper. |
| **Check** | Casper's intent check gets the same conversation context Misato had (the last exchanges, as data); a short confirmation of an earlier request is judged against that request; a test with a request, a question and a "yes" passes the check, and an unrelated action after a "yes" is still refused. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: every acceptance check is automated and passed in the merged [PR #113](https://github.com/voidbrain/nerv/pull/113)'s CI (42083387772). The owner's checks on the bases stay optional, not conditions. Fixed in [PR #113](https://github.com/voidbrain/nerv/pull/113): the gate passes the conversation's last three exchanges (`earlier`, each cut to 600 characters) to Casper's intent check, the same context Misato plans with; Casper's prompt says to judge a short answer or confirmation (yes, ok, sì, am, a time) against what the owner asked there. Since B-009 a confirmed cancel also goes to Casper, so this matters for "sì" after "delete all" too. Checked: test/misato.test.ts (through every process: a request, Misato's question, "Am. Yes": Casper sees the earlier request and approves; without it the fake Casper refuses), test/gate.test.ts (the prompt: none, at most three, cut to size), both fail without the fix; full suite 151 pass, build, headless. Not changed: the other bases' seats (shadow) still get the request alone; they would need the same context over the Kaji line. Reported 2026-11-05.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner test on Tabgha 2026-11-05; [PR #113](https://github.com/voidbrain/nerv/pull/113) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: merged PR CI 42083387772 |
| Reviewed | 2026-11-05 |

</details>

---
### B-012

**A base is not recognised by its name: "on Tabgha" fails, only "on NERV-02" works**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by CI and closed.

| | |
|---|---|
| **Issue** | Owner test on Tabgha 2026-11-05: *Remind me on Tabgha …* led to questions and a refusal; *Remind me on NERV-02 …* worked. Misato's remote tools name bases by ID only, and the consultant did not know Tabgha is a base (it asked about geofencing). |
| **Reproduce** | Ask Aoba to remind you on Tabgha of something. |
| **Check** | Misato's remote tools list each base as ID and name (NERV-02 · Tabgha), any case; "on Tabgha" reaches kaji.run for NERV-02; the consultant and pilots are told the base names as data; a test covers the name. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: every acceptance check is automated and passed in the merged [PR #114](https://github.com/voidbrain/nerv/pull/114)'s CI (42084149949). The owner's checks on the bases stay optional, not conditions. Cause corrected 2026-11-05 (read-only, Neo Tokyo-3's ledger, S-0866 and S-F57B): Misato did name bases correctly (its prompt lists *NERV-02 (Tabgha)*; it asked AM or PM, then proposed kaji.run for NERV-02). The refusal came from Casper, which compared a request saying *Tabgha* with an action saying *NERV-02* without knowing they are the same base (and without the earlier exchange, B-010); the consultant did not know Tabgha is a base either. Fixed in [PR #114](https://github.com/voidbrain/nerv/pull/114): for kaji.run Casper gets every enrolled base by id and name as data, with a rule that a base's name in the request matches its id in the action; the consultant (and pilots) get the same list when there is more than one base. Checked: test/kaji-run.test.ts (two bases: Casper's prompt lists NERV-02 · Tabgha), test/gate.test.ts (both prompts, with and without bases), both fail without the fix; full suite 152 pass, build, headless. Reported 2026-11-05.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner test on Tabgha 2026-11-05; [PR #114](https://github.com/voidbrain/nerv/pull/114) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: merged PR CI 42084149949 |
| Reviewed | 2026-11-05 |

</details>

---

### F-036

**Federated bases over the Kaji line: one main base, shared Scrolls, pilots and memory**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🔴 Large | ~100% |

💻 **→ Human action required: No**<br />None: verified and closed.

| | |
|---|---|
| **Issue** | Owner decision 2026-11-04: every base is a full installation; connected over the Kaji line they act as one agency with an owner-chosen main base. Today bases are independent, each with its own bot. |
| **Reproduce** | Run two bases; connect them; send a request on either channel; approve on one; look for each base's sorties and memory from the dashboard. |
| **Check** | Enrolment signed by the Key; the registry replicated on every base (signed records, merged last-seen), so the main base is not a single point of failure; the owner sets the main base (no election); connected: Aoba (main base) is the one channel, other bots go quiet, other bases dispatch to the main base, their MAGI are veto-only seats; alone: each base serves its own work with its own bot and MAGI; Scrolls distributed from the main base; pilots shared via Marduk; Lilith facts merged by id with provenance, conflicting edits/forgets go to the owner as a card; ledgers never merged, shown side by side; dashboard and channels reach other bases through the main base, each base's gate deciding its own actions; persona names per base, MAGI names fixed. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: every owner check on the two bases passed: relay (Tabgha's chat *· answered by Neo Tokyo-3*), fallback (Neo Tokyo-3 off, Tabgha answered itself), an action run on Tabgha (kaji.run approved, the reminder on Tabgha; its result on the sortie since B-011), and peer seats (the card's *Tabgha …(shadow)*, owner confirmed). The bugs found on the way are fixed and closed (B-008 stays open, B-009 to B-013 fixed); the follow-ups have their own records: F-048 to F-052. Owner checks on Tabgha 2026-11-05: **relay passed** (Tabgha's chat answered *· answered by Neo Tokyo-3*), **fallback passed** (Neo Tokyo-3 off, Tabgha answered itself), **slice 3b ran** (approved kaji.run, the reminder is in `nerv list` on Tabgha) but the follow-up never came (B-011); found on the way: B-008 (CONNECTION LOST during the relay), B-009 (an unrequested cancel), B-010 (Casper without the conversation), B-012 ("on Tabgha" not recognised), and F-051 (forwarded and running display). Remaining owner check: peer seats (`nerv kaji seat`, the card's *Other bases*). Found 2026-11-05 while adding consultants: `KajiLink.stop()` waited for its server to close, which only happens once every connection has ended, so a peer's keep-alive connection could hold the stop, and a service shutdown, forever (the full test suite hung at random with two-base tests). Fixed in [PR #92](https://github.com/voidbrain/nerv/pull/92): open connections are closed first; the suite then ran twice in about 17 s. **Next action / closure evidence:** Peers' MAGI in [PR #91](https://github.com/voidbrain/nerv/pull/91) (2026-11-05), the last phase 2 item: for every non-Green action the main base asks each online base's Casper in parallel with its own (`POST /kaji/verdict`, only from the main base; `Runtime.peerVerdict` on the base asked, on its own local model); the votes are extra ballot seats, veto-only (a reject stops, an approve adds nothing and never replaces Casper), shadow by default and set per base with `kaji seat BASE shadow|veto|off` (`kaji.seats`); no answer in time or no local model abstains; cards show them (*Other bases: …*). Checked: test/kaji-seats.test.ts (ballot rules; two runtimes, Tabgha's Casper rejecting: in shadow the card still goes to the owner with Tabgha's vote on it, with veto the action is rejected with Tabgha's reason, with Tabgha gone it abstains; a non-main base cannot ask for votes), suite 126 pass. **Next action / closure evidence:** Slice 3b in [PR #90](https://github.com/voidbrain/nerv/pull/90) (2026-11-05): actions on another base, one way (the main base sends, other bases never send actions to it). A base offers actions by name (`kaji offer …`, `kaji.offers`, none by default), first-hand in its heartbeat; Misato on the main base gets `kaji.run` only while some online base offers something (base, action, arguments); `kaji.run` is owner-only (always a card) and is checked against what that base offers before the gate; approving queues it (`kaji_outbox`), the coordinator sends it (`POST /kaji/run`, only from the main base) with an id the target remembers (`kaji_runs`), the target runs it through its own gate (`Runtime.runFromPeer`: it may run, refuse, or ask the owner again with a card relayed to Aoba), and the result reaches the owner as a follow-up (`remoteOutcomeText`). Checked: test/kaji-run.test.ts (two runtimes wired as serve: Misato sees the offer, an action not offered goes back to Misato, the card waits, after approval Tabgha's reminder is added once and the follow-up says so; a resend with the same id returns the first result; an action not offered is refused; Tabgha cannot run actions on the main base), suite 124 pass. **Next action / closure evidence:** Owner test 2026-11-05 (slice 2 verified): with Neo Tokyo-3 named main, `nerv chat "Remember that I drink tea at 5"` on Tabgha produced a card that arrived on Aoba (*🛰 Tabgha*), the tap was applied on Tabgha and its memory was updated. Owner decision 2026-11-05: dispatch is both ways, requests first. Slice 3a in [PR #85](https://github.com/voidbrain/nerv/pull/85): while the main base is online, a request asked on another base (its dashboard chat, `nerv chat`) goes to the main base's Misato (`POST /kaji/chat`, only the main base accepts; conversation `kaji:<base>-<channel>`); the reply says which base answered (`base` in the reply, shown by the CLI and the dashboard), and its cards are decided on Aoba or the main base's dashboard. A request runs locally only when it was never sent (connection refused, unreachable or connect timeout); a request that may have reached the main base and answers late is reported, never repeated. Checked: test/one-channel.test.ts (answered by the main base and nothing run locally; slow answer reported and not repeated; main base gone answered locally; a non-main base refuses requests; the conversation key), suite 118 pass. Next: slice 3b, the main base sends one action to a chosen base and gets its result back. Phase 2 slice 2 in [PR #83](https://github.com/voidbrain/nerv/pull/83) (2026-11-05), one channel: a signed `main` registry record (`kaji main BASE-ID`, newest wins, none until named, revoked base is no main; `Registry.main`, `kaji.main` RPC, `main` in `/api/bases`, MAIN badge on the dashboard and in `kaji list`); while the main base is online another base's Telegram channel is quiet (no `getUpdates`) and sends everything through `KajiLink.relay` (`POST /kaji/relay`, only the main base accepts, text plus card IDs, buttons built there as `k:BASE:a|r:ID`); a tap goes back through `KajiLink.decide` (`POST /kaji/decide`, accepted only from the main base) and the base applies it with its own decision path (`decisionText`); a failed relay falls back to the base's own bot. Checked: test/one-channel.test.ts (the main record and relay sanitising; two bases with two fake bots: Tabgha's card reaches Aoba, Tabgha's bot neither sends nor polls, a tap on Aoba stores the fact on Tabgha, a forged decide from a non-main base is refused, and with the main base gone Tabgha's own bot delivers a reminder), suite 116 pass. Remaining phase 2 slices: dispatch to the main base, peers' MAGI as veto-only seats. Owner report 2026-11-04: the log showed `Kaji: NERV-02 unreachable (The operation was aborted due to timeout)` then `reachable` with nothing else happening: one heartbeat timed out (8 s) on the Tailscale path, which the dashboard already tolerates (online for 90 s). Fixed in [PR #75](https://github.com/voidbrain/nerv/pull/75): a peer is logged unreachable only after three heartbeats in a row failed (`missesToLog`, derived from ONLINE_MS and the heartbeat interval), once, with the count; test/kaji-link.test.ts. Phase 2 slice 1 in [PR #73](https://github.com/voidbrain/nerv/pull/73) (owner request): each base's health in its heartbeat. Requests and replies carry the sender's own state (online, or degraded with at most three reasons of 200 characters: the same reasons as its doctor, such as a model route down or the brain not alive); the receiver sanitises it, stamps its own arrival time and keeps it in the coordinator's memory; `/api/bases` adds `health` per base (first-hand only, never relayed; counted only while that base is online; `null` for a base on older code). The dashboard shows a peer's DEGRADED badge, its reasons and a yellow pin, and a note for a base that sends no health. Checked: test/kaji-link.test.ts (report filtering; two links exchanging health both ways and dropping a malformed report; two Runtimes wired as `serve` does, where a base with a dead model route shows as degraded with its reason in the other's bases), full suite 99 pass. Remaining phase 2 slices, in order: Aoba as the one channel (other bots quiet while connected), dispatch to the main base, peers' MAGI as veto-only seats. Earlier: live 2026-11-04 (evening): after pulling #59 on both, the Kaji line came up — Neo Tokyo-3 (macOS) and Tabgha (Windows 11) each listening on its Tailscale address and seeing the other over signed heartbeats. Live 2026-11-04: both bases enrolled (Neo Tokyo-3 key on the Mac, Tabgha on Windows 11, root pinned on Tabgha by fingerprint, `kaji list` showing both). Phase 1b in [PR #59](https://github.com/voidbrain/nerv/pull/59): `src/kaji-link.ts` (listener on the enrolled address only, base-signed requests and replies, replay and skew guard, 30 s heartbeats, merged last-seen, registry catch-up verified against the local root), registry `kaji_seen`, scheduler RPC, `GET /api/bases`, dashboard bases panel and map from the real list (online/offline/last seen), state-change-only logging. Checked: test/kaji-link.test.ts (signature rules; two bases: online both ways, registry catch-up, impostor refused, forged record dropped, revoked base refused) and a temporary service with an unreachable second base (dashboard: NERV-01 online, NERV-02 offline, never heard). Owner's first import on Tabgha 2026-11-04 used Tabgha's own fingerprint for --root and got only "must match the file". Fixed in [PR #57](https://github.com/voidbrain/nerv/pull/57): the message says where the root fingerprint is (the "Root" line of kaji list on the base with the Key), recognises this base's own fingerprint, and still never prints the file's fingerprint (the owner's comparison is the check). Owner's first real enrolment 2026-11-04 put the address before the key; the command asked for the passphrase and then said only "An enrolment needs a name, an address and a public key". Fixed in [PR #56](https://github.com/voidbrain/nerv/pull/56): arguments are checked before the passphrase is asked, the key and the address may come in either order, and each mistake is named (base ID, name, key, address). Owner choices 2026-11-04: Tailscale for the first mesh (WireGuard underneath; swappable, since trust comes from the Key; Headscale or plain WireGuard later), the root key in a passphrase-encrypted file with an offline copy. Incident 2026-11-04: phase 1a first reached `main` by a direct push, without PR or CI (a background merge chain switched the shared checkout to `main` mid-commit, then a bare `git push` pushed it; `main` was unprotected). Reverted in [PR #51](https://github.com/voidbrain/nerv/pull/51) back to the last PR-checked state; the owner enabled branch protection on `main` (PR plus green `validate` and `native-macos`, enforced for admins, no force pushes); background jobs no longer switch the checkout and pushes name their branch. Merging lesson 2026-11-04: `gh pr merge --delete-branch` (used by merge-when-green) switches the local checkout to `main` when it deletes the branch checked out there, which moved the checkout mid-commit and changed the build the owner's running service used; development now happens in a separate worktree. Phase 1a re-landed in [PR #52](https://github.com/voidbrain/nerv/pull/52): `src/kaji.ts` (root key create/unlock, per-base keys, canonical signed records, `Registry` with pinned root, newest-enrolment and revoke-wins rules), `nerv key init [--out]`, `nerv base pubkey`, `nerv kaji enrol|revoke|list|export|import --root FINGERPRINT`. Checked: test/kaji.test.ts (encryption, wrong passphrase, tampering, foreign root, malformed records, append-only, revoke semantics, a two-base CLI run with fingerprint-checked import). Recorded in docs/NERV/NERV-ARCHITECTURE.md ("FEDERATION") in [PR #42](https://github.com/voidbrain/nerv/pull/42); the base identity exists ([PR #41](https://github.com/voidbrain/nerv/pull/41), F-035). Builds on F-005/F-006 (remote workers, cross-node orchestration), F-020 (persona names per base) and F-022 (memory merge). Kept from the earlier design: branch MAGI copies are seats, never authority (split-brain safety). Mapping confirmed by the owner 2026-11-04: Mac NERV-01 Neo Tokyo-3 (main), Windows 11 mini-PC NERV-02 Tabgha (own bot until connected; Windows support is F-037), NERV-03 Bethany planned. A base with no model route of its own (owner question 2026-11-04): connected, its Melchior and Balthasar still run locally (deterministic) and its Casper and Misato calls are served by another base's S² over the Kaji line (seat calls; the owner's own bases count as local, never Umbilical); alone, it runs as Dummy Plug (reminders fire, Green actions and owner `act` work, everything needing Casper reaches the owner). Owner 2026-11-04: anyone installs from git and owns their bases; there is no central server or public directory: each owner is their own Seele (Scrolls, Key), their Marduk registry (the list of their bases, with online/offline and last seen from Kaji heartbeats) lives on their main base, and the mesh admits only bases signed by their Key, so nobody else can see or join them. Owner 2026-11-04: the base list must not live only on the main base (single point of failure). Decided: the Marduk registry is replicated on every base as Key-signed records (enrol, revoke, main-base change) that verify themselves, exchanged over the Kaji line (revoke wins, newer signed record wins); last-seen is merged by the newest time per base; with the main base down the others keep the list, their status and their own work, and promoting another main base is an owner-signed decision with fencing. Shared list, single authority. Next for phase 2: each base's health (ok/degraded) in its heartbeat, so peers' dots show it too (owner request 2026-11-04). Open design points: main-base hand-over when the main base is offline (owner-confirmed, with fencing), how a quiet bot tells the owner which channel to use, memory merge cadence.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | [PR #42](https://github.com/voidbrain/nerv/pull/42) (architecture decision); [PR #52](https://github.com/voidbrain/nerv/pull/52) (trust layer); [PR #59](https://github.com/voidbrain/nerv/pull/59) (live link); [PR #41](https://github.com/voidbrain/nerv/pull/41) (base identity); [PR #73](https://github.com/voidbrain/nerv/pull/73) (health in the heartbeat); [PR #83](https://github.com/voidbrain/nerv/pull/83) (one channel); [PR #85](https://github.com/voidbrain/nerv/pull/85) (requests to the main base); [PR #90](https://github.com/voidbrain/nerv/pull/90) (actions on another base); [PR #91](https://github.com/voidbrain/nerv/pull/91) (peer seats) |
| Opened | 2026-11-04 |
| Verification | 2026-11-05: owner checks on Neo Tokyo-3 and Tabgha (relay, fallback, kaji.run, peer seats) |
| Reviewed | 2026-11-04 |

</details>

---
### B-013

**A sortie cut off by a restart stays open forever, with no reply**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified and closed.

| | |
|---|---|
| **Issue** | Owner test 2026-11-05: *Remind me on Tabgha tomorrow at 9 pm to water the plants* (S-1EBF), then NERV was closed and relaunched; the sortie card kept *Misato is working on it* with MAGI blinking. The ledger: request and consultant advice at 19:49, then nothing. After a restart only sorties waiting for an approval are resumed; one cut off while Misato planned (or an action ran) is never finished, closed or answered. |
| **Reproduce** | Ask Aoba something and stop the service before the reply. |
| **Check** | When the service starts, every Misato sortie the previous run left open and not waiting for the owner is closed as failed with a reply in the request's language saying it was interrupted, what had run, and that it will not carry on by itself; the owner is told on the channels; sorties waiting for an approval are left to resume; a sortie of the current run is never touched; a test across a restart covers all three. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: every acceptance check is automated and passed in the merged [PR #118](https://github.com/voidbrain/nerv/pull/118)'s CI (42089333601). Fixed in [PR #118](https://github.com/voidbrain/nerv/pull/118) (2026-11-05): `Ledger.interrupted(before)` finds them (open, from Misato, opened before this run started, no pending approval, no unanswered wait), `closeInterrupted` closes each with its reply in one transaction, and serve calls `Runtime.closeInterrupted()` once Telegram listens, so the follow-up reaches the owner. Not resumed on purpose: an action cut off mid-way may or may not have happened. Checked: test/resume.test.ts (two runtimes on one database: two interrupted sorties closed with their replies, English and Italian, the owner told once each; the one waiting for the owner left alone; a sortie of the new run untouched); full suite 153 pass, build, headless. INSTALL and area notes updated.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner test 2026-11-05 (S-1EBF on Neo Tokyo-3); [PR #118](https://github.com/voidbrain/nerv/pull/118) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: merged PR CI 42089333601 |
| Reviewed | 2026-11-05 |

</details>

---

### B-015

**CI native-macos fails before running: GitHub no longer offers the macos-14 runner**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by CI and closed.

| | |
|---|---|
| **Issue** | Found 2026-11-05 on #123: both native-macos jobs failed in about a second with *The configuration 'macos-14-arm64-us-default' is not supported*; main's last two runs (7b45844, 94b723d) had native-macos cancelled. GitHub stopped offering the image; nothing in the code changed. Every PR is blocked, since native-macos is a required check. |
| **Reproduce** | Any PR's native-macos job on `runs-on: macos-14`. |
| **Check** | native-macos runs and passes on a supported image named explicitly (not `latest`, so the Xcode and Swift version changes only on purpose); the runner images are listed under `outside` in .harness.json, so the audit reviews them. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: native-macos ran and passed on macos-15 in [PR #124](https://github.com/voidbrain/nerv/pull/124)'s CI (42095042478) and on every main run since (latest 42106421258). Fixed in [PR #124](https://github.com/voidbrain/nerv/pull/124) (2026-11-05): `runs-on: macos-15`; `outside` gains the runner images (what fails, how it shows). The job name stays native-macos, so the required check is unchanged (no repository setting touched).

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | #123 native-macos jobs 127479057886, 127479078814 |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: CI 42095042478, main 42106421258 |
| Reviewed | 2026-11-05 |

</details>

---
### B-016

**A sortie ID can switch the reply language: "why S-1E0E?" answered in Italian**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by CI and closed.

| | |
|---|---|
| **Issue** | Found 2026-11-05 on #127's windows job: test/resume.test.ts asked *why S-1E0E approved?* and got the answer in Italian. The language guess split the ID into letters: "1E0E" became two Italian "e" ("and"), outvoting the one English "why". It depends on the random ID, so it fails now and then, on any machine, and the owner would get a reply in the wrong language the same way. |
| **Reproduce** | `requestLanguage('why S-1E0E approved?')` returned "it". |
| **Check** | Sortie references and tokens with digits never vote; English and Italian questions with any ID keep their language; a test covers IDs that contain "e" and digits. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: its test is automated and passed in the merged [PR #127](https://github.com/voidbrain/nerv/pull/127)'s CI (42102698058) and on main (42103202794). Fixed in [PR #127](https://github.com/voidbrain/nerv/pull/127) (2026-11-05): `requestLanguage` removes sortie references first and skips any token with a digit. Checked: test/why.test.ts (the failing ID, an ID that starts with E, Italian with an ID, a token with digits), fails without the fix.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | #127 windows job (run 42101963247) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: merged PR CI 42102698058 |
| Reviewed | 2026-11-05 |

</details>

---

### B-017

**The Marduk Institute says the generic pilot is off while it is on**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by the owner and closed.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05: after `nerv models set consultant gemma4:12b` (*Saved. The running service now uses it.*) the panel still read *off · Turn it on: nerv models set consultant MODEL*. The panel (#125) read the consultant from `roles` while `GET /api/models` answers `{models:{roles:…}}`; the service itself had it right. |
| **Reproduce** | Driven in headless Chrome against the owner's service 2026-11-05: the panel listed Coder and Print Master but the generic pilot as off, while `/api/models` returned the consultant gemma4:12b. |
| **Check** | The generic pilot shows its model whenever one is set; before the first poll the panel says it is loading, not "planned"; the hint names a pilots command; a test pins the API shape the panel reads. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: the owner confirmed the generic pilot shows its model ("B-017 ok"); its automated checks passed in the merged PR's CI. Fixed in [PR #128](https://github.com/voidbrain/nerv/pull/128) (2026-11-05): the panel reads `models.roles.consultant`; *Loading pilots…* until the first poll answers; the generic pilot gets its own command, `nerv pilots generic MODEL|off` (the consultant role, so `models set consultant` keeps working), named in the hint and in `nerv pilots`. Also in the same change (owner, same report): base cards and the banner read *NERV-01 · Neo Tokyo-3*; the map is smaller with its legend on the right. Checked: test/dashboard.test.ts, test/model-setup.test.ts (the CLI command, a model Ollama lacks refused), a screenshot of the bases panel.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-05; headless Chrome against the owner's service |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: owner's check; tests in the merged PR's CI |
| Reviewed | 2026-11-05 |

</details>

---
### B-014

**Dashboard header cut off after coming back; a refresh does not fix it**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by the owner and closed.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05: sometimes, going back to the dashboard, the header is cut off; a refresh does not fix it, only closing and reopening the tab. On wide screens the page is one fixed screen (`body { overflow:hidden }`), but hidden only removes the scrollbar: the page could still be left scrolled (by a window that was narrower for a while and scrolled, by scrollIntoView or focus), with no way to scroll back, and a refresh restores that scroll position. |
| **Reproduce** | Reproduced in Chrome 2026-11-05: load the dashboard 1000 px wide, scroll down 700 px, widen to 1600 px: the page stays scrolled 624 px and the header sits at -527 px. |
| **Check** | On wide screens the page itself has nothing to scroll: the body is pinned to the window and only the columns scroll; narrow-then-wide, a forced scroll and scrollIntoView leave the header in place; the layout is unchanged; a test guards the rule; the owner sees it hold. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: the owner confirmed the header stays in place after narrow-then-wide and coming back ("B-014 ok"); its automated check passed in the merged PR's CI. Fixed in [PR #120](https://github.com/voidbrain/nerv/pull/120) (2026-11-05): in the one-page layout (min-width 1201 px) `html { height:100%; overflow:hidden; } body { position:fixed; inset:0; overflow:clip; }`, so the document has no scroll range and the browser holds it at the top whatever tries to move it. A script guard (scroll and resize listeners) was tried first and did not hold in Chrome; it was dropped. Checked in headless Chrome with a probe page: after narrow-then-wide, then a forced scrollTo(0,500) and a scrollIntoView, the page stays at 0 and the header at its place (main before the fix: 624 px scrolled, header at -527 px); a screenshot shows the layout unchanged; test/dashboard.test.ts guards the CSS rule; full suite and build pass. The owner's check closes it.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-05; [PR #120](https://github.com/voidbrain/nerv/pull/120) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: owner's check; tests in the merged PR's CI |
| Reviewed | 2026-11-05 |

</details>

---
### F-053

**CRT effect like a working tube: static scanlines, vignette, faint flicker and rolling band**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified by the owner and closed.

| | |
|---|---|
| **Issue** | Owner request 2026-11-05 (CRT notes: static horizontal scanlines at low opacity, very subtle brightness flicker, an occasional wide faint band rolling vertically, a static vignette; never scroll the scanlines themselves). The CRT layer was one static set of scanlines at 22% black, heavier than recommended, with nothing else. |
| **Reproduce** | Eva theme, press CRT: heavy fixed stripes only. |
| **Check** | Scanlines static at 5–12%; a static vignette; a brightness flicker under 5%, irregular; one wide faint band rolling down every 8–15 s; no colour separation or jitter (they blur the text); with reduced motion only the static layers; still opt-in and Eva only; a test checks these limits; the owner's look. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-05: the owner confirmed the CRT ("F-053 ok"); the two lines pass on separate 17 s and 29 s cycles, so together only now and then (the owner noticed they did not overlap), by design. Second tuning in [PR #125](https://github.com/voidbrain/nerv/pull/125) (owner: edges not noticeable on dark; the line more random, maybe two at different speeds, occasionally): edges `inset 0 0 70px 22px` at 85%; two thin dark lines, 6 px on a 17 s cycle and 3 px on a 29 s cycle offset by 11 s, each passing for a few seconds only, so together they look irregular. Owner feedback 2026-11-05 after the first version: the original scanlines were right and must stay (restored: 22% black, 4 px, static); the flicker was invisible (it dimmed only the overlay: now the page itself dips to 92–95% a few times every 6 s); the wide light band was ugly (now a thin 6 px soft dark line rolling down every 12 s); the vignette only on the very borders (an inset shadow, nothing across the middle). In [PR #123](https://github.com/voidbrain/nerv/pull/123); test/dashboard.test.ts checks each part and the reduced-motion rule; screenshot reviewed. Implemented in [PR #121](https://github.com/voidbrain/nerv/pull/121) (2026-11-05): scanlines at 9% on 3 px, a radial vignette to 28% at the edges, a 7 s irregular flicker between 97.5% and 100% opacity, a 28 vh band at 3.5% white rolling down every 12 s; `prefers-reduced-motion` stops the flicker and hides the band. Checked: test/dashboard.test.ts (the limits above), a headless Chrome screenshot with CRT on (text readable). The owner's look closes it.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | Owner request 2026-11-05; [PR #121](https://github.com/voidbrain/nerv/pull/121) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: owner's check; tests in the merged PR's CI |
| Reviewed | 2026-11-05 |

</details>

---

## Closed 2026-11-06

### B-018

**A sortie that answered without an action shows a wrong route: Misato unlit, a live line from EVA to Debrief**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: closed after the merged PR's green CI.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05 (S-B55C *Csncrl*: request, advice, Misato's reply, no action): the replayed flow ended with ADVISE green, Misato and Debrief unlit (orange in Eva) and an animated dashed line from EVA to Debrief. Live mode marked Misato's step passed only when an action existed; the animated (live) lines were computed for any selected sortie, also finished ones, and always entered Debrief from EVA; the flow had no route from Misato straight to Debrief. |
| **Reproduce** | Select a sortie Misato answered without using a tool. |
| **Check** | Misato's step is passed when she answered; such a sortie draws a solid route Misato → Debrief, green once passed, and nothing from EVA; animated lines appear only while a sortie runs; a sortie with an action keeps its route through EVA. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in the full audit: [PR #134](https://github.com/voidbrain/nerv/pull/134) merged with validate, native-macos and windows green (read with ci:status). Fixed in [PR #134](https://github.com/voidbrain/nerv/pull/134) (2026-11-05): `plan` passed when Misato replied; a new answer route (Misato → Debrief, its own lane on the right, entering Debrief from below), drawn only for a sortie without actions, solid, green when passed; `liveEdges` only for a running or waiting sortie, and into Debrief from Misato when no action ran. Checked in headless Chrome (S-B55C-shaped: Misato and Debrief passed, the answer route among the passed lines, no live line; with an action: no answer route) and by test/dashboard.test.ts; a screenshot.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-06.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-05 (S-B55C on Neo Tokyo-3) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: probe, screenshot, test/dashboard.test.ts (local run) |
| Reviewed | 2026-11-06 |

</details>

---

### B-019

**A failing MCP server said only "MCP server ended", hiding why**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: closed after the merged PR's green CI.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05: `nerv tools add files npx -y @modelcontextprotocol/server-filesystem ~/NERV-files`, then `nerv tools` printed *could not list its tools: MCP server ended.* The cause (the npm inside the owner's nvm Node lacks `npm-cli.js`, so `npx` crashes) was invisible: the client discarded the server's error output. |
| **Reproduce** | Add a server whose command exits at start, then run `nerv tools`. |
| **Check** | The message names the exit code and the error line from the server's error output (here *Error: Cannot find module './npm-cli.js'*), not stack lines, braces or the Node version. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in the full audit: [PR #141](https://github.com/voidbrain/nerv/pull/141) merged with validate, native-macos and windows green (read with ci:status). Fixed in [PR #141](https://github.com/voidbrain/nerv/pull/141) (2026-11-05): src/mcp.ts keeps the last 2,000 characters of the server's error output; when the server exits, the message gives the exit code and the line naming the error (or the last two meaningful lines). Checked: test/mcp.test.ts (a fake server that fails at start), and through the CLI against the owner's broken `npx`: *MCP server ended (exit 1): Error: Cannot find module './npm-cli.js'.* The owner's npx itself is a toolchain issue outside NERV (`/usr/local/bin/npx` works, or `nvm install-latest-npm`).

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-06.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-05 (Neo Tokyo-3) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: test/mcp.test.ts and a CLI run (local) |
| Reviewed | 2026-11-06 |

</details>

---

### B-020

**While the consultant works, its sortie blinks CONSULT but the advice step in the Sephirot stays dark**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: closed after the merged PR's green CI.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05 (S-E16D, S-7B04, consultant gemma4:12b): in Sorties the card's badge blinked CONSULT, while ADVISE in the Sephirot was not lit. In live mode a sortie is marked consulted only when the advice arrives (`misato.consult`); `stepState` returned *skip* for the advice step of a sortie not yet consulted before looking at its phase, so the running step was drawn as skipped. |
| **Reproduce** | With a consultant set, ask Misato anything and look at the Sephirot before the advice arrives. |
| **Check** | While the phase is `consult` the advice step is on (lit, its incoming line live); a sortie with no consultant still skips it; an advised one shows it passed. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in the full audit: [PR #142](https://github.com/voidbrain/nerv/pull/142) merged with validate, native-macos and windows green (read with ci:status). Fixed in [PR #142](https://github.com/voidbrain/nerv/pull/142) (2026-11-05): `stepState` skips the advice step only when the sortie is not in the consult phase. Checked: test/dashboard.test.ts runs the real `stepState` (running → on, no consultant → skip, advised → done); it fails without the fix. Not checked in a browser.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-06.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-05 (S-E16D, S-7B04 on Neo Tokyo-3) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: test/dashboard.test.ts (local run) |
| Reviewed | 2026-11-06 |

</details>

---

### B-022

**The bases map is blank**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: closed after the merged PR's green CI.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05: *map no more visible*. Since PR #137, a line comment sat before `const s` (each marker's size) on the same line, so `drawMap` threw *s is not defined* on every frame once it reached the bases: the canvas stayed fully transparent (probe on the live dashboard: 0 opaque pixels; calling `drawMap` gave the error). |
| **Reproduce** | Open the dashboard; look at NERV BASES. |
| **Check** | The map, both bases and their names are drawn. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in the full audit: [PR #143](https://github.com/voidbrain/nerv/pull/143) merged with validate, native-macos and windows green (read with ci:status). Live check after the rebuild: the map canvas went from 0 to fully drawn pixels on the owner's dashboard. Fixed in [PR #143](https://github.com/voidbrain/nerv/pull/143) (2026-11-05): the comment on its own line. Checked: test/dashboard.test.ts runs the real `drawMap` with a recording canvas (both bases named, one marker each, drawn to the last line); it fails without the fix with *s is not defined*. The PR that caused it (#137) was checked with a probe that read the page, not the canvas.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-06.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-05 (Neo Tokyo-3) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: test/dashboard.test.ts (local run); live probe after merge |
| Reviewed | 2026-11-06 |

</details>

---

### B-023

**The Sephirot does not follow a sortie while it runs; Casper says Green when idle; Gevurah has no number**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: closed after the merged PR's green CI.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05: the Sephirot did not show the consultant or Misato while a request ran; Casper read *Green: not consulted* with nothing running; GEVURAH had no number. With a sortie selected, a request just sent was selected only when its reply came back, so the flow showed the old sortie meanwhile. With it, the owner's layout requests: the crew avatars top right (no *you* on Misato's apartment, no Hyuga on Detection), each Sephirah's number with its Hebrew and Latin name top left (its meaning on hover); MAGI seats Balthasar 1, Casper 2, Melchior 3, the kanji large again, each seat's role (details on hover), Casper *intent · idle* when nothing runs; ADVISE's *no vote · advice into the LCL* only with no sortie selected. |
| **Reproduce** | Select an old sortie, then ask Misato something; watch the Sephirot. |
| **Check** | A request sent from the dashboard selects its sortie as soon as it appears; the Sephirot is numbered 1 to 11; Casper says idle, not needed (Green) or read by a local model. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in the full audit: [PR #144](https://github.com/voidbrain/nerv/pull/144) merged with validate, native-macos and windows green (read with ci:status). Fixed in [PR #144](https://github.com/voidbrain/nerv/pull/144) (2026-11-05). Checked: test/dashboard.test.ts (numbering 1 to 11, avatars, seat roles, Casper's states in both scripts); in headless Chrome against a throwaway base serving the branch: with an older sortie picked, a new request's sortie is selected (that run cannot show the window while the request runs, since the old code also selected it once the reply came); screenshots of the Sephirot.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-06.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-05 (Neo Tokyo-3) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: test/dashboard.test.ts, headless Chrome (local) |
| Reviewed | 2026-11-06 |

</details>

---

### B-024

**The consultant is not told which tools Misato has, so it advises against what she can do**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: closed after the merged PR's green CI.

| | |
|---|---|
| **Issue** | Owner run 2026-11-05 (S-77D5): with `files.read_text_file` granted, the consultant advised *Explain that you lack direct filesystem access and ask them to copy and paste the text*. Misato ignored it and read the file, but the advice was wrong: `consultant.advise` gets the request, the context and the bases, not the tools. |
| **Reproduce** | Grant an MCP tool, ask for something it does; read the consultant's advice. |
| **Check** | The consultant's input lists the tool names Misato is offered (NERV's own and granted MCP tools), and its system prompt says to advise within them. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in the full audit: [PR #146](https://github.com/voidbrain/nerv/pull/146) merged with validate, native-macos and windows green (read with ci:status). Fixed in [PR #146](https://github.com/voidbrain/nerv/pull/146) (2026-11-06): `consultant.advise` takes `tools` (name and the start of its description, at most 80); the runtime passes NERV's own tools and the granted MCP tools; the consultant's prompt says to advise within them and never to say Misato cannot do what one of them does. Checked: test/mcp.test.ts through every process (the consultant is told `notes.read_note` and `reminders.add`, not an ungranted tool). Not yet seen with the owner's gemma4:12b consultant.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-06.

| Field | Value |
|---|---|
| PR / evidence | Owner run 2026-11-05 (S-77D5 on Neo Tokyo-3) |
| Opened | 2026-11-05 |
| Verification | 2026-11-06: test/mcp.test.ts (local run) |
| Reviewed | 2026-11-06 |

</details>

---

### B-025

**A granted MCP tool runs under the EVA its effect class picks, not the one it was granted for**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: closed after the merged PR's green CI.

| | |
|---|---|
| **Issue** | Owner run 2026-11-05 (S-77D5): `files.read_text_file` was granted with `--eva 00`, but its ballot and Comms said EVA-02. The ledger registers an MCP tool with its effect class only; the grant's EVA class is used only to refuse EVA-03. |
| **Reproduce** | Grant a tool with `--eva 00`, use it, read the ballot's executor. |
| **Check** | The ballot's executor is the grant's EVA (EVA-00 here); an EVA-03 grant is still refused before F-049. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in the full audit: [PR #146](https://github.com/voidbrain/nerv/pull/146) merged with validate, native-macos and windows green (read with ci:status). Fixed in [PR #146](https://github.com/voidbrain/nerv/pull/146) (2026-11-06): each granted tool reaches the gate with its EVA class, and the executor is the stricter of that class and the stage's (quarantine, shadow, bounded, production); NERV's own tools are unchanged. Checked: test/mcp.test.ts (the stricter rule; through every process a tool granted for EVA-00 runs under EVA-00); both fail without the fix.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-06.

| Field | Value |
|---|---|
| PR / evidence | Owner run 2026-11-05 (S-77D5 on Neo Tokyo-3) |
| Opened | 2026-11-05 |
| Verification | 2026-11-06: test/mcp.test.ts (local run) |
| Reviewed | 2026-11-06 |

</details>

---

### B-026

**A Marduk Institute proposal stays open after its card is decided, and shows as a running sortie**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: closed after the merged PR's green CI.

| | |
|---|---|
| **Issue** | Owner report 2026-11-06: *all misato tags in sorties blink at the same time*. Two Marduk Institute sorties (pilots for file system access and file management, both approved at 00:30) were still open: after a decision the store closed only the owner's own sorties and Instrumentality's proposals, so a proposal sortie stayed open and the dashboard drew it as running (Misato's phase, blinking). An expired card closed no sortie at all. |
| **Reproduce** | Approve or turn down a `pilots.create` card; look at its sortie. |
| **Check** | A proposal sortie closes once every card is decided, whatever the decision; on each scheduler tick that expires a card, an owner action whose card expired closes as failed and a proposal as done; Misato's sorties still wait for her resume; the first tick closes those an earlier version left open. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in the full audit: [PR #145](https://github.com/voidbrain/nerv/pull/145) merged with validate, native-macos and windows green (read with ci:status). Fixed in [PR #145](https://github.com/voidbrain/nerv/pull/145) (2026-11-06): `settle` treats Marduk proposals like Instrumentality's; `Store.expire` (the scheduler tick) closes what nothing will finish. Checked: test/pilots.test.ts through every process (approved and turned down: closed) and test/ledger.test.ts (left open before, expired owner action, expired proposal, Misato untouched); both fail without the fix.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-06.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-06 (S-0CB7, S-8E2C on Neo Tokyo-3) |
| Opened | 2026-11-06 |
| Verification | 2026-11-06: test/pilots.test.ts, test/ledger.test.ts (local run) |
| Reviewed | 2026-11-06 |

</details>

---

### F-055

**Code coverage per folder, as the harness asks**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: closed after the merged PR's green CI.

| | |
|---|---|
| **Issue** | Owner question 2026-11-05 ("don't the harness require code coverage?"): AGENTS.md describes `docs/agents/coverage.md`, `npm run coverage` and a table on every PR, but nothing was set up: no script, no `coverage` settings, no CI step; the copied `tools/coverage-table.mjs` was never used. It reads the json-summary that Istanbul writes (OpenBando's Angular tests); Node's test runner writes LCOV. |
| **Reproduce** | `npm run coverage` did not exist; `docs/agents/coverage.md` was missing. |
| **Check** | `npm run test:coverage` runs the suite once with coverage and writes the summary; `npm run coverage` also writes the page and its baseline; CI validate runs the suite through it and prints the table (warnings; `coverage.enforce` off, as OpenBando); files no test loads appear as untested; the page changes only on purpose and in audits. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in the full audit: [PR #138](https://github.com/voidbrain/nerv/pull/138) merged with validate, native-macos and windows green (read with ci:status). Set up in [PR #138](https://github.com/voidbrain/nerv/pull/138) (2026-11-05): `tools/lcov-summary.mjs` (project tool) turns Node's LCOV into the json-summary and adds src/ files no test loaded at zero; scripts `test:coverage` and `coverage`; `.harness.json` `coverage` {summary, folders [src/], drop 2, enforce false}; validate runs `test:coverage` instead of `npm test` (the suite still once) and `coverage-table.mjs --check --github`; `coverage/` ignored. First table: src/ lines 93.1 %, branches 84.2 %, functions 84.1 % (30 files; untested: contracts.ts, types only). Limits, written in the tool: statements equal lines (LCOV has none); code run only in the scheduler and brain child processes is not counted (most of it is also tested in-process). Checked: test/coverage.test.ts (the conversion), the run above. Harness boundary: the rule and the table tool are the harness's; the coverage run, settings and converter are this project's; whether the converter becomes a template piece for Node test runner projects is the owner's call.

**Estimates:** No remaining effort; ~100% complete. Estimated 2026-11-06.

| Field | Value |
|---|---|
| PR / evidence | Owner question 2026-11-05; OpenBando's coverage setup as reference |
| Opened | 2026-11-05 |
| Verification | 2026-11-05: npm run coverage and test/coverage.test.ts (local run) |
| Reviewed | 2026-11-06 |

</details>

---


### F-057

**The dashboard header shows the running version; its commit on hover, copied on click**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: required browser and automated checks passed.

| | |
|---|---|
| **Issue** | Owner request 2026-11-06: *add version close to hour on header, hover shows commit hash, click copies it.* It also shows when a running NERV is older than its checkout (on 2026-11-05 a process started before F-021 merged had no MCP code). |
| **Reproduce** | Open the dashboard; look beside the clock. |
| **Check** | `v<version>` beside the clock; hover and accessible name give the full commit the service started with; a click copies it and says *copied* (or *copy failed*); hidden without a live base. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #150](https://github.com/voidbrain/nerv/pull/150) after reconciliation of merged PR #148: [CI run 42140503183](https://github.com/voidbrain/nerv/actions/runs/42140503183), validate, windows and native-macos passed (ci:status). Existing browser evidence below covers the recorded UI acceptance. Implemented in [PR #148](https://github.com/voidbrain/nerv/pull/148) (2026-11-06): `src/build.ts` reads the package version and `git rev-parse HEAD` once when the server starts; `/api/doctor` reports `build`; the header button (`showBuild`, `copyBuild`). Checked: test/dashboard.test.ts across the server and the dashboard functions (the doctor's commit equals the checkout's; hover text; copy; a refused clipboard); headless Chrome against a throwaway base: `v0.1.0`, the full commit on hover, the clipboard held the commit after a click; a screenshot.

**Estimates:** No remaining effort; ~100% complete. Reassessed 2026-11-06 against all recorded checks.

| Field | Value |
|---|---|
| PR / evidence | [PR #148](https://github.com/voidbrain/nerv/pull/148), merged; CI run 42140503183 green |
| Opened | 2026-11-06 |
| Verification | 2026-11-06: test/dashboard.test.ts; headless Chrome (local) |
| Reviewed | 2026-11-06 |

</details>

---


### B-027

**One field gets several pilot proposals: unmatched domains are counted by exact name**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: regression and merged CI passed.

| | |
|---|---|
| **Issue** | Full audit 2026-11-06: the generic pilot named one field *file system access*, *file management* and *file access* (S-E16D, S-7B04, S-77D5 and later); `Ledger.unmatched` counts only the exact name, so two of them reached three and two near-duplicate pilots were proposed 3 minutes apart (S-0CB7, S-8E2C); the second card was made while the first still waited. The owner approved both: the roster now has *file-system-access* and *file-management*. |
| **Reproduce** | Ask about one field in different words three times each; look at the pilots.create cards. |
| **Check** | Requests about one field count together whatever its exact name (shared words, or the same field as an existing or proposed pilot); no second proposal while one for an overlapping field waits; a test across the runtime and the ledger. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #151](https://github.com/voidbrain/nerv/pull/151): [PR #150 CI](https://github.com/voidbrain/nerv/actions/runs/42215185296) passed validate, windows and native-macos; read with ci:status. Implemented in [PR #150](https://github.com/voidbrain/nerv/pull/150): shared significant whole-word matching for unmatched requests and pending/rejected proposals, retaining the roster check with `choosePilot`. Proposal creation is serialized per runtime so overlapping concurrent requests see the first card. Regression exercises varying labels through the runtime, scheduler and ledger, suppression while pending, approval and rejection. No remaining required checks.

**Estimates:** No remaining effort; ~100% complete. Reassessed 2026-11-06 after all checks passed.

| Field | Value |
|---|---|
| PR / evidence | [PR #150](https://github.com/voidbrain/nerv/pull/150); full audit 2026-11-06 (events `pilot.unmatched` on Neo Tokyo-3) |
| Opened | 2026-11-06 |
| Verification | 2026-11-06 Unit/integration: npm test passed (181 passed, 1 platform skip), including varying labels across runtime/ledger and concurrent suppression; typecheck, build, integrations and conventions passed. Merged PR #150 CI run 42215185296 passed validate, windows and native-macos |
| Reviewed | 2026-11-06 |

</details>

---


### F-057

**The dashboard header shows an incrementing build version; commit on hover and click**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: build-counter, browser and merged CI acceptance passed.

| | |
|---|---|
| **Issue** | Owner clarification 2026-11-06: use an incrementing version number like OpenBando, since the package version stays unchanged across builds. Reopens the prior version-label implementation; see [archived acceptance](archive/backlog-2026.md#f-057). |
| **Reproduce** | Open the live dashboard and inspect the button beside the clock. |
| **Check** | Incrementing `v1.N` beside the clock, stable for the same revision across bases and advancing with main merges; full hash on hover and in the accessible name; click copies the full hash with success/failure feedback. Package version fallback without full git history; hidden without a live base. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #152](https://github.com/voidbrain/nerv/pull/152) after [PR #151 CI](https://github.com/voidbrain/nerv/actions/runs/42216202855) passed validate, windows and native-macos (ci:status); browser and two-base fixture acceptance below. Implemented in [PR #151](https://github.com/voidbrain/nerv/pull/151). OpenBando stamps v1.<deployment run number>; NERV has no deployment pipeline, so buildInfo uses the first-parent history count for v1.N from a full checkout. It reads the count against the captured commit, once at service start; shallow/source copies fall back to the package version. Full commit hover/copy remains. Checked locally: test/build.test.ts (increments, two-base equality, startup caching, shallow and source-copy fallbacks), dashboard regression, headless Chrome label/tooltip/clipboard and screenshot. No remaining required checks.

**Estimates:** Small remaining effort; ~90% complete. Reassessed 2026-11-06: build counter, regression and browser checks passed; merged No remaining required checks.

| Field | Value |
|---|---|
| PR / evidence | [PR #151](https://github.com/voidbrain/nerv/pull/151); owner clarification 2026-11-06; prior implementation PR #148 and closure PR #150 |
| Opened | 2026-11-06 |
| Verification | 2026-11-06 Unit/integration: full suite passed (183 passed, one systemd-only skip); build and dashboard regressions passed; Browser: headless Chrome displayed v1.158 with full hash on hover and copied the full hash; screenshot inspected. Merged PR #151 CI run 42216202855 passed validate, windows and native-macos |
| Reviewed | 2026-11-06 |

</details>

---


### B-029

**The kaji.run test timed out once in CI: the two test bases never exchanged their offers**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: robust-wait acceptance and merged CI passed.

| | |
|---|---|
| **Issue** | CI 2026-11-06 on PR #148 (run 42140503183, attempt 1, validate under coverage): test/kaji-run.test.ts:45 waited 15 s for `remoteOffers()` to list NERV-02 and timed out (the test took 16.5 s). The rerun passed, as do local runs under coverage (3 of 3, under 1 s each) and CI on #146 and #147. Hypotheses: a port taken between `freePort` and listen, or a first connection lost with no retry within the window. Not confirmed. |
| **Reproduce** | Run test/kaji-run.test.ts repeatedly on a loaded machine or in CI. |
| **Check** | The cause is named and fixed, or the wait made robust with a test for it; when it times out, the error says what each link saw (connected, offers heard). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #155](https://github.com/voidbrain/nerv/pull/155) on the recorded robust-wait acceptance path after [PR #154 CI](https://github.com/voidbrain/nerv/actions/runs/42220503857) passed validate, windows and native-macos (ci:status). Implemented in [PR #154](https://github.com/voidbrain/nerv/pull/154): replaced two independent free-port probes with a pair of held reservations, released immediately before concurrent link startup: the fixture cannot allocate the same port twice. Retain each link's recent logs, heard offers and both runtime base snapshots; every wait includes that state on timeout (including failed diagnostic reads). The integration deliberately starts with no advertised offers, then waits for a later real heartbeat to supply them. Separate regressions prove the reservations remain bound/distinct and timeout text retains the observed state. This follows the Check's robust-wait alternative: the historical CI cause is still unconfirmed; reservation release cannot prevent every external port race, which will now have listener diagnostics. Ten of ten local repetitions with coverage passed; full suite passed (191 passed, one systemd-only skip), alongside typecheck, build, conventions, integrations and backlog checks. No remaining required checks.

**Estimates:** No remaining effort; ~100% complete. Reassessed 2026-11-06 after robust-wait regressions, ten coverage repetitions, full suite and merged CI passed.

| Field | Value |
|---|---|
| PR / evidence | [PR #154](https://github.com/voidbrain/nerv/pull/154); original [CI run 42140503183](https://github.com/voidbrain/nerv/actions/runs/42140503183) (attempt 1 failed, attempt 2 green) |
| Opened | 2026-11-06 |
| Verification | 2026-11-06 Unit/integration: test/kaji-run.test.ts passed (4 tests), 10/10 repeated runs under coverage passed, full suite passed (191 passed, one systemd-only skip); merged PR #154 CI run 42220503857 passed validate, windows and native-macos |
| Reviewed | 2026-11-06 |

</details>

---

### Other changes — root scratch directory

Closed 2026-11-06 in [PR #156](https://github.com/voidbrain/nerv/pull/156): ignore `/~/` in this project’s `.gitignore`. This is a project-only setting in an adapted harness file; the shared template is unchanged. `git check-ignore` confirms the root directory and its contents are ignored while `nested/~/example` remains unignored. Reviewed README, AGENTS/area notes, backlog rules and the style guide: no affected product claims.


### B-030

**Angular workspace styles are blocked by its service CSP**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: browser/accessibility acceptance and merged CI passed.

| | |
|---|---|
| **Issue** | Browser acceptance for F-010: the default Angular build emits a stylesheet with media=print and an inline activation script. The service blocks inline scripts, so only critical CSS loads and the workspace appears mostly unstyled. |
| **Reproduce** | Build and serve the Angular workspace, connect to a temporary backend, and inspect computed styles and axe results. |
| **Check** | The built app loads its full stylesheet under the service CSP, uses the grid layout and has no CSP violations. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #158](https://github.com/voidbrain/nerv/pull/158) after [PR #157 CI](https://github.com/voidbrain/nerv/actions/runs/42225026067) passed validate (including Linux Chrome/axe), windows and native-macos; read with ci:status. Found 2026-11-06 during F-010 acceptance. Fix verified by the repeatable Chrome/axe suite and inspected screenshots; see [scope and evidence](acceptance/angular-2026-11-06.md). No remaining required checks.

**Estimates:** No remaining effort; ~100% complete. Reassessed 2026-11-06 after browser/accessibility acceptance and merged CI passed.

| Field | Value |
|---|---|
| PR / evidence | [PR #157](https://github.com/voidbrain/nerv/pull/157) scoped browser acceptance and fixes; Local Chrome screenshot and axe results, 2026-11-06; F-010 |
| Opened | 2026-11-06 |
| Verification | 2026-11-06 Browser/accessibility: all ten Chrome/axe views passed, screenshots inspected; merged PR #157 CI run 42225026067 passed validate, windows and native-macos |
| Reviewed | 2026-11-06 |

</details>

---

### B-031

**The status card skips the page heading hierarchy**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: browser/accessibility acceptance and merged CI passed.

| | |
|---|---|
| **Issue** | F-010 browser acceptance: axe reports heading-order because the registered status card uses h3 immediately after the workspace h1. |
| **Reproduce** | Build and serve the Angular workspace, connect to a temporary backend, and inspect computed styles and axe results. |
| **Check** | The status card uses a level-two heading; connected English/Italian views pass axe, including the shadow tree. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #158](https://github.com/voidbrain/nerv/pull/158) after [PR #157 CI](https://github.com/voidbrain/nerv/actions/runs/42225026067) passed validate (including Linux Chrome/axe), windows and native-macos; read with ci:status. Found 2026-11-06 during F-010 acceptance. Fix verified by the repeatable Chrome/axe suite and inspected screenshots; see [scope and evidence](acceptance/angular-2026-11-06.md). No remaining required checks.

**Estimates:** No remaining effort; ~100% complete. Reassessed 2026-11-06 after browser/accessibility acceptance and merged CI passed.

| Field | Value |
|---|---|
| PR / evidence | [PR #157](https://github.com/voidbrain/nerv/pull/157) scoped browser acceptance and fixes; Local Chrome screenshot and axe results, 2026-11-06; F-010 |
| Opened | 2026-11-06 |
| Verification | 2026-11-06 Browser/accessibility: all ten Chrome/axe views passed, screenshots inspected; merged PR #157 CI run 42225026067 passed validate, windows and native-macos |
| Reviewed | 2026-11-06 |

</details>

---

### B-032

**Angular navigation widens a 320 px viewport**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: browser/accessibility acceptance and merged CI passed.

| | |
|---|---|
| **Issue** | F-010 browser acceptance with full styles: the mobile navigation row makes a 320 px page about 344 px wide. |
| **Reproduce** | Build and serve the Angular workspace, connect to a temporary backend, and inspect computed styles and axe results. |
| **Check** | English and Italian layouts have no horizontal page overflow at 320, 390 and 1440 px; controls and reminder content remain usable. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #158](https://github.com/voidbrain/nerv/pull/158) after [PR #157 CI](https://github.com/voidbrain/nerv/actions/runs/42225026067) passed validate (including Linux Chrome/axe), windows and native-macos; read with ci:status. Found 2026-11-06 during F-010 acceptance. Fix verified by the repeatable Chrome/axe suite and inspected screenshots; see [scope and evidence](acceptance/angular-2026-11-06.md). No remaining required checks.

**Estimates:** No remaining effort; ~100% complete. Reassessed 2026-11-06 after browser/accessibility acceptance and merged CI passed.

| Field | Value |
|---|---|
| PR / evidence | [PR #157](https://github.com/voidbrain/nerv/pull/157) scoped browser acceptance and fixes; Local Chrome screenshot and axe results, 2026-11-06; F-010 |
| Opened | 2026-11-06 |
| Verification | 2026-11-06 Browser/accessibility: all ten Chrome/axe views passed, screenshots inspected; merged PR #157 CI run 42225026067 passed validate, windows and native-macos |
| Reviewed | 2026-11-06 |

</details>

---

### B-033

**Doctor diagnostic output cannot be keyboard-scrolled**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: browser/accessibility acceptance and merged CI passed.

| | |
|---|---|
| **Issue** | F-010 browser acceptance at 320 px: axe reports scrollable-region-focusable because long doctor JSON scrolls inside a pre without keyboard focus. |
| **Reproduce** | Build and serve the Angular workspace, connect to a temporary backend, and inspect computed styles and axe results. |
| **Check** | The doctor output is a keyboard-focusable labelled region with visible focus; both languages pass axe at narrow widths. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #158](https://github.com/voidbrain/nerv/pull/158) after [PR #157 CI](https://github.com/voidbrain/nerv/actions/runs/42225026067) passed validate (including Linux Chrome/axe), windows and native-macos; read with ci:status. Found 2026-11-06 during F-010 acceptance. Fix verified by the repeatable Chrome/axe suite and inspected screenshots; see [scope and evidence](acceptance/angular-2026-11-06.md). No remaining required checks.

**Estimates:** No remaining effort; ~100% complete. Reassessed 2026-11-06 after browser/accessibility acceptance and merged CI passed.

| Field | Value |
|---|---|
| PR / evidence | [PR #157](https://github.com/voidbrain/nerv/pull/157) scoped browser acceptance and fixes; Local Chrome screenshot and axe results, 2026-11-06; F-010 |
| Opened | 2026-11-06 |
| Verification | 2026-11-06 Browser/accessibility: all ten Chrome/axe views passed, screenshots inspected; merged PR #157 CI run 42225026067 passed validate, windows and native-macos |
| Reviewed | 2026-11-06 |

</details>

---

### F-010

**English-default interface with Italian selectable, and dedicated development port**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: scoped browser acceptance and merged CI passed.

| | |
|---|---|
| **Issue** | Translation and configuration implemented; natural-language interpretation remains F-003. Scoped browser visual/accessibility acceptance passed locally and in merged CI. |
| **Reproduce** | Follow docs/INSTALL.md and the scoped headless implementation checks. |
| **Check** | English default (owner decision 2026-11-04, was Italian), matching translation keys, selectable Italian with the language switcher kept, unchanged reminder content, labelled browser-local dates, development port 4318. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #158](https://github.com/voidbrain/nerv/pull/158) after [PR #157 CI](https://github.com/voidbrain/nerv/actions/runs/42225026067) passed validate (including Linux Chrome/axe), windows and native-macos; read with ci:status. 2026-11-06: repeatable Chrome/axe acceptance passed against the built UI and real local server: English default, selectable Italian, unchanged reminder text/UTC, browser-local dates, 4318 config, applied styles and responsive layout. Four discovered defects B-030–B-033 repaired; screenshots inspected. See [scope, evidence and limits](acceptance/angular-2026-11-06.md). No remaining required checks. Implemented in [PR #1](https://github.com/voidbrain/nerv/pull/1) with Italian as the default; the owner switched the default to English on 2026-11-04 ([PR #17](https://github.com/voidbrain/nerv/pull/17)): `init` writes `en`, the server and socket fall back to `en`, the web UI and `index.html` start in English, the native menu defaults to English unless a choice is stored; the switcher stays in both. Existing installs keep the language in their `config.json` (an `init` before this wrote `it`); set `"language": "en"` there and restart. Understanding and replying in Italian is conversational work under F-003.

**Estimates:** No remaining effort; ~100% complete. Reassessed 2026-11-06 after browser acceptance, defect fixes and merged CI passed.

| Field | Value |
|---|---|
| PR / evidence | [PR #157](https://github.com/voidbrain/nerv/pull/157) scoped browser acceptance and fixes; [PR #1](https://github.com/voidbrain/nerv/pull/1); 10 regression tests and headless process test pass; CI run 41254646946 green; [PR #17](https://github.com/voidbrain/nerv/pull/17) (English default) |
| Opened | 2026-11-01 |
| Verification | 2026-11-04: config default and RPC/doctor fallback asserted `en` in test/runtime.test.ts and test/protocol.test.ts, build, headless and Swift tests (local run; CI green: PR #17 run 41804450728, main run 41804458202; record fix PR #18 run 41804775905, main run 41804783909). 2026-11-06 Browser/accessibility: ten Chrome/axe views passed and screenshots inspected; scope/limits in docs/acceptance/angular-2026-11-06.md; merged PR #157 CI run 42225026067 passed validate, windows and native-macos |
| Reviewed | 2026-11-06 |

</details>

---


### B-028

**`src/contracts.ts` is unused: node and job contracts no module imports**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: approved removal and all required checks passed.

| | |
|---|---|
| **Issue** | Full audit 2026-11-06: `src/contracts.ts` (Capability, NodeAdvertisement, Job, from PR #3) is imported by no module or test, so coverage lists it as never run; the Kaji line (F-036) and F-049/F-050 have their own message types since. |
| **Reproduce** | `grep -rn contracts src test`: only the file itself. |
| **Check** | Either removed, or imported by the module that owns the distributed contract, with its types tested. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #160](https://github.com/voidbrain/nerv/pull/160) after [PR #159 CI](https://github.com/voidbrain/nerv/actions/runs/42233354933) passed validate, windows and native-macos; read with ci:status. The initially cancelled native job was rerun successfully. Owner approved deletion 2026-11-06. Removed the unused contracts file after confirming no importer; Kaji retains its implemented protocol types and shared/surface.ts remains the validated UI contract. Removed the obsolete area-note claim and corrected the README source ownership description. F-006/F-050 will define tested contracts alongside their implementations. Coverage is refreshed deliberately for the removed untested file. Typecheck, coverage suite, build and all ten Chrome/axe browser views passed. The maintenance review was refreshed after the project-only area-note cleanup; the timed consistency review includes validation and elapsed waits, with procedural counters left unknown. No remaining required checks.

**Estimates:** No remaining effort; ~100% complete. Reassessed 2026-11-06 after owner-approved removal, documentation/coverage refresh and green merged CI.

| Field | Value |
|---|---|
| PR / evidence | [PR #159](https://github.com/voidbrain/nerv/pull/159) unused-contract removal and owner-evidence reconciliation; Full audit 2026-11-06 |
| Opened | 2026-11-06 |
| Verification | 2026-11-06 Documentation: no code importer found; deletion approved by owner. Typecheck, coverage suite, build, browser/axe, conventions, integration metadata and refreshed maintenance evidence passed; merged PR #159 CI run 42233354933 passed validate, windows and native-macos |
| Reviewed | 2026-11-06 |

</details>

---


### B-034

**Live dashboard presents hardcoded cloud and budget claims**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: browser checks and merged CI passed.

| | |
|---|---|
| **Issue** | The map always says cloud off/all models local; budget header says $1/day and the summary says $0/local models even though cloud routing may be enabled and model cost accounting is not connected. |
| **Reproduce** | Open the live dashboard with a cloud route configured; inspect map/budget labels and run axe on the Pilots panel. |
| **Check** | Cloud caption follows this base’s route telemetry including unknown; budget tracking is explicitly unavailable with no fabricated daily spend or daily policy claim. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #161](https://github.com/voidbrain/nerv/pull/161) after [PR #160 CI](https://github.com/voidbrain/nerv/actions/runs/42241192687) passed validate, windows and native-macos (ci:status), with local scoped Chrome/axe and screenshot review. Found and candidate fix implemented 2026-11-06 during pilot-model and map review. Map cloud label now reads route health for this base, costs remain explicitly unavailable, and muted badges use --text on their existing tinted background. Focused regressions and scoped Chrome/axe passed; no remaining required checks.

**Estimates:** No remaining effort; ~100% complete. Reassessed 2026-11-06 after regression, scoped browser and green merged CI acceptance.

| Field | Value |
|---|---|
| PR / evidence | [PR #160](https://github.com/voidbrain/nerv/pull/160) pilot selectors/map status and owner clarification; Local source review, regression tests and Chrome/axe, 2026-11-06 |
| Opened | 2026-11-06 |
| Verification | 2026-11-06 Unit/integration and Browser/accessibility: focused checks passed; merged PR #160 CI run 42241192687 passed validate, windows and native-macos |
| Reviewed | 2026-11-06 |

</details>

---

### B-035

**Muted pilot badges fail small-text contrast**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: browser checks and merged CI passed.

| | |
|---|---|
| **Issue** | Scoped axe review of the Pilots panel reports low contrast for the GENERIC badge because muted text is used on a tinted muted background. |
| **Reproduce** | Open the live dashboard with a cloud route configured; inspect map/budget labels and run axe on the Pilots panel. |
| **Check** | Muted badge text uses a readable theme token; scoped Chrome/axe has no contrast violations and existing theme checks pass. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #161](https://github.com/voidbrain/nerv/pull/161) after [PR #160 CI](https://github.com/voidbrain/nerv/actions/runs/42241192687) passed validate, windows and native-macos (ci:status), with local scoped Chrome/axe and screenshot review. Found and candidate fix implemented 2026-11-06 during pilot-model and map review. Map cloud label now reads route health for this base, costs remain explicitly unavailable, and muted badges use --text on their existing tinted background. Focused regressions and scoped Chrome/axe passed; no remaining required checks.

**Estimates:** No remaining effort; ~100% complete. Reassessed 2026-11-06 after regression, scoped browser and green merged CI acceptance.

| Field | Value |
|---|---|
| PR / evidence | [PR #160](https://github.com/voidbrain/nerv/pull/160) pilot selectors/map status and owner clarification; Local source review, regression tests and Chrome/axe, 2026-11-06 |
| Opened | 2026-11-06 |
| Verification | 2026-11-06 Unit/integration and Browser/accessibility: focused checks passed; merged PR #160 CI run 42241192687 passed validate, windows and native-macos |
| Reviewed | 2026-11-06 |

</details>

---

## Closed 2026-11-06

### B-036

**Live map invents synchronization traffic**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: recorded acceptance passed after PR #166 merged.

| | |
|---|---|
| **Issue** | The simulation’s 2.2-second random mesh packet interval also ran in LIVE mode, alongside the real heartbeat observer. |
| **Reproduce** | Use two online enrolled bases with main selected; observe the live map and send an owner message to the other bot. |
| **Check** | No simulated packets in LIVE mode; only an observed changed heartbeat emits sync activity, and actual Telegram messages emit their own directional pulses. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #167](https://github.com/voidbrain/nerv/pull/167) after PR #166 CI runs 42280638858 and 42280632455 passed validate, windows and native-macos (ci:status); the cancelled queued job was rerun successfully.  Candidate fix 2026-11-06 in the F-019 map/Midori work. Live simulation guard and Telegram inbound polling changes have focused regressions; Chrome/scoped axe/mobile and full CI acceptance passed; no remaining required checks.

**Estimates:** No remaining work; ~100% complete. Reassessed 2026-11-06 after all recorded local and merged CI acceptance passed.

| Field | Value |
|---|---|
| PR / evidence | [PR #166](https://github.com/voidbrain/nerv/pull/166) map/tabs and Midori routing/status;  F-019/F-056 implementation and owner report 2026-11-06 |
| Opened | 2026-11-06 |
| Verification | 2026-11-06 Focused regressions, authenticated Chrome review, full suite (206 passed, one platform skip) and PR #166 CI passed. |
| Reviewed | 2026-11-06 |

</details>

---

### B-037

**A routed base’s Telegram bot leaves owner requests unread**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: recorded acceptance passed after PR #166 merged.

| | |
|---|---|
| **Issue** | Owner reports Tabgha does not answer while routing through main. The poll loop deliberately skipped getUpdates whenever main was online. |
| **Reproduce** | Use two online enrolled bases with main selected; observe the live map and send an owner message to the other bot. |
| **Check** | Both configured bots accept only their owner’s messages while outgoing inbox items still route through main; ordinary requests use existing Runtime dispatch, status answers from records, and no request is silently left unread solely because main is online. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #167](https://github.com/voidbrain/nerv/pull/167) after PR #166 CI runs 42280638858 and 42280632455 passed validate, windows and native-macos (ci:status); the cancelled queued job was rerun successfully.  Candidate fix 2026-11-06 in the F-019 map/Midori work. Live simulation guard and Telegram inbound polling changes have focused regressions; Chrome/scoped axe/mobile and full CI acceptance passed; no remaining required checks.

**Estimates:** No remaining work; ~100% complete. Reassessed 2026-11-06 after all recorded local and merged CI acceptance passed.

| Field | Value |
|---|---|
| PR / evidence | [PR #166](https://github.com/voidbrain/nerv/pull/166) map/tabs and Midori routing/status;  F-019/F-056 implementation and owner report 2026-11-06 |
| Opened | 2026-11-06 |
| Verification | 2026-11-06 Focused regressions, authenticated Chrome review, full suite (206 passed, one platform skip) and PR #166 CI passed. |
| Reviewed | 2026-11-06 |

</details>

---

## Closed 2026-11-06

### F-058

**Weekly closure recaps in yearly backlog archives**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: recorded review/adoption acceptance passed; no source deletion is claimed.

| | |
|---|---|
| **Issue** | Owner requests all weekly archive recaps at the top, with links to the first closing section. The reusable index/history guard is being released in the harness. |
| **Reproduce** | Review docs/archive/backlog-2026.md and the legacy docs/NERV sources. |
| **Check** | Adopt published harness 3.2.0, generate Monday–Sunday closure counts/links from archived closing dates, and keep every historical record line protected. Recaps validate in existing CI; the active ledger remains the status authority. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #168](https://github.com/voidbrain/nerv/pull/168) after PR #167 CI runs 42285102671 and 42285107921 passed validate, windows and native-macos (ci:status).  Owner request 2026-11-06. Published upstream v3.2.0 adopted after voidbrain/project-harness PR #62 CI 42283633421 passed and the tag was pushed. Copied tools are read from that tag; BACKLOG-RULES carries the strict derived-index exception; npm recap/check also generate/verify weekly archive indices. Historical record lines remain protected. The optional generic LCOV converter is not adopted here because it would change unrelated coverage behavior; the existing local converter stays unchanged.

**Estimates:** No remaining review/adoption work; ~100% complete. Reassessed 2026-11-06 after merged CI acceptance. The old sources remain only marked deletable, as requested.

| Field | Value |
|---|---|
| PR / evidence | [PR #167](https://github.com/voidbrain/nerv/pull/167) archive adoption/source review and CI reconciliation;  Owner request 2026-11-06; [voidbrain/project-harness#62](https://github.com/voidbrain/project-harness/pull/62), v3.2.0 |
| Opened | 2026-11-06 |
| Verification | Published tag/CI verified; local archive generation, immutable-history guard and recap checks passed. Full suite 206 passed/one platform skip; build, typecheck, conventions, integration metadata, headless lifecycle and Angular browser acceptance passed. Local adoption CI passed in PR #167. |
| Reviewed | 2026-11-06 |

</details>

---

### F-059

**Evaluate the NERV brainstorming folder before retirement**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: recorded review/adoption acceptance passed; no source deletion is claimed.

| | |
|---|---|
| **Issue** | Owner intends to remove docs/NERV and asks whether its ideas have been evaluated or superseded. The folder also contains the still-referenced canonical architecture and a useful dated review. |
| **Reproduce** | Review docs/archive/backlog-2026.md and the legacy docs/NERV sources. |
| **Check** | Every tracked source has a disposition and pinned hash; adopted/rejected concepts map to current owners, undecided proposals are preserved, canonical vocabulary moves to docs with current links, and the dated review is preserved unchanged. No unrequested source deletion or claim that all planned work is implemented. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06 in [PR #168](https://github.com/voidbrain/nerv/pull/168) after PR #167 CI runs 42285102671 and 42285107921 passed validate, windows and native-macos (ci:status).  Owner request 2026-11-06. Scoped documentation/backlog review at 7c0b619 is in docs/audits/2026-11-06-brainstorm-retirement.md and its source manifest. All 25 tracked files were reviewed (13 images visually and with local OCR); .DS_Store is ignored metadata. Architecture vocabulary moved to docs/NERV-ARCHITECTURE.md; the dated review moved unchanged to docs/audits/2026-11-04-rebrand-review.md. No other source was removed. Three undecided proposals are retained explicitly rather than silently rejected or accepted. Current architecture links and a historical archive path note are reconciled.

**Estimates:** No remaining review/adoption work; ~100% complete. Reassessed 2026-11-06 after merged CI acceptance. The old sources remain only marked deletable, as requested.

| Field | Value |
|---|---|
| PR / evidence | [PR #167](https://github.com/voidbrain/nerv/pull/167) archive adoption/source review and CI reconciliation;  Owner request 2026-11-06; docs/audits/2026-11-06-brainstorm-retirement.md |
| Opened | 2026-11-06 |
| Verification | Backlog and scoped audit manifest checks passed; CI passed in PR #167. This is a source review, not product acceptance. |
| Reviewed | 2026-11-06 |

</details>

---


### B-038

**Architecture documentation overstates Sync evidence and Spear compensation**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: recorded checks passed after PR #170 merged.

| | |
|---|---|
| **Issue** | Confirmed documentation defect: source still uses Casper confidence in Sync, and Spear reports inverse metadata without executing it. Correct current documents and issue a dated correction to the immutable report. |
| **Reproduce** | Compare the published retirement crosswalk and current Architecture with policy.ts ballot, Ledger.spear and model.ts route handling. |
| **Check** | All 14 dispositions and 23 crosswalk rows have reasoned judgements, preserved proposals remain unaccepted, and current documentation accurately describes Sync, Spear and route fallback. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06. PR #170 merged after both CI runs 42289559677/42289552958 passed validate, windows and native-macos. All 14 dispositions and 23 crosswalk rows reviewed; fixture synchronization corrected without changing runtime behavior or assertions. Closure reconciliation PR linked below.

**Estimates:** Small; ~100% complete. Closed 2026-11-06 after source review, local checks and merged PR #170 CI.

| Field | Value |
|---|---|
| PR / evidence | [PR #170](https://github.com/voidbrain/nerv/pull/170) |
| Closure PR | [PR #171](https://github.com/voidbrain/nerv/pull/171) |
| Opened | 2026-11-06 |
| Verification | 2026-11-06: ci:status confirms both PR #170 runs green. Four one-channel integration cases passed with coverage locally; full suite 206 passed, one platform skip. Backlog, audit scopes, recaps, conventions, links and whitespace passed. Product proposals remain unaccepted. |
| Reviewed | 2026-11-06 |

</details>

---

### B-039

**Telegram fallback regression asserts state before its response completes**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: recorded checks passed after PR #170 merged.

| | |
|---|---|
| **Issue** | CI run 42289045658 fails one-channel.test.ts:73: fake send request is visible before the client receives acceptance and updates channel state. The parallel run passes. Wait for accepted fallback telemetry before asserting, preserving the required behavior. |
| **Reproduce** | Run the one-channel integration fixture with coverage/concurrent test load; request receipt can precede the awaited API response. |
| **Check** | Regression waits for the local fallback send and accepted local delivery telemetry; unchanged route and delivery assertions pass. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06. PR #170 merged after both CI runs 42289559677/42289552958 passed validate, windows and native-macos. All 14 dispositions and 23 crosswalk rows reviewed; fixture synchronization corrected without changing runtime behavior or assertions. Closure reconciliation PR linked below.

**Estimates:** Small; ~100% complete. Closed 2026-11-06 after source review, local checks and merged PR #170 CI.

| Field | Value |
|---|---|
| PR / evidence | [PR #170](https://github.com/voidbrain/nerv/pull/170) |
| Closure PR | [PR #171](https://github.com/voidbrain/nerv/pull/171) |
| Opened | 2026-11-06 |
| Verification | 2026-11-06: ci:status confirms both PR #170 runs green. Four one-channel integration cases passed with coverage locally; full suite 206 passed, one platform skip. Backlog, audit scopes, recaps, conventions, links and whitespace passed. Product proposals remain unaccepted. |
| Reviewed | 2026-11-06 |

</details>

---

### F-061

**Reassess retired architecture concepts and preserved proposals**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: recorded checks passed after PR #170 merged.

| | |
|---|---|
| **Issue** | Owner requests better/worse/different judgements and reasons, covering both retirement matrices and the undecided proposals. This record owns the assessment only, not implementation of its recommendations. |
| **Reproduce** | Compare the published retirement crosswalk and current Architecture with policy.ts ballot, Ledger.spear and model.ts route handling. |
| **Check** | All 14 dispositions and 23 crosswalk rows have reasoned judgements, preserved proposals remain unaccepted, and current documentation accurately describes Sync, Spear and route fallback. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06. PR #170 merged after both CI runs 42289559677/42289552958 passed validate, windows and native-macos. All 14 dispositions and 23 crosswalk rows reviewed; fixture synchronization corrected without changing runtime behavior or assertions. Closure reconciliation PR linked below.

**Estimates:** Small; ~100% complete. Closed 2026-11-06 after source review, local checks and merged PR #170 CI.

| Field | Value |
|---|---|
| PR / evidence | [PR #170](https://github.com/voidbrain/nerv/pull/170) |
| Closure PR | [PR #171](https://github.com/voidbrain/nerv/pull/171) |
| Opened | 2026-11-06 |
| Verification | 2026-11-06: ci:status confirms both PR #170 runs green. Four one-channel integration cases passed with coverage locally; full suite 206 passed, one platform skip. Backlog, audit scopes, recaps, conventions, links and whitespace passed. Product proposals remain unaccepted. |
| Reviewed | 2026-11-06 |

</details>

---


### F-002

**Harden the reliable core**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟡 Medium | ~100% |

💻 **→ Human action required: No**<br />None: F-002 acceptance passed after PR #173 merged.

| | |
|---|---|
| **Issue** | Local core exists; phone delivery and recurrence belong to F-003. Production deployment is not provisioned. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Restart recovery, no duplicate local inbox delivery, cancellation, auth, invalid input and clean shutdown; production operations separately documented. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-06. PR #173 merged after both CI runs 42295005293/42294998432 passed validate (including 23 Chrome/axe states), windows and native-macos. The dated core acceptance report maps all F-002 checks; production code unchanged. Independent PWA, target-host install and backup acceptance remains in F-004/F-009/F-062.

**Estimates:** Medium; ~100% complete. Earlier ~70% lacked browser evidence; that work and final CI are complete. Project-local impact-map reconciliation was timed; no productivity claim.

| Field | Value |
|---|---|
| PR / evidence | [PR #173](https://github.com/voidbrain/nerv/pull/173); docs/acceptance/core-2026-11-06.md; [PR #157](https://github.com/voidbrain/nerv/pull/157) scoped browser acceptance and fixes; Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks |
| Closure PR | [PR #175](https://github.com/voidbrain/nerv/pull/175) |
| Opened | 2026-11-01 |
| Verification | 2026-11-06: ci:status confirms both PR #173 runs green for validate, windows and native-macos. Local Chrome/axe 23 states; 213 tests passed, one platform skip; three headless cases passed, one Windows-only skip. All named local-core acceptance passed; no physical-phone or hosted-deployment claim. |
| Reviewed | 2026-11-06 |

</details>

---

## Closed 2026-11-07

## Other changes

- 2026-11-07 · [PR #180](https://github.com/voidbrain/nerv/pull/180): complete published harness v3.3.0 reconciliation and repair its failing maintenance gate. Adopt rule-location checks, moved guides and input-bound review evidence; preserve project rules. Optional browser coverage, agent-behaviour runner and push guard remain unadopted. Review: separate fresh-context reviewer found no remaining bugs, security or compliance blockers after the adoption fixes. Local checks passed: typecheck, 228 unit/integration tests (one platform skip), build, browser/axe, headless integration (three passed, one Windows skip), rules, maintenance, backlog/recaps, roadmap, conventions, integration metadata, audit freshness and upstream copied-file parity. Closed 2026-11-07: PR #180 merged as `058b8ee`; ci:status confirms runs [42351766963](https://github.com/voidbrain/nerv/actions/runs/42351766963) and [42351762060](https://github.com/voidbrain/nerv/actions/runs/42351762060) both passed validate, windows and native-macos, including native tests and packaging. No maintenance action remains. Closure evidence: [PR #181](https://github.com/voidbrain/nerv/pull/181). Documentation consistency: README, AGENTS/area notes, BACKLOG-RULES and style guide reviewed; only affected claims updated.

### F-013

**Isolate the scheduler and execution runtime**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />Closed 2026-11-07: all recorded checks passed; no action remains.

| | |
|---|---|
| **Issue** | A/B/C process split, validated IPC and fail-closed lifecycle exist. Web histories now have bounded keyset pages; the dashboard reads bounded facts/SQL aggregates. Brain runs model/planner calls in its own workload boundary; it is not a sandbox. Independent review found no remaining blockers; merged PR #182 CI passed. |
| **Reproduce** | Follow docs/decisions/runtime-boundaries.md and the protocol/isolation test fixtures. |
| **Check** | Blocked/killed Brain leaves due delivery working; Nervous failure shuts supervisor down; no orphaned children; bounded queues/frames; large histories and concurrent CLI writes have measured limits. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Owner selected F-013 first, then F-067 (2026-11-07). Completed bounded reminder/inbox web history, startup-inclusive IPC admission, failure/lifecycle regressions and the observed large-history/concurrent-CLI latency trial; independent review passed. Closed 2026-11-07: all recorded checks passed; no action remains. Blocked/killed Brain leaves due delivery working; Nervous failure shuts supervisor down; no orphaned children; bounded queues/frames; large histories and concurrent CLI writes have measured limits.

**Estimates:** Small remaining effort; ~100% complete. Reassessed 2026-11-07: implementation, local load and browser acceptance passed; independent review and all remote CI checks passed; no remaining work.

| Field | Value |
|---|---|
| PR / evidence | [PR #182](https://github.com/voidbrain/nerv/pull/182) bounded histories/admission and acceptance; [PR #3](https://github.com/voidbrain/nerv/pull/3) runtime; [PR #5](https://github.com/voidbrain/nerv/pull/5) bounded native feeds; [PR #6](https://github.com/voidbrain/nerv/pull/6) lightweight status, CI green at merge `df0a52f` |
| Opened | 2026-11-01 |
| Verification | 2026-11-07 Unit/integration: bounded-history, admission/timeout/migration and sustained CLI load checks passed; three headless lifecycle cases passed, one Windows-only skip. Browser/accessibility: bilingual pages, focus and axe passed. [Scoped acceptance](../acceptance/runtime-2026-11-07.md) records measurements and limits. Full suite: 236 passed, one platform skip. Review: separate fresh-context reviewer found migration, timeout admission, timestamp/count race and focus issues; all fixed with regressions, no remaining blockers. PR #182 merged as 93114f8; runs [42353402738](https://github.com/voidbrain/nerv/actions/runs/42353402738) and [42353398574](https://github.com/voidbrain/nerv/actions/runs/42353398574) passed validate, windows and native-macos. Closed 2026-11-07; closure reconciliation [PR #183](https://github.com/voidbrain/nerv/pull/183). |
| Reviewed | 2026-11-07 |

</details>

---

### F-067

**Bill of materials: dependencies, models and MCP servers in CycloneDX**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />Closed 2026-11-07: implementation and every recorded acceptance check passed.

| | |
|---|---|
| **Issue** | What NERV runs on changes without a commit: Ollama models per role, the cloud model, MCP servers and their fingerprints. Nothing records them in a standard, comparable form, and the npm dependency list is not published either. |
| **Reproduce** | Ask which model answered as Casper last week, or which MCP server version a grant pinned on a given day: only live config and scattered events answer. |
| **Check** | CI attaches a [CycloneDX](https://owasp.org/www-project-cyclonedx/) SBOM of the locked npm dependencies (`npm sbom --sbom-format cyclonedx`). `nerv bom` (or a doctor section) writes a CycloneDX document of this base's configured models (role, route, name, digest when Ollama reports one) and granted MCP servers (name, fingerprint, effect class), with no keys, tokens or owner data; a test validates it against the CycloneDX schema and checks a secret never appears. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Runtime inventory implemented as `nerv bom`: allowlisted configuration only, optional local Ollama digests, granted MCP services, no server execution or credential reads. CI publishes npm lock-only CycloneDX dependency inventory; official schema and real CLI privacy regressions added. All local and remote checks passed; the downloaded CI artifact was inspected and validated. Owner selected implementation after F-013 (2026-11-07). Proposed 2026-11-07 from the OWASP review (see F-065). Two slices: the CI dependency SBOM (tooling, tiny), then the runtime models and services document. The runtime part is also the input F-063 needs to report the model that actually answered.

**Estimates:** Small completed scope; ~100% complete. Reassessed 2026-11-07: runtime CLI and dependency artifact implemented; local validation, independent review and remote CI/artifact acceptance passed; no remaining work.

| Field | Value |
|---|---|
| PR / evidence | [PR #183](https://github.com/voidbrain/nerv/pull/183) implementation/schema/privacy tests; [PR #179](https://github.com/voidbrain/nerv/pull/179) record and roadmap placement |
| Opened | 2026-11-07 |
| Verification | 2026-11-07 Unit/integration: 239 passed, one platform skip; official CycloneDX 1.5/1.6 schema and format validation, exact locked versions, real CLI/fake Ollama, unavailable-provider behavior and secret/owner-data sentinels passed. Typecheck/build, Chrome bilingual paging/focus/axe, three headless integration cases (one Windows skip) and static/record checks passed. Review: separate fresh-context reviewer found disabled-route state, archive links and ignored formats; fixed with regressions, final review found no remaining blockers. PR #183 merged as 04a8e44; runs [42354533567](https://github.com/voidbrain/nerv/actions/runs/42354533567) and [42354530104](https://github.com/voidbrain/nerv/actions/runs/42354530104) passed validate, windows and native-macos. Downloaded dependency-sbom artifact from 42354530104: 389 components, official CycloneDX 1.5 schema/formats and exact direct locked versions passed. Closed 2026-11-07; closure reconciliation [PR #184](https://github.com/voidbrain/nerv/pull/184). Historical per-call identity/usage remains F-063, outside this configuration inventory. |
| Reviewed | 2026-11-07 |

</details>

---

## Other changes

- 2026-11-07 · [PR #185](https://github.com/voidbrain/nerv/pull/185) · Harness v3.4.0 reconciliation (owner requested after F-013/F-067): copied the published skill/audit/MCP guides, catalogue and maintenance workflow unchanged; retained NERV's Node 24 jobs, locked dependency SBOM and project rules. CI actions use official verified release SHAs with release comments; project-only `ciActionPins` and a relation test keep both workflows aligned. Baseline typecheck/build and 239 tests passed (one platform skip). Local validation: 240 tests passed (one platform skip), typecheck/build, browser/axe, three headless cases (one Windows skip), static/record checks and copied parity passed. Measured reconciliation includes the user interruption and local validation waits; publication/remote CI follow the sample. Maintenance evidence renewed and passes. Review: separate fresh-context reviewer verified copied parity, project-rule preservation, action pins and renewed receipt; no blockers. Closed 2026-11-07: merged PR #185 at 0d17fdc; CI runs [42355574146](https://github.com/voidbrain/nerv/actions/runs/42355574146) and [42355572334](https://github.com/voidbrain/nerv/actions/runs/42355572334) passed validate, windows and native-macos. Downloaded the pinned upload action’s dependency-sbom artifact from 42355574146: 389 components, official schema/formats passed. No maintenance action remains. Closure evidence: [PR #186](https://github.com/voidbrain/nerv/pull/186). Optional OpenCRE stays unconfigured; no server or skill is installed.


## Closed 2026-11-07

### F-068

**Linked backlog prerequisites and generated unlocks**

| Signal | Priority | Status | Effort | Complete |
|---|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />No action remains; dependency links and generated unlocks are verified.

| | |
|---|---|
| **Issue** | Prerequisites live in prose, making sequencing and downstream impact hard to inspect. |
| **Reproduce** | Find the records that depend on F-063 or the execution capabilities required by F-012. |
| **Check** | Published harness release reconciled; reviewed hard prerequisites linked with required outcomes; Unlocks generated from those fields; local graph and freshness checks in CI; backlog and roadmap consistent. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-07 after PR #187 merged with CI runs 42373292192/42373290475 passing validate, windows and native-macos. Downloaded dependency-SBOM from 42373292192: 389 components passed the official CycloneDX schema and formats. Adopted published harness [v3.5.0](https://github.com/voidbrain/project-harness/tree/v3.5.0), commit 1865b2a10f53b293d8d76d1e8149f6bc1079439b after [upstream PR #75](https://github.com/voidbrain/project-harness/pull/75) passed CI 42372844701. Copied the released generator unchanged, reconciled the optional rule, registered scripts and impact/CI checks, and reviewed existing explicit prerequisites. Generated Unlocks has one source; local checks do not infer acceptance, execute jobs or check external state. No new integration or skill needed. Review: separate fresh-context agent confirmed released-copy parity, dependency semantics, ownership and rule/CI/roadmap consistency with no actionable findings. Local typecheck/build, 240 tests (one platform skip), and backlog/recap/roadmap/dependencies/conventions/integrations/rules passed. Browser/accessibility acceptance also passed locally. Native fixture/tests/app packaging are deferred to native-macos CI because this change only adds a documentation check and updates the template pin, with no native source changes. All remote CI jobs and the dependency-SBOM artifact are now verified.

**Estimates:** 2026-11-07: Small, ~100%; release/adoption, review, local checks, all CI jobs and artifact verification complete.

| Field | Value |
|---|---|
| PR / evidence | [PR #188](https://github.com/voidbrain/nerv/pull/188) closure reconciliation;  [PR #187](https://github.com/voidbrain/nerv/pull/187) harness adoption and dependency links |
| Opened | 2026-11-07 |
| Verification | Documentation: 2026-11-07, fresh-context adoption review found no actionable issues. Script: 2026-11-07, typecheck/build, 240 tests (one platform skip), browser/axe and static/ledger checks passed locally. Remote CI: 2026-11-07, runs 42373292192/42373290475 all passed including native tests/package. SBOM artifact: official schema and formats passed, 389 components. |
| Reviewed | 2026-11-07 |

</details>

---

### F-063

**Measured model usage and cost, with the model that actually answered**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: backend accounting verified and closed; F-019 owns dashboard display.

| | |
|---|---|
| **Issue** | Preserved proposal 2 of the [architecture reassessment](../audits/2026-11-06-architecture-reassessment.md#2-token-and-cost-accounting-useful-before-expanding-paid-cloud-use): the policy checks a declared action cost against the sortie budget and `Ledger.propose` defaults an omitted cost to zero, which is not provider usage. The cloud route allows same-provider server-side model substitution, so the model that answered can differ from the one asked for and is not recorded. |
| **Reproduce** | Ask Misato something on the cloud route; the ledger records the configured model and no tokens or spend. |
| **Check** | Per call: route, requested and returned model, provider-reported input/output tokens when available, duration, outcome and whether each value is measured, estimated or unavailable; no prompts or credentials stored to count usage; spend shown with price provenance; a timeout leaves usage unknown, never zero; a known test call reconciles. The dashboard (F-019) shows it. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-07 after PR #189 merged with runs 42376072311/42376068960 passing validate, windows and native-macos. Backend acceptance is complete; display remains F-019 as scoped before implementation.  Implemented 2026-11-07: durable pending observations before brain dispatch, provider-reported tokens and actual model, all role paths, paged authenticated API and explicit dated price snapshots. No UI change or pre-call enforcement; F-019 remains responsible for display. Known synthetic calls reconcile across provider/process/persistence/API for every model role; no paid live call or invoice reconciliation is claimed. SDK automatic retries are disabled to avoid hidden attempts. Review: fresh-context reviewer found invalid calendar price dates were accepted; corrected with round-trip date validation and rejection tests. No other actionable finding. Proposed 2026-11-06. Split out of F-019, which keeps the display: this record owns measurement and attribution in the backend. Context occupancy ("estimated input / configured context limit") is a later, lower-priority diagnostic and is not in this scope; it is never an authorization signal. A pre-call budget limit and later reconciliation are separate controls.

**Estimates:** Small, ~100%. Reassessed 2026-11-07: backend implementation, independent review, local acceptance and merged remote CI complete. F-019 owns dashboard work.

| Field | Value |
|---|---|
| PR / evidence | [PR #190](https://github.com/voidbrain/nerv/pull/190) closure reconciliation; [PR #189](https://github.com/voidbrain/nerv/pull/189) F-063 backend accounting and display-scope reconciliation; [PR #172](https://github.com/voidbrain/nerv/pull/172) record and roadmap placement; [Architecture reassessment](../audits/2026-11-06-architecture-reassessment.md), 2026-11-06 |
| Opened | 2026-11-06 |
| Verification | 2026-11-07 Unit/integration: full suite 245 passed, one platform skip before final refinements; final six focused accounting tests passed, including all roles, restart unknowns, fallback, cache/refusal accounting and authenticated HTTP. Typecheck, build, conventions and integrations passed. Browser/accessibility: existing Angular Chrome/axe acceptance passed. Headless: three passed, one Windows-only skip. Native Swift: nine passed, one absent live-TLS fixture skip; local ad-hoc app packaging passed. Remote CI: 2026-11-07 runs 42376072311/42376068960 passed validate, windows and native-macos. |
| Reviewed | 2026-11-07 |

</details>

---

### F-019

**Live decision-flow observability (dashboard bound to real stages)**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified and closed; work continues in F-003.

| | |
|---|---|
| **Issue** | The current `/dashboard/` served from `web/public/dashboard/` shows real sortie stages, but its Battery panel is still planned and state changes wait for a poll. Operators need measured accounting and prompt updates. `dashboard1.html` is historical prototype evidence only. |
| **Reproduce** | Run Green, Orange and Blue sorties; open the dashboard; confirm the active step, Pattern, MAGI verdicts, Sync Ratio inputs, approval card and outcome match the ledger. |
| **Check** | The shipped /dashboard/ tree, MAGI and structured/filterable Comms reflect real ledger state and Pattern/Sync Ratio. Battery shows bounded accounting pages, actual/requested models, measured tokens, outcomes/duration and cost provenance; unknowns remain unavailable and currencies/page subtotals stay distinct. Authenticated change notifications refresh state with reconnect/polling recovery; search covers loaded memory/Comms and distant reminders use calendar units. Demo remains explicitly separate; existing skins work. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-07 after PR #191 merged with all validate/windows/native-macos checks passing in runs 42378326649/42378322818.  Implemented 2026-11-07: accounting pages and fetch/SSE change invalidations; full source and real-process tests cover reported costs/unknowns, external CLI writes, reconnect, expiry and stream admission. Same search now filters/highlights loaded memory/Comms; calendar labels cover years/months/days. Browser /dashboard accounting/paging/mobile/axe and push refresh passed before the final search/date additions; independent fresh-context review fixed failed-paging cursor mutation and BFCache refresh restoration, then re-review found no remaining findings. See [dated acceptance](../acceptance/dashboard-2026-11-07.md). Final navigation-away/Back browser acceptance passed; remote CI and merge remain. Owner order 2026-11-07: complete F-019, then F-003. Implement against the shipped `/dashboard/`, never the retired dashboard1.html prototype. Accounting display uses bounded pages and explicit per-page currency subtotals, actual/requested model, reported tokens, duration/outcome and dated price provenance; limits/forecasts stay unavailable. Authenticated change notifications prompt current-page reads with polling recovery.  F-063 backend accounting is verified and closed (2026-11-07), merged in PR #189 after all six CI jobs passed. This record still owns the display; keep the planned/unavailable UI until connected. Estimates remain valid: display and pushed events remain. 2026-11-06 ([architecture reassessment](../audits/2026-11-06-architecture-reassessment.md)): measuring usage, cost and the model that actually answered moves to F-063; this record keeps showing it. F-063 has delivered the backend; the UI remains unavailable until this record connects it. Owner refinements 2026-11-06 implemented: Models and Battery tabs share a panel, preserve drafts/polling and support arrow/Home/End navigation; budget shortcut opens Battery. Legend uses “■ Bases” and “- Kaji line”, distinct heading text, lowercase sync, no extra headings or cloud caption; map height equals legend. Midori is a small round Telegram node; uniform status-coloured base labels, main as a larger square and this base’s square surrounded by a larger outline-only circle, no separate per-base Telegram circles, smaller contour waves. Midori has no Unknown/API-unchecked caption; its marker/name are muted when the API check is missing or stale. Active outbound paths go through main when routed, directly from fallback bases otherwise. New API-result/polling and last-received telemetry separates recent API response from configuration and phone receipt; message pulses represent newly observed owner receives or accepted sends only. Initial snapshots, empty polling and failures do not fabricate activity. Fixed B-036 (random live sync simulation) and B-037 (routed bot stops reading owner messages), tracked separately below. Owner message on old Tabgha v171 is evidence of a received phone message, not of an emitted inbound telemetry field; older code cannot publish the new fields. Angular CLI analytics explicitly disabled. Chrome has verified tabs/drafts/keyboard, equal map/legend height, routing versus fallback topology and scoped axe/mobile layout; Final Chrome/scoped axe/mobile rerun passed: map and legend both 148.16 px, no 390 px overflow, one routed main path and two fallback paths; model drafts/keyboard and deterministic status replies passed. Full suite 206 passed, one platform skip; three headless lifecycle checks and ten Angular Chrome/axe views passed. PR #166 merged after all CI checks passed (runs 42280638858/42280632455); the cancelled queued macOS job was rerun successfully. The timed project-document reconciliation covers area-note review through validation, including waits; no counters were inferred.  Owner preference 2026-11-06: combine the Models · Misato & Casper and Battery · Budget panels into one panel with two tabs, **Models** and **Usage & budget**. Models retains Misato/Casper selectors and cloud-route controls; pilot selectors remain in their own pilot cards. Usage & budget continues to say cost tracking planned until real accounting exists. This layout can be implemented independently of accounting; verify keyboard-accessible tabs, retained model drafts across tab switches/polling, and narrow-screen layout. The implemented tabs now use the owner’s preferred Battery name; accounting remains planned. PR #165 CI exposed a fixture race: the fake recipient records the recovered message before its signed relay response reaches the sender. The recovery check now waits for both recipient recording and sender telemetry, preserving the via-main requirement.  Channel telemetry slice in [PR #163](https://github.com/voidbrain/nerv/pull/163), 2026-11-06: Aoba records its actual route checks (via main, local fallback, local channel, unavailable or unknown), destination base and last send route/result/time. Both signed heartbeat directions carry only that base's own sanitized report; receivers stamp arrival, older/malformed reports clear previous telemetry, and online heartbeats cannot refresh an old route check. Runtime /api/bases marks reports fresh only within the existing 90-second online window and while enrolled/online; stale evidence stays visible as last reported/unknown. The bases panel shows the route, checked time and last send separately, with phone receipt explicitly unknown; an unconfigured channel and an older peer stay distinct. Standalone bases report through doctor. No token, chat ID, owner/account identifier, message text or provider error is shared. Existing relay/fallback behavior is preserved, with regressions for main-online delivery failure, own-bot fallback, relay recovery and main-offline fallback; two real runtimes cover heartbeat → authenticated bases API, freshness and old-peer omission. Remaining: cost accounting, pushed events and any separately designed round channel nodes; this slice does not establish phone delivery.  PR #160 map/label slice verified 2026-11-06: local regression and browser review plus merged CI run 42241192687 (validate, windows, native-macos green).  Owner clarification 2026-11-06: “if main is not delivering I will Telegram myself” already works. Source confirms src/telegram.ts out() relays while the main base is available and falls back to this base’s own bot when relay delivery fails; src/cli.ts supplies main-base availability. Record this as implemented behavior and owner-reported working evidence, not new routing work. The sharing/display plan is now implemented by the channel telemetry slice above; online heartbeats still do not establish delivery success. Aoba/Telegram may later appear as a round channel node, distinct from enrolled NERV bases. PR #160 added “Sync”, grouped legend headings and this base’s measured cloud-route state; this later slice publishes channel telemetry separately. Budget accounting remains unconnected and must be shown as unavailable; the two-tab panel layout is now explicitly planned above and does not implement accounting.  Owner correction 2026-11-05: on the map the strong marker is *this* base (the one showing the page), not the main base ([PR #137](https://github.com/voidbrain/nerv/pull/137)). Search highlight done in [PR #131](https://github.com/voidbrain/nerv/pull/131) (owner, 2026-11-05: "searched text is not highlighted, still not done?": it was only listed): the searched text is marked in each sortie card's title (escaped first, case-insensitive, regex characters literal). Same change, the bases map (owner): labels and markers scale with the canvas so they read at about 12 px in the smaller map, in the theme's font with a fallback; the main base is bigger, ringed and bold (this base when none is flagged); other bases get a scattered spot from their ID, the same on every reload, instead of a column. Checked: test/dashboard.test.ts, a screenshot of the map. Owner check 2026-11-05 of the route colours (#62): ADVISE stayed unlit (orange in Eva) after the consultant advised, because live mode never marked it passed; Misato's apartment showed green after an approved card instead of the decision colour. Fixed in [PR #127](https://github.com/voidbrain/nerv/pull/127): live mode marks ADVISE passed when advice was given; a passed apartment takes the decision colour (Eva and the Simple timeline). Checked in headless Chrome (a no-card sortie: ADVISE and Misato green, apartment faded; an approved one: apartment yellow) and by test/dashboard.test.ts. Owner, 2026-11-05: on start the dashboard selected the last sortie; by default it now shows the real state: only a running sortie is selected by itself (and let go when it finishes), otherwise none; a sortie the owner clicks stays selected ([PR #125](https://github.com/voidbrain/nerv/pull/125)). Owner requests 2026-11-05: highlight the searched text in the sortie list; the same search over Lilith (memory) and Comms; relative times in years, months and days ("in 3 years 2 months", "in 1 month 12 days", never "in 1167 days"; its date was right: 2030 was in the request, a test date, B-003); a spinner on the card of a running sortie; on a new request or a refresh, select the running sortie. Owner request 2026-11-05 ([PR #89](https://github.com/voidbrain/nerv/pull/89)): the chosen theme and the CRT effect are remembered in this browser (localStorage, a per-viewer preference; `?theme=` still wins; without storage the default theme); checked in headless Chrome (Light kept across a reload). **Next action / closure evidence:** Owner report 2026-11-05 ([PR #79](https://github.com/voidbrain/nerv/pull/79)): on a new base (Tabgha) Comms stayed blank until the first request: with no sorties yet nothing was added on the first refresh, so the panel was never drawn, not even its empty state. The first refresh now always draws it. Owner report 2026-11-04 ([PR #77](https://github.com/voidbrain/nerv/pull/77)): while the flow replays, the Sephirot lines changed width (1.4, 1.8 and 2 px by state) and their arrowheads grew with them, so the picture seemed to move. Now every line has one width (colour and dash tell the states apart), arrowheads are sized in pixels, and each column always reserves its scrollbar's space, so a scrollbar appearing can never shift the layout. Measured in headless Chrome on live data at 1920×1080, 1440×900 and 1280×800: no node changes position or size during a replay. **Next action / closure evidence:** Owner request 2026-11-04 ([PR #75](https://github.com/voidbrain/nerv/pull/75)): a sortie picked in the list redraws its flow step by step (450 ms a step, from Detection to where it stands; none with reduced motion), a second click on the selected card deselects it (and nothing is selected again by itself), the card says `aria-pressed`, and the Health panel is titled *Health*. Checked in headless Chrome on the demo: frames advance detect → intake → route → plan → MAGI → sync → apartment, the second click leaves no sortie selected. Earlier: Owner request 2026-11-04 ([PR #70](https://github.com/voidbrain/nerv/pull/70)): five practical additions to the dashboard. (1) **Coming up** lists every pending reminder with inline **Edit** (title and time; a refresh never wipes the form) and **Cancel**, through a new `PATCH /api/reminders/ID` (scheduler method `reminders.update`, same validation as a new reminder, admin only). (2) **Search** in Sorties (`/`) filters what is loaded at once and asks the service for matching titles in all history (`GET /api/sorties?q=`, literal and case-insensitive); **Load older sorties** pages back 50 at a time. (3) **Keys**: `a` approve, `r` reject, two presses each, the first says what the second will do; `Esc` cancels. (4) **Why**: every sortie summary carries one sentence (src/why.ts, from the ledger, no model), shown on its card. (5) **Empty states** say what to do next (needs, sorties, filters, search, coming up, Comms, detail). Tested: test/why.test.ts and an HTTP test through the scheduler process (search, why, edit, cancel); driven in headless Chrome against a throwaway service (search, Esc, two-press approve, edit surviving a refresh, Load older). A check in the owner's browser is still due. Earlier: Owner request 2026-11-04 ([PR #69](https://github.com/voidbrain/nerv/pull/69)): the four EVA cages sit in one row (two per row on phones); a cage's truncated description shows in full on hover. Checked with headless Chrome at 1920×1080 and 1440×900 in live mode. Earlier: Owner request 2026-11-04 ([PR #68](https://github.com/voidbrain/nerv/pull/68)): the dashboard fits one page on wide screens (≥1201 px: the page no longer scrolls, each column scrolls on its own); the big MAGI is at most 360 px wide; the Sephirot has side padding so the loop lanes back to Misato run inside it, not along the border; EVA cage and Da'at · Debrief share a row, with tighter row gaps and MAGI seats. The four EVA cage slots (EVA-00 prototype, EVA-01 test, EVA-02 production, EVA-03 quarantine) are reserved in live mode: only EVA-02, the in-process executor, is active; the others show PLANNED until their sandboxes exist. Checked with headless Chrome screenshots at 1920×1080 and 1440×900 (demo) and in live mode; a check in the owner's browser is still due. Earlier: Owner report 2026-11-04 ([PR #67](https://github.com/voidbrain/nerv/pull/67)): Comms was empty until a click — the trace loaded only for the selected sortie, none was selected on the first refresh, and the periodic redraw did not include Comms. Now the first refresh loads the five most recent sorties' traces, later ones keep the selected and every open sortie up to date, and Comms redraws whenever new lines arrive (not on every refresh, so scrolling back stays put). Owner review 2026-11-04 ([PR #66](https://github.com/voidbrain/nerv/pull/66)): this base's map pulse, bases badge and EVA cage beat follow its real health from doctor (online; DEGRADED in yellow when the brain is down or Misato has no model route; down when the scheduler is gone); a pulse travels the Kaji line each time a peer's heartbeat actually arrives; Entry Plug's subtitle names who acts ("Ritsuko signs the A.T. Field"; the node keeps its step name). Peers' own health in the heartbeat is next (phase 2). Owner review 2026-11-04 ([PR #65](https://github.com/voidbrain/nerv/pull/65)): fan-outs and merges share one turning bar (Detection → Binah/Chokhmah, TIFERET → Hod/Netzach, Hod/Netzach → Yesod); a loop back to Misato's plan resets every step after the plan, so only the current pass lights up and a step this pass bypasses never looks passed (live: stages after the plan come from the latest action only; simulation: returning to the plan clears them); the dim earlier-pass style is gone. Owner review 2026-11-04 ([PR #64](https://github.com/voidbrain/nerv/pull/64)): Sephirot lines are orthogonal — they leave and enter a node only at the middle of its N, S, E or W side with 90° turns in the gaps, loops back to Misato in their own lanes along the right edge, never behind a node — and end in an arrowhead; after a loop, steps reached only in an earlier pass are drawn dim dashed, so bright green means passed in this pass. Owner review 2026-11-04 ([PR #63](https://github.com/voidbrain/nerv/pull/63)): live sortie detail says who started it (you, or Misato from a chat) and its status instead of the simulation's "pilot … stage · editable by you" (pilots are skills; Misato is the planner), says when Misato answered without any action, shows the Spear only on open sorties and no battery line; the Sephirot's own request box (a duplicate of Comms' Ask Misato) and the SIDE RAILS legend are removed in both modes; approval cards drop the pilot label in live mode. Owner request 2026-11-04 ([PR #62](https://github.com/voidbrain/nerv/pull/62)): Sephirot lines show the route already taken — green when a step passed on its own, yellow (solid) through the owner's decision in Misato's apartment, faded into skipped steps — under the existing live (moving), waiting (yellow dashed) and reject (red) styles; it follows the selected sortie, so clicking any sortie shows its route. Owner report 2026-11-04: after reloading the live dashboard it showed simulated bases (TOKYO-3, NERV-01 with invented CPU) as if real — the one-use code is removed after sign-in, so a reload fell back to the simulation. Fixed in [PR #58](https://github.com/voidbrain/nerv/pull/58): served by the service the page is always live, and without a code it shows a NOT SIGNED IN bar with a memory-only token field and the `nerv open dashboard` hint; the simulation runs only from a file or with `?demo`. Checked in headless Chrome (no code: sign-in bar, no invented data; `?demo`: simulation; with a code: live). Owner 2026-11-04 ([PR #55](https://github.com/voidbrain/nerv/pull/55)): the last Sephirot node, Debrief, is named Da'at (the hidden sephira of knowledge: the sortie's outcome written into Central Dogma). Owner review 2026-11-04 ([PR #49](https://github.com/voidbrain/nerv/pull/49)): the job list scrolls on its own; in the Sephirot view TIFERET (the MAGI) is framed apart from the rest of the loop; live EVA cages show the one real executor honestly — EVA-02, in-process in the scheduler, not sandboxed yet — beating when an action newly ran (sandboxed cages remain planned). Live slice 2 in [PR #39](https://github.com/voidbrain/nerv/pull/39): **Reload models** in the Health panel (`POST /api/models/reload`, roles shown; the reload control promised on 2026-11-04), **While you were away** from real sortie closes and inbox deliveries since the last *Mark as read* (localStorage, per browser), and **Spear this sortie** backed by the new admin-only `POST /api/sorties/ID/spear` (through the scheduler process; 404 for unknown sorties; a stood-down card can no longer be approved, and a speared Misato sortie never resumes). Checked: test/dashboard.test.ts (Spear across processes: 401 without the token, card stood down, sortie revoked, late approval refused, 404) and headless Chrome (the three controls render, no console errors). Live slice 1 in [PR #36](https://github.com/voidbrain/nerv/pull/36): the dashboard moved to `web/public/dashboard/` (one copy; `docs/NERV/nerv-agency-dashboard.html` redirects there), runs under the service CSP (script in files, d3 replaced by a built-in marching-squares contour drawer, no remote font), is served at `/dashboard/`, and `npm start -- open dashboard` signs it in. `live.js` maps `GET /api/sorties` (new: newest first, counts, Patterns), `GET /api/sorties/ID` (new: actions with tool, args, ballot and outcome), events, approvals, pending reminders and doctor onto the panels; Approve/Reject call the real API, typing sends to Misato; TOKYO-3 alone on the map; panels without data say planned. Checked: test/dashboard.test.ts (reads, no grant IDs, paging, 404/400/401, `/dashboard` serving, no inline/remote script), the headless process test (`open dashboard` link and served page), and headless Chrome against a temporary service with a Green and a Blue sortie (LIVE banner, both sorties, the Blue card with buttons, planned panels, map drawn; a first-render error that stopped the map was found and fixed). Prototype 2026-11-04: `docs/NERV/nerv-agency-dashboard.html` (simulation, same ballot rules as `src/policy.ts`). It answers the five owner questions at the top (needs you, while you were away, coming up, broken or stuck, budget with limit and forecast); approval cards show the exact action, args, effect and undo, Pattern, Sync Ratio with its inputs, verdicts, why it stopped and the TTL; Pattern is the system's output (no risk buttons); the plan step is visible; a sortie list keeps history and several sorties run at once. One flow view: EVA Full draws the Sephirot tree with the big MAGI at its centre and the plan loops on the side; other themes show a compact decision timeline with the three MAGI seats inside. Owner decisions on decoration: keep MAGI (smaller), machine CPU/GPU/RAM on bases instead of per seat, a topographic map with real base positions (status-coloured pulses, dashed Kaji line, message pulses), EVA cage heartbeats instead of sync waves, no confidence slider or random jitter. Then define a versioned job-stage and decision-event schema emitted by the coordinator. Bind dashboard panels (and any NERV skin) to that stream. Keep Eva framing as optional skin; functional observability must work without it. Depends on the F-024 event schema (one schema for ledger, traces and the dashboard; now `src/events.ts`, versioned, [PR #16](https://github.com/voidbrain/nerv/pull/16): read pages by sequence, they may hold fewer than 50) and F-017 ballots. Owner review 2026-11-04 ([PR #25](https://github.com/voidbrain/nerv/pull/25)): the base map is a zoomed regional topographic sheet (procedural hills and valleys, index contours), not the world, with the three bases in the same district; panel header tags are orange on a black square tag; the title drops the "NERV Agency //" prefix already shown by the brand block; the cloud route reads off, since all models are local for now. Second pass ([PR #26](https://github.com/voidbrain/nerv/pull/26), corrected in [PR #27](https://github.com/voidbrain/nerv/pull/27)): Kaji links are straight lines (the owner's "not a straight line" meant the bases, not the links); every pair of bases exchanges node-sync messages, not only Tokyo-3; the bases form a triangle across the sheet. Still missing from the prototype: memory (Lilith) and channel views, and a model-reload control showing the roles in use (owner request 2026-11-04; admin only, calls `POST /api/models/reload`).

**Estimates:** Small, ~100%. Reassessed 2026-11-07: all implementation, review, local and remote acceptance complete. Historical estimate: Medium remaining effort; ~80% complete. Reassessed 2026-11-06 after PR #163 merged with all CI checks green: channel-state sharing/display is verified through real relay and signed heartbeat/API regressions plus Chrome/axe and mobile review. The tab/map and Midori/API/inbound refinements are implemented with local acceptance pending final CI. Overall Medium and ~80% remain valid because cost accounting and pushed events still remain. Reassessed 2026-11-07: explicit prerequisite outcomes preserve the existing scope and remaining-work estimate; independent slices can proceed.

| Field | Value |
|---|---|
| Depends on | [F-063](#f-063) — Measured usage and cost before displaying real accounting |
| PR / evidence | [PR #192](https://github.com/voidbrain/nerv/pull/192) F-019 closure reconciliation and next-record work; [PR #191](https://github.com/voidbrain/nerv/pull/191) accounting, pushed invalidations, loaded search/calendar labels, review and acceptance; [PR #189](https://github.com/voidbrain/nerv/pull/189) F-063 backend accounting and display-scope reconciliation; [PR #187](https://github.com/voidbrain/nerv/pull/187) reviewed prerequisite links;  [PR #167](https://github.com/voidbrain/nerv/pull/167) archive adoption/source review and CI reconciliation;  [PR #166](https://github.com/voidbrain/nerv/pull/166) map/tabs and Midori routing/status;  [PR #165](https://github.com/voidbrain/nerv/pull/165) two-tab panel plan;  [PR #164](https://github.com/voidbrain/nerv/pull/164) verified telemetry reconciliation;  [PR #163](https://github.com/voidbrain/nerv/pull/163) channel telemetry and CI reconciliation;  [PR #161](https://github.com/voidbrain/nerv/pull/161) verification reconciliation;  [PR #160](https://github.com/voidbrain/nerv/pull/160) pilot selectors/map status and owner clarification; docs/NERV/nerv-agency-dashboard.html (prototype, [PR #12](https://github.com/voidbrain/nerv/pull/12) and [PR #13](https://github.com/voidbrain/nerv/pull/13): comms panel with chat, image slots listed in docs/NERV/assets/README.md; [PR #25](https://github.com/voidbrain/nerv/pull/25): regional map, header tags, title; [PR #26](https://github.com/voidbrain/nerv/pull/26): node-to-node traffic; [PR #27](https://github.com/voidbrain/nerv/pull/27): straight links); earlier docs/NERV/dashboard-agnostic-2.html; review docs/audits/2026-11-04-rebrand-review.md §6; [PR #36](https://github.com/voidbrain/nerv/pull/36) (live slice 1); [PR #39](https://github.com/voidbrain/nerv/pull/39) (reload, away, Spear) |
| Opened | 2026-11-02 |
| Verification | 2026-11-07 Unit/integration: full suite 253 passed, one platform skip; focused dashboard and stream tests passed, including external SQLite writes, session expiry, bounded streams, page failure recovery and calendar units; typecheck/build/static checks passed. Browser/accessibility: /dashboard accounting/paging/search, desktop/mobile scoped axe and push-only refresh passed; final navigation-away/Back restoration passed. Native: nine Swift tests passed, one live-TLS fixture skip; preview packaging passed. Headless: three passed, one Windows-only skip. Remote CI: final runs 42378326649/42378322818 passed all six jobs. Earlier CI: first run found an omitted generated roadmap (committed); second exposed an existing Angular history test racing its loading guard. The test now waits for aria-disabled=false with all paging/focus expectations unchanged; local Chrome rerun passed. Final CI now passed. Historical evidence: 2026-11-06 Human: owner reports Telegram self-delivery fallback works; source review confirms existing relay/fallback paths. Per-base sharing: focused tests pass for actual relay/fallback transitions, signed two-runtime heartbeat/API state, stale reports and old-peer omission. Chrome: authenticated service with controlled bases fixtures checked local fallback, stale/offline and absent reports, zero scoped axe violations; desktop/mobile screenshots inspected, no 390 px page overflow. Full suite: 200 passed and one platform-only skip; build, static checks, three headless lifecycle cases and all ten Angular Chrome/axe views passed. Merged PR #163 CI runs 42250531835 and 42250519742 passed validate, windows and native-macos (ci:status); channel telemetry slice verified. Earlier evidence: 2026-11-04 live slice 1: tests and headless Chrome run above (local run; CI green: PR #36) |
| Reviewed | 2026-11-07 |

</details>

---

### F-003

**Models, Telegram, memory and proactive briefs**

| Signal | Priority | Status | Effort | Complete |
|:---:|---|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small | ~100% |

💻 **→ Human action required: No**<br />None: verified and closed after reviewed implementation and green CI.

| | |
|---|---|
| **Issue** | Model routes, the gated planner, Telegram and briefs are implemented. Scheduled Instrumentality failures still need durable visibility and a bounded later retry; messaging reliability and language acceptance need reconciled evidence. |
| **Reproduce** | Follow README commands and the owning milestone in ROADMAP. |
| **Check** | Italian/English commands, replying in the language the owner wrote in (owner, 2026-11-04: English is the default, Italian must be understood and answered in Italian), local-only privacy, no cloud fallback without permission, restart/retry/channel failure tests and live phone delivery. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-07 after PR #192 merged with runs 42379685099/42379679262 passing validate, windows and native-macos.  Implementation 2026-11-07 after F-019 merged: scheduled claims persist before model dispatch, allow at most two attempts per local-day slot separated by an hour, fence stale results and keep fixed reasons without prompts/provider errors. Health and bilingual briefs show failed/skipped/recovered outcomes. Added real-process failure→restart→backoff→recovery and Telegram delivery failure/restart/checkpoint/language checks. Independent fresh-context P1 review found and resolved an episode/outcome crash gap and stale failure reasons; re-review found no remaining blockers. Episode/outcome writes now share one transaction. Final local checks and all merged CI jobs passed. See [dated acceptance](../acceptance/assistant-2026-11-07.md).  Owner order 2026-11-07: work on this record after F-019. Review implemented messaging acceptance and finish Instrumentality failure visibility and bounded same-day retry, then reassess required channel/language/privacy acceptance.  Owner question 2026-11-05 (what if Instrumentality cannot run at 03:00?): historically it ran at the first chance after 03:00 and retried an unreadable digest once, then skipped silently. The digest input remains bounded; this change adds durable recovery rather than an unlimited historical replay. Now implemented: a failed or skipped night shows in health and in the next brief with its reason (*Instrumentality did not run last night: the local route was down*), and a retry later the same day. Owner report 2026-11-05: Telegram replies kept switching between Italian and English. The ledger showed the planner model (qwen2.5-coder:14b) answering *How is weather today?* in Italian and a follow-up to *Remember I don't like beer* in Italian, despite the rule to match the request. Fixed in [PR #94](https://github.com/voidbrain/nerv/pull/94): the service decides the reply language from the owner's message (`requestLanguage`, falling back to the earlier exchanges) and Misato's prompt says it outright (*Write the reply in English: the owner wrote in English…*), on every step including the follow-up after an approval. Checked: test/consultant.test.ts (the owner's real messages detected right; English after an Italian exchange; the follow-up after an approval), suite passing. Schedules by chat in [PR #45](https://github.com/voidbrain/nerv/pull/45) (owner request 2026-11-04: "move brief at 9, brief at 8.30"): tool `settings.schedule` (Green, reversible) changes only the brief time and the Instrumentality schedule; `serve` re-reads them every minute, so no restart; live on Ollama: "sposta il brief alle 9" and "brief alle 8 e mezza e instrumentality quando sono inattivo" each applied in one action. Hyuga's daily brief in [PR #38](https://github.com/voidbrain/nerv/pull/38): `src/brief.ts` builds it from facts (cards waiting, reminders due in 24 h in local time, sorties finished or failed since the previous brief, health) in the configured language, no model; `config.brief.at` (HH:MM, owner's time zone); Aoba sends it once per local day, recorded before sending so a restart never repeats it; `npm start -- brief` prints it. Run on the owner's real data 2026-11-04. Owner Telegram feedback 2026-11-04 ("show notes works, delete note 1 workish, delete all doesn't: switches en/it, replies with the list, asks confirmation then nothing") fixed in [PR #37](https://github.com/voidbrain/nerv/pull/37): each request records its conversation (`telegram:CHAT`, `cli`, `dashboard`) and Misato sees the last 3 exchanges of the same one within 30 minutes (`Ledger.conversation`), so a "sì" has its question; `reminders.cancel` takes `ids` (up to 20) and gained an inverse, `reminders.restore`, so a bulk cancel is one reversible Green action; notes/promemoria named as reminders. Live on Ollama: "mostra le note" listed, "cancella tutte le note" cancelled both, a bare "sì" after that did nothing. The same run first showed Misato repeating an earlier reply and inventing a reminder on a bare "sì"; the prompt now forbids both. Model limits seen: weekday names sometimes mistranslated, an extra step. Also `nerv` command (package.json bin, `npm link`). Aoba (Telegram) in [PR #32](https://github.com/voidbrain/nerv/pull/32): `src/telegram.ts` (Bot API over outbound HTTPS long polling, one owner chat, others ignored and logged, stale messages not run, replies from `Runtime.chat`, typing indicator), CLI `telegram link` (finds the private chat that sent /start, saves `telegram.chatId`), private `telegram-token` file; started by `serve`. The owner created the bot "Aoba" on 2026-11-04; the first token was pasted in the conversation and replaced via BotFather /revoke before use; the stored file was world-readable and was set to 600. Kaji line (WireGuard mesh) stays in milestone 3: Telegram needs no mesh. First live `telegram link` failed with `fetch failed`: the owner's network inspects HTTPS (Node: UNABLE_TO_GET_ISSUER_CERT_LOCALLY; curl, using the macOS trust store, worked). Fixed in [PR #33](https://github.com/voidbrain/nerv/pull/33): `npm start`, the launchd/systemd units and the child processes run Node with `--use-system-ca` (one list, `NODE_FLAGS`, kept equal by test). After the fix the link reached Telegram, which held no /start; the owner resent it and `telegram link` bound the owner's chat. Live check 2026-11-04 on the owner's phone: "ricordami di bere acqua" went through Misato and the gate (Green) and back, and the reminder arrived on Telegram two minutes later. Misato loop in [PR #28](https://github.com/voidbrain/nerv/pull/28): `src/misato.ts` (one JSON step per call: an action or the reply; tool catalogue, now and time zone in the prompt; strict parsing), brain method `misato.step` on `models.roles.misato`, `Runtime.chat` gates each action (Casper only when not Green), feeds the outcome back, stops at a reply or 6 steps; an identical proposal already waiting is not gated twice; approval steps say "NOT done yet"; due times reach Misato already converted (`dueLocal`); `misato.reply` events; `POST /api/chat` (admin) and CLI `chat`. Live run 2026-11-04 on the owner's Ollama (Misato qwen2.5-coder:14b, Casper gemma4:12b, temporary data home): Italian request → reminder created and Italian reply; English request → English reply with 09:00 Rome time; a Blue action → Casper approved (confidence 1), one card waiting. Found and fixed in that run: replies in the wrong language, UTC times shown raw, the same action proposed twice, a reply claiming an approval-pending action was done. Remaining model limit: replies may still overstate a waiting action, so `chat` prints waiting actions from the facts. Owner's first `chat` (2026-11-04) failed with "Cloud route (Umbilical) is disabled." because `config.json` had no models: Misato fell back to the disabled cloud route. Fixed in [PR #30](https://github.com/voidbrain/nerv/pull/30): with no route the error says what to configure; the owner's config now has the all-Ollama roles, applied with `reload`, and the same request then created the reminder and answered in Italian. Owner 2026-11-04: Ollama (gemma4:12b, gemma4:e2b-it-q4_K_M, qwen2.5-coder:14b) and Claude; confirmed split: Misato (the planner that proposes actions) on Claude, Casper on local Gemma. Per-role models (`models.roles`, Casper local only) and in-place brain reload (`reload`, `POST /api/models/reload`; a broken file keeps the last working settings) in [PR #24](https://github.com/voidbrain/nerv/pull/24). Later the same day the owner chose to go fully on Ollama for now ([PR #25](https://github.com/voidbrain/nerv/pull/25) records it): Misato on a local model too, no API key yet; Claude stays a later switch through `roles.misato.route` and `reload` (a Pro plan has no API access, so it will need a Console key). Proposed models: Misato on qwen2.5-coder:14b, Casper on gemma4:12b, so the reviewer is a different model from the planner; Reload today: CLI `reload` and `POST /api/models/reload` (admin token); promised to the owner: a reload control with the roles in use — done in the dashboard (F-019, [PR #39](https://github.com/voidbrain/nerv/pull/39)); the Angular workspace still has none; answers in the language the owner writes in. OpenJEV (Ritsuko's lab, static analysis of code and skills) is not in this loop: it belongs to evaluated skills (F-007/F-025). Model routes implemented in [PR #11](https://github.com/voidbrain/nerv/pull/11) (model routes): S² local OpenAI-compatible loopback endpoint and Umbilical Claude route (`claude-opus-5-5`, server-side refusal fallback, off by default, key in a private `anthropic-key` file); explicit privacy per ask, no route fallback, bounded replies; brain-process `model.complete`, admin `POST /api/ask`, CLI `ask [--cloud]`, doctor shows routes. Historical model-route bootstrap next step: Misato loop calling `Ledger.propose`/`authorize` per tool call, then Telegram. Historical bootstrap prerequisites (owner supplied the local route and Telegram, with dated acceptance below): a running local model, an API key if the cloud route is wanted, and a Telegram bot token plus phone for delivery. M2a umbrella, re-scoped 2026-11-04: Telegram adapter (Aoba) with delivery outbox and retry reconciliation; Misato agent loop calling one model route (Umbilical cloud or S² local) through the per-action MAGI gate (F-017); recurring timezone-aware schedules. Memory is F-022, approvals F-023, ledger/trace F-024, triggers F-026, provenance F-027, digest F-028, evals F-029, degraded mode F-030. Closure criteria: Italian/English commands, local-only privacy, no cloud fallback without permission, restart/retry/channel failure tests and dated live phone delivery evidence. Current implementation/acceptance is described above; the old bootstrap next steps are history.

**Estimates:** Small, ~100%. Reassessed 2026-11-07: implementation, independent P1 review, recorded Human evidence and local/remote acceptance complete. Historical bootstrap estimate: Large remaining effort; ~20% complete. Bootstrap scope estimate, not verification. Estimated 2026-11-01; reassessed 2026-11-04: scope narrowed to channel + agent loop; model routes done, agent loop done 2026-11-04; resume after approval, Telegram, memory and briefs remain.

| Field | Value |
|---|---|
| PR / evidence | [PR #193](https://github.com/voidbrain/nerv/pull/193) verified closure reconciliation; [PR #192](https://github.com/voidbrain/nerv/pull/192) durable schedule recovery, atomic outcomes, channel/language acceptance and independent P1 review; Foundation CI #1 green; PR #1 merged; CI run 41254646946 green; scoped audit and local checks; [PR #11](https://github.com/voidbrain/nerv/pull/11) (model routes); [PR #24](https://github.com/voidbrain/nerv/pull/24) (roles, reload); [PR #28](https://github.com/voidbrain/nerv/pull/28) (Misato loop); [PR #30](https://github.com/voidbrain/nerv/pull/30) (no-route message); [PR #32](https://github.com/voidbrain/nerv/pull/32) (Aoba, Telegram); [PR #33](https://github.com/voidbrain/nerv/pull/33) (system certificates); [PR #37](https://github.com/voidbrain/nerv/pull/37) (conversation, bulk cancel, nerv); [PR #38](https://github.com/voidbrain/nerv/pull/38) (daily brief) |
| Opened | 2026-11-01 |
| Verification | 2026-11-07 Unit/integration: model privacy/no-cloud-fallback, real-process bilingual Telegram requests, failed delivery/checkpoint/restart recovery, scheduled failure/backoff/restart/recovery, no-exchange skip, stale completion fencing and atomic episode/outcome persistence passed focused tests. Final local checks: full suite 261 passed, one platform skip; build/typecheck, Chrome/axe including /dashboard navigation restoration, three headless lifecycle cases (one Windows-only skip), rules/conventions/integration/ledger checks passed. Final brief truncation assertion passed separately. Human: 2026-11-04, recorded owner Ollama Italian/English gated requests and Telegram message/reply/reminder arrival passed; no new real-phone or paid-provider send is claimed. Review: independent fresh-context P1 review identified episode/outcome crash gap and retained failure reason; both fixed and re-reviewed without remaining blockers. Remote CI: 2026-11-07 runs 42379685099/42379679262 passed validate, windows and native-macos. |
| Reviewed | 2026-11-07 |

</details>

---

### F-069

**Adopt harness 4.0 remaining-effort records and work queue**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: published release adopted, review and all CI checks passed.

| | |
|---|---|
| **Issue** | Owner requested removing redundant completion percentages, retaining honest remaining-work estimates, and adopting a reusable queue with explicit record prioritization and visible reasons. |
| **Reproduce** | Choose the next task across record priorities, remaining effort, roadmap placements, prerequisites and human decisions. |
| **Check** | Reconcile published harness 4.0.0; migrate active records while preserving scope/rationale/evidence and historical archives; adopt and validate the read-only queue with per-record order/reason and roadmap context. No weighted score or status/permission inference. Project checks, independent review and green CI; then continue ready records. |

<details>
<summary>Next action, estimate and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-07 after PR #194 runs 42398004525/42398009143 passed every validate, Windows and macOS job.  Published upstream v4.0.0 at bdec31f after PR #77 CI 42397531754 and PR #78 CI 42397672129 passed. Copied files reconciled from the tag; active records migrated without changing historical archives. NERV owns only adoption and project-specific migration. The upstream release owns its tests and acceptance and does not wait for NERV. After adoption, continue B-021/F-029 agent-executable acceptance using queue context and current evidence.

**Estimates:** Small remaining effort, provisionally 2–6 hours including project migration and validation, assuming clean reconciliation. Reassessed 2026-11-07: implementation complete; independent review and project CI passed; no remaining adoption work.

| Field | Value |
|---|---|
| Depends on | [voidbrain/project-harness:F-045](https://github.com/voidbrain/project-harness/blob/v4.0.0/docs/BACKLOG.md#f-045) — Published v4.0.0 release |
| Queue order | 1 — Owner-requested harness adoption before further backlog implementation |
| PR / evidence | [PR #195](https://github.com/voidbrain/nerv/pull/195) adoption closure;  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; Owner instruction 2026-11-07; published upstream v4.0.0, PRs #77/#78 |
| Opened | 2026-11-07 |
| Verification | 2026-11-07: typecheck and build passed; baseline suite 261 passed, one platform skip. Backlog, queue, dependencies, roadmap, recaps, rules, conventions, integrations and maintenance checks passed. Review: separate context verified copied-tool fidelity, archive preservation and scope; missing queue input and estimate prose corrected, re-review reports no remaining findings. PR #194 CI runs 42398004525/42398009143 passed every job. |
| Reviewed | 2026-11-07 |

</details>

---

### B-040

**Sephirot incoming edge remains active for the whole step**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />None: regression, browser and every CI check passed.

| | |
|---|---|
| **Issue** | The incoming edge animates while a node works, falsely implying continuous communication. |
| **Reproduce** | Select an active planning sortie in /dashboard. |
| **Check** | Busy nodes and route history remain distinct; no edge animation derives from phase alone. Busy-node motion honors reduced motion. Explicit transfer-duration/recent-transfer telemetry remains F-052. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-07 after PR #195 runs 42398922334/42398926076 passed every CI job.  Regression committed failing before the fix. Removed phase-derived edge animation and its unused styles; routes remain visible and busy nodes get a gentle outline pulse. Transfer animation awaits explicit telemetry in F-052. CI passed. Earlier next action:  Commit a regression for liveEdges before changing its semantics. See [the source assessment](design/operator-flow-review-2026-11-07.md). Preserve observed communication separately from step activity; do not infer delivery or execution from a UI state.

**Estimates:** No remaining defect work. Reassessed 2026-11-07: regression, browser, review and all CI passed. Historical estimate: Medium. Explicit transfer telemetry remains F-052.

| Field | Value |
|---|---|
| PR / evidence | [PR #196](https://github.com/voidbrain/nerv/pull/196) closure;  [PR #195](https://github.com/voidbrain/nerv/pull/195) project tuning and regressions;  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; Owner report 2026-11-07; Test: test/dashboard.test.ts, B-040 active planning edge, fails with class live instead of the recorded route |
| Opened | 2026-11-07 |
| Verification | 2026-11-07: committed B-040 regression passes; full suite 263 passed, one platform skip; Chrome CRT/palette/reduced-motion checks pass. Review: fresh-context reviewer reports no remaining findings after stale legacy assertion correction. PR #195 CI runs 42398922334/42398926076 passed every validate, Windows and macOS job. |
| Reviewed | 2026-11-07 |

</details>

---

### F-053

**CRT: stronger varied flicker, smoothly randomized bands and dynamic signal noise**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: owner accepted the current CRT appearance.

| | |
|---|---|
| **Issue** | Owner feedback on v1.205: grain is not visible, flicker was softened too much, moving lines are too infrequent. Restore prior flicker strength with fewer overall events and regular double-pulse variants; bands should smoothly, randomly slow and accelerate, including occasional pauses/reversals. Latest clarification: fixed grain makes the screen matte; replace it with changing analog-style pixel signal noise without washing out the display. |
| **Reproduce** | Enable CRT in Eva /dashboard, compare dark orange and other palettes. |
| **Check** | Opt-in readable effect, no layout shift; reduced motion disables animation; varied singles and regular double pulses without hazardous flashing; dynamic sparse pixel noise without a flat fill/veil; reduced motion stops and clears noise; owner visual acceptance. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-07: owner accepted the CRT (“crt ok for now”) after PR #199 merged with every CI check green; no required visual work remains.  Implemented retuning for latest owner feedback: restore 4–8% dips, five pulse groups including three doubles per 31 seconds; replace fixed 43/67-second band cycles with independently randomized eased passes (roughly 9–18 / 13.5–24 seconds including rest). Replace the rejected fixed grain with transparent-canvas signal noise: isolated 1 px specks, about 0.045% coverage capped at 1,800, refreshed no faster than 90 ms and fully cleared before each frame. No filled field, static grain or matte overlay remains. Each pass varies speed smoothly and may pause or briefly reverse. Cancel animations/timers when disabled, hidden, Simple or reduced motion. Browser lifecycle, scoped axe, randomized trajectory bounds, build/typecheck and full suite passed; owner visual acceptance remains; PR #199 runs 42402931969/42402936170 passed validate, windows and native-macos; owner visual acceptance passed. PR #198 was closed unmerged after the owner rejected the static-grain appearance; this revision keeps its stronger flicker/smooth bands and replaces only the noise. PR #197 was closed unmerged after a strongest-dip contrast check found the small MAGI heading too dim; the corrected CRT-only heading now passes axe at the 8% dip. Media-preference change events were missed in Chrome: cached eligibility checks in the existing frame loop now recover the transition without duplicate animation restarts. Prior tuning in PR #195 (1–2.5% flicker, 43/67-second bands and 2.5% grain) passed automated checks but was rejected as too faint/infrequent in the owner's v1.205 check.

**Estimates:** No remaining work. Historical estimate: Small, 1–3 focused hours; latest owner acceptance completes the required visual check.

| Field | Value |
|---|---|
| PR / evidence | [PR #200](https://github.com/voidbrain/nerv/pull/200) owner acceptance and closure;  [PR #199](https://github.com/voidbrain/nerv/pull/199) dynamic-noise revision and retained CI evidence;  [PR #198](https://github.com/voidbrain/nerv/pull/198) superseded, closed unmerged after owner clarified dynamic noise without matte appearance;  [PR #197](https://github.com/voidbrain/nerv/pull/197) superseded, closed unmerged after additional strongest-dip contrast finding;  [PR #196](https://github.com/voidbrain/nerv/pull/196) evidence and queue reconciliation;  [PR #195](https://github.com/voidbrain/nerv/pull/195) project tuning and regressions;  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; Owner request 2026-11-07; reopened from [closed history](archive/backlog-2026.md#f-053), preserving prior acceptance |
| Opened | 2026-11-05 |
| Verification | 2026-11-07: earlier candidates passed strongest-dip heading contrast and motion lifecycle checks, with history in PRs #197/#198; both closed unmerged after subsequent findings/owner feedback. Current dynamic-noise revision: 265 tests passed, one platform skip; build/typecheck/conventions passed. Chrome verified changing pixel buffers, under 0.1% painted coverage, full clearing on reduced motion, band preference/theme/off lifecycle and scoped axe at the strongest dip. Screenshot inspected: sparse specks with clear surfaces. Review: separate reviewer reports no actionable findings. CI: PR #199 runs 42402931969/42402936170 passed every job. Human: 2026-11-07 owner “crt ok for now”; accepted. |
| Reviewed | 2026-11-07 |

</details>

---

### F-057

**Version button shows and copies Git’s unique short commit ID**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: Git-backed, browser, independent review and all CI checks passed.

| | |
|---|---|
| **Issue** | Owner reports that clicking the version copies a full hash and asks for the seven-character form. The archived acceptance specified full-hash copying. Latest clarification: use Git’s verified unique abbreviation, not fixed string truncation, and use the same short ID on hover and click. |
| **Reproduce** | Click and hover over the dashboard version. Compare its ID with `git rev-parse --short <running-full-commit>` and verify it resolves with Git. Configure a longer abbreviation and an actual object-prefix collision in a disposable repository. |
| **Check** | Backend captures Git’s unique abbreviation of the running commit; hover, accessible name and clipboard use that same ID without slicing. Git settings and collisions may produce more characters. Full identity/version remain cached at startup. Legacy metadata can fall back to the full usable ID, never a fabricated prefix. Actual Git collision, server-to-browser clipboard and green CI checks pass. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-07 after PR #200 runs 42404230022/42404234032 passed every validate, Windows and macOS job.  Initial seven-character clipboard expectation was superseded by the owner's explicit instruction “I don't want to truncate”; the later clarification also uses the short ID on hover. The fixed-seven test changes deliberately under that new requirement. A Git-backed regression was committed failing before backend implementation; it honors configured abbreviation length and a real object-prefix collision. Backend now runs Git against the captured full commit once at startup, and the UI uses that returned ID verbatim. Browser/review/CI passed; owner answered the format choice. Prior scope stays in [archived history](archive/backlog-2026.md#f-057).

**Estimates:** No remaining work; previous Small 30–60-minute estimate covered implementation, regression, browser checks and reconciliation.

| Field | Value |
|---|---|
| PR / evidence | [PR #201](https://github.com/voidbrain/nerv/pull/201) closure reconciliation;  [PR #200](https://github.com/voidbrain/nerv/pull/200) verified commit ID and owner pause;  Owner clarification 2026-11-07; Tests: test/build.test.ts Git unique abbreviation/collision regression (committed failing before backend fix), test/dashboard.test.ts supplied unique ID, test/angular.browser.mjs real server→button→clipboard. Initial fixed-seven expectation was superseded by the explicit uniqueness requirement. |
| Opened | 2026-11-06 |
| Verification | 2026-11-07: Git abbreviation/configuration and real prefix-collision tests passed; UI uses the server-supplied identifier. Full suite: 267 passed, one platform skip; typecheck/build/conventions passed. Chrome verified actual server metadata→button→clipboard and matching hover; scoped axe passed. Review: separate context found no actionable findings. PR #200 CI runs 42404230022/42404234032 passed every job. |
| Reviewed | 2026-11-07 |

</details>

---

## Closed 2026-11-08

### B-044

**Advise → Misato never shows its passed route**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: committed regression, Chrome stroke check and every CI check passed.

| | |
|---|---|
| **Issue** | Owner reports the Advise → Misato line never marks passed. The renderer excludes all layout-loop edges from route history, including this normal advice-return route. |
| **Reproduce** | Select a sortie with recorded consultant advice, while Misato plans or after completion. |
| **Check** | Completed advice paints its return route green when Misato is active or passed. Unused advice remains skipped; unfinished advice and unobserved execution/replanning loops remain unpassed. No communication animation is inferred. Unit regression and ledger→API→live adapter→actual SVG stroke browser check pass, followed by CI. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-08 after PR #201 runs 42421593024/42421597561 passed every job.  Regression committed failing before the fix. Allow only the consultant-to-plan layout loop through the existing passed-edge rules; other loop-history limitations remain unchanged. Browser fixture records real ledger advice and checks the rendered stroke. All checks and CI passed.

**Estimates:** No remaining work. Historical estimate: Small, 1–2 focused hours; browser and CI acceptance passed.

| Field | Value |
|---|---|
| PR / evidence | [PR #201](https://github.com/voidbrain/nerv/pull/201) advice route and resumed owner sequence;  Owner report 2026-11-07; Test: test/dashboard.test.ts, B-044 completed advice marks route passed; committed failing before implementation. |
| Opened | 2026-11-07 |
| Verification | 2026-11-07: committed unit regression passes; Chrome verified ledger→API→adapter→passed SVG stroke; full suite 268 passed, one platform skip; build/typecheck passed. Review: separate context found no actionable findings. CI: PR #201 runs 42421593024/42421597561 passed validate, Windows and native-macos. |
| Reviewed | 2026-11-08 |

</details>

---

### F-029

**Golden sortie eval suite for Casper and pilot promotion**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: evaluation feature verified and closed; model-quality failures remain in B-021.

| | |
|---|---|
| **Issue** | Watermelon promotion and the Casper seat need regression evidence; a score without a fixed test set means nothing. |
| **Reproduce** | Run the suite against the deterministic seats and against a recorded model seat; change a policy rule and rerun. |
| **Check** | Suite covers each effect class, taint, rejects and expiry; deterministic part runs in CI; model-seat runs are recorded with model id and date; results feed F-025 stage evidence. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-08: PR #202 runs 42424820318/42424816395 passed every validate, Windows and native-macos job.  Versioned runner implemented: seven repository-owned policy/ledger/conversation/channel/base/stress/browser groups, append-only JSON evidence, source/input identities, explicit partial/unsupported coverage, bounded repeats and separate local Casper/Misato regression/holdout corpora. Initial full scripted run passed 178 checks; 90 cover seat/effect/taint combinations. New browser case spans real processes for clarification, same-sortie answer, approval effect, duplicate decision and topic change. Scripted execution currently supports POSIX owned process groups; Windows fails closed pending Job Object supervision (ordinary Windows tests and manifest checks remain supported). Frozen source 3c71986: full scripted suite 178 passed, repeated stress 24 passed, Casper 8/8 passed, Misato 4/5 passed with the topic-change holdout retained under B-021. Independent runner review has no remaining blockers. See docs/evaluations/README.md and dated reports. CI acceptance passed. Eval results feed stage review but do not promote or rewrite production.  Latest owner instruction 2026-11-07 resumes F-029 and sequences F-029 → B-042 after the current corrections; it supersedes the earlier pause.  Owner extension 2026-11-07: enumerate every flow branch and bounded reloop, all counted/shadow MAGI vote combinations (including opposing and changing seats), clarification, contradiction, mind changes, repeated consults, decomposition and cross-channel duplicate decisions. Run dashboard-only cases with Playwright and neutral isolated bases where needed; retain event/log evidence, language and incorrect-assumption findings. Coverage must name unsupported branches rather than imply exhaustive coverage.  Owner assessment 2026-11-07: expand the versioned scenario plan to dashboard/agent acceptance, ambiguity, contradictions, changed intent, language switching, duplicate/concurrent actions, expiry/restart, failure injection and signed multi-base cases. [Concrete assessment and test matrix](decisions/evaluation-and-improvement.md) distinguishes scripted control-flow tests from recorded real-model judgment; evidence includes actual effects, ledger, screenshots and model/seed/configuration, not just the agent’s claimed success. Start with B-021 browser acceptance and deterministic CI cases; then bounded real-model, generated/stress and multi-agent/multi-base runs on isolated neutral fixtures. The self-improvement loop proposes isolated changes, preserves regression/holdout tests and independent verification, and uses the existing owner-confirmed promotion rules (F-025/F-045/F-049). The scenario runner is now implemented; automatic repair/promotion remains outside this evaluation feature.  2026-11-06 (roadmap review of `ballot` in src/policy.ts): Casper's confidence can only lower Sync (clamped to 0–1 and multiplied), but an approving Casper that omits confidence gets the full configured value, more than one reporting 0.9. Decide here whether a missing confidence should count as unknown (owner card) rather than certain; the [reassessment](audits/2026-11-06-architecture-reassessment.md) also notes Sync is a heuristic, not a calibrated probability. Start with deterministic cases alongside F-017 tests; add recorded model cases with F-003.

**Estimates:** No remaining work. Historical estimate: 1–2 focused hours for CI, evidence reconciliation and closure. Frozen model/stress evidence and outcome triage complete. Reassessed 2026-11-08: suite/runner/browser implementation and initial scripted validation complete. Previous Large estimate covered their construction; future capability branches remain owned by the manifest’s named records.

| Field | Value |
|---|---|
| PR / evidence | [PR #202](https://github.com/voidbrain/nerv/pull/202) evaluation suite and frozen evidence; [PR #201](https://github.com/voidbrain/nerv/pull/201) advice route and resumed owner sequence;  [PR #200](https://github.com/voidbrain/nerv/pull/200) verified commit ID and owner pause;  [PR #196](https://github.com/voidbrain/nerv/pull/196) remaining-effort reassessment;  [PR #196](https://github.com/voidbrain/nerv/pull/196) evidence and queue reconciliation;  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #193](https://github.com/voidbrain/nerv/pull/193) agent-executable acceptance and evaluation assessment; [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | 2026-11-08: initial scripted suite 178 checks passed, including actual browser operation; golden/runner/model-adapter unit checks passed. Final full suite 364 passed, two skips; build, typecheck, headless and repository checks passed. Frozen scripted/stress/model reports retained in docs/evaluations; independent review resolved process ownership and source identity findings. PR #202 runs 42424820318/42424816395 passed all six jobs. |
| Reviewed | 2026-11-08 |

</details>

---

---

### B-042

**Telegram approval card arrives after dashboard decision**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: local, signed-link, browser and every CI check passed.

| | |
|---|---|
| **Issue** | An approval decided in the dashboard can still arrive as a live Telegram card and be tapped again. |
| **Reproduce** | Pause outbound card delivery, decide in dashboard, release send, then tap the card. |
| **Check** | Exactly one execution across dashboard and Telegram decisions; pending sends recheck status; sent cards reconcile to decided/expired state; no decision replay. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-08 after PR #203 runs 42425786736/42425784575 passed all six jobs.  2026-11-08: test/telegram-reconcile.test.ts reproduces both failures through dashboard REST and actual loopback Telegram sends: route lookup can send an already-decided card, and in-flight sends have no durable button cleanup. Both fail against unchanged production code.  The unchanged regressions now pass. Added bounded coordinator-only status RPC and main-only signed Kaji lookup; local/relayed cards recheck before sending, retain message IDs and retry decided/expired button cleanup after failures/restarts. Bundles remove only decided rows. Cleanup batches reads, serializes edits/sends and bounds tracking/queues; unavailable remote status retains cleanup. Cards predating message-ID tracking cannot be located automatically; repeat decisions remain idempotent. Golden suite v2 includes these scenarios; v1 baseline evidence is preserved. See [the source assessment](design/operator-flow-review-2026-11-07.md). Preserve observed communication separately from step activity; do not infer delivery or execution from a UI state.

**Estimates:** No remaining work. Historical estimate: Small, 1–2 focused hours for final checks, CI and reconciliation. Reassessed 2026-11-08 after implementation and local/signed integration checks.

| Field | Value |
|---|---|
| PR / evidence | [PR #203](https://github.com/voidbrain/nerv/pull/203) durable cross-channel card reconciliation; [PR #196](https://github.com/voidbrain/nerv/pull/196) evidence and queue reconciliation;  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; Owner report 2026-11-07; source assessment linked above |
| Opened | 2026-11-07 |
| Verification | 2026-11-08: committed failing regressions now pass unchanged; local and real signed Kaji status/decision tests, pagination/expiry and bundled-row tests passed. Final suite 369 passed, two skips; typecheck, build, headless and repository checks passed. Chrome/axe: both browser cases passed. Expanded channel suite: 19 passed on clean frozen source 85aa894, retained in docs/evaluations/2026-11-08-card-reconciliation.json. Main-only signed status authorization and coordinator-only bounded RPC checks passed. PR #203 runs 42425786736/42425784575 passed every job. |
| Reviewed | 2026-11-08 |

</details>

---

---

### B-041

**Late reconnect brief has a morning greeting and unavailable sections**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: reproduced recovery paths, delivery identity, browser and every CI check passed.

| | |
|---|---|
| **Issue** | Tabgha reconnecting around 18:00 sent a morning greeting, unread sections and several messages; duplicate identity and causes remain unverified. |
| **Reproduce** | Reconnect a base after its brief time; compare durable brief, scheduler attempts and channel delivery identities. |
| **Check** | Time-appropriate or neutral greeting; unavailable sources reported honestly; one delivery per identity, bounded recovery and no replay of completed briefs across restarts. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-08 after PR #204 runs 42426712622/42426709846 passed every job.  2026-11-08: three regressions in test/brief-recovery.test.ts reproduce a failed checkpoint read being treated as absence, a report with every source unavailable being sent immediately, and two schedulers writing duplicate daily deliveries. All were committed failing before the production fix; all now pass unchanged. The scheduler retries unknown checkpoints and complete core-source outages, records source names safely, and atomically commits one delivery per local day across schedulers/restarts. New rollback/cursor/reopen checks pass; the additive daily_briefs table preserves inbox rowids and UUIDs. These are reproduced failure classes; no retained Tabgha log identifies which occurred in the owner report.  Earlier greeting fix: regression committed failing before implementation; composition now uses the owner time zone for morning/afternoon/evening, with a neutral overnight title. The older Telegram delivery test now identifies the brief by its title instead of requiring morning: the owner deliberately changed that requirement. New B-041 test remains unchanged. Reproduced failure-class fixes passed final CI; the original Tabgha incident remains unattributed without its logs. Partial source failures remain explicit rather than being silently called healthy. Greeting, partial reads and restart/delivery recovery are verified; the original incident is not attributed to a particular reproduced failure. See [the source assessment](design/operator-flow-review-2026-11-07.md). Preserve observed communication separately from step activity; do not infer delivery or execution from a UI state.

**Estimates:** No remaining work for the reproduced failure classes. Historical estimate: Small, 1–2 focused hours for final full-suite/evaluation evidence, CI and reconciliation. Reassessed 2026-11-08 after reproduced failure classes were fixed.

| Field | Value |
|---|---|
| PR / evidence | [PR #205](https://github.com/voidbrain/nerv/pull/205) closure and queue reconciliation; [PR #204](https://github.com/voidbrain/nerv/pull/204) daily brief recovery and durable identity; [PR #196](https://github.com/voidbrain/nerv/pull/196) evidence and queue reconciliation;  [PR #195](https://github.com/voidbrain/nerv/pull/195) project tuning and regressions;  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; Owner report 2026-11-07; source assessment linked above; Test: test/brief.test.ts, B-041 delayed brief greeting, fails against the unchanged fixed-morning implementation |
| Opened | 2026-11-07 |
| Verification | 2026-11-08: unchanged committed checkpoint/outage/overlap regressions and rollback/cursor/reopen checks passed; 20 targeted brief/Telegram tests passed. Final suite 373 passed, two skips; typecheck, build, headless, conventions and repository checks passed. Frozen clean source 058c3b8: full v3 evaluation passed 193 checks in all seven groups, including Chrome/axe and real process joins; retained in docs/evaluations/2026-11-08-brief-recovery.json. PR #204 runs 42426712622/42426709846 passed all six jobs. Historical 2026-11-07: unchanged committed greeting regression and Telegram delivery/restart integration passed; full suite 263 passed, one platform skip; PR #195 CI runs 42398922334/42398926076 passed all jobs. No evidence yet attributes reported duplicate messages. |
| Reviewed | 2026-11-08 |

</details>

---

---

### F-014

**Version and secure WebSocket JSON-RPC communication**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | — |

💻 **→ Human action required: No**<br />No action remains for the enrolled outbound worker profile; local RPC stays read-only.

| | |
|---|---|
| **Issue** | Version 1 signed outbound workers, durable receipts, leases/fences, approval locks, cancellation and legacy quarantine are implemented for advertised registered built-ins. Device/bootstrap, arbitrary tools and physical adapters remain separate work. |
| **Reproduce** | Follow docs/decisions/runtime-boundaries.md and the protocol/isolation test fixtures. |
| **Check** | Reject unauthenticated/Origin/browser/query-token access; validate schemas/graph; bound payloads/concurrency; reconnect and asleep-worker tests before remote execution. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-08. PR #206 merged at dde59f6 after every Linux, Windows and macOS check passed; acceptance criteria verified through repository-owned protocol/hostile-frame/reconnect/heartbeat fixtures. Independent code review found no remaining concrete blockers and independently passed 54 tests; documentation/harness review found no blockers after clarifying offline cancellation reconciliation. See [worker protocol](../decisions/worker-protocol.md). Committed regressions precede fixes for deferred approval fencing, enrolment revocation, expiry, nonce-cache poisoning and local connection/Origin admission. Full-suite compatibility retains the existing Spear response when no remote work is pending.

**Estimates:** No remaining work for this record. Historical estimates covered implementation and acceptance; device/bootstrap, arbitrary execution and production-host work remain with their separate records.

| Field | Value |
|---|---|
| PR / evidence | [PR #207](https://github.com/voidbrain/nerv/pull/207) verified closure and overload-fixture heartbeat isolation: one Windows CI run exposed accelerated 150 ms heartbeat contention during four-slot saturation while its parallel run passed; targeted overload case passes with a separate 10 s fixture heartbeat, leaving dedicated heartbeat tests and all outcome assertions unchanged;  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #206](https://github.com/voidbrain/nerv/pull/206) implementation (first Windows CI exposed a timing-dependent seat fixture, corrected without changing expected outcomes): committed regressions in test/worker-jobs.test.ts, test/worker-link.test.ts, test/worker-outbox.test.ts and test/protocol.test.ts; [frozen evaluation evidence](../evaluations/2026-11-08-f014-scripted.json) |
| Opened | 2026-11-01 |
| Verification | 2026-11-08: full core 412 passed / 2 platform skips; headless 3 passed / 1 Windows skip; typecheck, build, repository checks passed. Clean cdd8a0e: v4 all seven groups 234 passed, three base repetitions 141 passed with stable inputs. Swift 9 passed / 1 skip; native packaging passed. Review: fresh-context report-only PR #207 closure reviewer found no blocking documentation findings and confirmed overload-fixture isolation preserves every replay/idempotency assertion using the local diff and supplied CI evidence; no application suites rerun. Independent implementation reviewer passed 54 tests and found no remaining code or documentation blockers; prior findings fixed. PR #206 final CI runs 42464014727/42464012081 passed all six jobs. Targeted causal peer-seat tests passed and independent diff review confirmed shadow completion before reply and veto waiting until reply. Production-host, phone and physical acceptance are not claimed. |
| Reviewed | 2026-11-08 |

</details>

---

### B-045

**A newly negotiated worker loses an admitted request burst**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | — |

💻 **→ Human action required: No**<br />No action remains for the repaired bounded worker handshake.

| | |
|---|---|
| **Issue** | Windows CI reproduced lost concurrent worker requests; the coordinator publishes readiness before queuing hello acknowledgement, and that response competes with four requests for the same frame admission slots. |
| **Reproduce** | B-045 immediate-burst regression in test/worker-link.test.ts fails deterministically before the fix; CI 42479082275 also failed the overload case. |
| **Check** | Publish only after acknowledgement is queued; accept four bounded requests plus control responses, retain four active request/pending limits, and execute one durable effect. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Committed regression adf6cde fails before the fix and passes unchanged after it. Acknowledgement is queued before publication; parsing has an eight-frame bound, active/pending requests retain four slots, and termination stops queued parsing. Independent fresh-context review found no blockers. Closed 2026-11-08 after PR #208 CI 42480170710 passed all five jobs; regression and admission/fencing contracts passed on Linux and Windows. Keep unknown-outcome/resource fencing safeguards.

**Estimates:** No remaining work for this repair.

| Field | Value |
|---|---|
| PR / evidence | [PR #209](https://github.com/voidbrain/nerv/pull/209) reviewed closure and partial routing evidence;  [PR #208](https://github.com/voidbrain/nerv/pull/208) CI-discovered repair; Test: B-045 immediate negotiated burst in test/worker-link.test.ts. |
| Opened | 2026-11-08 |
| Verification | 2026-11-08: 46 targeted policy/worker/outbox/Kaji tests passed, typecheck passed. Review: independent fresh-context report-only implementation and closure reviews found no blockers; confirmed admission bounds, identity/fencing and unchanged assertions, no blockers. CI 42480170710 passed all five jobs, including Windows and the full marker. |
| Reviewed | 2026-11-08 |

</details>

---

### F-071

**Adopt scoped verification and periodic full-suite evidence**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | — |

💻 **→ Human action required: No**<br />No implementation work remains; use the adopted scoped policy on subsequent jobs.

| | |
|---|---|
| **Issue** | Repeated local/full evaluations and duplicate push/PR CI waste work; select affected checks and retain explicit periodic full verification. |
| **Reproduce** | Run verification:plan; compare documentation, brief-only, critical runtime and missing/stale full-evidence changes. |
| **Check** | Targeted paths select affected regressions; documentation skips app suites when full evidence is current. Risk/request/7 days/10 integrations force full. Marker cannot certify partial or failed jobs; one PR workflow only. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-08. PR #208 merged with all five jobs in CI 42480170710 passing. A documentation-only follow-up verifies the partial plan against that exact merged full-run baseline; its own CI establishes scoped workflow routing. Harness v4.1.0 is published from [project-harness PR #80](https://github.com/voidbrain/project-harness/pull/80); this record owns only NERV settings, adapter, CI and adoption. Preserve gate, review, privacy and acceptance requirements.

**Estimates:** No remaining adoption work; further jobs use the configured policy.

| Field | Value |
|---|---|
| PR / evidence | [PR #209](https://github.com/voidbrain/nerv/pull/209) reviewed closure and partial routing evidence;  [PR #208](https://github.com/voidbrain/nerv/pull/208) adoption;  Test: test/verification-policy.test.mjs and test/ci-pins.test.mjs. Published tag v4.1.0 resolves to a8a358e. |
| Opened | 2026-11-08 |
| Verification | Six local adapter/policy/pin tests and 46 affected worker/adapter contracts passed; typecheck, conventions and rule checks passed. Review: independent fresh-context review identified event privacy/schema and route recovery selection gaps; committed regression 2cedfe7 precedes mapping fixes. Follow-up independent review confirmed both mappings fixed, no remaining blockers. CI 42479082275 correctly refused its full marker after Windows path-separator and worker burst failures; committed regressions adf6cde reproduce both issues, fixes pass the unchanged tests. Independent follow-up review found no blockers; final CI 42480170710 passed all five jobs, including full-suite. Linux 419 tests passed with one platform skip; browser/axe, headless, Windows and Swift/TLS packaging passed. Real merged-baseline partial plan recorded in docs/acceptance/verification-2026-11-08.md. |
| Reviewed | 2026-11-08 |

</details>

---

### F-072

**Adopt harness v4.2.0 parallel tasks, model profiles and architecture review**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />No adoption action remains.

| | |
|---|---|
| **Issue** | Adopt the released reusable workflow in NERV with project-owned tasks, model evidence and a scoped architecture reassessment. |
| **Reproduce** | Inspect work sources and tasks; build/check the ledger; inspect the procedure index and candidate profile; exercise shared claim status after setup. |
| **Check** | Migration preserves records and links; derived views agree; task dependencies/resources are explicit; unmeasured Gemma remains candidate; scoped report tracks contradictions under existing IDs; reviewed CI passes and shared registry is established without bypassing safeguards. |

<details>
<summary>Next action, estimates and evidence</summary>

**Resolution:** Closed 2026-11-08. PR #216 merged after all five CI jobs passed in run 42517545579. Shared registry initialized after confirming absence; status reads metadata head `b8ad0df` with fence 0 and no held tasks, preserving a clean worktree/index. Adopt released v4.2.1 (upstream regression and CI 42517786923) for the empty-active-directory fix. All adoption acceptance is complete; Gemma remains candidate and runtime feature acceptance stays open.

**Historical next action:** Local consistency checks and fresh-context report-only review passed. Merge after required CI passes, then initialize the shared metadata registry and reconcile this record. Model qualification and runtime distributed orchestration remain their existing records; no model inference or physical/device action is part of adoption.

**Estimates:** No remaining adoption work, reconciled 2026-11-08; elapsed measurement includes waiting, not a productivity comparison.

| Field | Value |
|---|---|
| PR / evidence | [PR #217](https://github.com/voidbrain/nerv/pull/217) final adoption evidence; Harness [v4.2.1](https://github.com/voidbrain/project-harness/releases/tag/v4.2.1) (includes v4.2.0), PRs #82/#83; [PR #216](https://github.com/voidbrain/nerv/pull/216) NERV adoption |
| Opened | 2026-11-08 |
| Verification | 2026-11-08: exact 38-record migration; work/backlog/rules/recap/dependency/queue/roadmap/convention/audit checks and six verification/pin regressions pass. Review: independent fresh-context reviewer found no remaining blocker after prerequisite/resource corrections. PR #216 CI 42517545579 passed plan, validate, windows, native-macos and full-suite. Shared registry setup/status passed without worktree/index changes. Behavior runner/tool not adopted; no model campaign |
| Reviewed | 2026-11-08 |

</details>

---

### Documentation organization and review register

[PR #220](https://github.com/voidbrain/nerv/pull/220) records closure and capability follow-up.

**Documentation organization and review register — Closed, 2026-11-08.** [PR #219](https://github.com/voidbrain/nerv/pull/219) owner-requested documentation maintenance: clarify source/generated/evidence ownership; index all review/acceptance/evaluation reports with actual dates and next conditions; preserve current decisions; move confirmed superseded NERV prototypes, old target schema and analysis export into `remove/` with a byte-preserving manifest. Closed 2026-11-08: all 26 original byte hashes and staged destinations validated, maintained links and source/view checks passed, independent review corrections applied, PR #219 CI 42521677029 passed all five jobs. Ten active tasks now declare specialist capability requirements and a linked table; no suggested model is fabricated. This does not execute a new product audit/model campaign or claim every remaining outcome is decomposed.

### Target-schema correction and retirement recheck

[PR #222](https://github.com/voidbrain/nerv/pull/222) records closure.

**Target-schema correction and retirement recheck — Closed, 2026-11-08.** [PR #221](https://github.com/voidbrain/nerv/pull/221) restores the active target with implemented/planned labels; recheck all 26 retired sources and preserve mixed design inputs outside remove/. Assess Gauntlet ownership/reuse versus existing benchmarks without creating a repository or running model campaigns. Closed 2026-11-08: all 26 hashes, source/current links, schema and view checks passed; fresh-context review found no blocker; PR #221 CI 42530253552 attempt 2 passed all five jobs. The original Windows heartbeat failure is retained under open B-046, not claimed fixed.


<a id="archive-week-2026-11-09"></a>
### F-073

**Adopt Gauntlet Protocol for capability evidence and existing flow evaluations**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />No remaining adoption action. Protocol 0.1.1 and NERV integration are accepted; model campaigns remain explicit separate runs.

| | |
|---|---|
| **Issue** | Reuse system flow evidence alongside independently measured model capabilities without conflating them or promoting unmeasured models. |
| **Reproduce** | Plan NERV flow packs, run a selected existing group, normalize evidence and compare/export reviewed profiles. |
| **Check** | Pinned independent package; actual existing runner join; no implicit model calls/downloads; private immutable evidence; candidate profiles remain candidates; documented manual campaigns and limits. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-09 after [PR #223](https://github.com/voidbrain/nerv/pull/223), exact head737fa53, merged mainb15fe37. CI 42535553841 passed plan, validate, Windows, native-macos and full-suite. Accepted pinned protocol 0.1.1, seven existing flow adapters, explicit cost/execution gates, private evidence, comparison and reviewed export. Clean-source selected policy join passed90; six new integration/artifact/cancellation tests passed. Review: fresh-context report-only review found and resolved the upstream cancellation defect, then found no remaining issues. [Acceptance](../acceptance/gauntlet-2026-11-09.md), [review](../reviews/2026-11-09-gauntlet.md), [guide](../evaluations/gauntlet.md). No live-model/coding qualification or production promotion claimed. B-042 remains Investigate after its unchanged Windows cleanup fixture passed the final head; this is not a causal fix. Consistency: source task, roadmap, generated views and guides reconciled; independent Gauntlet release has no NERV gate.

**Estimates:** Small remaining effort at closure: no adoption work remains. Earlier 2–3 day estimate and under-one-day review estimate were estimates, not measured token/runtime cost.

| Field | Value |
|---|---|
| PR / evidence | [PR #223](https://github.com/voidbrain/nerv/pull/223); upstream [Gauntlet #3](https://github.com/voidbrain/gauntlet-protocol/pull/3), CI 42534614317; clean-source acceptance and independent review linked above. Initial CI 42535069202 failed recap-week validation and an unchanged Windows remote-card cleanup assertion; B-042 retains that evidence, not a fix claim. |
| Opened | 2026-11-09 |
| Verification | 2026-11-09 Unit/integration: policy90 passed on clean source50932b4, six new integration tests pass. CI 42535553841 passed every required job/full-suite on exact head737fa53, Node24 Linux/Windows and native macOS. Review: independent report-only recheck passed. No model qualification. |
| Reviewed | 2026-11-09 |

</details>

---

F-073 reconciliation: [PR #224](https://github.com/voidbrain/nerv/pull/224), documentation-only acceptance update against PR #223 / CI 42535553841.

## Closed 2026-11-09

### B-047

**CLI bootstrap planning test uses an expired inspection fixture**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-09 after fixture regression and full CI passed.

| | |
|---|---|
| **Issue** | The CLI capability-planning regression uses an inspection fixed at 2026-11-08T12:00Z against the current clock, so CI fails after its 24-hour validity window. |
| **Reproduce** | After 2026-11-09T12:00Z run the committed test named F-005: planning verifies the pinned source capability before proposing model-free init in test/node-discovery.test.ts. |
| **Check** | The CLI planning regression passes with a current neutral inspection; deterministic fixed-clock expiry tests still reject expired/future reports; production expiry behavior stays intact. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-09. PR #237 exact head be60c19 / full CI42614209749 passed all five jobs, merged main81b1106. The committed main regression reproduced the expired neutral fixture before the fixture-only fix (6040515 precedes c8709d3). The CLI fixture now uses the current clock; every assertion, fixed-clock expiry case and production source remains unchanged. Independent report-only final review found no blocker;18 focused provenance/discovery tests passed, plus22 targeted bootstrap tests locally.

**Estimates:** Small at closure, assessed 2026-11-09; no implementation or acceptance remains.

| Field | Value |
|---|---|
| PR / evidence | [PR #237](https://github.com/voidbrain/nerv/pull/237); Review: independent fresh-context report in [provenance boundary](../reviews/2026-11-09-provenance-boundary.md), finding fixed and rechecked; Test: test/node-discovery.test.ts — F-005: planning verifies the pinned source capability before proposing model-free init (committed on main before fix). |
| Opened | 2026-11-09 |
| Verification | 2026-11-09 Unit/integration:22 targeted discovery/bootstrap tests and PR237 full CI42614209749 passed, including Linux/Windows tests and full-suite. Review: independent report-only final delta review found no blockers. |
| Reviewed | 2026-11-09 |

</details>

---

B-047 acceptance reconciliation: [PR #238](https://github.com/voidbrain/nerv/pull/238).

### F-026

**Hyuga watch: proactive triggers (heartbeat, schedules, events)**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-09 after automated trigger, budget and quiet-delivery acceptance.

| | |
|---|---|
| **Issue** | Background checks need explicit triggers, durable permission limits and quiet-hour notification behavior. |
| **Reproduce** | Configure a heartbeat check and an event trigger; let both fire inside and outside quiet hours; let the model route be down. |
| **Check** | Triggers create sorties with their source recorded; proactive sorties run in EVA-00 (no external effects) unless the pilot is Production; quiet hours defer notifications, not deliveries already due; per-trigger budget; duplicate ticks after restart do not duplicate sorties. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** T01 accepted after PR239 exacthead24c3600 / CI42624083120 passed all five jobs/full-suite, mergedmain5c7997b. T02 implementation connects validated opt-in configuration, local pilot-bound planning, durable step/action limits, approval/restart/cancellation and quiet-hour brief/card/remote follow-up delivery. [Configuration](../INSTALL.md#proactive-watches-hyuga), [decision](../decisions/hyuga-watch.md), [acceptance](../acceptance/hyuga-watch-2026-11-09.md).

Closed 2026-11-09: PR #240 exact head `6acac44` / [CI42635119338](https://github.com/voidbrain/nerv/actions/runs/42635119338) passed plan, validate, Windows, native-macos and full-suite; merged main `0968262`. Golden suite v5 and Gauntlet system pack1.2.0 select the new watch joins. Historical PR240 initial Windows session-loss failure is retained under B-046; the final revision passed without changing that test or WorkerLink. This is not a causal B-046 fix. Independent fresh-context review found queued remote dispatch could outlive withdrawn watch authority; fixed at the actual transport callback and durable cancellation boundary, preserving prior-attempt uncertainty. Recheck32 tests passed, no remaining blocker. No live-model qualification, actual EVA sandbox or physical notification receipt is required/claimed by this automated trigger contract; those retain their owning records.

**Estimates:** Small at closure, reassessed 2026-11-09; no F-026 implementation or acceptance remains. Original Large estimate2026-11-04 remains historical.

| Field | Value |
|---|---|
| PR / evidence | Acceptance reconciliation: [PR #241](https://github.com/voidbrain/nerv/pull/241); [PR #240](https://github.com/voidbrain/nerv/pull/240) T02 runtime/delivery; [PR #239](https://github.com/voidbrain/nerv/pull/239) T01 admission/gate implementation; Review: independent fresh-context report-only implementation review, dispatch finding fixed and32 tests rechecked without blocker; No review: closure reconciliation is documentation-only and introduces no runtime change; [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | 2026-11-09 Unit/integration: PR #240 exact head `6acac44` / [CI42635119338](https://github.com/voidbrain/nerv/actions/runs/42635119338) passed plan, validate, Windows, native-macos and full-suite; merged main `0968262`. Linux coverage, Windows full tests/service lifecycle, browser/axe/headless and macOS Swift/TLS/package checks passed. Local joins and fresh-context review establish the recorded trigger/budget/quiet-delivery contract; no live-model qualification, OS confinement or phone receipt claimed. |
| Reviewed | 2026-11-09 |

</details>

---

F-026 acceptance reconciliation carried from superseded [PR #241](https://github.com/voidbrain/nerv/pull/241) into [PR #242](https://github.com/voidbrain/nerv/pull/242). Runtime acceptance remains PR240 / CI42635119338; PR241 failed before jobs due to GitHub internal errors.

## Closed 2026-11-12

### B-021

**A question from Misato closes the sortie, and the answer opens a new one**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-12: [PR #281](https://github.com/voidbrain/nerv/pull/281) merged with CI 43165354765 green on all five jobs; every recorded check passed.

| | |
|---|---|
| **Issue** | Owner report 2026-11-05 (S-E16D, S-7B04): Misato asked *Which specific file in ~/NERV-files would you like me to read?* and the sortie closed with Debrief: done; the answer *shopping.txt* became a new sortie, and the consultant advised on it from scratch. Misato's plan has only two shapes, an action or a final reply, so a question is recorded as the final reply. |
| **Reproduce** | Ask Misato something she must ask back about (*read a file in ~/NERV-files*), then answer. |
| **Check** | A question keeps the sortie open, waiting for the owner (Debrief not lit, shown like an approval wait); the next message in the same conversation continues that sortie; a short answer (up to 8 words) goes straight to Misato, a longer one gets the consultant again as a follow-up with its first advice in view (it may say none); an unanswered question closes the sortie after 24 hours as no answer; a restart does not close a sortie waiting for an answer as interrupted. Owner addition 2026-11-06: a clearly unrelated message cancels the wait and starts a new sortie; length alone never decides. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-12 in the reconcile of PR #288: [PR #281](https://github.com/voidbrain/nerv/pull/281) merged into main `90d797d` at 06:08 UTC; its CI [43165354765](https://github.com/voidbrain/nerv/actions/runs/43165354765) on head `e706c75` passed plan, validate, Windows, native-macos and full-suite (attempt 1). The recorded Check is met: the deterministic tests below cover the waiting question, same-sortie continuation, the 8-word rule, the 24-hour expiry, restart and the topic change (control flow and prompt); the owner-approved gemma4:12b run returned `newRequest` on both topic-change cases and planned both continuations (competence evidence for that model only); the record named no owner check. B-021-T01 and B-021-T02 closed (0.5 h and 1.5 h agent, stated, against baselines of 1.5 h and 2.5 h). Out of this Check and tracked elsewhere: [B-049](../BACKLOG.md#b-049) (invented reminder title). Fixed 2026-11-12 in [PR #281](https://github.com/voidbrain/nerv/pull/281), both remaining issues, each starting from a committed failing test. (1) Forwarded-answer timeout: once an answer has been sent to the main base it is the main base's, which owns the question. A late or failed reply now closes this base's copy as failed, like any forwarded request that times out, instead of keeping the question waiting here; the next message is a new sortie here, forwarded as a new request, and the main base decides whether it answers its own question. An answer that never reached the main base still keeps the question waiting and never runs locally: the connection failed, this base no longer sees that base as main, or (after review) the main base turned it away outright with 400/401/403/409, which /kaji/chat checks before running anything (`KajiLink.chat` marks that reply `refused`, and a peer cannot set the mark itself). (2) Topic change: the first turn of an answer now carries `originalRequest` and `pendingQuestion`, both counted inside the route's LCL budget (after review), and its system prompt ends with an explicit topic decision: a message that asks for something else returns `{"newRequest":true}` even when Misato could answer it, and length never decides. Prompts of every other turn are byte-identical to main (checked for the four cases without clarification). The coordinator's control flow for `newRequest` is unchanged (the old sortie is speared, a fresh sortie answers). Backend correctness and model competence stay distinct: the deterministic tests establish the control flow and the prompt contents; the real-model run below is competence evidence for gemma4:12b only, not for other models or the cloud route. Real-model run approved by the owner 2026-11-12 (parent session) to verify the topic-change decision. Planned before running: model gemma4:12b (local Ollama on the agent host, loopback only, no cloud route), the B-021 planner cases of `evals/planner-v1.json` (`topic-change-during-question` holdout plus the ask/continuation regression cases in that file) and any B-021 topic-change or continuation cases added with the fix; budget at most 12 evaluator runs (development probes included) and 60 minutes of model time, no paid usage. Run 2026-11-12 within that budget: 7 invocations (5 development probes, 2 recorded runs), about 10 minutes of model time on the local route, no paid usage; the recorded runs took 1 min 42 s and 1 min 15 s. The second run exists because adding cases bumped the corpus to suite `misato-planner-v2` (as the golden suites do); both reports are kept. The model failure on `italian-missing-title` (no clarification turn, prompt unchanged) is a separate finding: [B-049](../BACKLOG.md#b-049). Closure: verify and close in the reconcile after #281 merges with green CI; no owner check remains (phone display/receipt is outside this Check). History: Reassessed 2026-11-07 at owner request: dashboard/control-flow acceptance is agent-executable; it does not require an owner to drive the browser. Browser waiting-state acceptance now passes; frozen real-model evidence confirmed a topic-change failure (final reply instead of newRequest). Backend/Telegram/signed-link correctness stays distinct from that competence finding. See [evaluation assessment](../decisions/evaluation-and-improvement.md). The previous owner script is a reusable agent scenario, not an owner-only prerequisite. Actual Telegram device evidence is only needed for claims about phone display/receipt. The forwarded-answer timeout was then unresolved; no verification is inferred from changing the actor.  Implemented 2026-11-06 on `fix/misato-clarification`. Misato has a third plan shape `{"ask": …}`: the ledger records `misato.asked` (conversation, 24-hour expiry), the next message in that conversation is claimed once as `misato.answered` and continues the same sortie; up to 8 words go straight to Misato, longer answers get the consultant again with `previousAdvice`. A clear topic change makes Misato return `{"newRequest": true}` on the first turn of the answer: the old sortie is speared (nothing ran in it for the new request) and a fresh sortie answers. Questions survive restart (`resumable`/`interrupted` skip them), expire once as `misato.unanswered` (sortie failed, one reply saying nothing was resumed), and are bound to their conversation (a Telegram message cannot answer a dashboard question; messages in one conversation are serialised). An approval resume after a clarification keeps the original request and does not consult again. Forwarded questions: the sortie stays open on this base; the answer goes to the main base in the same conversation; if the main base is unavailable or changed, the answer stays waiting and is never run locally. Dashboard: a pending question shows as waiting at Misato's apartment, Debrief unlit; Comms shows the question, the answer and an expiry. Known limit until 2026-11-12 (fixed above): if a forwarded answer timed out after the main base already took it, this base kept waiting while the main base had moved on; the next message was then forwarded as an answer. **Scenario script (dashboard browser/agent; Bot protocol and optional phone checks separately):** (1) `Read a file in ~/NERV-files` → Misato asks which file; the dashboard shows the sortie waiting, Debrief unlit. (2) `shopping.txt` → same sortie continues (same S- id in the dashboard), no second sortie. (3) Repeat (1), then `What is on my calendar tomorrow?` → the first sortie is shown as stood down, a new sortie answers. (4) Repeat (1), restart the service (`nerv service restart`, or stop and run `nerv serve`), then answer → still the same sortie.

**Estimates:** Small at closure, 2026-11-12; no work remains. Steps B-021-T01 and B-021-T02 took about 2 h agent in all (stated), against 4 h planned. History: Small remaining. Reassessed 2026-11-08: browser and real-model evidence recorded; fix the confirmed model topic-change failure and forwarded-answer timeout before closure. Historical estimate: owner check on a real base. Reassessed 2026-11-06 after implementation and automated checks.

| Field | Value |
|---|---|
| PR / evidence | Closure reconcile: [PR #288](https://github.com/voidbrain/nerv/pull/288) (records only; No review: documentation-only closing reconcile, the fix itself was reviewed in #281 as below). [PR #281](https://github.com/voidbrain/nerv/pull/281), CI [43165354765](https://github.com/voidbrain/nerv/actions/runs/43165354765) green: Test: test/clarification.test.ts "B-021: a forwarded answer that times out after the main base took it leaves no question waiting here; the next message is a new sortie" (committed failing in a153849: the sortie stayed open; passes after f577413). Test: "B-021: the first turn of an answer names the pending question and its job, and puts the topic decision last" and "B-021: the coordinator gives the answer turn its pending question and original request; later turns get neither" (committed failing in df5f4f5; pass after 46604ee, whose Prettier run also reflowed these two tests and the a153849 timeout test, whitespace only, no assertion changed). After review: Test: test/one-channel.test.ts "B-021: a dispatched request the main base refuses outright is marked refused; a sent request that fails later is not" and test/clarification.test.ts "B-021: an answer the main base refuses outright (nothing ran there) keeps the question waiting here" (committed failing in 97e53e3; pass after fa96660). Test: test/lcl.test.ts "B-021: on an answer turn, originalRequest and pendingQuestion count inside the LCL budget of each route" (committed failing in 2db734c; passes after a2ae65c; the eight corpus prompts are byte-identical to the evaluated 46604ee). Review: fresh-context design review (design-reviewer, Opus) of 137b29e: no blocker; fail-before/pass-after confirmed in a separate clone for both fixes, other-turn prompts byte-identical (32 of 32, local and cloud). Should-fix items done: a definite refusal keeps the question waiting (it closed it before), the two fields count inside the LCL budget, and the reused holdout is named below; nits (the Prettier note, double-counted remaining hours, task resources) fixed. Real-model evidence: docs/evaluations/2026-11-12-misato-v2.json (suite misato-planner-v2, commit aef407b, source inputs stable; the tree had uncommitted record edits only) and docs/evaluations/2026-11-12-misato-b021.json (same cases under the old suite id, commit 46604ee); three B-021 cases added to evals/planner-v1.json (test/evaluation-runner.test.mjs now expects suite misato-planner-v2 with 8 cases, 2 holdouts: a deliberate requirement change, the corpus grows by these cases) (`answer-continues-short`, `answer-continues-long` regressions and an unseen `topic-change-unrelated-question` holdout); `topic-change-during-question` was used while developing the fix: it keeps its `holdout` label in the corpus and both reports, but only `topic-change-unrelated-question` is unseen evidence. Earlier: 2026-11-08 frozen failure docs/evaluations/2026-11-08-misato.json (topic change answered as a final reply); [PR #202](https://github.com/voidbrain/nerv/pull/202) evaluation suite and frozen evidence; [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #193](https://github.com/voidbrain/nerv/pull/193) agent-executable acceptance and evaluation assessment; [PR #177](https://github.com/voidbrain/nerv/pull/177) implementation; Owner report 2026-11-05 (S-E16D, S-7B04 on Neo Tokyo-3); owner refinement 2026-11-06 (topic change cancels the wait); 2026-11-06 checks of PR #177: full suite 226 passed (one platform skip), build, typecheck, conventions, headless lifecycle and Angular browser acceptance. |
| Opened | 2026-11-05 |
| Verification | Unit/integration 2026-11-12: test/clarification.test.ts (plan shape, durable question, conversation binding, 8-word rule, approval resume, topic change, forwarded question, forwarded-answer timeout, answer-turn prompt) and test/one-channel.test.ts (question and answer across the real signed Kaji link, main base down and back) 16 of 16 after review; test/lcl.test.ts covers the budget; test/telegram.test.ts covers B-021 over Aoba; `npm test` 595 passed, 2 skipped, 0 failed after review (macOS, Node 26, worktree install); typecheck, lint, format:check and the backlog, work, queue, dependency, roadmap, rules and maintenance checks pass. PR #281 CI 43165354765 (head `e706c75`, 2026-11-12) passed all five jobs, including Windows and full-suite. Browser/accessibility 2026-11-08: test/evaluation.browser.mjs passed in the frozen 178-check suite (waiting apartment, Debrief unlit, same-sortie answer, approval effect and scripted topic change; axe). Real-model judgment 2026-11-12 (gemma4:12b, digest 6114515d…, local loopback Ollama, provider-default temperature): suite misato-planner-v2, docs/evaluations/2026-11-12-misato-v2.json, 8 of 8 passed; both topic-change cases returned `newRequest` (`topic-change-during-question`, `topic-change-unrelated-question`) and both continuations planned the reminder (`answer-continues-short`, `answer-continues-long`). The earlier run of the same cases (docs/evaluations/2026-11-12-misato-b021.json) passed 7 of 8 with the same B-021 results; it failed `italian-missing-title`, whose prompt is unchanged by this fix (an invented title instead of a question: [B-049](../BACKLOG.md#b-049), outside B-021's Check). Development probes on the same model: the original holdout returned `newRequest` 2 of 3 before the fix and 5 of 5 after; continuations 6 of 6 after. The 2026-11-08 run (topic change failed) is history in PR / evidence. Human: no owner-only dashboard acceptance required after the 2026-11-07 assessment; real-phone display/receipt is outside this Check. |
| Review | Added 2026-11-12 after #288 merged: a fresh-context review of the closure (mechanical-reviewer, Haiku) checked each Check item against cited evidence on main, the closing tasks, the archive and the header; no blocker. This review replaces the `No review:` reason given in #288. Known limit, not a failed check: "length alone never decides" is evidenced for long related answers (answer-continues-long) and for short unrelated ones (test/clarification.test.ts, 6 words); the only long unrelated case, topic-change-during-question, was a development holdout. |
| Reviewed | 2026-11-12 |

</details>

---

### B-048

**Windows service test cannot delete its data folder after stopping NERV**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-12: verified in [PR #284](https://github.com/voidbrain/nerv/pull/284), no recurrence since.

| | |
|---|---|
| **Issue** | `test/windows-service.integration.ts` failed on the Windows CI job with `EPERM, Permission denied` on its data folder (`nerv-winsvc-*`): PR #262 (CI 42986531117), PR #263 (CI 42988602602), PR #264's branch (CI 42993629496, 42994952185), each on the first attempt. Every failing run lasted 2.1–2.8 s against 5.9 s for a pass. The `EPERM` came from `rmSync` in `finally`, which replaced the error that left the test steps, and `finally` removed the task without stopping NERV, so the still-running service held the folder. Once the test reported the first failure ([PR #265](https://github.com/voidbrain/nerv/pull/265), CI 43004476280 and 43004894442), it was `service status` exiting 1 right after install with `database is locked`. Cause: every CLI command except `nodes` and `help` first runs `assertRootMigrationReady` (`src/root-migration.ts`), which opened the database read-only with no busy timeout. Right after install the service is starting: Store creates the schema and switches to WAL under a write lock, so the check failed at once. The race is not Windows-specific; any CLI command run while serve opens the database could hit it. |
| **Reproduce** | Any platform: `node --test --test-name-pattern="brief database lock" test/root-migration.test.ts` holds an exclusive lock from another process for 400 ms while the check runs; before the fix it fails with `database is locked`. On Windows CI: `node --test test/windows-service.integration.ts`, intermittently. |
| **Check** | The check's connection waits up to 5 s for a lock (`timeout: 5000`, as Store's `busy_timeout`). The regression test failed with `database is locked` before the fix (committed first) and passes after. The Windows test now stops NERV before removing the task, and reports the first failure with any cleanup error, the files left and the node, cmd and wscript processes. Accepted when the Windows job passes on PR #265 and on the next five runs on `main`. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-12 in the reconcile of PR #288. Verified in [PR #284](https://github.com/voidbrain/nerv/pull/284) (CI 43165572275, all four jobs it ran passed; full-suite skipped for records only): no `database is locked` or `EPERM` in 34 Windows `npm test` jobs since the fix. Since then the Windows jobs of CI 43164854081 (#283), 43165354765 (#281), 43165572275 (#284), 43166751719 (#285), 43168006619 (#286) and 43168381380 (F-005-T12 branch) passed; their logs contain neither string (searched 2026-11-12; the #283 and #284 jobs ran no Node tests, #285's ran selected regressions only). No action remains. The follow-ups named below stay unrecorded until seen. Before closure: Verified when the Windows job passes on PR #265 and on the next five CI runs on `main` with no `database is locked` or `EPERM`; a recurrence returns it to Investigate. Not fixed here, recorded for follow-up if seen: other read-only opens without a timeout (`src/node-lifecycle-execution.ts`, `src/upgrade-rehearsal.ts`), the reads Store makes before setting its own `busy_timeout`, and `service stop` returning once the port refuses, before Node and its `cmd` log redirect exit. Root-migration plans made before this change must be regenerated (the handler hashes its own source).

**Third observation, 2026-11-11:** [PR #264](https://github.com/voidbrain/nerv/pull/264) changes only backlog records and task files, and its first Windows run (CI 42993629496) failed the same way. So the trigger is in `main` itself, or in the Windows runner, not in the PR under test. All three failures came after PR #262 merged at about 08:20 UTC; PR #263's fresh run passed. Every PR now risks a red Windows job on its first attempt, so this blocks merges until rerun. [PR #265](https://github.com/voidbrain/nerv/pull/265) found the cause (`database is locked` while the service started).

**Estimates:** Small at closure, 2026-11-12; nothing remains. Investigation and fix took about half a day, mostly CI round trips.

| Field | Value |
|---|---|
| PR / evidence | Closure reconcile: [PR #288](https://github.com/voidbrain/nerv/pull/288). Verification: [PR #284](https://github.com/voidbrain/nerv/pull/284). Test: test/root-migration.test.ts "the root-migration check waits for a brief database lock instead of failing" (fails with `database is locked` before the fix). Fix: [PR #265](https://github.com/voidbrain/nerv/pull/265): diagnostic CI 43004476280 (first failure `service status`) and 43004894442 (`database is locked`). Failing runs before: [CI 42986531117](https://github.com/voidbrain/nerv/actions/runs/42986531117/attempts/1), [CI 42988602602](https://github.com/voidbrain/nerv/actions/runs/42988602602/attempts/1), CI 42993629496, CI 42994952185. |
| Opened | 2026-11-11 |
| Verification | 2026-11-11: cause reproduced on macOS by the regression test (fails before the fix, passes after). Windows CI passed on PR #265 (CI 43005607280) and on PR #264 after merging main into it (CI 43007427908); five clean runs on `main` pending. 2026-11-12: every completed Windows `npm test` job since #265 merged (2026-11-11 11:01 UTC) through CI run 43118800708: 23 passed, 11 failed, and none of the 11 contains `database is locked` or `EPERM` (logs searched; all were B-046 heartbeat failures). The criterion named five runs on `main`, but `main` gets CI only weekly or by dispatch (`.github/workflows/ci.yml`); pull-request runs test each change merged with `main`, so these 34 jobs stand in for them, stated here rather than assumed. |
| Reviewed | 2026-11-12 |

</details>

---

### B-051

**Kaji link server looks up the registry for every unsigned request, with no concurrency bound**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-12 in [PR #291](https://github.com/voidbrain/nerv/pull/291): coalesced in-flight bases() lookups and deterministic regression committed first.

| | |
|---|---|
| **Issue** | Found in the review of [PR #282](https://github.com/voidbrain/nerv/pull/282) (B-043). `KajiLink.serve` (src/kaji-link.ts) awaits `this.port.bases()`, a call to the nervous child process, for every inbound request before `verifySigned` can check it, and nothing bounds how many such lookups run at once. While the child is slow, anyone who can reach the listen address can send unsigned requests that each take a slot of the shared process queue (`MAX_CHILD_REQUESTS`, 32) and make unrelated callers fail with "Process queue is full". The lookup itself is needed: verification uses the enrolled bases' public keys. |
| **Reproduce** | Hold the main base's nervous calls (as test/periodic-overlap.test.ts does by intercepting `child.send`), then send more than 32 unsigned POSTs to the Kaji listen address: the queue fills and a legitimate call is refused. |
| **Check** | A committed test fails before the fix: concurrent unsigned requests while the child is slow fill the process queue. After the fix they share one in-flight `bases()` lookup or are bounded (excess refused before any child call, with a clear status), legitimate signed requests and the periodic heartbeat still pass, revocation still takes effect on the next lookup, and no timeout is widened. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-12 in [PR #291](https://github.com/voidbrain/nerv/pull/291) (merged into main `9497e89`; CI 43200741170 passed plan, windows, native-macos and validate). The recorded Check is met: deterministic regression committed first in `test/periodic-overlap.test.ts` (951c779) fails before the fix (32 held) and passes after it (1 held, legitimate signed requests and immediate revocation verified). Fix in `src/kaji-link.ts` (9b49a9f) coalesces in-flight `bases()` lookups in `KajiLink`, clearing the reference in `finally` to preserve per-lookup revocation freshness. B-051-T01 closed (0.75 h agent against 1.5 h baseline). No action remains.

**Reproduction and fix 2026-11-12 ([PR #291](https://github.com/voidbrain/nerv/pull/291), B-051-T01):** Committed deterministic regression in `test/periodic-overlap.test.ts` (commit 951c779): with nervous child calls held, 37 unsigned requests filled the process queue (`child.held('kaji.bases')` was 32), the test failed before the fix, and an unrelated caller's `kaji.main` was blocked. Fix in `src/kaji-link.ts`: `KajiLink` coalesces in-flight `bases()` lookups so concurrent requests share one in-flight call while the registry is answering, and clears the reference in `finally` so subsequent lookups are fresh and revocation takes effect immediately on the next lookup. After the fix, `child.held('kaji.bases')` is 1, all unverified requests are rejected with 401/403, `kaji.main` gets through, signed heartbeat requests succeed, and revoked peers are rejected on the next lookup.

**Fresh-context review 2026-11-12 (design-reviewer, Pro):** Pass. No blockers or should-fix. Verified that in-flight `bases()` coalescing in `finally` clears on settlement (resolve/reject), propagating errors cleanly and preserving immediate revocation freshness per lookup. Confirmed deterministic regression 951c779 committed before fix, and all internal call sites in `src/kaji-link.ts` unified to `this.bases()`.

**Estimates:** Small at closure, 2026-11-12; no work remains. Step B-051-T01 took 0.75 h agent (stated) against 1.5 h baseline.

| Field | Value |
|---|---|
| PR / evidence | Closure: [PR #291](https://github.com/voidbrain/nerv/pull/291) (B-051-T01), Test: test/periodic-overlap.test.ts. Review: fresh-context design/security review (Pro), Pass. Recorded in [PR #289](https://github.com/voidbrain/nerv/pull/289). Found in the B-043 design review of #282; code confirmed on main: `serve` calls `this.port.bases()` before `verifySigned`. |
| Opened | 2026-11-12 |
| Verification | Unit/integration: 2026-11-12 test/periodic-overlap.test.ts reproduces queue saturation before fix (32 held) and passes after fix (1 held, legitimate and revocation checks pass). PR #291 CI 43200741170 passed all jobs. Closed 2026-11-12. |
| Reviewed | 2026-11-12 |

</details>

---

### B-043

**Process queue saturation during Windows cross-base execution test**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-12: PR #282's CI passed (Windows and full suite) and the next five full Windows test runs showed no `Process queue is full`; every recorded check passed.

| | |
|---|---|
| **Issue** | PR #198 Windows run 42401648023 failed in the existing cross-base kaji.run test: ProcessClient.call rejected Runtime.loop's finish RPC with “Process queue is full” (-32004). The other Windows run on the same candidate passed. No CRT code runs in that backend path; the exact cause remains unverified. |
| **Reproduce** | Any platform: `node --test test/periodic-overlap.test.ts` holds every request the coordinator sends to the nervous child (a stalled child) while the resumer and the Kaji heartbeat tick; before the fix the resumer alone fills the 32-request bound and the heartbeat starts one registry lookup per tick. In the cross-base fixture, holding the main base's nervous requests for 2 s before the chat reproduces the CI failure itself (`Process queue is full`). |
| **Check** | Cause: two periodic jobs started again while their previous run still waited on the nervous process, the resumer's `misato.resumable` poll and the Kaji heartbeat tick (`listen` → `kaji.bases`), so a child that stops answering for about 1–2 s collected one request per tick and per peer heartbeat against the shared bound of 32. Fix: one resumable poll at a time (a sweep asked for during a poll shares one fresh poll after it; a resumer tick during a poll is skipped) and one heartbeat tick at a time (`busy`, as the other ticks). A deterministic regression explains the observed saturation. Background work stays bounded; preserve the process queue safeguard. The cross-base path records a terminal result or an explicit failure without lost/duplicate remote effects. Windows and full-suite checks pass; do not merely widen a timeout/queue or weaken assertions. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-12 (reconcile [PR #306](https://github.com/voidbrain/nerv/pull/306)): the five-run criterion below is met. After the three runs counted in PR #288, the next Windows jobs that ran the full Node suite were CI [43174322070](https://github.com/voidbrain/nerv/actions/runs/43174322070) (#287, head `27057a9`) and [43175149191](https://github.com/voidbrain/nerv/actions/runs/43175149191) (#287, head `39afae7`): both passed and neither log contains `Process queue is full`. Twelve further full Windows jobs since then, through #305's CI 43232448595, also passed with no occurrence (logs searched 2026-11-12; each ran the cross-base `kaji-run` tests). Not counted: Windows jobs with `Full=false` (selected Node regressions or none), e.g. #288 (CI 43170498801) and #304 (CI 43228969920). As for B-048, pull-request runs stand in for runs on `main`. The open note on the Kaji HTTP server lookup was taken up as B-051 (closed in PR #291). No work remains. Original criterion: Verified when the fix's PR CI passes (Windows and full suite) and the next five Windows runs on `main` show no `Process queue is full`; a recurrence returns it to Investigate with the held-request counts below as the first diagnostic. Bounded, not eliminated: a call that times out (5 s) keeps its slot until the child answers (the safeguard), so each producer re-issues at most once per call timeout during a stall; a stall long enough to fill 32 slots that way (tens of seconds) is refused by the safeguard as intended.

**Reconcile 2026-11-12 ([PR #288](https://github.com/voidbrain/nerv/pull/288)):** [PR #282](https://github.com/voidbrain/nerv/pull/282) merged into main `b6737fb` at 00:17 UTC; its CI [43125296727](https://github.com/voidbrain/nerv/actions/runs/43125296727) passed all five jobs, Windows and full-suite included. Windows jobs since then that ran the full Node suite: CI 43165354765 (#281), 43168006619 (#286; attempt 2 kept attempt 1's Windows job) and 43168381380 (F-005-T12 branch, not merged): all passed and none of their logs contains `Process queue is full` (searched 2026-11-12). Not counted: the Windows jobs of #283 and #284 ran no Node tests, and #285's ran selected Telegram regressions only. As for B-048, pull-request runs stand in for runs on `main`, which gets CI only weekly or by dispatch. 3 of 5 so far; it stays Implemented. B-043-T01 closed.

**Reproduction and fix 2026-11-12 ([PR #282](https://github.com/voidbrain/nerv/pull/282), B-043-T01):** CI logs of both failing Windows attempts were read: run 42401648023 (job 128490535844) failed at `ProcessClient.call` ← `finish` ← `Runtime.loop`; run 42994952185 attempt 1 (job 130436848956) failed at `ProcessClient.call` ← `bases` ← `KajiLink.run` ← the test's direct `la.run`. Different callers, one cause: the queue was already full. Committed regression first (`test/periodic-overlap.test.ts`): with the child's requests held, 32 `misato.resumable` polls were outstanding (test 1), three sweeps asked during a held poll sent their own polls (test 2), and 53 heartbeat registry lookups started in 640 ms (test 3); all three pass after the fix. Per-producer counts in the cross-base `kaji.run` fixture, main base's nervous requests held for 2 s just before the chat (local diagnostic, not committed): before the fix 32 held (`misato.resumable` 16, `kaji.bases` 15, `kaji.main` 1) and the test failed with `Process queue is full`; after it 4 held (1, 2, 1) and the test passed; held for 8 s after it, 8 (2, 4, 2) and it passed. The `kaji.bases` lookups came from this base's own tick and from the peer's heartbeats, which its unguarded tick resent every 200 ms while the previous one was unanswered. **Ruled out:** the proactive watch (`startWatch` coalesces through `checkWatch`/`watchWork`, so the timing reassessment's finding 2 overstated it), the outbox, brief, instrumentality, dashboard feed, worker-link heartbeat and Telegram delivery ticks (each already guarded or coalesced). **Fresh-context review 2026-11-12 (design-reviewer):** no must-fix. Applied: the heartbeat guard is an instance field, so a stop and start while a tick waits does not run a second tick beside it (regression committed first, failed before: 2 lookups); the stall tests release held requests in `finally`. **Not fixed here, recorded for follow-up if seen:** the Kaji HTTP server (`serve` in `src/kaji-link.ts`) calls `kaji.bases` for every inbound request before verifying its signature, with no cap on concurrent requests, so a client that can reach the listen address could put one nervous request in flight per request while the child is slow; in this fixture the only sender is the peer, whose tick is now guarded. A new record (cap or coalesce that lookup) needs an ID reserved; the owner decides whether to open it. Side effect of the guard: with many peers timing out (8 s each, in turn) a tick can outlast the 30 s interval, so ticks are skipped and the "unreachable" log comes later than `missesToLog` assumes; before, overlapping ticks counted misses too fast. **Not established:** what stalls the child on the Windows runner; B-046's mechanism (3) recorded both store processes pausing together for 200–270 ms on CI, which is consistent with but does not prove a longer pause here.

**Code evidence 2026-11-11 ([PR #261](https://github.com/voidbrain/nerv/pull/261)):** the [timing reassessment](../../reviews/2026-11-11-timing-reassessment.md) found three periodic jobs without the `busy` guard the other ticks use: the resumer (`startResumer`), the proactive watch (`startWatch`) and the base heartbeat tick in `src/kaji-link.ts`. Each can start again before its previous run finished and all share the 32-request child bound; this fixture runs them at 100 and 200 ms. This supports the overlap hypothesis but is not a reproduction: the slow-child regression this record requires is still the next step, before any guard is added.

**Observation 2026-11-11:** [PR #264](https://github.com/voidbrain/nerv/pull/264), which changes only records, failed the Windows job once with the same `Process queue is full` in the cross-base `kaji.run` test (CI 42994952185); the rerun then hit B-048 instead. The [timing reassessment](../../reviews/2026-11-11-timing-reassessment.md) found three periodic jobs without an overlap guard; not reproduced yet.

**Estimates:** Small at closure, 2026-11-12; no work remains (observation took no agent work beyond the log search in this reconcile). 2026-11-12: B-043-T01 closed at about 2 h agent (stated) against 2 h; remaining work is observation of the next two full Windows runs only. Re-estimated 2026-11-12 in agent hours (harness 5.6.0): B-043-T01 had 0.5 h agent remaining (CI, merge); about 1.75 h spent (stated); method in the task basis. Day figures are dated history: 2–3 focused days estimated 2026-11-07.

| Field | Value |
|---|---|
| PR / evidence | Closure reconcile: [PR #306](https://github.com/voidbrain/nerv/pull/306) (records only; No review: documentation-only closing reconcile from CI evidence, the fix itself had a fresh-context design review in #282 as below). Reconcile: [PR #288](https://github.com/voidbrain/nerv/pull/288). Fix: [PR #282](https://github.com/voidbrain/nerv/pull/282) (B-043-T01), CI [43125296727](https://github.com/voidbrain/nerv/actions/runs/43125296727) green; [PR #261](https://github.com/voidbrain/nerv/pull/261) timing reassessment; [PR #199](https://github.com/voidbrain/nerv/pull/199) dynamic-noise revision and retained CI evidence;  [PR #198](https://github.com/voidbrain/nerv/pull/198) observed failure; [Windows run 42401648023](https://github.com/voidbrain/nerv/actions/runs/42401648023), job 128490535844; existing Test: test/kaji-run.test.ts, main-base Misato remote action and approval. Same-candidate run 42401650926 Windows passed. |
| Opened | 2026-11-07 |
| Verification | 2026-11-07 CI failure observed: Process queue is full at ProcessClient.call → Runtime.loop finish. 2026-11-12: reproduced deterministically (test/periodic-overlap.test.ts fails before the fix, passes after; local macOS). Windows CI on the fix passed (PR #282 CI 43125296727, all five jobs). After the merge, 5 of 5 full Windows runs clean (CI 43165354765, 43168006619, 43168381380, 43174322070, 43175149191; no `Process queue is full`), and 12 more through CI 43232448595. Closed 2026-11-12. |
| Reviewed | 2026-11-12 |

</details>

---

### B-046

**Intermittent heartbeat loss in deferred worker-approval fixtures**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-12: remedy (a) merged in PR #293 after a fresh-context review; the next 11 CI runs ran every B-046 and F-014 deferred-approval test on Windows and under Linux coverage with no session loss.

| | |
|---|---|
| **Issue** | PR #219 Linux coverage failed deferred-approval cancellation; PR #221 Windows failed deferred-approval resource retention. Both existing fixtures reported Worker connection lost. The stack reaches the heartbeat request rejection path; the fixture uses a 150 ms heartbeat/reply budget. Unchanged-head failed-job retries passed; matching symptoms do not establish a shared cause or a fix. |
| **Reproduce** | Run test/worker-link.test.ts, cancellation of a deferred approval stands down its card and makes the terminal result replayable, under coverage and constrained scheduling; also run deferred owner approval retains the worker resource on Windows. Compare the isolated diagnostic and original CI attempts. No worker/runtime test or executable behavior changed in the documentation PR. |
| **Check** | A controlled regression explains the failure before any fix; preserve cancellation, terminal replay, resource ownership and fail-closed unknown outcomes. Do not weaken assertions or merely widen timeouts. Final CI passes and the causal fix is independently reviewed; one successful retry is not closure. |

<details>
<summary>Next action, estimates and evidence</summary>

**Closure 2026-11-12 (closing reconcile [PR #308](https://github.com/voidbrain/nerv/pull/308)):** [PR #293](https://github.com/voidbrain/nerv/pull/293) merged into main `d751a1c` at 11:06 UTC with plan, validate, windows and native-macos green. Every CI run on a PR opened after it whose jobs ran the Node suite tested a merge with #293 in it: runs 43207764269, 43210723639, 43214703863, 43221745947, 43224282982, 43224427512, 43225678158, 43226982598, 43229809268, 43231161689 and 43232448595 (PRs #294, #295, #297, #300–#303 and #305). In each, the Windows `npm test` and the Linux `validate` job (`npm run test:coverage`) passed all seven B-046 tests and the three F-014 deferred-approval tests (the original failing cases), with no failed test in either job: 22 job runs, no `Worker connection lost` or `No outbound worker session`. The one failed run in that window (43217698406, #299) failed the Angular bilingual browser acceptance, not the worker link. The causal fix had a fresh-context design review (#293, Pass). Remaining uncertainty, recorded rather than resolved: mechanism (2) of the third fix (a ping answer still queued for verification when the capped wait ends) has no change addressing it and was not seen again; a recurrence of the symptom opens a new B- record linking this one.

**Owner decision 2026-11-12:** remedy (a) for mechanism (3): give the test fixtures a ping reply budget above the measured store latency (nervous-process calls of 50–270 ms on loaded runners); the B-046 stall tests keep 150 ms; production (10 s budget) unchanged. (b) WebSocket ping/pong and (c) a registry snapshot were declined. The owner asked that it not start until the current work is finished.

**Remedy (a) implemented 2026-11-12 ([PR #293](https://github.com/voidbrain/nerv/pull/293)):** owner chose remedy (a) for mechanism (3). In `test/worker-link.test.ts`, `fixture(heartbeatMs = 500, workerHeartbeatMs = heartbeatMs)` gives fixtures a 500 ms ping reply budget above the measured store latency (50–270 ms on loaded runners). The B-046 stall tests explicitly keep 150 ms (`fixture(150)` and `fixture(150, 60000)`). The committed regression `B-046: a ping waiting on a slow store on the worker does not end a healthy session` has its `todo` removed and passes (32 of 32 tests in `test/worker-link.test.ts` pass). Production link settings remain unchanged. Closes after independent review and CI passing.

**Next action / closure evidence:** Fix implemented 2026-11-11 ([PR #276](https://github.com/voidbrain/nerv/pull/276)) for finding 1 of the timing reassessment: a request timeout that fires late because this process was stalled (more than a quarter of the budget, at least 25 ms, past its deadline) is deferred once by a fresh budget from the moment the loop resumed; an on-time timeout stays final, and a peer that is really gone still times out after the grace. The committed regression `B-046: a healthy session survives an event-loop stall longer than the heartbeat budget` is no longer todo and passes (3 of 3 locally; it failed 3 of 3 with a one-turn `setImmediate` deferral, which is not enough when the reply is produced only after the stall). Closes after independent review and CI passing, Windows included, on #276 and the next main runs. B-043 (finding 2) and B-042 stay separate.

**Second fix 2026-11-11 ([PR #278](https://github.com/voidbrain/nerv/pull/278)):** after #276, [PR #275](https://github.com/voidbrain/nerv/pull/275) run [43084555427](https://github.com/voidbrain/nerv/actions/runs/43084555427) failed the B-046 regression on Windows (the test took 4.5 s, about three times its usual time: a loaded runner). Not reproduced there; 15 runs on macOS under twice-oversubscribed CPU passed. Code reading found the gap, now reproduced deterministically on macOS (3 of 3 before the fix): the grace budget's own timer was final even when it fired late after a second stall, and a verdict ran before the frames already received were applied (expired timers run before sockets are read; received frames are verified one by one on the `incoming` chain, which awaits the registry). Now every timeout verdict waits one `setImmediate` (after the poll phase) and then the frames already queued on `incoming`, for at most one more budget (each queued frame awaits the registry, in serve nervous-process calls with their own timeouts, so waiting for the whole queue could delay a verdict by many budgets), before rejecting. Worst case for a peer that never answers: budget + stall + budget, plus at most one budget while received frames are still verified; the grace is granted once per request (new test below). The cap itself has no dedicated test. #278 Windows CI run [43105159883](https://github.com/voidbrain/nerv/actions/runs/43105159883) then failed the new second-stall test (the other three B-046 tests passed there): on Windows (IOCP) the poll phase only collects a socket completion and the read callback runs in the next loop turn's pending phase, after a single `setImmediate`. The verdict now waits one full loop turn (two nested `setImmediate`) before checking. This explanation is inferred from libuv's Windows design, not observed; Windows CI decides it. Run [43106952492](https://github.com/voidbrain/nerv/actions/runs/43106952492) (one Windows run): with the loop-turn wait the second-stall test and the other two B-046 session tests passed on Windows; the new single-request test failed on Linux and Windows only on its own lower bound (1000 ms rounded, under an exact `>= 1000`), a test defect: timers fire a fraction of a millisecond early on the loop clock; the bound now allows 50 ms, still separating one grace from none. Whether this was the Windows cause is not proven until Windows CI passes repeatedly.

**Third fix 2026-11-12 ([PR #278](https://github.com/voidbrain/nerv/pull/278)), owner agreed 2026-11-11 to continue past the estimate:** #278 run [43108272198](https://github.com/voidbrain/nerv/actions/runs/43108272198) passed all four B-046 tests on Windows but lost the session in "F-014 review: deferred owner approval retains the worker resource" (the original symptom). A timeout now carries its diagnosis as the error cause (method, role, budget, timer lateness, elapsed, queued frames, last frame age, pending; no payload or identity). Under CPU load locally it named three mechanisms: (1) "Worker pending request bound reached": the heartbeat took one of the four work slots, so a link whose slots were busy refused its own heartbeat and ended a healthy session, and a fifth incoming request (the ping) did the same on the receiving side; (2) a ping answer still queued for verification when the capped wait ended; (3) no answer within the 150 ms fixture budget with no stall. Fix for (1), test first ("B-046: a link whose request slots are all busy keeps its heartbeat and its session", 3 of 3 failures before): a tick is skipped while a ping is outstanding, the ping is counted apart from the work bound on both sides, at most one at a time. (2) and (3) were not seen again on a quiet machine (see the measurement note below), but no change addresses them: they remain possible causes of a Windows CI failure, and "Implemented" does not cover them. Review of #278 (fresh context, Opus): no blocker; its should-fix items are done in [PR #279](https://github.com/voidbrain/nerv/pull/279): the protocol decision states the heartbeat slot, and an overlapping inbound ping from a peer on earlier code takes a work slot instead of ending the session (test "B-046: an overlapping ping from a peer on earlier code is answered, not refused", 3 of 3 failures against the strict receiver). The second-stall test was corrected to run only the coordinator heartbeat: in one process the stalls also froze the peer answering a reverse-direction ping (3 of 15 failures before and after the slot fix); now 0 of 20, and still 5 of 5 failures against the pre-#278 source.

**Observation 2026-11-12 (#275 run [43118800708](https://github.com/voidbrain/nerv/actions/runs/43118800708), with #278 and #279 merged in):** Windows failed "F-014: restart during unfinished work preserves uncertainty and resource lock until explicit owner reconciliation" with the diagnosis `{ method: worker.ping, role: coordinator, budgetMs: 150, firstLatenessMs: 0, elapsedMs: 150, queuedAtVerdict: 0, lastFrameAgoMs: 202, pending: 2, incomingPing: false }`: mechanism (3), the in-process worker sent nothing for 202 ms while the loop ran on time. That test blocks the loop with two `execFileSync` CLI calls on the worker database. Cause not identified; the failed jobs were rerun on the unchanged head, which proves nothing about it.

**Mechanism (3) identified 2026-11-12 ([PR #280](https://github.com/voidbrain/nerv/pull/280), B-046-T02):** every frame a link receives is verified on the serial `incoming` chain against its registry, `kaji.bases` and `kaji.main` calls to the receiving side's nervous process, so the worker answers a ping only after its nervous process has served the calls queued ahead of them. #280 adds a fixture print of nervous calls of 50 ms or more (side, method, duration, start on the process clock, calls in flight; no payload) and an `atMs` field in the timeout diagnosis. Its run [43121587426](https://github.com/voidbrain/nerv/actions/runs/43121587426) (head bb4f45c) failed on Linux coverage the original B-046 test, "F-014: cancellation of a deferred approval stands down its card and makes the terminal result replayable": coordinator ping verdict on time (`firstLatenessMs: 0`, `atMs: 37303`, `elapsedMs: 150`, `queuedAtVerdict: 0`, `lastFrameAgoMs: 147`, `pending: 2`). The same test's print: the worker's `kaji.bases` for that ping started at 37153 (when the ping was sent) and took 225 ms behind one call in flight, a `usage.finish` write that took 271 ms from 37101; at the same moment the coordinator's own nervous process took 215 ms for `kaji.seen`. Both child processes were slow together while this process's loop ran on time: a machine-wide pause of the store processes (disk sync or scheduling on the runner; which one is not established), not the link. The Windows job of that run passed; its prints show nervous calls of 50–140 ms outside the stall tests, close to the 150 ms budget. Committed regression, `todo` until the remedy is chosen: "B-046: a ping waiting on a slow store on the worker does not end a healthy session" delays the worker's next `kaji.bases` by 300 ms with the loop free; it fails 3 of 3 locally (macOS) and passes 2 of 2 with an 80 ms delay. **Fixture or production:** a fixture timing sensitivity. The fixtures' ping budget is 150 ms; production's is 10 s and a nervous call times out at 5 s, so production would end a session this way only if the store stalled for about 10 s, when ending it is defensible. Verifying before answering is required (an unauthenticated frame is never answered). **Ruled out for this run:** an event-loop stall in the test process (lateness 0), frames received but unverified at the verdict (queue 0), the heartbeat slot bound (fixed in #278), the CLI child of the restart test (this failure was in another test). **Decision for the owner (the task forbids widening timeouts on its own; the timing reassessment said not to widen them as the fix):** (a) fixture only: a ping reply budget in the fixtures above the measured store latency, with the B-046 stall tests keeping 150 ms; production unchanged; recommended, since the production budget already covers it; (b) protocol: prove liveness with transport ping/pong independent of the store, keeping signed pings for offers; changes docs/decisions/worker-protocol.md; (c) verify frames against a registry snapshot the link refreshes off the frame path; trades per-frame revocation freshness, a security choice. After the choice: implement it against the todo regression (remove the todo), fresh-context review, repeated Windows and Linux coverage CI.

**Measurement note 2026-11-12:** local runs from 2026-11-11 evening onward had up to 108 leaked busy-loop processes from earlier CPU-load runs still running (a zsh word-splitting bug in their cleanup; found and killed 2026-11-12). Local figures stated as "under load" understate the load, and figures stated without load were taken under heavy load. Re-measured on a quiet machine after the third fix: test/worker-link.test.ts 0 failures in 8 runs; `npm test` 588 passed, 2 skipped, 0 failed. Windows CI evidence is unaffected.

**Additional observation 2026-11-09:** PR #240 [CI42633909320 attempt1](https://github.com/voidbrain/nerv/actions/runs/42633909320/attempts/1) failed the existing expired-pending-worker-approval case on Windows with `No outbound worker session` at its next dispatch;498 passed, one failed, four skipped. WorkerLink and that test are unchanged by PR240. Isolated Mac execution of the exact test passed (one test); a failed-job-only unchanged-head retry was requested, then canceled when the required suite-version metadata changed the PR head. This is another session-loss observation, not a proven shared heartbeat cause or fix. Retain the original logs and investigation; F-026 cannot close on the failed run.

Final PR240 revision6acac44 / CI42635119338 passed all five/full-suite checks. Its initial macOS attempt could not acquire a hosted runner; an unchanged-head failed-job retry passed. WorkerLink and the worker test stayed unchanged. Neither this final pass nor the separate infrastructure failure establishes a causal B-046 fix.

**Mechanism reproduced 2026-11-11 ([PR #261](https://github.com/voidbrain/nerv/pull/261)):** the [timing reassessment](../../reviews/2026-11-11-timing-reassessment.md) shows that with the fixtures' 150 ms heartbeat budget a 200 ms event-loop stall while a `worker.ping` is in flight ends the session 8 of 8 times (0 of 8 with a 100 ms stall or a 1,000 ms budget): the expired timeout runs before the reply already waiting on the socket is read. This yields both recorded messages (`Worker connection lost`, then `No outbound worker session`). A committed `todo` regression in test/worker-link.test.ts fails today without failing the suite. Next: change the verdict so received data gets one event-loop turn before the peer is declared lost, remove the `todo`, independent review. The match to the recorded CI failures is by symptom and mechanism; those runs were not replayed, and plain CPU contention (48 runs) reproduced nothing.

**Observation 2026-11-11 ([PR #275](https://github.com/voidbrain/nerv/pull/275), runs 43075838339 attempts 1–2 and 43078307821):** Windows `npm test` failed on three consecutive attempts at two heads, each time in a different F-014 test of test/worker-link.test.ts with `Worker connection lost; result may be unknown` (Peer.end, worker-link.ts:336): the original B-046 heartbeat-loss symptom, now on 3 of 3 Windows attempts after passing on #272–#274 the same day with the same Node 24.22.2. The B-046 todo regression is listed in the failure summary as designed and is not the cause (an earlier note in #275 said otherwise). PR #275 changes no worker code or test; its only runtime-adjacent change is the Gauntlet 0.7.1 dev dependency.

**Observation 2026-11-11, after the fix ([PR #275](https://github.com/voidbrain/nerv/pull/275) run [43084555427](https://github.com/voidbrain/nerv/actions/runs/43084555427), head 2a226ed with #276 merged in):** Windows `npm test` failed the new regression itself, "B-046: a healthy session survives an event-loop stall longer than the heartbeat budget" (4.5 s), with "a reply that arrived during the stall must not end the session"; `full-suite` failed in the same run. The same test passed on Windows in #276. One failure, not yet reproduced: the one-grace fix is not shown to hold on a loaded Windows runner. Not rerun to obtain a green result; B-046 stays open until it is explained.

**Estimates:** Small at closure, 2026-11-12; no work remains. B-046-T02 closed at about 6.25 h agent (stated: 5.75 h before this reconcile plus about 0.5 h of CI evidence collection and records) against a 1.25 h baseline. Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 1 open step has 0.5 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Re-estimated 2026-11-11 in agent hours (harness 5.6.0): the open step totals 1.5 h agent (steps table; method in each task basis). Day figures below are dated history. Medium remaining effort, provisionally 2–3 focused days including controlled reproduction, regression, causal fix and CI verification. Estimated 2026-11-08; reassess after evidence identifies the owner/cause.

| Field | Value |
|---|---|
| PR / evidence | Closure reconcile: [PR #308](https://github.com/voidbrain/nerv/pull/308), records only (No review: documentation-only closing reconcile from CI evidence; the fix had a fresh-context design review in #293 as below). CI after #293: 43207764269, 43210723639, 43214703863, 43221745947, 43224282982, 43224427512, 43225678158, 43226982598, 43229809268, 43231161689 and 43232448595, Windows and Linux coverage, all B-046 and F-014 deferred-approval tests passed. Review: fresh-context design review (Pro) of [PR #293](https://github.com/voidbrain/nerv/pull/293) (remedy a): Pass (0 blockers, 0 should-fix); test fixture ping reply budget set to 500 ms while stall tests keep 150 ms, production unchanged, regression assertions preserved. Test: test/worker-link.test.ts "B-046: a ping waiting on a slow store on the worker does not end a healthy session" (committed failing without todo in cd477e4, passes with remedy (a)). Test: test/worker-link.test.ts "B-046: a healthy session survives an event-loop stall longer than the heartbeat budget" (committed as todo in [PR #261](https://github.com/voidbrain/nerv/pull/261), todo removed by the fix). Test: "B-046: after a stall, a peer that never answers is still disconnected after one grace budget" (added after review). Test: "B-046: an answer that arrives during a second stall is read before the grace budget ends the session" (committed failing before the second fix, [PR #278](https://github.com/voidbrain/nerv/pull/278); it now also samples the session directly). Test: "B-046: a stalled request the peer never answers gets one grace budget, not two" (#278 review: the dead-peer test could not see a second deferral, because heartbeats sent after the stall end the session anyway; this one fails 3 of 3 on a two-grace mutant). Review of #278: fresh-context design review (Opus), no blocker; should-fix items (time bound of the verdict wait, unenforced once-only grace) fixed. Review: fresh-context design review (Opus) of #276: no blocker; fail-closed semantics, admission retention and timer cleanup hold; the regression fails 3 of 3 with only src/worker-link.ts reverted; should-fix items (no committed dead-peer-after-stall test; the code comment claimed a laptop sleep counts as a stall, which depends on the platform clock) fixed in #276. [PR #271 CI 43020769457](https://github.com/voidbrain/nerv/actions/runs/43020769457) (2026-11-11, records and one setting only): Windows failed `F-014: restart during unfinished work preserves uncertainty and resource lock until explicit owner reconciliation` and `F-014 review: expired pending worker approval releases only proven unexecuted work without an owner tap`, with the B-046 stall assertion; another occurrence with no runtime change. [PR #266 CI 43008826172](https://github.com/voidbrain/nerv/actions/runs/43008826172) (2026-11-11, harness/records-only PR): Windows failed `F-014 review: approval after disconnect cannot execute with an invalidated worker lease` with `Worker connection lost` from the heartbeat path (`src/worker-link.ts:336`), alongside the B-046 todo regression; a new fixture showing the same symptom. [PR #261](https://github.com/voidbrain/nerv/pull/261) timing reassessment; [PR #242](https://github.com/voidbrain/nerv/pull/242) retains/supersedes PR241 and adopts diagnostics;  PR240 final-result reconciliation: [PR #241](https://github.com/voidbrain/nerv/pull/241); [PR #222](https://github.com/voidbrain/nerv/pull/222) evidence reconciliation; [PR #221 CI 42530253552 attempt 1](https://github.com/voidbrain/nerv/actions/runs/42530253552/attempts/1): Windows deferred owner approval retains the worker resource failed in the same heartbeat rejection path; unchanged-head failed-job retry passed. No executable worker code or test assertion changed; [PR #220](https://github.com/voidbrain/nerv/pull/220) task/capability and evidence reconciliation; [PR #219](https://github.com/voidbrain/nerv/pull/219); [CI 42521677029 attempt 1](https://github.com/voidbrain/nerv/actions/runs/42521677029/attempts/1) failed Linux coverage; attempt 2 reran only failed jobs and passed, retaining Windows/native results. Test: test/worker-link.test.ts deferred-approval cancellation. Isolated Mac Node 26 coverage diagnostic passed with loopback access; an earlier sandbox-denied run was stopped and excluded from runtime conclusions. |
| Opened | 2026-11-08 |
| Verification | Closed 2026-11-12: 11 CI runs after #293 merged passed every B-046 and F-014 deferred-approval test on Windows (`npm test`) and Linux (`test:coverage`). 2026-11-12 reconcile: #276 ([CI 43083410323](https://github.com/voidbrain/nerv/actions/runs/43083410323)), #278 ([CI 43116761922](https://github.com/voidbrain/nerv/actions/runs/43116761922)) and #279 ([CI 43117700741](https://github.com/voidbrain/nerv/actions/runs/43117700741)) merged with plan, validate, windows, native-macos and full-suite green; the #277 merge (CI 43119747639) also passed Windows. Mechanism (3) failed on Windows on #275 run 43118800708 with both fixes merged in (Observation above), so green runs do not verify B-046. 2026-11-11 Unit/integration: the B-046 regression and the other 25 tests of test/worker-link.test.ts pass 3 of 3 locally (macOS) with the fix; Windows CI passed in #276 but failed the regression on #275 run [43084555427](https://github.com/voidbrain/nerv/actions/runs/43084555427). Second fix with review changes: the four B-046 tests pass 3 of 3 locally (macOS), test/worker-link.test.ts passes 3 of 3 under twice-oversubscribed CPU, `npm test` 587 passed, 2 skipped, 0 failed. Windows CI run 43105159883 failed the second-stall test; after the loop-turn change the second-stall test passed on Windows in run 43106952492 (one run, not yet repeated); test/worker-link.test.ts passes 3 of 3 on macOS; third fix (slot bound) on a quiet machine: worker-link 0 failures in 8 runs, `npm test` 588 passed, 2 skipped; repeated Windows CI pending. 2026-11-08: intermittent CI failure observed; isolated pass and unchanged-head retry pass did not establish a causal fix. |
| Reviewed | 2026-11-12 |

</details>

---

### F-043

**Reminder times: all day, at a time, from–to, from, until**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-12: [PR #310](https://github.com/voidbrain/nerv/pull/310) merged into main `eb396c2` after CI 43268094337 passed all five jobs (plan, validate, windows, native-macos, full-suite).

| | |
|---|---|
| **Issue** | Owner request 2026-11-05: "Renew car insurance" needs no time; "Chiamare il dentista" could be at a time, between two times, from a time or until one. Every reminder has one exact time today. |
| **Reproduce** | `nerv chat "remind me to renew the car insurance on 3 March"`: it gets a made-up time. |
| **Check** | A reminder is all day, at a time, from–to, from or until; the request sets it ("on 3 March", "at 10", "between 10 and 12", "after 15", "by 18"); Coming up, the inbox and the brief show it that way; an all-day reminder arrives at the brief's time on its day; a range arrives at its start (or, for "until", ahead of the end); old reminders read as "at a time". |

<details>
<summary>Next action, estimates and evidence</summary>

**F-043-T01–T03, 2026-11-12 ([PR #310](https://github.com/voidbrain/nerv/pull/310)):**
- **F-043-T01 (`src/reminder-time.ts`, `src/store.ts`, `src/rpc.ts`, `src/nervous-process.ts`, `src/runtime.ts`, `src/server.ts`, `src/executors.ts`):** Added reminder time kinds (`all-day`, `at`, `from-to`, `from`, `until`) and optional `end` timestamp with an additive `reminder_times` table in SQLite that migrates existing reminders as `at` ("at a time") without altering `reminders` columns. Exposed `kind` and `end` across RPC (`reminders.add`, `reminders.update`), `Runtime`, REST (`POST /api/reminders`, `PATCH /api/reminders/:id`) and `reminders.add` / `reminders.list` executors.
- **F-043-T02 (`src/reminder-time.ts`, `src/misato.ts`, `src/runtime.ts`, `src/executors.ts`):** Added bilingual (EN/IT) request parsing (`parseReminderRequest`, `reconcileReminderArgs`) for date-only all-day reminders ("on 3 March", "il 3 marzo"), exact times ("at 10", "alle 10"), ranges ("between 10 and 12", "from 10 to 12", "tra le 10 e le 12", "dalle 10 alle 12"), start-only ("after 15", "dopo le 15", "dalle 15") and deadlines ("by 18", "until 18", "entro le 18", "fino alle 18"), overriding any made-up clock time proposed by Misato on date-only requests.
- **F-043-T03 (`src/store.ts`, `src/brief.ts`, `web/public/dashboard/live.js`, `web/src/i18n.ts`, `web/src/main.ts`):** All-day reminders arrive at `brief.at` (`08:00` default) on their local day in `config.timeZone` and reschedule when `settings.schedule` or `brief.at` changes; `from-to` and `from` arrive at their start (`due`); `until` arrives 1 hour ahead of `end`. Coming up in the live dashboard, the Angular workspace, the local inbox delivery message and Hyuga's brief display the reminder time kind in English and Italian. Note: host token counters are not exposed in this environment (`work-usage` coverage `unavailable`).

**Next action / closure evidence:** Closed 2026-11-12: [PR #310](https://github.com/voidbrain/nerv/pull/310) merged into main `eb396c2` after CI [43268094337](https://github.com/voidbrain/nerv/actions/runs/43268094337) passed all five jobs (`plan`, `validate`, `native-macos`, `windows`, `full-suite`). F-043-T01–T03 closed.

**Estimates:** Small at closure, 2026-11-12; 0 h remaining (3 steps closed 2026-11-12 in 0.75 h agent stated total against 4.5 h baseline). Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 3 open steps total 3 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Medium remaining effort. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | [PR #310](https://github.com/voidbrain/nerv/pull/310) (F-043-T01–T03 implementation and regressions), CI [43268094337](https://github.com/voidbrain/nerv/actions/runs/43268094337) all five jobs green; [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; Owner request 2026-11-05 |
| Opened | 2026-11-05 |
| Verification | Closed 2026-11-12: [PR #310](https://github.com/voidbrain/nerv/pull/310) CI [43268094337](https://github.com/voidbrain/nerv/actions/runs/43268094337) passed plan, validate, windows, native-macos and full-suite; unit/integration (`test/core.test.ts`, `test/misato.test.ts`, `test/brief.test.ts`, `test/dashboard.test.ts`) and browser/accessibility (`test/angular.browser.mjs`, `test/pwa.browser.mjs`, AXE 0 violations) passed |
| Reviewed | 2026-11-12 |

</details>

---

### B-008

**Tabgha dashboard says CONNECTION LOST while a relayed request is running**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-12 as not reproduced on current main (owner decision); the original timeout's cause stays unidentified.

| | |
|---|---|
| **Issue** | Owner test on Tabgha 2026-11-05: during a request relayed to Neo Tokyo-3 (about 80 s), Tabgha's dashboard showed *LIVE · CONNECTION LOST — Request timed out; outcome may be unknown.. Run npm start -- open dashboard again if the service restarted.* The service had been up two minutes and the reply arrived. The message is the scheduler/brain call timeout reaching the browser; one failed poll is shown as a lost connection, with a doubled full stop and a misleading restart hint. |
| **Reproduce** | [Reproduction on Tabgha, 2026-11-12](../acceptance/b008-tabgha-2026-11-12.md) (method and results). Original: on a base that is not the main one, ask something in its dashboard chat while the main base takes over a minute to answer. |
| **Check** | A slow or failed poll is retried before anything is shown; a real loss says what is unreachable; the call that timed out is found and fixed or given a fitting limit; no doubled punctuation; a test covers a poll that fails once. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Partial fix in [PR #153](https://github.com/voidbrain/nerv/pull/153), 2026-11-06: one failed poll preserves the last view and retries on the regular interval; repeated failures probe authenticated status and distinguish REFRESH DELAYED, STATUS UNAVAILABLE (HTTP error) and SERVICE UNREACHABLE (no reply). A successful poll clears the warning. GET reads have a 10 s bound; writes are neither retried nor given the read timeout. API errors name method/path, IPC timeouts name process/method/limit, and the banner removes doubled punctuation and the unsupported restart hint. Regression covers transient failures, recovery, status reachability, session expiry, read bounds, no write replay, and dashboard REST reads during a pending relay. The old report lacks endpoint/method details; the original timeout cause remains unverified, so B-008 stays Investigate until reproduced and fixed or given an evidenced fitting limit.

**Closure 2026-11-12 (owner decision):** closed as not reproduced. On main `8c58ee5` the real Tabgha dashboard stayed live through relays of 47.5 s and 209.6 s with no failed or slow read ([evidence](../acceptance/b008-tabgha-2026-11-12.md)); the 2026-11-05 message came from the ProcessClient IPC timeout that PR #153 replaced, and its cause was never identified (hypotheses: SQLite lock contention on Windows, a coordinator event-loop stall, start-up work). If the banner shows a lost connection again, open a new record linking this one. Follow-ups from the reproduction: B-054, B-055.

**Reproduction on current main, 2026-11-12 ([PR #318](https://github.com/voidbrain/nerv/pull/318)):** the agent updated Tabgha to `8c58ee5` with the owner's approval and drove its real dashboard in headless Edge, each run starting about 25 s after a service restart. Relays of 47.5 s and 209.6 s (the original was about 80 s) left the banner `LIVE · NERV-02 · Tabgha — Kaji line: Neo Tokyo-3 online`; no dashboard request failed, errored or took over 1.5 s. Not reproduced; cause still unidentified. [Evidence](../acceptance/b008-tabgha-2026-11-12.md). Found on the way: B-054 (long replies exceed the main base's 120 s model-call limit) and B-055 (Windows launcher runs Node from an fnm per-shell path). Decision pending: close as not reproduced, or keep open.

**Parked 2026-11-12 (B-008-T01, time box 2 h agent; [PR #283](https://github.com/voidbrain/nerv/pull/283)):** cause not identified. Findings: the original text *Request timed out; outcome may be unknown.* is the ProcessClient IPC timeout before #153 (git history of src/process-client.ts), so a dashboard read on Tabgha waited on a child process call past its limit. In the poll of that time the uncaught reads (sorties, approvals, doctor, reminders, inbox, memory, memory/episodes, sorties/:id) all reach the nervous process (5 s limit); the doctor's brain calls and the bases and pilots reads were caught, so the timed-out call was very likely a nervous call (inferred, not observed). The relay itself does not use a child process on the forwarding base: `kaji.chat` is an HTTPS call to the main base with its own limit. **Ruled out in a controlled run:** a seeded database (3,000 sorties, 36,000 events, 300 briefs) with a real nervous and brain process and a relayed chat held pending: five full dashboard polls (the current read set plus 8 sortie details and 5 traces) took about 17 ms each; the slowest reads were doctor and bases at about 240 ms in the first poll only; no read failed. The committed pending-relay regression passes on Windows CI (run 43125296727, job windows, 2.6 s including process start-up; Linux coverage 1.0 s). Build info, model key reads and the quick_check in doctor are not slow on a database of this size. **Not ruled out:** Tabgha is a Windows mini PC; the report came two minutes after a service start. Open hypotheses: (a) SQLite lock contention on Windows (another process holding the database, such as a CLI command, which opens the store and writes its header, or antivirus/indexer access): the nervous process waits synchronously up to its `busy_timeout` of 5,000 ms, the same as its IPC limit, so every queued call times out; (b) a coordinator event-loop stall of about 5 s, the B-046 mechanism at production scale (expired timers run before replies already received); (c) start-up work in the nervous process during the first minutes. No code changed: no failing test exists to fix against. **Next experiment (owner, about 15 minutes):** on Tabgha, with the service updated to current main and restarted, open the dashboard (`npm start -- open dashboard`), and within two minutes type in its chat `What is the weather like in a typical spring, in three short paragraphs?` (any request the main base takes over a minute to answer). Watch the banner until the reply arrives. Expected: the banner stays LIVE. If it shows REFRESH DELAYED, STATUS UNAVAILABLE or SERVICE UNREACHABLE, copy its detail text (it names `GET /api/<path>` and, for an IPC timeout, `nervous|brain <method> timed out after <N> ms`) into the record or a message, and say whether any other `npm start -- …` command ran at that moment. With that text the agent writes a regression for the named call and fixes or bounds it (B-008-T01).

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 1 open step has 0.5 h agent + 0.25 h owner (steps table; each task basis gives old → new). Figures after this sentence are dated history. Re-estimated 2026-11-12 in agent hours (harness 5.6.0): B-008-T01 has 0.75 h agent and 0.25 h owner remaining, about 1.5 h agent spent (stated). Day figures below are dated history. Small remaining effort. Reassessed 2026-11-06: misleading connection warning and missing diagnostics repaired; original timeout investigation remains. Reassessed again after #153 CI: Small remains valid; no new evidence identifies the original call.

| Field | Value |
|---|---|
| PR / evidence | [PR #318](https://github.com/voidbrain/nerv/pull/318) Tabgha reproduction on 8c58ee5, not reproduced ([evidence](../acceptance/b008-tabgha-2026-11-12.md)); [PR #283](https://github.com/voidbrain/nerv/pull/283): park findings and B-008-T01 (records only). Measurement 2026-11-12: seeded dashboard poll during a pending relay, about 17 ms per poll, no failure (scratch script, not committed). Windows CI run 43125296727: pending-relay regression passed in 2.6 s. [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #153](https://github.com/voidbrain/nerv/pull/153) partial fix and diagnostics; owner test on Tabgha 2026-11-05 |
| Opened | 2026-11-05 |
| Verification | Closed 2026-11-12: not reproduced on Tabgha at 8c58ee5 (two relays, banner live, no failed or slow read); owner decided to close. 2026-11-06 Unit/integration: polling and IPC regressions passed; full suite passed (189 passed, one systemd-only skip), including the pending-relay regression. Browser: headless Chrome verified transient failure retention, delayed refresh, HTTP status failure, unreachable service and automatic recovery; screenshot inspected. Build, typecheck, conventions and integration metadata passed. Merged PR #153 CI run 42218258228 passed validate, windows and native-macos; original Tabgha timeout not reproduced. 2026-11-12: a seeded relay-pending poll measurement (macOS) and Windows CI run 43125296727 did not reproduce it either. |
| Reviewed | 2026-11-12 |

</details>

---

## Closed 2026-11-13

### B-042

**Telegram approval card arrives after dashboard decision**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-13: >10 clean CI runs since [PR #285](https://github.com/voidbrain/nerv/pull/285) merged with no `remote dashboard decision reconciles the main bot card` failure.

| | |
|---|---|
| **Issue** | Reopened after PR #223 Windows test/one-channel.test.ts failed the existing remote dashboard decision reconciles the main bot card assertion; later seen on macOS under load and once on Linux coverage. Cause (2026-11-12): an awaited `deliver()` could return a pass already running whose cleanup had read the card's status before the decision (runtime), and the fixture's wait could pass before Aoba tracked the card (fixture). |
| **Reproduce** | Any platform: `node --test --test-name-pattern="not a pass that read status" test/telegram-reconcile.test.ts` stalls a periodic pass's status lookup after it read the card as pending, decides on the dashboard, then awaits `deliver()`; before the fix no `editMessageReplyMarkup` is sent. |
| **Check** | Explain the failure with controlled evidence; preserve exactly-once effects, eventual stale-button removal, retry/restart and signed lookup. A passing retry is not a causal fix. Do not weaken assertions or merely widen timeouts. |

<details>
<summary>Next action, estimates and evidence</summary>

**Closure 2026-11-13 ([PR #366](https://github.com/voidbrain/nerv/pull/366)):** Verified and closed. Since [PR #285](https://github.com/voidbrain/nerv/pull/285) merged, >10 clean CI runs passed `validate` (coverage) and `windows` (`npm test`) with zero `remote dashboard decision reconciles the main bot card` failures, including 13 consecutive full-suite runs on PRs #351–#362 and #364 (`43400556615`, `43403424239`, `43407258975`, `43408524345`, `43410089251`, `43413688550`, `43415096808`, `43417130191`, `43419687659`, `43423770834`, `43425810207`, `43431026103`, `43436719798`), plus #363 (`43433680581`) and #365 (`43439870639`) passing `validate` and `windows`.

**Next action / closure evidence:** Verified when PR #285's CI passes (Windows and full suite) and the next ten CI runs show no recurrence; a recurrence returns it to Investigate, first checking whether Aoba's timer pass and the test's awaited pass are still distinct (mechanism 1) and whether the card was tracked before the decision (mechanism 2).

**Reconcile 2026-11-12 ([PR #288](https://github.com/voidbrain/nerv/pull/288)):** [PR #285](https://github.com/voidbrain/nerv/pull/285) merged into main `9aec642` at 06:20 UTC; its CI [43166751719](https://github.com/voidbrain/nerv/actions/runs/43166751719) passed plan, validate, Windows and native-macos, with full-suite skipped: the scoped selection ran test/one-channel.test.ts, test/telegram-reconcile.test.ts and the other channel regressions on Windows, not the whole Node suite. The whole suite with the fix included first ran in #286's CI [43168006619](https://github.com/voidbrain/nerv/actions/runs/43168006619) (head `94e3a0a` merges #285): Windows passed, Linux coverage passed on both attempts (attempt 1 failed only the browser step, [B-050](#b-050)), full-suite passed on attempt 2. Runs since the merge that ran this case: 43168006619 (#286) and 43168381380 (F-005-T12 branch; Windows ran the suite, validate stopped at `check:work` before tests). No failure of this case in either (logs searched 2026-11-12). 2 of 10 so far; it stays Implemented. B-042-T01 closed.

**Cause and fix 2026-11-12 ([PR #285](https://github.com/voidbrain/nerv/pull/285), B-042-T01):** **Recheck first.** Failed-job logs of every CI run since #277's run 43093410846 were searched (43098344555, 43105159883, 43105169242, 43106362909, 43106952492, 43108272198, 43118800708, 43121587426): none failed this assertion (their failures were B-046 and F-014 worker-link cases); every other completed run since then passed, all on attempt 1, including 7 runs after #279 merged and 43164854081 after #282. Too few runs to call the rarer B-042 failure gone, and none of #278/#279/#280/#282 touches the mechanism: they shorten worker-link and nervous-child latency, which only narrows the window below. **Mechanism 1 (runtime, reproduced):** Aoba delivers every 100 ms in the fixture; each pass starts with `reconcile()`, whose remote-card status is a signed lookup across the Kaji link. `deliver()` returned a pass already in progress, so when the test decided the card while a timer pass was between its lookup and its edits, `await aoba.deliver()` resolved with that pass's pre-decision snapshot and sent no edit. A slower lookup (loaded runner, slow child) widens the window: consistent with the load-dependent, cross-platform failures. Committed regression first (`test/telegram-reconcile.test.ts`, the stalled-lookup case above): failed at 95bf226, passes after. Fix: callers of `deliver()` while a pass runs share one follow-up pass that starts after it; passes never overlap; the periodic tick still skips while a pass runs, so a slow pass queues no ticks; `stop()` waits for the follow-up, which starts no pass after stop. **Mechanism 2 (fixture):** the fixture waited until the fake Bot API server recorded the relayed `sendMessage`, which happens before Aoba reads the response and tracks the card (the same gap the fallback step's comment already names); a decision in that gap is caught by `sendMessage`'s own post-send status check, which the awaited delivery does not wait for. The fixture now waits until Aoba tracks the card (read in memory). No timeout widened, no assertion changed. **Ruled out:** cleanup coalescing (`reconcile()` is only called from the serialized `deliverOnce`); the B-046 verdict race (the lookup completes, it is just stale). **Fresh-context review 2026-11-12 (design-reviewer):** no must-fix; verified fail-before/pass-after and no overlap in the microtask gap. Applied: the fixture first polled Aoba's state file, which on Windows could make Aoba's own atomic save fail while the file is open; it now reads the tracked cards in memory. Noted: an awaited `deliver()` can now take up to two passes (each cleanup bounded at 8 s), so the next Telegram update in the serialized queue may wait longer when a remote base is slow; bounded, no starvation. Channels regressions pass locally (63 of 63, macOS); one-channel 3 of 3 runs.

Earlier next action (2026-11-09, done above): inspect event ordering for remote card registration, status snapshot and a concurrent/coalesced deliver pass, then reproduce under controlled scheduling before any fix. These are hypotheses, not proof of a production regression or harmless infrastructure noise. Existing deliver() coalesces an active pass; the fixture expects a new cleanup edit after explicitly awaiting delivery. No Telegram/Kaji executable or assertion changed in PR #223. Retain the [original B-042 closure](../../archive/backlog-2026.md#b-042) and its regression/browser evidence; this observation does not erase the earlier successful scope.

**Observation 2026-11-11 ([PR #261](https://github.com/voidbrain/nerv/pull/261)):** during an unrelated local full-suite run on macOS (Node 26) the one-channel case failed once and passed 3 of 3 alone, then 16 of 16 in the [timing reassessment](../../reviews/2026-11-11-timing-reassessment.md) runs, 8 of them under CPU contention. The failure is therefore load-dependent and not Windows-only; cause still unproven. Re-examine after B-046 and B-043, which reduce background churn in the same fixtures.

**Observation 2026-11-11 ([PR #277](https://github.com/voidbrain/nerv/pull/277), run [43093410846](https://github.com/voidbrain/nerv/actions/runs/43093410846)):** Linux `validate` (`npm run test:coverage`) failed this case on `remote dashboard decision reconciles the main bot card`; the same command passed locally on macOS (585 passed, 0 failed) at the same head. #277 changes no runtime code (harness tools, records and docs), so this is another occurrence with no runtime change, and the first seen on Linux. The case crosses the worker link; whether it shares the B-046 cause fixed in [PR #278](https://github.com/voidbrain/nerv/pull/278) (a verdict before frames already received were applied) is unproven: recheck after #278 merges.

**Estimates:** 2026-11-12: B-042-T01 closed at about 1.5 h agent (stated) against 2 h; remaining work is observation of the next eight runs only. Re-estimated 2026-11-12 in agent hours (harness 5.6.0): B-042-T01 had 0.5 h agent remaining (CI, merge); about 1.25 h spent (stated); method in the task basis. Day figures are dated history: 2–3 focused days estimated 2026-11-09.

| Field | Value |
|---|---|
| PR / evidence | Closure reconcile: [PR #366](https://github.com/voidbrain/nerv/pull/366). Reconcile: [PR #288](https://github.com/voidbrain/nerv/pull/288). Fix: [PR #285](https://github.com/voidbrain/nerv/pull/285) (B-042-T01), CI [43166751719](https://github.com/voidbrain/nerv/actions/runs/43166751719) green (full-suite skipped); last occurrence [PR #277 run 43093410846](https://github.com/voidbrain/nerv/actions/runs/43093410846) (Linux coverage). [PR #267 CI 43012116246](https://github.com/voidbrain/nerv/actions/runs/43012116246) (2026-11-11, harness/records-only PR: `.gitignore`, version stamp, CI template clone): Windows failed this one-channel case on `remote dashboard decision reconciles the main bot card` again; another occurrence with no runtime change. [PR #261](https://github.com/voidbrain/nerv/pull/261) timing reassessment; [PR #223](https://github.com/voidbrain/nerv/pull/223); [CI 42535069202 attempt 1](https://github.com/voidbrain/nerv/actions/runs/42535069202/attempts/1) Windows failed card-cleanup assertion, Linux later failed only recap week validation. Test: test/one-channel.test.ts remote dashboard decision reconciles the main bot card. Earlier closure: PR #203 CI 42425786736/42425784575; preserved in archive. |
| Opened | 2026-11-07 |
| Verification | Closed 2026-11-13: >10 clean CI runs since PR #285 merged (#351–#362 and #364 full-suite, plus #363 and #365 validate/windows; zero failures of `remote dashboard decision reconciles the main bot card`). 2026-11-12: mechanism reproduced deterministically (`test/telegram-reconcile.test.ts` fails before the fix, passes after; local macOS); PR #285 CI 43166751719 passed scoped, #286 CI 43168006619 passed full-suite. |
| Reviewed | 2026-11-13 |

</details>

---

### B-050

**Dashboard browser test reads the banner before the page has loaded**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-13: [PR #294](https://github.com/voidbrain/nerv/pull/294) merged with CI [43207764269](https://github.com/voidbrain/nerv/actions/runs/43207764269) green and subsequent browser CI runs show no recurrence of the `until` TypeError.

| | |
|---|---|
| **Issue** | [PR #286](https://github.com/voidbrain/nerv/pull/286) CI [43168006619](https://github.com/voidbrain/nerv/actions/runs/43168006619/attempts/1) attempt 1, job validate (`npm run test:browser`): `test/evaluation.browser.mjs` case golden-v1/dashboard failed with `TypeError: Cannot read properties of null (reading 'textContent')` on the first `until` right after `Page.navigate` (`document.querySelector('.banner')` was null). The fixture's `until` (`test/fixtures/browser.mjs`) throws as soon as the evaluated expression throws instead of retrying, so a page that has not loaded yet fails the test. Attempt 2 (failed jobs rerun, same head `94e3a0a`) passed; local runs passed 3 of 3. Whether #286's service worker plays a part is not established (the test uses a fresh browser profile, per the F-004 agent). |
| **Reproduce** | `npm run build && node --test test/evaluation.browser.mjs` (case golden-v1/dashboard); intermittent, seen once in CI. Deterministically: evaluate the case's first `until` expression before the dashboard document has its `.banner` (for example against `about:blank`, or with the dashboard response delayed). |
| **Check** | A committed test fails before the fix: `until` on an expression that throws while the page is still loading fails at once. After the fix the wait retries across navigation, or waits for the document to load, and still fails with a clear timeout when the condition never holds. The case's assertion (`LIVE ·` shown, `SIGNING IN` gone) is unchanged; no timeout widened. Browser CI passes. |

<details>
<summary>Next action, estimates and evidence</summary>

**Closure 2026-11-13 ([PR #366](https://github.com/voidbrain/nerv/pull/366)):** Verified and closed. [PR #294](https://github.com/voidbrain/nerv/pull/294) merged into `main` (`d987a3a`) on 2026-11-12T11:25:57Z after CI [43207764269](https://github.com/voidbrain/nerv/actions/runs/43207764269) passed all five jobs (`plan`, `validate`, `windows`, `native-macos`, `full-suite`). Subsequent browser CI runs (including #351–#365 `validate` / Angular bilingual browser acceptance) passed with no recurrence of the `until` `TypeError`. `B-050-T01` closed.

**Fix implemented 2026-11-12 ([PR #294](https://github.com/voidbrain/nerv/pull/294)):** committed failing tests in `test/evaluation.browser.mjs` (commit `feb13de`) reproducing immediate `until` failure on expression exceptions during page loading and timeout error format. In `test/fixtures/browser.mjs`, `until` now catches evaluation exceptions and retries until the condition holds or timeout expires, including last error message on timeout. All browser tests pass.

**Next action / closure evidence:** Write a failing test for the race in the browser fixture, then fix the wait: retry `until` while the expression throws during navigation (keeping the last error for the timeout message), or wait for the navigated document to load before the first `until`. Do not weaken the assertion or widen the 15 s timeout. Check whether other `until` callers right after `Page.navigate` (test/evaluation.browser.mjs, test/pwa.browser.mjs and the other browser tests) share the race, and whether the service worker added in #286 changes page timing in the CI browser. Verified when the fix's CI passes and later browser runs show no recurrence.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 1 open step has 0.5 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Small, about 1.5 h agent (estimated 2026-11-12, not a measurement): a fixture-level failing test, a small change to `until` or the navigation wait, the browser suite locally, review and CI. Uncertain if the service worker turns out to be involved.

| Field | Value |
|---|---|
| PR / evidence | Closure reconcile: [PR #366](https://github.com/voidbrain/nerv/pull/366). Fix: [PR #294](https://github.com/voidbrain/nerv/pull/294) (CI [43207764269](https://github.com/voidbrain/nerv/actions/runs/43207764269) all five jobs green). Test: test/evaluation.browser.mjs "B-050: until retries through evaluated expression exceptions and resolves when condition holds" (committed failing in feb13de, passes after fix). Test: test/evaluation.browser.mjs "B-050: until still fails with timeout when throwing condition never holds" (committed failing in feb13de, passes after fix). Recorded in [PR #288](https://github.com/voidbrain/nerv/pull/288). Observed: CI 43168006619 attempt 1, job validate (job 131014457197), `test/evaluation.browser.mjs:62` via `until` in `test/fixtures/browser.mjs`; attempt 2 job validate (131017084799) passed on the same head. Same run, attempt 1: F-004-T01's own browser case passed. |
| Opened | 2026-11-12 |
| Verification | Closed 2026-11-13: [PR #294](https://github.com/voidbrain/nerv/pull/294) CI [43207764269](https://github.com/voidbrain/nerv/actions/runs/43207764269) passed all five jobs (`plan`, `validate`, `windows`, `native-macos`, `full-suite`) and subsequent browser CI runs (#351–#365 `validate`) passed with no recurrence of the `until` `TypeError`. 2026-11-12: committed failing tests in `test/evaluation.browser.mjs` (`feb13de`) passed after fix in `test/fixtures/browser.mjs`. |
| Reviewed | 2026-11-13 |

</details>

---

### B-052

**Owner actions point at procedures the owner has to hunt for**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-13: all open procedure records link copy-paste acceptance pages under `docs/acceptance/`.

| | |
|---|---|
| **Issue** | Owner, 2026-11-12, on F-005: its human action said "run the T13 copy-paste procedure below", but the procedure sat inside the collapsed details, the Reproduce row said only "Follow README commands and the owning milestone in ROADMAP" with no link, and the cue still waited on an already merged PR. "I should not manually search for files and lose myself between pointers of pointers." F-005 fixed here; F-006 and F-016 now link their decisions. Still without a linked procedure: B-008 ("steps in details"), F-004, F-009, F-011, F-015, F-023. |
| **Reproduce** | Open [the backlog](../../BACKLOG.md) and read the human-action line of B-008, F-004, F-009, F-011, F-015 or F-023: none links the exact commands or steps to run and their expected result. |
| **Check** | Every 🧑 line that asks the owner to run or check something links one page (or a visible section of the record) with copy-paste blocks and the expected result; its Reproduce row links the same; no "below", "in details" or bare path. Harness rule: project-harness F-064. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** B-052-T01: write the missing procedures under docs/acceptance/ (macOS Terminal for Neo Tokyo-3, PowerShell for Tabgha) and link them from each human-action line and Reproduce row. Template rule requested upstream as project-harness F-064; this record owns only NERV's records.

**Estimates:** Small: six procedures drafted from the existing evidence in each record. Estimated 2026-11-12, not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #345](https://github.com/voidbrain/nerv/pull/345) B-052-T01: linked copy-paste procedures under docs/acceptance/ for F-004, F-009, F-011 and F-023 (head e27317c, merged 3de720a; CI43344301717 passed plan, validate, windows and native-macos, full-suite skipped by scoped verification; PR cited in the full audit of 2026-11-13); [PR #311](https://github.com/voidbrain/nerv/pull/311): F-005 procedure moved to [docs/acceptance/f005-t13-mac-update-procedure.md](../../acceptance/f005-t13-mac-update-procedure.md). No test: documentation-only procedure links across existing backlog records. |
| Opened | 2026-11-12 |
| Verification | 2026-11-13: Documentation/CI verified ([PR #311](https://github.com/voidbrain/nerv/pull/311) CI run `43272309918` green; `check:backlog` passed). |
| Reviewed | 2026-11-12 |

</details>

---

### B-053

**F-029 descendant-process test failed once in CI with every process already gone**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-13: single-observation descendant liveness fix merged in [PR #341](https://github.com/voidbrain/nerv/pull/341) with green CI.

| | |
|---|---|
| **Issue** | PR #316's validate job (run 43286749372, `npm run test:coverage`, Linux) failed `F-029: a timed-out scenario terminates its owned descendant process` with `no executing child survives the group timeout`, actual `[3708]`. The test took 5,030 ms in total: the 5 s run budget plus about 30 ms, so its wait loop (`while (owned.some(alive))`, up to 5 s) ended at once with nothing alive, and the following `owned.filter(alive)` found PID 3708 alive. The PR does not touch the runner or the test. Likely a race between the two separate liveness reads (PID reuse under coverage load, or the zombie check in `/proc/<pid>/stat` reading differently); inferred, not observed. |
| **Reproduce** | `node --test --test-name-pattern='terminates its owned descendant' test/evaluation-runner.test.mjs` passed 5 of 5 locally on macOS on 2026-11-12; the failure was seen once on Linux CI under coverage. |
| **Check** | A committed test or measurement shows the two-read race (or names another cause); the test decides on one observation per process and still fails when a descendant really survives; CI passes repeatedly. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** B-053-T01. If the runner really leaves a descendant, that is a runner defect under F-029 and the fix goes there, test unchanged.

**Estimates:** Small, estimated 2026-11-12, not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #341](https://github.com/voidbrain/nerv/pull/341) (fix + failing-first test `Test: test/evaluation-runner.test.mjs`); seen on [PR #316](https://github.com/voidbrain/nerv/pull/316), CI run 43286749372 job validate. |
| Opened | 2026-11-12 |
| Verification | 2026-11-13: Unit/integration & CI passed ([PR #341](https://github.com/voidbrain/nerv/pull/341) CI run `43342141161`: `plan`, `validate`, `windows`, `native-macos` green). |
| Reviewed | 2026-11-12 |

</details>

---

### B-055

**The Windows service launcher runs Node from an fnm per-shell path**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-13: stable Node path resolution merged in [PR #340](https://github.com/voidbrain/nerv/pull/340) with green CI.

| | |
|---|---|
| **Issue** | 2026-11-12 on Tabgha: `nerv-service.vbs` runs `…\fnm_multishells\<id>\node.exe`, a junction fnm creates for one shell session; `service install` wrote it from `process.execPath` (src/service.ts). Over SSH that path did not run, while the permanent install (`…\fnm\node-versions\v24.22.2\installation\node.exe`) did. If fnm's per-shell junctions are cleaned up, the scheduled task can no longer start NERV. |
| **Reproduce** | On Windows with Node from fnm, run `service install` from an fnm shell and read the Node path in `%USERPROFILE%\.nerv\nerv-service.vbs`. |
| **Check** | `service install` records a stable Node path (the junction's target, or refuses with a clear message naming the fix) on Windows, and the same rule holds for the launchd and systemd definitions; a test covers a per-shell path. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** B-055-T01. A bug fix starts with a committed failing test.

**Estimates:** Small, estimated 2026-11-12, not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #340](https://github.com/voidbrain/nerv/pull/340) (`Test: test/service-node-path.test.ts`); found during B-008 reproduction, [evidence](../../acceptance/b008-tabgha-2026-11-12.md); [PR #318](https://github.com/voidbrain/nerv/pull/318). |
| Opened | 2026-11-12 |
| Verification | 2026-11-13: Unit/integration & CI passed ([PR #340](https://github.com/voidbrain/nerv/pull/340) CI run `43342248715`: `plan`, `validate`, `windows`, `native-macos` green). |
| Reviewed | 2026-11-12 |

</details>

---

### F-025

**Extra MAGI seats (veto-only), consultants and watermelon trust for pilots**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Attach extra seats by action class as veto-only, start new seats in shadow, and promote pilots through Prototype → Test → Production.

| | |
|---|---|
| **Issue** | Specialists help, but a new or remote seat must never approve what the core three would refuse, and skills need earned trust. |
| **Reproduce** | Attach a deterministic test seat and a model expert seat to code-write actions; run them in shadow; promote one; force a failure and a Spear revocation. |
| **Check** | Extra seats can only reject; shadow seats are logged, not counted; a timed-out seat abstains; consultants advise the planner without a vote and receive only Scrolls-allowed data; pilots run only in the EVA class of their stage; promotion to Production needs the owner's confirmation; failure, override spikes or Spear demote automatically. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-13 after all four steps (`F-025-T01`–`F-025-T04`, PRs [#358](https://github.com/voidbrain/nerv/pull/358)–[#361](https://github.com/voidbrain/nerv/pull/361)) merged and passed verification. F-025-T04 ([PR #361](https://github.com/voidbrain/nerv/pull/361), 2026-11-13): `previousStage`, `shouldDemotePilot`, `demotePilot` (`src/pilots.ts`) and `Runtime.demotePilotOnSignal` + automatic Spear demotion (`src/runtime.ts`, `test/pilots.test.ts`) automatically demote watermelon trust stages on failure, override spikes, or Spear revocation while keeping owner-only promotion to Production (`promotionEligible`, `pilots.promote`). F-025-T03 ([PR #360](https://github.com/voidbrain/nerv/pull/360), 2026-11-13): `filterConsultantInput` (`src/misato.ts`) and `Runtime.useRemoteConsultant` (`src/runtime.ts`, `test/consultant.test.ts`) filter `deny`, `localOnly`, and tainted data so consultants advise without a vote using only Scrolls-allowed data. F-025-T02 ([PR #359](https://github.com/voidbrain/nerv/pull/359), 2026-11-13): `SeatPool` (`src/seat-pool.ts`), private per-seat keys (`readSeatKey`/`writeSeatKey` in `src/config.ts`), `canLeaveMachine` / `scrolls.localOnly` (`src/policy.ts`, `Ledger.preview`), and `Runtime.useSeatPool` (`test/seat-pool.test.ts`). F-025-T01 ([PR #358](https://github.com/voidbrain/nerv/pull/358), 2026-11-13): `Runtime.useExtraSeat` attaches veto-only extra seats by action class (`effects`, `tools`, `patterns`), starts new seats in shadow (`ballot` / `ballot.shadow` logging without counting), promotes to veto (`shadow: false`), and abstains on timeout (`AbortController`, `test/extra-seats.test.ts` + `test/gate.test.ts` + `test/kaji-seats.test.ts`). Owner decisions 2026-11-05 for the free API seats: one seat per provider and model, each with its own key (terminal prompt) and trust stage; attached by action class, veto-only, shadow first, promoted one by one; each action asks one or two seats from the pool in turn to spread free quotas; a seat that hits its limit or times out abstains and is skipped for a while; only actions the Scrolls allow to leave the machine get cloud seats (never local-only or tainted data). **Optional:** `seats` checks each candidate (key, provider reachable, model still listed) and skips the unavailable ones with the reason; with an empty pool actions simply get no cloud seat, shown as information, never as degraded; re-checked periodically. Owner check 2026-11-05 on Neo Tokyo-3: with `models set consultant gemma4:12b`, Comms showed *Consultant (gemma4:12b): …* before Misato's reply. Consultants, local, in [PR #92](https://github.com/voidbrain/nerv/pull/92) (2026-11-05): `roles.consultant` (a local model; `models set consultant MODEL|off`, the dashboard's Models panel, `PUT /api/models`); asked once per request before Misato plans (`consultant.advise` in the brain, never on a resume), its advice (up to 600 characters, "none" is none) goes into Misato's prompt as data on the local route only and is recorded as a `misato.consult` event (Comms; the dashboard's Gevurah node lights up); no vote, no action. Checked: test/consultant.test.ts (advice in Misato's prompt and in the trace, one consultation per request, none on a resume, off and "none" add nothing, never on the cloud route), test/model.test.ts and test/model-setup.test.ts (role validation, local only, set and off), suite 129 pass. Related (2026-11-05): the other bases' Casper is now a veto-only, shadow-first extra seat (F-036, [PR #91](https://github.com/voidbrain/nerv/pull/91)); the same ballot mechanism takes the free API seats this record plans. Seat registry via Marduk and stage tracking on top of F-017/F-024; evaluation evidence from F-029. Absorbs F-018 (closed 2026-11-04).

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 4 open steps total 5.5 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Medium remaining effort (peer seats in F-036, local consultants). Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan) |
| Opened | 2026-11-02 |
| Verification | 2026-11-13: T01 `test/extra-seats.test.ts` + `test/gate.test.ts` + `test/kaji-seats.test.ts` (12/12); T02 `test/seat-pool.test.ts` + `test/extra-seats.test.ts` + `test/gate.test.ts` + `test/ledger.test.ts` (32/32); T03 `test/consultant.test.ts` + `test/misato.test.ts` (20/20); T04 `test/pilots.test.ts` (13/13); `check:conventions` and `check:fast` passed. |
| Reviewed | 2026-11-04 |

</details>

---

### F-042

**Misato reads the agency: status and "why" from the records**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-13: [PR #314](https://github.com/voidbrain/nerv/pull/314) merged with green full-suite CI (`43282005793`).

| | |
|---|---|
| **Issue** | Owner question 2026-11-05 ("is this the answer we want? include ballot, experts and consultants?"): Misato can act but cannot read the agency itself, so questions about it are guessed (B-004). |
| **Reproduce** | Ask Aoba "why was S-… approved?", "what is waiting for me?", "is Tabgha up?". |
| **Check** | Read-only tools give Misato a sortie's record (decision, ballot with each seat's vote and reason, peer seats, consultant advice, approver and time), what waits for the owner, base health and the bases' status; answers quote the records in the request's language and never invent; these tools run as Green without a card; the consultant is not asked for questions about the agency itself. |

<details>
<summary>Next action, estimates and evidence</summary>

**F-042-T01–T02, 2026-11-12 ([PR #314](https://github.com/voidbrain/nerv/pull/314)):**
- **F-042-T01 (`src/executors.ts`, `src/ledger.ts`, `src/store.ts`, `src/runtime.ts`, `src/rpc.ts`, `src/nervous-process.ts`):** Added three Pattern Green read-only built-in tools (`effect: 'read'`, running inside the scheduler process without an approval card): `sorties.explain` (returns a sortie's record by short ID with decision, ballot and each seat's vote and reason, peer seats including late shadow votes `ballot.shadow`, consultant/pilot advice, approver and decision time, or recent sorties when `ref` is omitted), `approvals.list` (returns pending approval cards with sortie short ID, title, tool, arguments, Pattern, reason, ballot verdicts and expiry, plus open clarification questions waiting for the owner via `Ledger.waitingQuestions`), and `agency.status` (returns this base's health, degraded reasons, model routes, pending reminders and Instrumentality status, plus enrolled NERV bases with `baseId`, `name`, `status`, `self`, `main`, `online`, `lastSeen`, `health` and `channel`, optionally filtered by `base` id or name).
- **F-042-T02 (`src/why.ts`, `src/misato.ts`, `src/runtime.ts`, `src/brain-process.ts`, `src/rpc.ts`):** Added `isAgencyQuestion(text, bases)` in `src/why.ts` so `Runtime.loop` skips the consultant when the owner asks about sorties, ballots, waiting approvals/questions, or base/agency health and status (while still consulting on action requests such as `"Remind me on Tabgha to stretch"`). Passed enrolled base names (`bases: [{ id, name }]`) as data to the consultant/pilots and to Misato (`B-012`), localized `decided`, `expires`, and `lastSeen` timestamps (`decidedLocal`, `expiresLocal`, `lastSeenLocal`) in `misatoAsk`, and updated Misato's system prompt to call `sorties.explain`, `approvals.list` or `agency.status` and quote the records in the request's language without inventing. Note: host thread-reset APIs and token counters are not exposed in this environment (bounded continuation; `work-usage` coverage `unavailable`).

**Next action / closure evidence:** Verify and close when [PR #314](https://github.com/voidbrain/nerv/pull/314) merges with green CI. Owner test 2026-11-05: the consultant did not know Tabgha is a base (it asked about geofencing): pilots and the consultant should get the agency's facts as data too (base names, B-012). Planned 2026-11-05. B-004 is the first slice (the "why" question).

**Estimates:** 0 h remaining (2 steps implemented 2026-11-12 in 0.5 h agent stated total; awaiting CI). Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 2 open steps total 2.75 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Medium remaining effort. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | [PR #314](https://github.com/voidbrain/nerv/pull/314) (F-042-T01–T02 implementation and regressions: `test/why.test.ts`, `test/consultant.test.ts`); [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; Owner question 2026-11-05 |
| Opened | 2026-11-05 |
| Verification | 2026-11-13: Unit/integration & full-suite CI passed ([PR #314](https://github.com/voidbrain/nerv/pull/314) CI run `43282005793` green across `plan`, `windows`, `native-macos`, `validate`, `full-suite`). |
| Reviewed | 2026-11-12 |

</details>

---


### F-045

**Pilots: a roster of permanent agents that grows, specialises and is chosen per request**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🔴 Large |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Owner questions 2026-11-05: NERV needs permanent agents (a coder, the 3D expert on Tabgha, and others as jobs require: a Photoshop expert), a generic one for anything else, specialists that grow from it, and automatic choice. The design already names pilots (F-025: pilots run in the EVA class of their stage, watermelon trust) but has no roster. Consultants (F-041) become pilots asked only for advice (owner, 2026-11-05). |
| **Reproduce** | Ask Aoba for an image edit or a coding job: there is no pilot to give it to. |
| **Check** | **Definition as data:** a pilot is a role and domain (topics, keywords), skills, tools, a model, a memory scope, an EVA class and a trust stage (Prototype, Test, Production), with its parent; most share the base's model, a separate model only when its evaluations justify it. **Roster:** a registry like the Kaji one; each base offers its pilots in the heartbeat; the owner adds, renames, retires and pins. **Generic pilot:** one per base, takes any job no specialist covers, in the most restrictive EVA its stage allows. **Two ways of use:** asked for advice (the F-041 consultant rules: at most one per topic by default, the owner's pin, then the main base's own, then the best record, the next as fallback, "ask both" per topic; advice is data, never a vote or an action) or put in charge of the job (acts in its EVA, effects by card). **Choice:** Misato routes by domain and keywords, base, stage allowed for the action and record; unclear goes to the generic pilot or a question; the card shows the pilot, its stage and base, and the owner can change it; routing accuracy is measured. **New specialists found automatically:** unmatched domains, tools the generic pilot lacked and repeated failures are counted per domain; past a threshold (e.g. three unmatched in 30 days, or one missing tool) NERV proposes a pilot (or an extension of an existing one) on a card with the sorties behind it, its skills, tools and installs; created at Prototype. **Split and merge by evidence:** a split when sorties cluster in a subdomain and a narrower set scores better; a merge when two overlap and neither is better; lineage kept. **Learning (owner decision 2026-11-05: the recommendation):** new evaluation cases from failures are added automatically and shown; domain memory is proposed in one review card a week; skills change only by the owner's approval, versioned; prompt, model, tools, permissions and trust stage are always the owner's; nothing learned from a tainted sortie becomes a skill without review; a change to skills or prompt is versioned and re-runs the pilot's evaluations, and a drop moves it back a stage. **Inside a pilot** planning, doing and checking stay one loop; promotion through the golden sortie evaluations. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-13 after all nine steps (`F-045-T01`–`F-045-T09`) completed and passed verification (`F-045-T07`–`F-045-T09` in [PR #364](https://github.com/voidbrain/nerv/pull/364)). Owner integration 2026-11-09: pilot selection and promotion must distinguish individual-role evidence from separately measured combination/workflow evidence as specified in [configuration qualification](../../decisions/configuration-qualification.md). Bind coder, auditor, prompts, skills/tools, handoffs and host/runtime settings; independent hidden acceptance determines success, not auditor agreement. Consume NERV-owned evidence from F-006-T03/T04 before claiming evaluated pair or specialist placement; retain owner promotion and suggest-only defaults. No pair selection or mini PC acceptance is implemented by this documentation.

Owner extension 2026-11-07: show pilot description, proposal rationale and request evidence, consultation/sortie outcomes and evaluation sample sizes. Investigate generic Time Request PROTO proposal quality. Distinguish advice from execution assignment/history; assess tool acquisition/discard, evidence-based specialization, split and merge with versioned lineage and explicit promotion gates. No autonomous capability change is implied by the current roster.  Owner discussion 2026-11-06 (skill marketplaces): **skills found outside NERV are untrusted input**, like intake. A found skill (marketplace, repository, another agent's SKILL.md) is adopted only as a reviewed, **pinned copy**: source, version, content hash and licence recorded, and the licence must allow keeping a copy; it enters at seed. A change at the source is a new version: re-review, re-run evaluations, back to seed. **Never load a skill remotely at run time**: that excludes delivery models that always serve the latest version and forbid saving (e.g. Agensi's MCP delivery, terms §5.2/§8.2). **Bundled scripts are code**: they run in the pilot's EVA and their effects go through the gate; a skill's text never widens the pilot's tools or permissions. This applies F-021's pinning lesson (a description fingerprint is not a code pin) to skills.  Owner refinement 2026-11-06: use an inline Model/select/Apply row without repeating the pilot name; retain identity in the accessible name. Apply stays disabled until an installed choice differs from the saved model, and disables again on revert/save or while applying.  Owner request 2026-11-06: move consultant/model selection out of Models and into each pilot card. Candidate implementation: generic fallback plus an independent specialist selector, installed local Ollama models only; per-specialist API validates owner authorization and discovery, preserves the rest of the roster, and applies to the next request. Drafts survive polling; unavailable saved models remain explicit. Future cloud/other-engine options require provider-aware pilot routing and explicit privacy permission; no placeholder executable choices are added. API/DOM regression and Chrome against the real runtime/config passed, including independent changes, generic-off, draft retention, next-request routing and scoped axe (zero violations). Full suite passed (194 passed, one systemd-only skip), build and process/browser checks passed. The local selector slice is verified in merged PR #160 (run 42241192687: validate, windows and native-macos green).  Owner decision 2026-11-05 on promotion, time and evidence: a pilot (and a skill) becomes eligible for the next stage after a minimum time there and enough clean runs (for example 7 days in Proto and 10 runs without a MAGI reject or an owner edit; skills count uses); its card shows the progress (*eligible in 5 d · 6/10 runs*, then *ready to promote*); when ready, NERV proposes the promotion on a card, never automatic; Prod always needs the owner; a failure or the Spear moves it back a stage. Needs a per-pilot record of runs, rejects and edits (and F-029's evaluations). Owner decision 2026-11-05 on skill stages (option B): skills grow by their own stages, **seed → sprout → ripe** (Eva, Kaji's watermelons) and **create → try → use** (Simple), distinct from the pilots' proto → test → prod; shown on the skills box in [PR #129](https://github.com/voidbrain/nerv/pull/129). Detection slice in [PR #122](https://github.com/voidbrain/nerv/pull/122) (2026-11-05): the generic pilot names the request's domain on its first line (*Domain: image editing*, no extra model call; no generic pilot, no detection); a request no specialist fits records `pilot.unmatched`; after 3 in 30 days the Marduk Institute opens a sortie with an owner-only `pilots.create` card (id, name, domain, keywords; the requests behind it in the card's reason), never twice while one waits, not again for 30 days after a no; approved, the pilot is written at Prototype on the generic pilot's model and the next request in that domain goes to it. Misato can propose `pilots.create` too when asked. Checked: test/pilots.test.ts (the domain line; through every process: two requests no card, the third a card, a fourth no second card, approved then used, a rejected domain not proposed again); full suite and build pass. Not yet: the missing-tool and repeated-failure signals, extension of an existing pilot instead of a new one. Slice 1 in [PR #107](https://github.com/voidbrain/nerv/pull/107) (2026-11-05): the pilot definition (src/pilots.ts: id, name, domain, keywords, local model, stage, parent, pinned, retired; checked on read), a local roster in config.json (`nerv pilots` list, add, set, pin, unpin, retire, restore; a model Ollama lacks is refused), the generic pilot (the F-025 consultant, `roles.consultant`), and advice mode: before Misato plans, the pilot whose keywords the request contains advises on its own model (pinned first, then most keywords, then later stage; retired never), named in its prompt and in the trace (`misato.consult` with the pilot; dashboard Comms and the why answer show it); no match, the generic pilot. Checked: test/pilots.test.ts (roster checks, routing order, through every process: a specialist on its model, the generic one otherwise, a retire applied to the next request), test/model-setup.test.ts (the CLI); full suite 146 pass, build, headless. Remaining slices: offered by other bases; "ask both" and the fallback; detection of unmatched domains and proposals by card; the coder pilot acting in an EVA; split and merge; learning as decided. Owner decision 2026-11-05: pilots learn by the recommendation ("F-045 … the recommendation"). Planned 2026-11-05 from the owner's questions. Supersedes F-041 (consultants are pilots in advice mode; its rules are kept above). First slices: the pilot definition and roster with the generic pilot; advice mode (the F-041 work); the coder pilot in a sandbox EVA (intent, spec and plan approved by card, an independent read-only verifier, results as a PR by card); then detection of new specialists, then split and merge. Candidate pilots discussed: coder, verifier, researcher (EVA-03, no effects), ops (read-only watch), 3D expert (Tabgha), archivist (memory hygiene, F-044); each gets its own record when it is built.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 6 open steps total 8.25 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Reassessed 2026-11-06 for pilot-owned model selectors: the local selector slice passed local and merged CI acceptance; remote pilots, execution and future provider/cloud routing remain, so Large remains valid.  Reassessed 2026-11-06 with B-027: duplicate-proposal matching is repaired; the remaining remote-pilot and execution scope is unchanged, so Large remains valid.  Large remaining effort (roster, advice, detection). Estimated 2026-11-05. Reassessed 2026-11-07: explicit prerequisite outcomes preserve the existing scope and remaining-work estimate; independent slices can proceed. Reassessed 2026-11-07: Large remains valid: proposal evidence and outcomes, tool evolution and split/merge lineage need evaluated lifecycle contracts beyond the current adviser roster.

**Completed prerequisites:** [F-029](../../archive/backlog-2026.md#f-029) — Golden evaluation evidence for pilot promotion (closed).

| Field | Value |
|---|---|
| Depends on | — |
| PR / evidence | [PR #364](https://github.com/voidbrain/nerv/pull/364) F-045-T07..T09 cloud/other-provider pilot routing, split/merge with lineage, tool acquisition/discard, and Time Request PROTO proposal quality; [PR #357](https://github.com/voidbrain/nerv/pull/357) F-045-T06 evidence-based placement keeping individual, combination, and placement scopes distinct; [PR #356](https://github.com/voidbrain/nerv/pull/356) F-045-T05 remote pilots chosen and run through the authenticated worker line with grant checks; [PR #355](https://github.com/voidbrain/nerv/pull/355) F-045-T04 execution choice by domain/evidence and owner-only promotion; [PR #354](https://github.com/voidbrain/nerv/pull/354) F-045-T03 F-041 consultant ranking, fallback, and ask-both advice mode; [PR #353](https://github.com/voidbrain/nerv/pull/353) F-045-T02 owner roster management and generic pilot EVA confinement; [PR #352](https://github.com/voidbrain/nerv/pull/352) F-045-T01 pilot data schema, PilotRegistry, and Kaji heartbeat offers; [PR #227](https://github.com/voidbrain/nerv/pull/227) staged qualification design and owner resume; [PR #221](https://github.com/voidbrain/nerv/pull/221) schema/reuse assessment; [Gauntlet ownership/reuse proposal](../../design/gauntlet-protocol-2026-11-08.md), 2026-11-08; the proposal preceded delivered Gauntlet0.1.1 adoption in PR #223 / F-073; automatic routing/qualification remains unimplemented and no consumer work gates upstream releases; [PR #196](https://github.com/voidbrain/nerv/pull/196) remaining-effort reassessment;  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #187](https://github.com/voidbrain/nerv/pull/187) reviewed prerequisite links;  [PR #161](https://github.com/voidbrain/nerv/pull/161) verification reconciliation;  [PR #160](https://github.com/voidbrain/nerv/pull/160) pilot selectors/map status and owner clarification; Owner questions 2026-11-05; slice 1 [PR #107](https://github.com/voidbrain/nerv/pull/107) |
| Opened | 2026-11-05 |
| Verification | 2026-11-13 F-045-T07..T09: `npm run typecheck`, `node --test test/pilots.test.ts` (16/16 passed), and `node --test test/gate.test.ts test/pilot-model.test.ts test/model-setup.test.ts test/misato.test.ts test/protocol.test.ts` (35/35 passed); `canPilotLeaveMachine`, `resolvePilotInference`, `proposePilotSplit`, `proposePilotMerge`, `splitPilot`, `mergePilots`, `proposePilotToolChange`, `applyPilotToolChange`, `sanitizeProposedDomain`, and `pilots.split`/`pilots.merge`/`pilots.tools` owner-only executors implemented. Earlier: 2026-11-13 F-045-T06: `node --test test/pilots.test.ts` (12/12 passed) and `npm run check:conventions && npm run check:fast` passed; `evaluatePilotPlacement`, `chooseQualifiedExecution`, `Runtime.assessPilotPlacement`, and `Runtime.selectQualifiedPilotForExecution` implemented keeping individual, combination, and placement evidence distinct. Earlier: 2026-11-13 F-045-T05: `node --test test/pilots.test.ts test/kaji-run.test.ts test/pilot-model.test.ts` (16/16 passed) and `npm run check:conventions && npm run check:fast` passed; `canRunRemotePilot`, `selectRemotePilotRun`, `RunItem.pilot`, and `runFromPeer` pilot grant enforcement implemented. Earlier: 2026-11-13 F-045-T04: `node --test test/pilots.test.ts test/pilot-model.test.ts test/gate.test.ts` and `npm run check:conventions && npm run check:fast` passed; `chooseExecutionPilot`, `promotionEligible`, and owner-only `pilots.promote` implemented. Earlier: 2026-11-13 F-045-T03: `node --test test/pilots.test.ts test/pilot-model.test.ts` and `npm run check:conventions && npm run check:fast` passed; F-041 consultant ranking (`rankPilots`, `chooseAdvisers`), fallback, and ask-both adviser selection implemented. Earlier: 2026-11-13 F-045-T02: `node --test test/pilots.test.ts test/pilot-model.test.ts test/model-setup.test.ts` and `npm run check:fast` passed; owner roster management (add, rename, pin, retire) via CLI/API/Runtime and generic pilot EVA confinement implemented. Earlier: 2026-11-13 F-045-T01: `node --test test/pilots.test.ts test/kaji-link.test.ts test/model-setup.test.ts` (23/23 passed) and `npm run typecheck` passed; pilot data fields (`role`, `skills`, `tools`, `memoryScope`, `evaClass`), `PilotRegistry`, and Kaji heartbeat pilot offers implemented. Earlier: 2026-11-06 Unit/integration and Browser/accessibility: pilot model API/DOM regressions, full suite, real-runtime Chrome flow, inline-row/Apply states and scoped axe passed; merged PR #160 CI run 42241192687 green; 2026-11-05 slice 1: test/pilots.test.ts, test/model-setup.test.ts, full suite (local run) |
| Reviewed | 2026-11-13 |

</details>

---


### F-046

**Misato checks what already exists before adding: same thing, a change, or new**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-13: `reminders.update` and `memory.edit` tools added, matching pending reminders and Lilith facts shown to Misato with the three-way check (same, changed, new) in EN/IT, and `old → new` fact edit approval cards.

| | |
|---|---|
| **Issue** | Owner request 2026-11-05, after B-003 (the same dentist request sent four times, two copies approved): before adding something, Misato should look for it among what already exists (reminders, Lilith's facts, later calendar and notes); if it is the same, not add another and say so in the reply; if it changed (another time, a corrected fact), propose changing the existing one instead. Today the store drops only exact copies (B-003 for reminders, `factKey` for facts); a reminder with the same title at another time becomes a second one, and a fact that contradicts an earlier one ("I like tea" after "I don't like tea") is added next to it. Misato has no tool to change a reminder. |
| **Reproduce** | Ask Aoba to remind you to call the dentist on 3 February at 10, then again at 11: two reminders. Tell it you like tea, then that you don't: two facts. |
| **Check** | Before proposing reminders.add or memory.remember, Misato is shown the existing items that match (same or similar title, the same subject); the same item is not proposed again and the reply says it already exists (with its time or text); a changed one becomes a proposal to change it (reminders.update for title or time; for a fact, the edit of the existing fact, shown old → new on the card), approved like any change; a really new item is added as today; the reply says which of the three it was and why; works in English and Italian; tests cover same, changed and new for reminders and facts, through the scheduler. Calendar and notes follow the same rule when they exist. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Planned 2026-11-05 from the owner's request. Builds on B-003 (exact copies of a reminder are returned, [PR #103](https://github.com/voidbrain/nerv/pull/103)) and Lilith's exact-text check. Slices: reminders.update as a Misato tool (the dashboard's edit already has it in the scheduler); matching existing items in Misato's context before an add; facts that change or contradict an earlier one proposed as an edit (shares the spelling and split work of F-044).

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 3 open steps total 3 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Medium remaining effort. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | [PR #369](https://github.com/voidbrain/nerv/pull/369); [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration; Owner request 2026-11-05; `test/f046-existing-check.test.ts` |
| Opened | 2026-11-05 |
| Verification | Passed (`npm run typecheck`, `npm run build`, `npm test`, `npm run check:fast`) |
| Reviewed | 2026-11-13 |

</details>

---


### F-052

**Timings for every step, live in the Sephirot; shadow seats never make you wait**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🔴 Large |

💻 **→ Human action required: No**<br />Per-call timings, sortie detail and `why` durations, live Sephirot node timings, and daily role timing summary.

| | |
|---|---|
| **Issue** | Owner question 2026-11-05: how long did the job take, how long Misato, the EVA, is the ghost (shadow) voter slowing it? The ledger stamps only step boundaries: in S-3BFF, Misato's planning, Casper and Tabgha's shadow seat fall in one 95.7 s gap, so nobody can tell who was slow. The gate waited for every seat, also shadow ones whose vote does not count. |
| **Reproduce** | Read a sortie's events: there is no duration per model call, per seat or per executor. |
| **Check** | 1. Each call's duration is recorded with the sortie (consultant or pilot, each Misato step, Casper, each other base's seat, the executor). 2. The sortie detail and the why answer show them (*Misato 38 s · Casper 6 s · Tabgha (shadow) 41 s · EVA-02 0.1 s*); 2a. while a sortie runs, the Sephirot shows the elapsed time on the active node and each finished node's time (owner, 2026-11-05). 3. Shadow seats never delay: the gate decides once Casper and the veto seats have voted; a later shadow vote is recorded, never counted. 4. A daily summary (brief or health): median and slowest time per role, so a slow model or base stands out. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-13 after all steps (`F-052-T01`–`F-052-T05`) implemented and verified. `F-052-T02`: `src/runtime.ts`, `src/store.ts`, `src/ledger.ts`, `src/events.ts`, `src/policy.ts`, `src/kaji-link.ts`, `src/rpc.ts`, and `src/nervous-process.ts` record per-call `durationMs` on consultant/pilot (`misato.consult`, `pilot.unmatched`), each Misato step (`misato.step`, `misato.reply`, `misato.asked`), Casper and extra/peer seats (`ballot.verdicts`, `ballot.shadow`), and executors (`action.done`, `action.failed`), keeping network `transferMs` (`kaji.answered`, peer seats) distinct from step duration. `F-052-T03`: `src/timing.ts`, `Ledger.sortie`, `Ledger.explain`, `src/why.ts`, and `web/public/dashboard/dashboard.js` (`renderDetail`) format and display per-role timings (e.g. `Misato 38 s · Casper 6 s · Tabgha (shadow) 41 s · EVA-02 0.1 s`) in EN/IT. `F-052-T04`: `web/public/dashboard/index.html`, `dashboard.js`, and `live.js` show live elapsed time on the active Sephirot node and finished node times on completed nodes without false communicating claims (B-040). `F-052-T05`: `Ledger.timingSummary`, `src/brief.ts` (`gatherBrief`, `composeBrief`) report median and slowest duration per role in the daily brief. Checked: `test/f052-timings.test.ts`, full `npm test`, `npm run build`, `npm run typecheck`, `npm run check:fast`. Owner extension 2026-11-07: transfer duration and step duration are different. A minimum recent-transfer pulse may improve visibility but must not claim the network is still communicating (B-040).  Item 3 in [PR #116](https://github.com/voidbrain/nerv/pull/116) (2026-11-05): `Runtime.usePeerSeats` (serve and the two-base test share it, instead of a copy in the test) returns each other base's vote as a pending promise; the gate waits for Casper and the veto seats only; a shadow vote already in goes on the card, one that comes later is recorded as `ballot.shadow` on its action (dashboard trace: *MAGI · NERV-02 (shadow, after the decision)*) and never changes the outcome. Checked: test/kaji-seats.test.ts (two runtimes, Tabgha's Casper answering after 1.5 s: in shadow the decision comes in under 1.2 s and the late reject is kept with the action; in veto it is waited for and stops the action; an absent base abstains), fails without the change (changed deliberately: the shadow vote is no longer always on the card); full suite 152 pass, build, headless.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 4 open steps total 4.75 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Medium remaining effort. Estimated 2026-11-05. Reassessed 2026-11-07: Raised to Large remaining effort: explicit call/transfer boundaries, live elapsed display, cross-base seats and summary statistics need instrumentation and end-to-end evidence across several components.

| Field | Value |
|---|---|
| PR / evidence | [PR #373](https://github.com/voidbrain/nerv/pull/373) (`F-052-T02`–`F-052-T05`); [PR #196](https://github.com/voidbrain/nerv/pull/196) remaining-effort reassessment;  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; Owner question 2026-11-05 (ledger timing of S-7663 and S-3BFF); item 3 [PR #116](https://github.com/voidbrain/nerv/pull/116) |
| Opened | 2026-11-05 |
| Verification | 2026-11-05 item 3: test/kaji-seats.test.ts and full suite (local run) |
| Reviewed | 2026-11-07 |

</details>

---


### F-074

**Indexed reusable evaluations, operator campaigns and the first Gemma smoke**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-13 ([PR #370](https://github.com/voidbrain/nerv/pull/370)): F-074-T10 (identity-bound ledger coverage) and F-074-T04 (profile-matched 8K/2048 operator role-evaluation bundle) completed; all 7 deterministic `nerv-system-flows` cases recorded in schema 2 ledger (`evals/gauntlet/ledger.json`).

| | |
|---|---|
| **Issue** | NERV needs discoverable test capabilities and reusable measured evidence without confusing common model results with system acceptance. |
| **Reproduce** | Generate the combined index, validate evidence reuse/mismatch, then execute the ten-case Gemma pack under explicit bounded settings. |
| **Check** | Every common pack in the pinned release is consumed or excluded with a reason; a new or changed case raises a backlog item until a run covers it; one root command runs NERV and common packs, reusing only exact-identity evidence. Profile-matched bounded operator role command with saved reports; pinned independent release; generated index current; common reuse exact/fresh and system-source aware; measured cold/warm telemetry with unknown metrics explicit; one authorized Gemma4:12b Q4_K_M 8K serial/default-sampling/thinking-on smoke, output2048/case and explicit time/token limits. No model downloads or live alternative-runtime campaigns. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** T03 consumes released Gauntlet0.3.0 from independent PR7 / CI42607576561: pinned source/artifact, shared machine/scenario CLI/API, report/cache/compare identity and NERV wrapper joins. Generic definitions moved upstream; NERV retains assignments and acceptance. Accepted adoption after PR #235 exactheadb4cd887 / full CI42608578429, mergedmainc5323e5; T03 closed; [independent review](../../reviews/2026-11-09-gauntlet-environment-adoption.md) found no blocking findings after exact source/package and nine-join checks; no model/load campaign. T02 was separately executed by the owner and reviewed below; dependency adoption itself ran no model.

 T01 closed after PR #225, exact head11c963c, merged main8fab24c. CI42573854325 passed plan, validate, Windows, native-macos and full-suite; eight local integration/index/cache/artifact/cancellation tests and independent report-only recheck passed. Adopted Gauntlet0.2.0: generated index17cases, exact/source-aware private reuse with original timestamps, streaming/sampled telemetry and fixture-tested local-runtime adapters. [Adoption acceptance](../../acceptance/gauntlet-v02-2026-11-09.md). T02 is closed after the owner-provided first ten-case Gemma run and evidence review; the report below records the actual measured failure. No model download, alternative-runtime installation or qualification occurred. Queue order is regenerated from current record/task/dependency state; consult the generated view rather than this historical selection; F-023-T03 is accepted with live native acceptance pending; combination qualification requirements are tracked under F-006/F-045, not claimed by this smoke.

**Operator handoff and references 2026-11-09:** [Terminal commands](../../evaluations/gauntlet.md#operator-runs-common-gemma-smoke-and-nerv-system-acceptance) save common Gemma and dedicated scripted-system reports with explicit budgets and environment declarations. Common can run through NERV OR a prepared Gauntlet checkout without duplicating measurement. T04 retains the requested profile-matched NERV role bundle: current native role defaults do not match the common8K/2048 profile or aggregate cap. [external-project assessment](../../reviews/2026-11-09-external-agent-projects.md) retains optional external runners; generic adapters stay upstream. No model campaign was launched while documenting this.

**First campaign reviewed 2026-11-09:** [common Gemma report review](../../evaluations/2026-11-09-gemma-common-smoke.md), report19a5b470-e87a-4400-a2e9-920404a797d2. All10 executed,7 passed; change-mind/tool-choice/missing-input failed JSON parsing,4/4 holdouts passed. Duration64.744s,1608 output tokens, exact requested model/profile and moderate-load declaration. The run completed inside budget; candidate acceptance failed. Raw response text and human responsiveness/load observations are unavailable. Preserve failure, do not automatically rerun or weaken grading. T02 closed; T04 is unimplemented and keeps the parent Open.

**Diagnostics/job-rule adoption2026-11-09:** T05 consumes released Gauntlet0.4.1 (PR11 / CI42686856664, main8d99d9f/tagv0.4.1) and harness4.4.1 (PR91 / CI42678501222). New common selected-case capture/inspection and private development job registration are implemented; eleven package/wrapper joins pass, including source-bound failed reply capture with unchanged grading and no public raw reply. Native client counters/loading and the role-profile workflow remain unverified/unimplemented, not qualification. [Adoption evidence](../../acceptance/gauntlet-private-diagnostics-2026-11-09.md).

**Gauntlet 0.5.0 pin, 2026-11-11 ([PR #259](https://github.com/voidbrain/nerv/pull/259)):** merged d2bb481, CI42974448234 passed all five jobs. Replaces the vendored artifact, lockfile and provenance with released 0.5.0 (tag v0.5.0, source 0d46c4a, upstream PR #29 / CI 42973762775, SHA256 in the vendor manifest) and regenerates the capability index links. Upstream adds the 28-case expanded pack and repeatable candidate comparisons. The expanded pack is not wired in; NERV's model commands keep the ten-case smoke packs. `gauntlet:compare` forwards to upstream, so its behaviour changes: 2–64 reports required and a new output shape (identity, mismatch reasons, per-result rows); no NERV code read the old keys, and a new regression joins the command to two saved reports. No model campaign ran. test/gauntlet.test.mjs (12 tests) and `gauntlet:plan` pass against the new artifact. [Independent fresh-context review](https://github.com/voidbrain/nerv/pull/259) verified artifact provenance against tag v0.5.0, the lockfile scope and tests, and found the first wording understated the compare change; corrected here. T04/T05 status unchanged.

**Structured-output extension2026-11-09:** Owner accepted explicit Ollama schema support and a prepared moderate-load diagnostic command. T05 includes released upstream F-007 adoption: `--format=schema` selects a separate structure-only smoke pack; original unconstrained evidence remains unchanged. Medium-load live acceptance is owner-run and unexecuted; no qualification follows from fixture success.

**Adoption accepted2026-11-10:** T05 closed after PR #242 exacthead03c0721 / CI42687439382 passed all five jobs including full-suite, mergedmainbc7a9c3. Independent harness/source/schema review and eleven joins passed. Prepared moderate-load schema diagnostic remains owner-run and unexecuted; T04 remains planned and the parent stays Open.

**F-074-T06–T08 implemented 2026-11-11 ([PR #272](https://github.com/voidbrain/nerv/pull/272)):** Gauntlet 0.6.0 pinned; every shipped pack consumed (`neutral-smoke`, `neutral-smoke-schema`, `general-assistant-expanded`) plus `nerv-system-flows`, with exclusions only by reasoned config; committed metadata-only run ledger `evals/gauntlet/ledger.json`; `gauntlet:pending` (harness `evaluations` setting, reported at session start), `check:gauntlet-runs` in CI (fails while a pending case has no open record), `gauntlet-runs` impact row; `gauntlet:all` plans and runs only uncovered cases and records them. Model limits scale the day limits per case. The five ordinary system cases ran and passed locally and are in the ledger; 50 cases stay pending, named by F-074-T09. Known limit: ledger coverage ignores runtime identity, machine scenario and NERV source key (see F-074-T08). Review: fresh-context design review (Opus): one blocker (check:gauntlet-runs accepted any mention of a pack id, including record history, so a changed case passed CI unraised) and should-fix items (`--max-age-days` did not reach Gauntlet's cache; `gauntlet:all` exited 0 on failures; F-074-T08 acceptance and fixtures), fixed in #272: only unfinished tasks listing `pack/case` or `pack/*` raise a case, with a failing-path test; age passed through; exit 1 on failure; F-074-T08 acceptance states the unmet part; fixtures for --fresh, max age and another profile. Provenance verified: the tgz matches tag v0.6.0.

**Gauntlet 0.7.1 pinned 2026-11-11 ([PR #275](https://github.com/voidbrain/nerv/pull/275)):** artifact, lockfile and provenance replaced together; NERV records new runs in ledger schema 2. F-074-T10's first acceptance (pin) is done; passing the intended identity remains.

**F-074-T09 completed 2026-11-12 ([PR #316](https://github.com/voidbrain/nerv/pull/316)):** the agent ran the 7 pending expanded cases with the owner's approval. A first attempt at the default 30 s per case stopped on case 1 (7 s model load plus about 24 tokens/s of thinking; not the 840 s pack limit as first thought) and recorded nothing; with a 90 s case limit approved by the owner (`--limits`, 630 s, same 14,336-token cap) all 7 passed in 103 s and 2,195 tokens. The ledger now covers all 48 model and 7 system cases and `gauntlet:pending` is empty. [Summary](../../evaluations/2026-11-12-gauntlet-t09.md). NERV's default model limits stay at 30 s per case, too short for long thinking replies with this profile: a later fresh run with it needs an owner-approved `--limits`.

**Owner run 2026-11-11 (F-074-T09, partial; [PR #274](https://github.com/voidbrain/nerv/pull/274)):** the ledger now records 41 of the 48 model cases (neutral-smoke 10, neutral-smoke-schema 10, general-assistant-expanded 21; corrected 2026-11-12 from the ledger: 38 passed, neutral-smoke change-mind, missing-input and tool-choice failed) and the expensive system cases `browser` and `stress`, from the owner's run (expanded report finished 13:49:56Z). The last seven expanded cases (prompt-injection-r2, -h1, -h2, combined-r1, -r2, -h1, -h2) were not graded in that report: Gauntlet records only passed or failed results, so an error or not-run result covers nothing and the cases stay pending. The likely cause is the 840 s suite limit for 28 cases being reached before the last ones ran; the report's per-case status confirms it. `gauntlet:all` reruns only those seven. **Gauntlet 0.7.0 published 2026-11-11** (gauntlet-protocol B-002, PRs #37/#38): ledger coverage follows model digest, runtime, scenario and source key; F-074-T10 is no longer blocked.

**Owner answers 2026-11-11 ([PR #273](https://github.com/voidbrain/nerv/pull/273)):** the T09 "budget" is the hard time and output-token limits `gauntlet:all` prints and enforces, now stated in F-074-T09. No default max age for reuse: a run stays valid until its identity changes; an age limit would only cover identity the ledger does not bind. That gap (F-074-T08 known limit) is planned: upstream [gauntlet-protocol PR #36](https://github.com/voidbrain/gauntlet-protocol/pull/36) opens B-002 (ledger records model digest, runtime, scenario and a consumer source key; `pending` names the change), and F-074-T10 adopts it. B-002 is a bug upstream: F-010-T01's acceptance named runtime and machine scenario, and v0.6.0 shipped without them.

**Gap found 2026-11-11:** the 0.5.0 pin (PR #259) shipped the 28-case `general-assistant-expanded@1.0.0` pack, but tools/gauntlet.mjs names `smoke-v1.json` by path, and nothing compares the artifact's packs with the ones NERV uses, so the new pack was never run or indexed. Owner decision the same day: NERV always consumes every common pack plus its own; a pack added or changed raises a run-new-tests item; `gauntlet:all` from the root runs new, changed or stale cases and reuses exact-identity evidence. Tasks T06–T09. Same day, because the harness and Gauntlet are reused by future projects: the generic comparison moves upstream ([gauntlet-protocol PR #33](https://github.com/voidbrain/gauntlet-protocol/pull/33), F-010: run ledger and `gauntlet pending`; [project-harness PR #109](https://github.com/voidbrain/project-harness/pull/109), F-052: declared evaluation dependencies reported by check:freshness, with the backlog rule). T07 only adopts them.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 3 open steps total 2 h agent + 0.5 h owner (steps table; each task basis gives old → new). Figures after this sentence are dated history. Re-estimated 2026-11-11 in agent hours (harness 5.6.0): the 3 open steps in hours total 2.75 h agent + 0.5 h owner (steps table; method in each task basis). Day figures below are dated history. Small remaining effort, reassessed 2026-11-11 after F-074-T06–T08: F-074-T09 (0.5 day including owner time), F-074-T04 (1 focused day) and F-074-T10 (0.5 focused day; pinned 0.7.1) remain. Earlier the same day: Medium, about 3 focused days (T06 0.5, T07 1, T08 1, T09 0.5, plus T04). Reassessed 2026-11-11 after the owner asked that NERV always consume every common pack and that new packs raise a run; previous estimate Small covered T04 only. Estimates, not measurements.

| Field | Value |
|---|---|
| PR / evidence | [PR #370](https://github.com/voidbrain/nerv/pull/370) F-074-T10/T04 & closure; [PR #259](https://github.com/voidbrain/nerv/pull/259) Gauntlet 0.5.0 pin; [PR #243](https://github.com/voidbrain/nerv/pull/243) adoption acceptance;  [PR #242](https://github.com/voidbrain/nerv/pull/242) retains/supersedes PR241 and adopts diagnostics;  Reference/operator documentation: [PR #241](https://github.com/voidbrain/nerv/pull/241); Acceptance reconcile: [PR #236](https://github.com/voidbrain/nerv/pull/236); Environment adoption: [PR #235](https://github.com/voidbrain/nerv/pull/235); Review: fresh-context report, no blocking findings; Test: test/gauntlet.test.mjs shared-context consumer/reuse/admission join;  [PR #227](https://github.com/voidbrain/nerv/pull/227) staged qualification design and owner resume; [PR #226](https://github.com/voidbrain/nerv/pull/226) adoption acceptance and explicit owner pause; [PR #225](https://github.com/voidbrain/nerv/pull/225); upstream Gauntlet PR #5 / CI42572655186; Review: independent report-only recheck linked above. |
| Opened | 2026-11-09 |
| Verification | 2026-11-13 Unit/integration: `test/gauntlet.test.mjs` (18 passed), `test/evaluation-model.test.mjs` (1 passed), `gauntlet:index`, `check:gauntlet-index`, `gauntlet:plan`, `gauntlet:role-plan`, `gauntlet:all --execute --allow-expensive` (7/7 `nerv-system-flows` passed and recorded with schema 2 `sourceKey`), `check:gauntlet-runs` (0 pending), and `check:fast` passed; no live model run executed for T04. Earlier 2026-11-10 Unit/integration: PR242 exacthead03c0721 / CI42687439382 passed all five jobs/full-suite; eleven fixture joins and independent harness/source/schema review passed; T05 closed, no live schema campaign. Earlier2026-11-09 Unit/integration: PR235 exactheadb4cd887 / CI42608578429 passed all five jobs including full-suite, mergedmainc5323e5. Nine focused context/reuse/admission/package joins, local468 Node tests (466 passed, two platform skips), typecheck/build/index and committed-source policy90 passed. Review: independent exact package/source/installed-file verification and nine joins, no blocking finding. Real-model2026-11-09: owner-provided common smoke validated and reviewed, complete10cases,7 passed/3 failed,64.744s/1608 tokens; no load/model qualification. |
| Reviewed | 2026-11-11 |

</details>

---

### F-015

**Pair native clients without sharing the root credential**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🟢 | 🔺 P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-13 by the owner: every Check item passed live (T02, T03); service-host stopped-profile recovery and the stale 2026-11-07 client moved to F-081.

| | |
|---|---|
| **Issue** | Backend single-use invitations, pinned TLS transport, separate hashed verifier storage and read-only revocable credentials are implemented; Swift Keychain/pinning source exists with macOS CI checks. Owner-ticket renewal and stopped-profile recovery are implemented/tested; live native Keychain/recovery acceptance remains open. |
| **Reproduce** | Live runs: [pairing and Keychain trial](../../acceptance/f015-keychain-trial-2026-11-12.md) and [failure, recovery and rotation](../../acceptance/f015-live-failures-2026-11-12.md); design in docs/decisions/runtime-boundaries.md. |
| **Check** | Expired/replayed tickets fail; credentials are bound to runtime identity; no tokens in URLs/argv/logs or Brain; revocation/rotation tested; native permissions remain explicit. |

<details>
<summary>Next action, estimates and evidence</summary>

**F-015-T03 completed 2026-11-12 ([PR #325](https://github.com/voidbrain/nerv/pull/325)):** owner-approved split into four live cases (T03a revocation 0.25 h, T03b lost renewal reply 0.5 h, T03c Keychain failure 0.25 h, T03d offline TLS/auth rotation 0.5 h, evidence 0.5 h; about 20 min owner), replacing the 0.5 h + 0.5 h estimate. All four ran on an isolated profile and recovered with the native README procedure: a revoked credential is refused and its data cleared; a renewal completed on a throttled server while the companion stopped waiting left the old token dead and an orphan replacement, recovered by `clients`, `revoke` and fresh pairing; a cancelled keychain prompt made the save fail after the server renewed, recovered the same way; the stopped-profile rotation gave a new identity and pin, kept the profile's data, and the companion refused the new certificate with its old pin. [Evidence](../../acceptance/f015-live-failures-2026-11-12.md). Every Check item has now passed live (T02 and T03); service-host stopped-profile recovery stays deferred. Found: B-057, and B-056 extended.

**F-015-T02 completed 2026-11-12 ([PR #322](https://github.com/voidbrain/nerv/pull/322)):** the companion (main `214b7cb`, now in `~/Applications/NERV.app`) paired live to an isolated profile `NERV-T1` on ports 4417/4419; the owner saw that profile's reminder and the service-mismatch guard; a used and an expired invitation were refused (400); no token in the profile log, the companion's log and preferences, process arguments or URLs; the owner then re-paired to the live service. A pasted invitation for another runtime during renewal was refused on the Mac with a misleading message (B-056). [Evidence](../../acceptance/f015-keychain-trial-2026-11-12.md). Left open: F-015-T03, and the unrevoked 2026-11-07 client on the live service.

**Next action / closure evidence:** Owner selected this Mac for companion UI only (shared with F-011); icon/menu visibility is owner-confirmed; next prepare the exact isolated pairing/Keychain trial. No real credential or TLS/auth set has been replaced. Service-host stopped-profile recovery remains deferred until the owner chooses that host. Explicit renewal now requires a fresh owner ticket plus the current valid credential, atomically replaces it and retains read-only scope. Swift validates the existing runtime/pin/ports before sending the old token; lost replies or Keychain failure require inspection/new invitation. The documented offline TLS/auth replacement rotates native identity and invalidates old clients without changing unrelated data. No automatic live certificate rotation is claimed. PR #213 CI 42489975323 passed all five jobs including full-suite; actual OS/Keychain acceptance stays pending. See [renewal and recovery guide](../../../native/README.md#renew-an-unexpired-native-credential).

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 2 open steps total 1 h agent + 1 h owner (steps table; each task basis gives old → new). Figures after this sentence are dated history. Re-estimated 2026-11-11 in agent hours (harness 5.6.0): the 2 open steps in hours total 1.75 h agent + 1 h owner (steps table; method in each task basis). Day figures below are dated history. Medium remaining effort (two to three focused days), reassessed 2026-11-08: implementation/isolated joins are delivered; live Keychain, failure/recovery and target-host acceptance remain uncertain and require owner access.

| Field | Value |
|---|---|
| PR / evidence | [PR #325](https://github.com/voidbrain/nerv/pull/325) F-015-T03 live failure, recovery and rotation ([evidence](../../acceptance/f015-live-failures-2026-11-12.md)); [PR #322](https://github.com/voidbrain/nerv/pull/322) F-015-T02 isolated pairing and Keychain trial ([evidence](../../acceptance/f015-keychain-trial-2026-11-12.md)); [PR #215](https://github.com/voidbrain/nerv/pull/215) native CI and scoped owner acceptance; [PR #213](https://github.com/voidbrain/nerv/pull/213) credential renewal and offline recovery contracts; [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #4](https://github.com/voidbrain/nerv/pull/4) merged; Linux and macOS checks green; live Keychain/rotation acceptance remains pending |
| Opened | 2026-11-01 |
| Verification | 2026-11-12 live on the owner's Mac: pairing, replay/expiry refusal and secret checks (T02); revocation, lost renewal reply, Keychain failure and offline rotation with recovery (T03); owner-observed. 2026-11-08 Unit/integration: five Node authentication/renewal contracts and one stopped-profile recovery contract pass; actual HTTPS admission, single-use tickets, old-token invalidation, independent clients, full roster, expired/revoked refusal and retained unrelated data covered. Swift: three pairing tests pass, including real pinned Swift-to-Node HTTPS renewal and identity/pin/port refusal. Typecheck/conventions pass. PR #213 CI 42489975323 passed plan, validate, windows, native-macos and full-suite. Live Keychain/OS/certificate-recovery acceptance pending; fixtures never change real credentials, services or login state. |
| Reviewed | 2026-11-13. Review: fresh-context closure review in the closing PR (2026-11-13). |

</details>

---
