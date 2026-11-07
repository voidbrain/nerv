# Backlog archive 2026

Closed records in closing-date order. Dated evidence, not current status.

**2026-11-06 source-path note:** The canonical architecture moved to [docs/NERV-ARCHITECTURE.md](../NERV-ARCHITECTURE.md); the dated review is preserved in [audits](../audits/2026-11-04-rebrand-review.md). Historical docs/NERV references remain evidence of the [pinned source snapshot](https://github.com/voidbrain/nerv/tree/7c0b61964a1827681f83c10dd36c762b525a1911/docs/NERV); see the [retirement mapping](../audits/2026-11-06-brainstorm-retirement.md). Original archived record lines are unchanged.

<!-- archive-recap:start -->
## Weekly closure recaps

Closed records in this archive, grouped by closing date (Monday–Sunday). Links open the first section for that week; current status stays in the active backlog.

| Closing week | Features closed | Bugs closed |
|---|---:|---:|
| [2026-11-02 – 2026-11-08](#archive-week-2026-11-02) | 34 | 37 |
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
