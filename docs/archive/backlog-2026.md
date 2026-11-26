# Backlog archive 2026

Closed records in closing-date order. Dated evidence, not current status.

**2026-11-06 source-path note:** The canonical architecture moved to [docs/NERV-ARCHITECTURE.md](../NERV-ARCHITECTURE.md); the dated review is preserved in [audits](../audits/2026-11-04-rebrand-review.md). Historical docs/NERV references remain evidence of the [pinned source snapshot](https://github.com/voidbrain/nerv/tree/7c0b61964a1827681f83c10dd36c762b525a1911/docs/NERV); see the [retirement mapping](../audits/2026-11-06-brainstorm-retirement.md). Original archived record lines are unchanged.

<!-- archive-recap:start -->
## Weekly closure recaps

Closed records in this archive, grouped by closing date (Monday–Sunday). Links open the first section for that week; current status stays in the active backlog.

| Closing week | Features closed | Bugs closed |
|---|---:|---:|
| [2026-11-23 – 2026-11-29](#archive-week-2026-11-23) | 9 | 30 |
| [2026-11-16 – 2026-11-22](#archive-week-2026-11-16) | 21 | 32 |
| [2026-11-09 – 2026-11-15](#archive-week-2026-11-09) | 22 | 20 |
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

### B-058

**A Finder or ignored file marks every recorded evaluation run stale**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-13: [PR #376](https://github.com/voidbrain/nerv/pull/376) merged with all five CI jobs green; ignored OS metadata no longer changes the evaluation source key.

| | |
|---|---|
| **Issue** | 2026-11-13: `sourceInputs` hashed Git-ignored files. One `web/.DS_Store` changed the Gauntlet system source key although a clean checkout of the same commit had none pending. |
| **Reproduce** | On main `a4081d5`, add a `.DS_Store` under `web/`; the seven cases incorrectly become source-changed. |
| **Check** | OS metadata and Git-ignored files do not change `sourceInputs`; other untracked files still do; a committed regression fails without the fix. |
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

**Closure evidence:** B-058-T01 closed. `sourceInputs` skips OS metadata and Git-ignored source files; regression `dfa4861` failed before the fix. PR #376 merged as `07c627c`; CI 43479688340 passed all five jobs.

**Estimates:** Small, estimated 2026-11-13. No actual recorded: the closing reconciliation cannot establish the original task's elapsed effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #376](https://github.com/voidbrain/nerv/pull/376) |
| Opened | 2026-11-13 |
| Verification | Closed 2026-11-13: regression and pending checks passed; PR #376 CI passed all five jobs. |
| Reviewed | 2026-11-13 |

</details>

---

### F-075

**The seven nerv-system-flows evaluation cases run again at current main**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-13: the seven deterministic system cases passed against the F-021 registry source; `gauntlet pending` is empty and no model was called.

| | |
|---|---|
| **Issue** | Runtime source changes invalidate the exact source key of every `nerv-system-flows` result. |
| **Reproduce** | Change registered runtime source and run `node tools/gauntlet.mjs pending`. |
| **Check** | All seven system cases pass and are recorded; pending exits 0. |

<details>
<summary>Next action, estimates and evidence</summary>

**Closure evidence:** T01 recorded 7/7 on PR #376. F-021-T02 then changed the runtime source; T02 reran policy, ledger, conversation, channels, bases, stress and browser with built assets. All seven passed, `stillPending` was 0, and `modelQualification` was false.

**Estimates:** No remaining effort. T02 actual 0.25 h agent (stated); T01 actual unavailable from the closing reconciliation.

| Field | Value |
|---|---|
| PR / evidence | [PR #376](https://github.com/voidbrain/nerv/pull/376); F-021-T02 working PR |
| Opened | 2026-11-13 |
| Verification | Closed 2026-11-13: 7/7 deterministic system cases passed; pending exits 0; no model call. |
| Reviewed | 2026-11-13 |
**Closed 2026-11-13 by the owner:** every Check item passed live in T02 and T03 (2026-11-12). Statements below that call live Keychain, OS or recovery acceptance pending are dated history written before those trials; what stayed open moved to F-081.

**F-015-T03 completed 2026-11-12 ([PR #325](https://github.com/voidbrain/nerv/pull/325)):** owner-approved split into four live cases (T03a revocation 0.25 h, T03b lost renewal reply 0.5 h, T03c Keychain failure 0.25 h, T03d offline TLS/auth rotation 0.5 h, evidence 0.5 h; about 20 min owner), replacing the 0.5 h + 0.5 h estimate. All four ran on an isolated profile and recovered with the native README procedure: a revoked credential is refused and its data cleared; a renewal completed on a throttled server while the companion stopped waiting left the old token dead and an orphan replacement, recovered by `clients`, `revoke` and fresh pairing; a cancelled keychain prompt made the save fail after the server renewed, recovered the same way; the stopped-profile rotation gave a new identity and pin, kept the profile's data, and the companion refused the new certificate with its old pin. [Evidence](../../acceptance/f015-live-failures-2026-11-12.md). Every Check item has now passed live (T02 and T03); service-host stopped-profile recovery stays deferred. Found: B-057, and B-056 extended.

**F-015-T02 completed 2026-11-12 ([PR #322](https://github.com/voidbrain/nerv/pull/322)):** the companion (main `214b7cb`, now in `~/Applications/NERV.app`) paired live to an isolated profile `NERV-T1` on ports 4417/4419; the owner saw that profile's reminder and the service-mismatch guard; a used and an expired invitation were refused (400); no token in the profile log, the companion's log and preferences, process arguments or URLs; the owner then re-paired to the live service. A pasted invitation for another runtime during renewal was refused on the Mac with a misleading message (B-056). [Evidence](../../acceptance/f015-keychain-trial-2026-11-12.md). Left open: F-015-T03, and the unrevoked 2026-11-07 client on the live service.

**Next action / closure evidence:** Owner selected this Mac for companion UI only (shared with F-011); icon/menu visibility is owner-confirmed; next prepare the exact isolated pairing/Keychain trial. No real credential or TLS/auth set has been replaced. Service-host stopped-profile recovery remains deferred until the owner chooses that host. Explicit renewal now requires a fresh owner ticket plus the current valid credential, atomically replaces it and retains read-only scope. Swift validates the existing runtime/pin/ports before sending the old token; lost replies or Keychain failure require inspection/new invitation. The documented offline TLS/auth replacement rotates native identity and invalidates old clients without changing unrelated data. No automatic live certificate rotation is claimed. PR #213 CI 42489975323 passed all five jobs including full-suite; actual OS/Keychain acceptance stays pending. See [renewal and recovery guide](../../../native/README.md#renew-an-unexpired-native-credential).

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 2 open steps total 1 h agent + 1 h owner (steps table; each task basis gives old → new). Figures after this sentence are dated history. Re-estimated 2026-11-11 in agent hours (harness 5.6.0): the 2 open steps in hours total 1.75 h agent + 1 h owner (steps table; method in each task basis). Day figures below are dated history. Medium remaining effort (two to three focused days), reassessed 2026-11-08: implementation/isolated joins are delivered; live Keychain, failure/recovery and target-host acceptance remain uncertain and require owner access.

| Field | Value |
|---|---|
| PR / evidence | [PR #380](https://github.com/voidbrain/nerv/pull/380) closure; [PR #325](https://github.com/voidbrain/nerv/pull/325) F-015-T03 live failure, recovery and rotation ([evidence](../../acceptance/f015-live-failures-2026-11-12.md)); [PR #322](https://github.com/voidbrain/nerv/pull/322) F-015-T02 isolated pairing and Keychain trial ([evidence](../../acceptance/f015-keychain-trial-2026-11-12.md)); [PR #215](https://github.com/voidbrain/nerv/pull/215) native CI and scoped owner acceptance; [PR #213](https://github.com/voidbrain/nerv/pull/213) credential renewal and offline recovery contracts; [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #4](https://github.com/voidbrain/nerv/pull/4) merged; Linux and macOS checks green; live Keychain/rotation acceptance remains pending |
| Opened | 2026-11-01 |
| Verification | 2026-11-12 live on the owner's Mac: pairing, replay/expiry refusal and secret checks (T02); revocation, lost renewal reply, Keychain failure and offline rotation with recovery (T03); owner-observed. 2026-11-08 Unit/integration: five Node authentication/renewal contracts and one stopped-profile recovery contract pass; actual HTTPS admission, single-use tickets, old-token invalidation, independent clients, full roster, expired/revoked refusal and retained unrelated data covered. Swift: three pairing tests pass, including real pinned Swift-to-Node HTTPS renewal and identity/pin/port refusal. Typecheck/conventions pass. PR #213 CI 42489975323 passed plan, validate, windows, native-macos and full-suite. Live Keychain/OS/certificate-recovery acceptance pending; fixtures never change real credentials, services or login state. |
| Reviewed | 2026-11-13. Review: [fresh-context closure review](https://github.com/voidbrain/nerv/pull/380#issuecomment-6862313031), no blockers. |

</details>

---

## Closed 2026-11-14

### B-062

**`nodes inspect` gives one vague message for an unreachable host and for a target without Node.js**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: the fix passed CI and the VM run.

| | |
|---|---|
| **Issue** | 2026-11-14, F-005-T22 owner run: `nodes inspect --ssh nerv-linux` printed "Read-only command failed. Check the selected client and target prerequisites". Here SSH could not resolve the host, but the same text appears when the target has no Node.js, which is the prerequisite T22 must report. The owner cannot tell which one to fix. |
| **Reproduce** | `nodes inspect --ssh <unknown host>`, and `nodes inspect --ssh <host without node>`: both print the same line. |
| **Check** | A regression through the real command runner: SSH exit 255 says the target could not be reached over SSH (name, key or known host); exit 127 says Node.js is missing on the target's non-interactive PATH; other failures keep the generic text; all still say no installation was requested. |

<details>
<summary>Next action, estimates and evidence</summary>

**Closed 2026-11-14:** PR #396 merged (CI 43572379622 green). On the VM without Node.js (F-005-T22 step 1, run by the agent at the owner's request), `nodes inspect --ssh nerv-linux` now says Node.js was not found on the target's non-interactive PATH. **Next action / closure evidence:** B-062-T01 implemented. All seven nerv-system-flows cases reran and passed at this source (ledger updated; stress and browser in B-062-T02).

**Estimates:** Small, estimated 2026-11-14: 0.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #396](https://github.com/voidbrain/nerv/pull/396); found in the F-005-T22 owner run, 2026-11-14. |
| Opened | 2026-11-14 |
| Verification | Unit: test/node-inspection-errors.test.ts through the real runner. VM run 2026-11-14 (F-005-T22 step 1): the missing-Node message appears. |
| Reviewed | 2026-11-14 |

</details>

---

### F-066

**Machine credentials: rotation and telling owner use from automated use**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: every check is automated and passed in CI.

| | |
|---|---|
| **Issue** | Checked against the [OWASP Non-Human Identities Top 10](https://owasp.org/www-project-non-human-identities-top-10/) (2025): grants are short-lived (NHI7), base keys are per base (NHI9) and revocation wins (NHI1), but the admin token, the Telegram token and the cloud key have no rotation path (NHI7, long-lived secrets), and nothing shows whether a ledger entry came from the owner by hand or from an automated client using the same token (NHI10, human use of NHI). |
| **Reproduce** | Look for a command that replaces the admin token, Telegram token or cloud key while running and invalidates the old one: none. Make one REST decision by hand and one from a script with the admin token: the ledger cannot tell them apart. |
| **Check** | A rotation command per credential: the new one works at once, the old one is refused, no restart or re-enrolment needed, no secret printed or logged. `doctor` reports each credential's age (never its value). Ledger events record the client kind that acted (dashboard session, CLI, API token, Telegram) and a test proves an API-token decision is distinguishable from a dashboard one. |

<details>
<summary>Next action, estimates and evidence</summary>

**Closed 2026-11-14:** F-066-T01 ([PR #394](https://github.com/voidbrain/nerv/pull/394), CI 43567022613) and F-066-T02 ([PR #399](https://github.com/voidbrain/nerv/pull/399), CI 43576040188) merged with every check green. **Next action / closure evidence:** F-066-T01 closed 2026-11-14 after [PR #394](https://github.com/voidbrain/nerv/pull/394) passed complete deterministic CI and merged: `credentials rotate admin|telegram|cloud` atomically replaces private files; live HTTP, WebSocket, Telegram and cloud routes read the replacement without a service restart; doctor exposes age in seconds only. Next F-066-T02. Rotation of base keys and the root key belongs to F-036's enrolment and stays out of scope.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 2 open steps total 1.5 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Small. Set 2026-11-07.

| Field | Value |
|---|---|
| PR / evidence | [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #179](https://github.com/voidbrain/nerv/pull/179) record and roadmap placement |
| Opened | 2026-11-07 |
| Verification | Unit/integration: rotation, doctor age and client-kind regressions, CI green on PR #394 and PR #399. |
| Reviewed | 2026-11-14 |

</details>

---

### B-063

**`nodes inspect` accepts a Node.js older than NERV requires without saying so**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: the fix passed CI and the VM run.

| | |
|---|---|
| **Issue** | 2026-11-14, preparing step 2 of the F-005-T22 procedure (docs/acceptance/f005-t22-prerequisites.md): `nodes inspect` records the target's Node.js version but never compares it with `package.json` `engines.node` (≥ 24), so Ubuntu's Node 18 passes silently and the expected "below the version NERV requires" never appears. |
| **Reproduce** | Inspect a target whose `node --version` is 18.x: the command succeeds. |
| **Check** | A regression through `nodesCommand`: an older Node.js fails the command naming the found and required versions, after the unchanged inspection file is saved as evidence; a supported one passes as before; nothing is installed. |

<details>
<summary>Next action, estimates and evidence</summary>

**Closed 2026-11-14:** PR #397 merged (CI 43569512021 green) and the VM run passed. **Next action / closure evidence:** B-063-T01 closed 2026-11-14 after PR #397 merged (CI 43569512021 green). B-063-T03 closed 2026-11-14: on the VM with Node 18.19.1 the command failed naming 18.19.1 below >=24.0.0. B-063-T01: `nodes inspect` saves the unchanged inspection, then fails naming the found and required Node.js versions. All seven nerv-system-flows cases reran and passed at this source (stress and browser in B-063-T02).

**Estimates:** Small, estimated 2026-11-14: 0.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #397](https://github.com/voidbrain/nerv/pull/397); found while preparing the F-005-T22 owner run, 2026-11-14. |
| Opened | 2026-11-14 |
| Verification | Unit: test/node-inspection-version.test.ts through nodesCommand. VM run 2026-11-14: passed (F-005-T22 step 2). |
| Reviewed | 2026-11-14 |

</details>

---


### B-054

**A long chat reply on the main base fails at the 120 s model-call limit**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: [PR #410](https://github.com/voidbrain/nerv/pull/410) passed all five CI jobs and merged.

| | |
|---|---|
| **Issue** | 2026-11-12, B-008 reproduction: a five-paragraph request relayed from Tabgha ran 209.6 s and ended *Could not finish: Local route (S²) timed out.*; Neo Tokyo-3's log: *S² local route down … back after 1 min*. Misato there runs `gemma4:12b` with thinking at about 24 tokens/s on this Mac (Ollama log, F-074-T09), so about 2,900 tokens fit in `MODEL_TIMEOUT_MS` (120 s): an ordinary long answer can exceed it, and the route is then marked down for every request. |
| **Reproduce** | On the main base with Misato on `gemma4:12b` (thinking on), ask in chat for five detailed paragraphs on any topic; watch the reply and the service log. |
| **Check** | A long reply within the configured output allowance completes, or fails with a reason that says the answer was too long rather than marking the route down; any new limit is backed by a measured token rate; one slow reply does not take the route down for other requests. |

<details>
<summary>Next action, estimates and evidence</summary>

**Closed 2026-11-14:** [PR #410](https://github.com/voidbrain/nerv/pull/410) passed CI run 43622463226 (plan, windows, native-macos, validate, full-suite) and merged to main. **Next action / closure evidence:** B-054-T01 implemented 2026-11-14. Measured from the main base's `model_usage` rows for the 19:21 UTC run: consultant advice 33.2 s (744 in / 511 out tokens), Misato's first step 61.0 s (1,976 in / 829 out), the second step cut at the provider's 115 s limit (`MODEL_TIMEOUT_MS` − 5 s) with no usage: 209.2 s of the 209.6 s relay. Fix: S² calls (`completeOpenAICompatible`) stream the reply (`stream: true`); at the limit a route that sent nothing still fails with *timed out* (outage), while one still writing fails with *reply too long … ask for a shorter answer*, which is not an outage and leaves the route up. Test: `B-054: a long S² reply still being written at the time limit fails as too long and leaves the route up` in `test/model.test.ts` (committed first, `86461c5`), plus `B-054: a streamed S² reply within the limit is joined, with its usage`. Existing S² test updated to expect `stream: true`.

**Estimates:** Small, estimated 2026-11-12, not a measurement; B-054-T01 actual 0.25 h agent (stated).

| Field | Value |
|---|---|
| PR / evidence | [PR #410](https://github.com/voidbrain/nerv/pull/410) (fix, CI 43622463226); found during the B-008 reproduction, [evidence](../acceptance/b008-tabgha-2026-11-12.md); [PR #318](https://github.com/voidbrain/nerv/pull/318). |
| Opened | 2026-11-12 |
| Verification | Unit/integration: `test/model.test.ts` and `test/engine-provider.test.ts` pass; CI 43622463226 green across all 5 jobs on PR #410 before merge. |
| Reviewed | 2026-11-14 |

</details>

---

### B-060

**Timing-sensitive tests fail on the Windows CI runner without a code change**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: closed per owner instruction after [PR #411](https://github.com/voidbrain/nerv/pull/411) passed CI; root-cause IPC decoupling tracked in B-066.

| | |
|---|---|
| **Issue** | 2026-11-13: three PRs that changed no product code failed `windows` on three different timing tests, and each passed on rerun. #379: `test/instrumentality.test.ts:216` (F-003 failed night, 15 s timeout) and `test/kaji-link.test.ts:376` (degraded base, 20 s timeout). #382: `test/worker-link.test.ts:1116` (B-046 event-loop stall: "a reply that arrived during the stall must not end the session"). The same day `validate` on #379 failed once with "Chrome startup timed out". On #383 `validate` failed in `test/upgrade-health.test.ts` (F-005-T14) with `listen EADDRINUSE 127.0.0.1:44784`: the fixture draws a random port in 43990–44989, inside Linux's ephemeral range, and opens it again at every simulated service start, so any outgoing socket holding that port fails the test. |
| **Reproduce** | `gh run view 43486093786 --log-failed` and the #382 Windows job of 2026-11-13; run the three tests on a loaded Windows host. |
| **Check** | Each test waits on the condition it checks instead of wall-clock budgets the runner can miss (or has a Windows-specific budget with a stated reason); a loop of 20 Windows runs of the three tests passes; the Chrome start timeout has headroom on the CI runner. |

<details>
<summary>Next action, estimates and evidence</summary>

**Closed 2026-11-14:** Closed at owner instruction after [PR #384](https://github.com/voidbrain/nerv/pull/384) and [PR #411](https://github.com/voidbrain/nerv/pull/411) (CI 43622889287: plan, windows, validate, native-macos, full-suite green) merged; the underlying `worker-link.ts` heartbeat / `nervous` SQLite IPC coupling identified during B-060-T02 is tracked separately for an architectural fix in B-066 (`docs/decisions/worker-heartbeat-liveness.md`) rather than running an extra 20-loop Windows CI cycle on the timing workaround. **Next action / closure evidence:** B-060-T01 implemented 2026-11-13 (`PR #384`): update-health fixture keeps its kernel-chosen port; Test: `B-060: the fixture service keeps its port…` in `test/upgrade-health.test.ts` (committed first, `a02697c`). B-060-T02 implemented 2026-11-14 (`PR #411`): Windows-specific budgets with reasons in `test/instrumentality.test.ts`, `test/kaji-link.test.ts`, `test/worker-link.test.ts` (`hb = 400`, `stallMs = Math.ceil(hb * 1.5)` = 600 ms so `late > Math.max(25, timeoutMs / 4)` holds), `test/telegram.test.ts`, and `test/windows-service-lifecycle.test.ts`; Chrome startup timeout raised from 20 s to 45 s in `test/angular.browser.mjs` and `test/fixtures/browser.mjs`.

**Estimates:** Small, estimated 2026-11-13; T01 and T02 closed at 0.25 h agent each (stated).

| Field | Value |
|---|---|
| PR / evidence | [PR #411](https://github.com/voidbrain/nerv/pull/411) (B-060-T02, CI 43622889287); [PR #384](https://github.com/voidbrain/nerv/pull/384) (B-060-T01); [PR #383](https://github.com/voidbrain/nerv/pull/383), [PR #379](https://github.com/voidbrain/nerv/pull/379), [PR #382](https://github.com/voidbrain/nerv/pull/382); follow-up root cause: B-066. |
| Opened | 2026-11-13 |
| Verification | Unit/integration & Windows CI: 63/63 local macOS tests + PR #411 CI 43622889287 passed all 5 jobs (`windows`, `validate`, `native-macos`, `full-suite`, `plan`); 20-run loop waived in favour of B-066 root-cause fix per owner instruction. |
| Reviewed | 2026-11-14 |

</details>

---

### B-061

**Four-character sortie short IDs can collide, so a lookup by short ID can return many**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: [PR #412](https://github.com/voidbrain/nerv/pull/412) passed all five CI jobs and merged.

| | |
|---|---|
| **Issue** | 2026-11-13: `test/why.test.ts` (F-042, "sorties.explain …") failed once with `'many' !== 'one'` and passed on three reruns. A sortie's short ID is `S-` plus the first four hex characters of its UUID. Two sorties created in the same test can share them, and then `sorties.explain` by short ID finds several. The same collision can happen to the owner, since four hex characters give 65,536 values. |
| **Reproduce** | Create two sorties whose UUIDs share their first four characters, then explain one by its short ID. |
| **Check** | A regression with two colliding sorties: either the short ID grows until it is unique among open or recent sorties, or explain says the short ID is ambiguous and lists the candidates; the F-042 test no longer depends on random UUIDs. |

<details>
<summary>Next action, estimates and evidence</summary>

**Closed 2026-11-14:** [PR #412](https://github.com/voidbrain/nerv/pull/412) passed CI run 43622417765 (plan, native-macos, validate, windows, full-suite) and merged to main. **Next action / closure evidence:** B-061-T01 implemented 2026-11-14: `Ledger.openSortie` retries `randomUUID()` (up to 16 attempts) when the 4-character prefix collides with an existing sortie; `Ledger.explain`, `explainRecord`, and `sorties.explain` return distinguishing candidate short IDs (`S-` + 8–12 hex chars), titles, and statuses when multiple sorties match a prefix; `test/why.test.ts` F-042 uses an 8-character prefix for `sorties.explain`. Test: `B-061: colliding sortie short IDs list distinguishing candidates on explain` in `test/why.test.ts` (committed first, `970b969`; failed before the fix).

**Estimates:** Small, estimated 2026-11-13: 0.5 h agent; actual 0.25 h agent (stated). Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #412](https://github.com/voidbrain/nerv/pull/412) (fix, CI 43622417765); [PR #389](https://github.com/voidbrain/nerv/pull/389); found while reconciling harness 8.11.0, 2026-11-13. |
| Opened | 2026-11-13 |
| Verification | Unit/integration: 7/7 tests in `test/why.test.ts` pass; PR #412 CI 43622417765 green across all 5 jobs before merge. |
| Reviewed | 2026-11-14 |

</details>

---

### B-064

**`nodes lifecycle-inspect` on a fresh Linux machine fails with a raw ENOENT**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: [PR #413](https://github.com/voidbrain/nerv/pull/413) passed all five CI jobs and merged.

| | |
|---|---|
| **Issue** | 2026-11-14, F-005-T22 step 3 on the Linux VM: `nodes lifecycle-inspect --action install` in a fresh clone printed `ENOENT: no such file or directory, lstat '<home>/.nerv'`. The lifecycle commands support only the local Mac profile, and the data home does not exist yet, but neither is said, so the procedure's expected prerequisite plan never appears. |
| **Reproduce** | On Linux with no `~/.nerv`: `npm start -- nodes lifecycle-inspect --action install --out install-plan.json`. |
| **Check** | A regression through `nodesCommand`: no data home gives a message naming it and saying nothing changed; off macOS the message says the lifecycle supports only the Mac profile (Linux is F-005-T25); the Mac behaviour is unchanged. |

<details>
<summary>Next action, estimates and evidence</summary>

**Closed 2026-11-14:** [PR #413](https://github.com/voidbrain/nerv/pull/413) passed CI run 43622666273 (plan, validate, native-macos, windows, full-suite) and merged to main. **Next action / closure evidence:** B-064-T01 implemented 2026-11-14: `requireServiceHome` in `src/node-lifecycle-execution.ts` checks that the data home exists before `inspect()` and throws a message naming the missing path and stating nothing was changed; `src/nodes-cli.ts` rejects unsupported platforms with a message naming macOS, Linux, and Windows and stating nothing was changed; `docs/acceptance/f005-t22-prerequisites.md` notes the missing-home message. Test: `B-064: nodes lifecycle-inspect names a missing data home and unsupported platform instead of raw ENOENT` in `test/node-lifecycle.test.ts` (committed first, `2e70e8a`).

**Estimates:** Small, estimated 2026-11-14: 0.5 h agent; actual 0.25 h agent (stated). Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #413](https://github.com/voidbrain/nerv/pull/413) (fix, CI 43622666273); [PR #400](https://github.com/voidbrain/nerv/pull/400) records it; found in the F-005-T22 VM run, 2026-11-14. |
| Opened | 2026-11-14 |
| Verification | Unit/integration: 7/7 tests in `test/node-lifecycle.test.ts` pass; PR #413 CI 43622666273 green across all 5 jobs before merge. |
| Reviewed | 2026-11-14 |

</details>

---

### B-065

**A revoked base is drawn on the map and listed as offline**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔹 P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />None: [PR #415](https://github.com/voidbrain/nerv/pull/415) passed CI (`plan`, `validate`, `windows`, `native-macos`) and merged to `main` (`27bccf0`).

| | |
|---|---|
| **Issue** | Owner report 2026-11-14: the dashboard map still shows "Local acceptance" (`MAC-ACCEPTANCE`), revoked on 2026-11-11 (registry serial 5). The registry marks it `revoked` (`src/kaji.ts`), but the live dashboard maps a revoked base to `offline` (`web/public/dashboard/live.js:500`) and draws it on the map and in the base list like any unreachable base. |
| **Reproduce** | With a revoked base in the registry, open the dashboard: it appears on the Kaji line map and in the base list as offline. |
| **Check** | A committed test fails first; a revoked base is not drawn on the map and not counted in "n/m online"; if listed at all it is labelled revoked, apart from live bases; the registry keeps its record (append-only). |

<details>
<summary>Next action, estimates and evidence</summary>

**Closed 2026-11-14:** [PR #415](https://github.com/voidbrain/nerv/pull/415) passed CI run `43630406751` (`plan`, `validate`, `windows`, `native-macos`; `full-suite` skipped by scoped verification) and CodeQL run `43630403237`, and merged to `main` at `27bccf0`. **Next action / closure evidence:** B-065-T01 implemented 2026-11-14: `applyBases` and `window.renderBases` in `web/public/dashboard/live.js` exclude `status === "revoked"` entries from `BASES`, `LINKS`, `observeTelegram`, `pulseHeartbeats`, and the `n/m online` header count, and list revoked bases in a separate `Revoked` subsection without live channel lines. Test: `B-065: revoked bases are excluded from BASES on the map and listed apart from live bases in renderBases` in `test/dashboard.test.ts` (committed first, `7e70720`; failed before the fix, unchanged by the fix).

**Estimates:** Small, estimated 2026-11-14: 0.5 h agent; actual 0.25 h agent (stated). Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-14; [PR #409](https://github.com/voidbrain/nerv/pull/409); [PR #415](https://github.com/voidbrain/nerv/pull/415) (`27bccf0`, CI `43630406751`) |
| Opened | 2026-11-14 |
| Verification | Unit/regression: 42/42 tests pass across `test/dashboard.test.ts`, `test/channel-display.test.mjs`, and `test/dashboard-poll.test.ts`; `npm run check:fast` passed; PR #415 CI `43630406751` green (`plan`, `validate`, `windows`, `native-macos`). |
| Reviewed | 2026-11-14 |

</details>

---

## Closed 2026-11-15

### F-020

**Grounded personas for HITL and explanation (Misato primary)**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔹 P3 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-15: every step closed and the Check met.

| | |
|---|---|
| **Issue** | Personas Codec Chat exists as UI prototype. Free-form roleplay without grounding is a distraction and safety risk. |
| **Reproduce** | Request approval, status brief, or “why was this Red?”; confirm answers cite real job/decision data and cannot bypass policy. |
| **Check** | Misato can surface pending HITL and accept/reject with audit; Gendo (or Command) can explain classification; no persona can grant capabilities the backend policy denies; persona layer can be disabled; responses remain useful in non-Eva skins. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-15 in the backlog reconciliation: every step closed on green CI ([PR #427](https://github.com/voidbrain/nerv/pull/427)). 2026-11-15: F-020-T02 closed with `formatMisatoPendingHitl` and `decideHitlThroughPersona` in `src/persona.ts`, `persona hitl list|decide` in `src/cli.ts`, and regression test in `test/persona.test.ts` verifying grounded pending-approval surfacing, neutral fallback when disabled, and audited approve/reject routing through `Store.decide`. Owner decision 2026-11-04 (F-036): persona names are per base and renamable (Misato, Gendo… by default; e.g. Bob, Fritz, Tim on another base); MAGI seat names stay fixed on every base. Implement thin, state-grounded persona adapters after F-003 messaging and F-017 decisions exist. Prefer Misato for push/HITL. Keep Shinji/pilots as optional labels for workers, not primary chat partners. Safety: persona output never overrides capability tokens or Pattern Red rules.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 3 open steps total 3 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Medium remaining effort (prototype UI). Estimated 2026-11-02; priority lowered to P3 on 2026-11-04 (skin, not behaviour); estimate unchanged. Reassessed 2026-11-07: explicit prerequisite outcomes preserve the existing scope and remaining-work estimate; independent slices can proceed.

**Completed prerequisites:** [F-003](#f-003) — Messaging path for state-grounded persona replies; [F-017](#f-017) — Policy decisions remain authoritative over persona output.

| Field | Value |
|---|---|
| Depends on | — |
| PR / evidence | [PR #219](https://github.com/voidbrain/nerv/pull/219) retired-reference path correction; [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #187](https://github.com/voidbrain/nerv/pull/187) reviewed prerequisite links;  [retired dashboard1 personas prototype](../../remove/docs/NERV/dashboard1.html) |
| Opened | 2026-11-02 |
| Verification | 2026-11-15, Script: merged PR CI green (#427); every step closed. |
| Reviewed | 2026-11-15 |

</details>

---

### F-044

**Memory: one fact per subject, a proposed spelling fix, typo-tolerant recall**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔹 P3 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-15: every step closed and the Check met.

| | |
|---|---|
| **Issue** | Owner question 2026-11-05 about "remember i don't like wine and i play ultimate frisbbe": it is stored as one fact; facts are not linked to each other; recall matches exact words, so "frisbee" will not find "frisbbe" and the typo stays. |
| **Reproduce** | `nerv chat "remember i don't like wine and i play ultimate frisbbe"`, approve, then ask "what sports do I play?" and look in Lilith. |
| **Check** | A request with several facts proposes one fact per subject, on one card the owner approves or edits as a whole (each fact also editable or removable before approving); a proposed spelling fix is shown on the card next to the original (never applied silently); recall finds a fact despite a small typo (in the request or in the fact) and still ranks exact matches first; tests cover the split, the shown fix and fuzzy recall. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-15 in the backlog reconciliation: every step closed on green CI ([PR #439](https://github.com/voidbrain/nerv/pull/439)). 2026-11-15: F-044-T03 closed with bounded Levenshtein fallback in `Memory.recall` (`src/memory.ts`), finding facts despite small typos in either the query or stored fact while ranking exact FTS5 matches first (`test/memory.test.ts`). F-044-T02 closed with `suggestSpellingFix` in `src/memory.ts`, `suggestedText` & explicit `{ useSuggestedFix: true }` opt-in in `src/store.ts` and `src/server.ts`, Telegram & dashboard card rendering (`web/public/dashboard/dashboard.js`, `web/public/dashboard/live.js`) showing proposed fixes next to the original without silent mutation, and regression test in `test/memory.test.ts`. F-044-T01 closed 2026-11-14 after [PR #392](https://github.com/voidbrain/nerv/pull/392) merged with all CI jobs green: a multi-subject request creates one independently auditable approval per fact and presents them on one card with per-fact Edit/Remove and card-level approval. Next F-044-T03. Planned 2026-11-05 (owner approved the three parts).

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 3 open steps total 3 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Medium remaining effort. Estimated 2026-11-05.

| Field | Value |
|---|---|
| PR / evidence | [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; Owner question 2026-11-05 |
| Opened | 2026-11-05 |
| Verification | 2026-11-15, Script: merged PR CI green (#439); every step closed. |
| Reviewed | 2026-11-15 |

</details>

---

### F-050

**Forwarding a whole job to another base**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔶 P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-15: every step closed and the Check met.

| | |
|---|---|
| **Issue** | Owner questions 2026-11-05: can a base forward a full job to another, when it is busy or when the other does better; why, when and how. Today a base that is not the main one forwards whole requests to the main base (one channel, F-036), and the main base sends single actions to a base that offers them (slice 3b); the main base never hands a whole job to another base. |
| **Reproduce** | Ask the main base for a job only another base can do well (Tabgha's 3D expert, its GPU, a device next to it). |
| **Check** | The main base forwards a whole job when another base has the pilot, model, tool or device it needs (capability), when its own queue or model is busy and the other is idle (load), or when the data or device is there (locality), never a job with local-only or tainted data (the Scrolls decide what may leave); the job goes as one signed Kaji message with a job ID (it never runs twice) and only the context the Scrolls allow; the receiving base runs the whole sortie with its own Misato, pilot and gate, never looser than the main base's Scrolls; cards still reach the owner through Aoba; the result returns as a follow-up and the main ledger records where it ran and why; if the base goes silent, reconcile durable job receipts and resource ownership before any retry or reassignment; silence alone never proves execution stopped; tests across two bases. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-15 in the backlog reconciliation: every step closed on green CI ([PR #430](https://github.com/voidbrain/nerv/pull/430), [PR #442](https://github.com/voidbrain/nerv/pull/442)). 2026-11-15: F-050-T02 closed with `WholeJobHandoffStore` in `src/whole-job-handoff.ts` (wired into `Store.wholeJobHandoffs` in `src/store.ts`) and `test/whole-job-handoff.test.ts` verifying receipt-bound reconciliation before retry or reassignment across lost reply, restart, and sleeping base, plus Scroll floor and F-048 load-forwarding enforcement. F-050-T01 closed with [whole-job handoff contract](../decisions/whole-job-handoff.md) distinguishing bounded worker actions (`WorkerJobs`) from delegated whole sorties, inspecting the `F-045` remote capability prerequisite (`src/pilots.ts`, `src/kaji.ts`, `src/worker-jobs.ts`), and requiring unknown outcomes to remain held (`uncertain`) until reconciled; no runtime delegation is authorized by this contract. Planned 2026-11-05 (owner). Builds on F-036, F-045 (pilots offered by other bases) and F-048.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 2 open steps total 3.5 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Reassessed 2026-11-06 with B-028: removing unused speculative types does not remove implemented behavior; concrete tested contracts remain part of this feature, so Large remains valid.  Large remaining effort. Estimated 2026-11-05. Reassessed 2026-11-07: explicit prerequisite outcomes preserve the existing scope and remaining-work estimate; independent slices can proceed.

| Field | Value |
|---|---|
| Depends on | [F-045](#f-045) — Remote pilot capability offers for capability-based forwarding |
| PR / evidence | [PR #220](https://github.com/voidbrain/nerv/pull/220) task/capability and evidence reconciliation; 2026-11-08: [authored task capability requirements](../work/README.md#active-task-capability-requirements); no model qualification or feature acceptance claimed; [Scoped architecture reassessment](../audits/2026-11-08-architecture-reassessment.md), 2026-11-08; [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #187](https://github.com/voidbrain/nerv/pull/187) reviewed prerequisite links;  [PR #159](https://github.com/voidbrain/nerv/pull/159) unused-contract removal and owner-evidence reconciliation; Owner questions 2026-11-05 |
| Opened | 2026-11-05 |
| Verification | 2026-11-15, Script: merged PR CI green (#430, #442); every step closed. |
| Reviewed | 2026-11-15 |

</details>

---

### F-054

**The base chronicle: a daily log of the agency's milestones, plain and in Eva lore**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔹 P3 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-15: every step closed and the Check met.

| | |
|---|---|
| **Issue** | Owner request 2026-11-05: the base should keep a log of what happened ("today we established connection with Tabgha"), in Eva lore or in two versions. The ledger is evidence, not a story; Instrumentality summarises the owner's conversations, not the agency's own milestones. |
| **Reproduce** | Look for a record of when Tabgha joined, the first relayed request or the first pilot: only scattered events. |
| **Check** | One entry per day, built only from recorded facts (bases enrolled or online for the first time, a new main base, pilots created or promoted, the first action run on another base, outages and recoveries; bugs closed left out by owner decision 2026-11-12), never invented; two versions by theme: Simple, plain and without a model; Eva, the same facts retold in the lore voice by a *Chronicler* pilot (Fuyutsuki), a writer only, starting at Proto, its text checked to name only the day's facts; shown as a Chronicle tab, with an optional line in the morning brief; each entry links its sources (sortie IDs, registry records). |

<details>
<summary>Next action, estimates and evidence</summary>

**Owner decisions, 2026-11-12:** (1) F-054 starts now, ahead of the rest of F-021 (F-021-T02 to T05 stay open): F-021 is no longer a prerequisite. (2) Facts the agency does not store today (a base online for the first time: only `last_seen` is kept; outages and recoveries: route and base health live in memory; pilot promotions: a stage change is a hand edit of config.json) are recorded from now on, without backfill: new step F-054-T04. (3) Bugs closed are left out: they live in the git backlog, not in the agency's data, and the running service does not read its development repository.

**F-054-T01, 2026-11-12 ([PR #301](https://github.com/voidbrain/nerv/pull/301)):** `src/chronicle.ts` builds the Simple chronicle without a model: one entry per local day (owner's time zone), only days with something recorded, each line with its source (`registry:<record id>` or a sortie's short ID). Facts: base enrolled, enrolled again, revoked and named main (signed registry records under the pinned root, dated by their signed `issued` time), pilot created (an approved `pilots.create` that ran), and per base the first remote action that ran without an error. `chronicle [DAYS]` prints it (last 30 days by default), in English or Italian. Evidence: `test/chronicle.test.ts` (day grouping across midnight in Rome, no entry for empty days, unreadable times and unknown kinds left out, both languages, and a join test across Store, Ledger and Registry: only the approved pilot, the first remote action that ran (not a failed, a later or a waiting one), registry sources equal to the stored record IDs, then the CLI command). Dashboard tab and brief line are F-054-T03.

**Reconcile 2026-11-12 ([PR #306](https://github.com/voidbrain/nerv/pull/306)):** [PR #305](https://github.com/voidbrain/nerv/pull/305) merged into main `5700ccf`; its CI [43232448595](https://github.com/voidbrain/nerv/actions/runs/43232448595) passed all five jobs. F-054-T04 closed (1 h agent, stated, against 1.5 h). F-054 stays Open: F-054-T02 and F-054-T03 are planned.

**F-054-T04, 2026-11-12 ([PR #305](https://github.com/voidbrain/nerv/pull/305)):** `src/milestones.ts` keeps an append-only `milestones` table (additive, no schema version change; update and delete refused by triggers), recorded from now on with no backfill: a base heard of for the first time (`Registry.seen`, only when no last-seen time was stored for it under any root), another base unreachable after a full online window of missed heartbeats and back on its next answer (`KajiLink.mark` → `milestones.health` in the nervous process), a model route down and back (`Runtime.logRoutes`, once a minute from the brain's route health, so a flap shorter than the poll is not recorded), and a pilot promoted to a later stage by `pilots set ID --stage …` (a demotion or another edit is not). Only a change adds a row, and a report not newer than the last one for that subject is ignored, so repeats and restarts add nothing. The chronicle shows them with source `milestone:<row id>`, in English and Italian. Evidence: `test/milestones.test.ts` (rules, append-only, no backfill, and three joins: Kaji link → runtime → nervous process → chronicle; brain route health → runtime → chronicle; `pilots set` → `chronicle` CLI).

**Next action / closure evidence:** Closed 2026-11-15 in the backlog reconciliation: every step closed on green CI ([PR #443](https://github.com/voidbrain/nerv/pull/443)). Planned 2026-11-05 (owner: yes, after F-021; superseded 2026-11-12, see above). Builds on the ledger, the Gehirn registry, F-045 (pilots) and F-028 (the brief).

**Estimates:** Medium remaining effort. Estimated 2026-11-05. Reassessed 2026-11-07: explicit prerequisite outcomes preserve the existing scope and remaining-work estimate; independent slices can proceed.

| Field | Value |
|---|---|
| Depends on | [F-045](#f-045) — Chronicler pilot for the Eva narrative; plain fact collection can proceed |
| PR / evidence | [PR #305](https://github.com/voidbrain/nerv/pull/305) F-054-T04 milestones (src/milestones.ts, test/milestones.test.ts); [PR #301](https://github.com/voidbrain/nerv/pull/301) F-054-T01 Simple chronicle (src/chronicle.ts, test/chronicle.test.ts); [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #187](https://github.com/voidbrain/nerv/pull/187) reviewed prerequisite links;  Owner request 2026-11-05 |
| Opened | 2026-11-05 |
| Verification | 2026-11-15, Script: merged PR CI green (#443); every step closed. |
| Reviewed | 2026-11-15 |

</details>

---

### F-064

**Bounded incident circuits instead of a global kill switch**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔹 P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-15: every step closed and the Check met.

| | |
|---|---|
| **Issue** | Preserved proposal 3 of the [architecture reassessment](../audits/2026-11-06-architecture-reassessment.md#3-automatic-incident-response-bounded-circuits-before-a-global-kill-switch): Spear revokes unused grants and stands down approvals by hand, but nothing detects an incident, interrupts in-flight work or responds automatically. A global automatic revocation would itself risk an outage. |
| **Reproduce** | Inject a fault (a tool repeatedly failing, a tainted input reaching an external-effect action): nothing changes until the owner spears the sortie. |
| **Check** | One circuit first, with a written trigger → response table: stop new work in the affected scope, revoke its unused grants, keep evidence, one deduplicated alert, explicit rearm. Injected faults revoke only the intended authority and keep recovery access; benign input never trips it; model suspicion is a signal for review, never authority to stop every base. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-15 in the backlog reconciliation: every step closed on green CI ([PR #445](https://github.com/voidbrain/nerv/pull/445)). F-064-T01 closed 2026-11-13: the owner accepted the first circuit: on one channel, repeated Blue action attempts from tainted input trip it; its response reuses the Spear of Longinus on every open sortie of that channel (revoke unused grants, stand down pending approvals, close the sortie) and adds what the Spear lacks: it stops new work on the channel, keeps the evidence, sends one deduplicated alert, and only the owner rearms it. Like the Spear, it cannot undo effects that already ran; it reports them. A global kill switch and model-only shutdown stay rejected. Proposed 2026-11-06; not accepted scope until the owner picks the first circuit. The reassessment also notes that Spear does not stop an already-running external operation or run inverses; interruption and compensation stay explicit, separately authorized work, not part of a first circuit. Related F-023 (approvals) and the closed F-024 ledger. Design input 2026-11-07: the OWASP [Agent Control Standard](https://github.com/GenAI-Security-Project/agent-control-standard) v0.1.0 (a Guardian that allows, denies or modifies each tool call, deterministic layer first, optional model layer without the policy source) mirrors the MAGI gate; its reference Guardian fails open by default and its wire is not yet authenticated, so it is a comparison point for trigger and rearm vocabulary, not a component to adopt. Threat-map row ASI08 (cascading failures) points here (F-065, [PR #179](https://github.com/voidbrain/nerv/pull/179)).

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 3 open steps total 3.25 h agent + 0.25 h owner (steps table; each task basis gives old → new). Figures after this sentence are dated history. Medium for one bounded circuit; large for a cross-base incident coordinator. Set 2026-11-06.

| Field | Value |
|---|---|
| PR / evidence | [PR #380](https://github.com/voidbrain/nerv/pull/380) [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #172](https://github.com/voidbrain/nerv/pull/172) record and roadmap placement; [Architecture reassessment](../audits/2026-11-06-architecture-reassessment.md), 2026-11-06 |
| Opened | 2026-11-06 |
| Verification | 2026-11-15, Script: merged PR CI green (#445); every step closed. |
| Reviewed | 2026-11-15 |

</details>

---

### F-065

**Agentic threat map: each OWASP risk tied to a NERV control and the test that proves it**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔶 P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-15: every step closed and the Check met.

| | |
|---|---|
| **Issue** | The gate, grants, Lilith, the Kaji line and the tools process already answer most published agentic risks, but nothing maps them: a reviewer cannot see which risk a control covers, which risk has no control, or which claim no test backs. The [architecture reassessment](../audits/2026-11-06-architecture-reassessment.md#3-automatic-incident-response-bounded-circuits-before-a-global-kill-switch) cites only OWASP's prompt-injection cheat sheet. |
| **Reproduce** | Ask which NERV test covers OWASP ASI08 (cascading failures) or LLM06:2026 (unbounded consumption): no document answers, and the honest answer today is none. |
| **Check** | One row per risk from the [OWASP Top 10 for Agentic Applications](https://genai.owasp.org/initiatives/agentic-security-initiative/) (ASI01–ASI10), the [LLM Top 10 2026](https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/) (LLM01–LLM10) and the [MCP Top 10](https://owasp.org/www-project-mcp-top-10/) (MCP01–MCP10, beta), each citing version-pinned [AISVS](https://github.com/OWASP/AISVS) requirements (`v1.01-C<chapter>.<section>.<req>`, mainly C5, C8, C9, C10, C12), the NERV control (source path) and a test name, or "gap" with the owning record. A tool run in CI fails when a cited test does not exist or a row is neither tested nor a named gap. Not-applicable rows say why (LLM09: no embeddings, Lilith uses FTS5). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-15 in the backlog reconciliation: every step closed on green CI ([PR #435](https://github.com/voidbrain/nerv/pull/435), [PR #444](https://github.com/voidbrain/nerv/pull/444)). Proposed 2026-11-07 from an OWASP standards review in the session (Agentic Top 10, LLM Top 10 2026, MCP Top 10, AISVS 1.01, Agent Control Standard). Known gaps to land as rows: ASI08 cascading failures (F-064), LLM06:2026 unbounded consumption (F-063), credential rotation (F-066). Candidate gap to verify first: MCP results flowing into later prompts (LLM08:2026 hidden context exposure, MCP10). Map, not certification: a row says what a test shows, never that the risk is gone.

**Accepted assessment 2026-11-09:** [execution boundaries](../reviews/2026-11-09-execution-boundaries.md). Map the deterministic runner/warden controls (F-049), protected grading and artifact-bound promotion (F-006), and existing grant/recovery safeguards to actual tests or named gaps. No new LLM security authority, compliance claim or separate security project follows.

**Retained test references 2026-11-09:** [external-project assessment](../reviews/2026-11-09-external-agent-projects.md): AgentDojo hostile tool-output families can inform versioned NERV attack/defense cases. Map observed controls to actual tests or named gaps; a benchmark pass is neither certification nor proof of F-049 confinement.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 2 open steps total 2 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Medium: the document is a day; the test-name check is small. Set 2026-11-07.

| Field | Value |
|---|---|
| PR / evidence | [PR #242](https://github.com/voidbrain/nerv/pull/242) retains/supersedes PR241 and adopts diagnostics;  Reference/operator documentation: [PR #241](https://github.com/voidbrain/nerv/pull/241); Assessment: [PR #231](https://github.com/voidbrain/nerv/pull/231);  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #179](https://github.com/voidbrain/nerv/pull/179) record and roadmap placement |
| Opened | 2026-11-07 |
| Verification | 2026-11-15, Script: merged PR CI green (#435, #444); every step closed. |
| Reviewed | 2026-11-15 |

</details>

---

### F-077

**Dependency and code alerts, a Node 26 CI job and a dependency refresh**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔹 P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-15: every step closed and the Check met.

| | |
|---|---|
| **Issue** | Proposed by the full audit of 2026-11-06 and never decided or tracked: Dependabot alerts are disabled and no code-scanning analysis exists; CI tests Node 24 while the bases run Node 26. On 2026-11-13 `npm outdated` lists `@anthropic-ai/sdk` 1.1.0 (1.8.0 out), Angular 22.2.4 (22.2.6) and TypeScript 6.0.3 (7.0.2, a major). |
| **Reproduce** | `gh api repos/voidbrain/nerv/dependabot/alerts` (403 disabled), `gh api repos/voidbrain/nerv/code-scanning/alerts` (404 no analysis), `npm outdated`, `node-version` in `.github/workflows/ci.yml`. |
| **Check** | Each chosen option is in place: alerts on and read in the next audit; a Node 26 job green in CI; patch and minor updates applied with the full suite and build passing. Options not chosen are recorded as declined. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-15 in the backlog reconciliation: every step closed on green CI ([PR #446](https://github.com/voidbrain/nerv/pull/446)). F-077-T01: on 2026-11-13 the owner adopted (a) Dependabot alerts and (b) code scanning, and declined (c) the Node 26 CI job. The agent's attempt to turn both settings on was refused by its sandbox, so the owner was given the [steps](../acceptance/f077-security-settings.md). F-077-T01 closed 2026-11-13: after the owner's explicit approval the agent turned both on (vulnerability-alerts 204; CodeQL default setup started run 43485629624). F-077-T02 can go ahead without it.

**Estimates:** Small, estimated 2026-11-13. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #379](https://github.com/voidbrain/nerv/pull/379) [PR #377](https://github.com/voidbrain/nerv/pull/377) [PR #374](https://github.com/voidbrain/nerv/pull/374) [full audit 2026-11-13](../audits/2026-11-13-full.md) |
| Opened | 2026-11-13 |
| Verification | 2026-11-15, Script: merged PR CI green (#446); every step closed. |
| Reviewed | 2026-11-15 |

</details>

---

### F-080

**Peer-facing handlers move out of the serve wiring into a tested module**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔹 P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-15: every step closed and the Check met.

| | |
|---|---|
| **Issue** | `onRelay`, `onDecide`, `onChat` and `onSortie`, which decide what another base may read or do, are defined inline in the `serve` command of `src/cli.ts` (lines 1431–1458). That makes the composition root hold peer policy, testable only through a cross-base run; the F-051 sortie-scope question sat there ([architecture reassessment](../audits/2026-11-13-architecture-reassessment.md), finding 5). |
| **Reproduce** | Read `src/cli.ts` `serve`. |
| **Check** | The handlers live in a module under `src/` with unit tests for each refusal and success path; `serve` only wires them; behaviour does not change (the existing cross-base tests pass unchanged). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-15 in the backlog reconciliation: every step closed on green CI ([PR #431](https://github.com/voidbrain/nerv/pull/431)). 2026-11-15: F-080-T01 closed with `createPeerHandlers` in `src/peer-handlers.ts`, `serve` wiring in `src/cli.ts`, and unit/cross-base tests (`test/peer-handlers.test.ts`, `test/kaji-link.test.ts`, `test/one-channel.test.ts`) passing. Proposed by the [architecture reassessment of 2026-11-13](../audits/2026-11-13-architecture-reassessment.md); a split of `src/runtime.ts` is deferred there.

**Estimates:** Small, estimated 2026-11-13: 0.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #377](https://github.com/voidbrain/nerv/pull/377) [Architecture reassessment 2026-11-13](../audits/2026-11-13-architecture-reassessment.md) |
| Opened | 2026-11-13 |
| Verification | 2026-11-15, Script: merged PR CI green (#431); every step closed. |
| Reviewed | 2026-11-15 |

</details>

---

### F-096

**Fewer tokens per run: quiet test output and short records**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔶 P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-15: every step closed and the Check met.

| | |
|---|---|
| **Issue** | Owner request 2026-11-14: prefer fewer tokens to less time. A passing `npm test` prints 103k characters (about 26k tokens) for 744 tests; Node's dot reporter prints 786 but alone drops the totals, test names and what tests log. npm adds `npm notice run …` lines to each script. F-005 holds 28 KB of dated evidence and F-051 13 KB, re-read whenever the record is touched. |
| **Reproduce** | `npm test 2>&1 \| wc -c`; `wc -c docs/work/records/*.md \| sort -n \| tail`. |
| **Check** | `npm test` prints dots, every failure in full and the totals, and writes the complete spec report to an ignored file (a test proves a failure and a test's log are kept); `.npmrc` sets `loglevel=warn`; F-005 and F-051 keep their current state and recent evidence, and older dated evidence moves to the archive with a link back, every line preserved; characters before and after recorded. Uses the harness quiet reporter (project-harness F-077-T02) when released; until then a local reporter with the same behaviour. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-15 in the backlog reconciliation: every step closed on green CI ([PR #439](https://github.com/voidbrain/nerv/pull/439)). 2026-11-15: F-096-T02 closed with older evidence moved verbatim to [2026 evidence archive](../archive/evidence-2026.md) (`docs/work/records/F-005.md`: 27,936 bytes / 113 lines -> 7,943 bytes / 50 lines; `docs/work/records/F-051.md`: 12,793 bytes / 36 lines -> 5,840 bytes / 36 lines). Opened 2026-11-14 at the owner's request; pairs with project-harness F-077 (token-lean outputs) and F-076 (rule load).

**Estimates:** Small, estimated 2026-11-14: 1 h agent over two steps. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #393](https://github.com/voidbrain/nerv/pull/393) (opened) |
| Opened | 2026-11-14 |
| Verification | 2026-11-15, Script: merged PR CI green (#439); every step closed. |
| Reviewed | 2026-11-15 |

</details>

---

### F-095

**Source files small enough for an agent to read whole: split runtime.ts first, warn at 600 lines**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🔴 Large |

💻 **→ Human action required: No**<br />Closed 2026-11-15; all six tasks complete.

| | |
|---|---|
| **Issue** | Owner question 2026-11-14: are code files too long for agent context? `src/` has 29.7k lines; 7 files exceed 1,000 lines. `src/runtime.ts` is 2,965 lines (123 KB, about 30k tokens by characters ÷ 4), more than all the always-loaded and backlog rules together; then `node-lifecycle-execution.ts` 1,766, `cli.ts` 1,515, `store.ts` 1,504, `ledger.ts` 1,381, `pilots.ts` 1,117, `rpc.ts` 1,112. An agent either spends a large part of its context on one file or reads it in pieces and misses connections. The [2026-11-13 architecture reassessment](../../audits/2026-11-13-architecture-reassessment.md) deferred a `runtime.ts` split until repeated conflicts or a defect; agent context cost is new evidence it did not weigh. |
| **Reproduce** | `wc -l src/*.ts \| sort -n \| tail`. |
| **Check** | A warn-only check lists source files over 600 lines; `runtime.ts` is split along its responsibilities (for example job admission, approvals and resume, worker dispatch, routing) and `store.ts` per table group, then the other files over 1,000 lines; behaviour does not change: the existing tests pass unchanged and no public export changes meaning; `cli.ts` follows F-080. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-15 in [PR #478](https://github.com/voidbrain/nerv/pull/478): `src/cli.ts` is 893 lines, `src/runtime.ts` 985, and `src/server.ts` 923; the PR confirms no public export changes, and all CI jobs including the full suite passed. F-095-T06 is closed; all six tasks are complete. F-095-T01 closed with dated addendum in `docs/audits/2026-11-13-architecture-reassessment.md` recording context-cost measurements (`wc -lc`), reversing the `runtime.ts` deferral, and naming target modules for `src/runtime.ts` and `src/store.ts`. Opened 2026-11-14 at the owner's request. F-095-T01 revisits the reassessment's deferral with the context-cost evidence before any code moves. Pairs with the harness record on loading rules top-down (project-harness F-076).

**Estimates:** Large, estimated 2026-11-14: 5.5 h agent over six steps, mechanical moves with unchanged tests. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #478](https://github.com/voidbrain/nerv/pull/478) (merged; CI green); [PR #391](https://github.com/voidbrain/nerv/pull/391) (opened); — |
| Opened | 2026-11-14 |
| Verification | `F-095-T02` verified via `tools/check-source-sizes.mjs`, `test/source-sizes.test.ts`, `tsc`, and `check:fast`. `F-095-T03` split `src/runtime.ts` (3,399 -> 1,015 lines) into 10 modules all under 600 lines (`runtime-api.ts`, `runtime-approvals.ts`, `runtime-bases.ts`, `runtime-chat.ts`, `runtime-dispatch.ts`, `runtime-instrumentality.ts`, `runtime-peers.ts`, `runtime-pilots.ts`, `runtime-planning.ts`, `runtime-routes.ts`), verified with `npm run typecheck`, `npm run check:fast`, `npm test`, and fresh-context review. `F-095-T04` split `src/store.ts` (1,619 -> 570 lines) into 6 table-group modules all under 600 lines (`store-watch.ts`, `store-reminders.ts`, `store-push.ts`, `store-kaji-outbox.ts`, `store-inbox.ts`, `store-sorties.ts`) sharing `sqlite-transaction.ts`, verified with `npm run typecheck`, `npm run check:fast`, and `npm test`. `F-095-T05` split `src/node-lifecycle-execution.ts` (2,076 -> 662 lines into `node-lifecycle-apply.ts`, `node-lifecycle-mac.ts`, `node-lifecycle-linux.ts`, `node-lifecycle-windows.ts`), `src/ledger.ts` (1,401 -> 821 lines into `ledger-queries.ts`, `ledger-approvals.ts`), `src/pilots.ts` (1,204 -> 587 lines into `pilots-qualification.ts`), and `src/rpc.ts` (1,114 -> 227 lines into `rpc-schemas.ts`), leaving `src/cli.ts` to `F-080`, verified with `npm run typecheck`, `npm run check:fast`, and `npm test`. `F-095-T06` verified in PR #478: `cli.ts` 893, `runtime.ts` 985, `server.ts` 923 lines; existing tests passed unchanged, no public exports changed, full CI passed. |
| Reviewed | 2026-11-16 |

</details>

---

<a id="archive-week-2026-11-16"></a>
## Closed 2026-11-16

### F-104

**Architecture and token cost compared with outside systems**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-16; all three steps complete.

| | |
|---|---|
| **Issue** | Owner request 2026-11-15: compare NERV's architecture, structure and functions with frontier and similar agent systems (concepts to keep, integrate or reject, at what level, why and why not), and look outside for better token-cost techniques. The procedure exists (`docs/agents/architecture-review.md`) but has not been run with an outside comparison; the harness cadence for it is the template's work. |
| **Reproduce** | Read `docs/audits/`: the 2026-11-13 reassessment has no outside comparison. |
| **Check** | A dated report under `docs/audits/` with a web-sourced comparison table (concept, source, adopt / adapt / reject / watch, level, why) and a token-cost section from measured usage; each adopt or adapt becomes a backlog record and each decision a decision record; nothing changes architecture without its own record. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-16 in [PR #502](https://github.com/voidbrain/nerv/pull/502). F-104-T01 ([PR #487](https://github.com/voidbrain/nerv/pull/487)) and F-104-T02 ([PR #488](https://github.com/voidbrain/nerv/pull/488)) delivered the two reports (`docs/reviews/architecture/2026-11-16.md`, `docs/reviews/token/2026-11-16.md`, moved there from `docs/audits/` so the periodic review windows see them), both merged on green CI. F-104-T03, the owner's review of 2026-11-16: accepted deferred domain tool loading and prompt-prefix stability, measured first (new record F-106); declined SQLite step-boundary checkpoints (only matters once F-048-T04's multi-step orchestration exists; revisit there) and A2A task-state naming over Kaji (cosmetic unless NERV federates with outside agents, which is not planned); archiving over-budget evidence is housekeeping `check:freshness` already lists, no record. The architecture report mostly reconfirmed existing decisions; the token report asserts cost pressure without a measurement, hence F-106-T01 measures first. Two more records came out of the same review session: F-105 (a PR names itself in a record, or CI fails) and B-069.

**Estimates:** 3.5 h agent + 0.5 h owner in three steps. Estimated 2026-11-15. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #487](https://github.com/voidbrain/nerv/pull/487) F-104-T01; [PR #488](https://github.com/voidbrain/nerv/pull/488) F-104-T02 (both merged; CI green); owner review 2026-11-16 in [PR #502](https://github.com/voidbrain/nerv/pull/502) |
| Opened | 2026-11-15 |
| Verification | 2026-11-16: both reports merged on green CI (#487, #488); the owner's decisions recorded above. Closed 2026-11-16. |
| Reviewed | 2026-11-16 |

</details>

---

## Closed 2026-11-18

### F-023

**Misato's apartment: approval cards with TTL, delivered by Pen Pen**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18: Verified 2026-11-15 by the owner on the paired Mac; archived at the 2026-11-18 reconciliation.

| | |
|---|---|
| **Issue** | Blue actions and low Sync Ratio need the owner. Without full content an approval is a rubber stamp; without a TTL a sleeping owner stalls the sortie. |
| **Reproduce** | Follow the [paired Mac approvals procedure](../../acceptance/f023-native-approvals-procedure.md) (create a Blue approval; approve, reject, edit, or leave it to expire; repeat the decision; restart NERV Agency while pending). |
| **Check** | Card shows action, arguments/diff/recipients, Pattern, Sync Ratio and inputs, reason and remaining TTL; expiry stands down (never approves); a decision is applied once and is idempotent on repeat; pending cards survive restart; the decision and its source are written to Central Dogma; Pen Pen delivery reuses the inbox and later Telegram/native notifications. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** F-023-T04 passed 2026-11-15 (owner, paired Mac; [PR #458](https://github.com/voidbrain/nerv/pull/458)): a Blue card (a reminder on NERV-02) raised one macOS banner; the companion card showed tool, arguments, Pattern, Sync Ratio, reason and TTL, read-only, opening the web workspace without a token; VoiceOver announced labels, countdown and buttons; deciding it removed the card from the companion with no repeat banner. T03 accepted 2026-11-09: [durable approval delivery acceptance](../../acceptance/native-approval-delivery-2026-11-09.md). Each Store proposal and generic inbox notice commit together; a separate additive identity table backfills pending cards once, preserving reminder/brief rowids. Native notifications use the existing persisted cursor and OS identifiers, validate notice identity/expiry and skip settled/expired cards. Telegram consumes the notice cursor without sending a duplicate card. Existing read-only credentials and dashboard/Telegram decision authority remain. Fresh-context review found no blocking runtime/security findings; one stale architecture sentence was corrected. PR232 exact head1b23c68 / CI42588026092 passed all five jobs including full-suite; merged maincdb4f6. T03 is closed; actual menu/VoiceOver/banner acceptance remains an owner action, not a fixture pass.

T02 implemented 2026-11-09: [bounded native cards acceptance](../../acceptance/native-approvals-2026-11-09.md). Pinned HTTPS previews preserve complete arguments, verdicts and Sync inputs; local countdown disables expired review, polling removes decided cards and failed reads clear stale state. Existing dashboard/Telegram paths decide; native credentials remain read-only. Static EN/IT renders inspected, Swift/TLS fixtures and 460 Node tests pass (two platform skips), ad-hoc package builds. PR #229 exact head f3109c1 merged main5933855; CI42584230832 passed plan, validate, Windows, native-macos and full-suite. T02 is closed. T03 implementation and its remaining acceptance are recorded above; actual menu/VoiceOver/banner acceptance stays separate.

2026-11-09 T01: [native approval authority contract](../../decisions/native-approvals.md) chooses read-only preview and the existing dashboard owner decision path. Paired credentials cannot decide or mint sessions; no admin/token URL handoff. That contract did not itself implement cards; T02 implementation evidence is recorded above. T03 implementation is recorded above; live acceptance remains separate.

Telegram delivery in [PR #32](https://github.com/voidbrain/nerv/pull/32): each pending card is sent once to the owner's chat with Approve once / Reject buttons; a tap applies `Store.decide` (source `telegram`), runs the tool once and removes the buttons; expiry still never approves. Implemented in [PR #8](https://github.com/voidbrain/nerv/pull/8) (gate, ledger, approvals): approval cards (action, args, effect, Pattern, Sync Ratio and inputs, verdicts, reason, TTL), once-only decisions, TTL expiry on scheduler ticks, survival across restart, CLI `approvals`/`approve`/`reject`. API added in [PR #9](https://github.com/voidbrain/nerv/pull/9) (approvals API): `GET /api/approvals` (read-only clients and socket), `POST /api/approvals/ID` (admin, REST only; grant ID never returned). Current remaining delivery acceptance is recorded above; edit returns through the existing agent loop (F-003). Original plan: Approval table and decision transitions in `src/store.ts`, API/CLI to list and decide, then Telegram buttons via F-003. Edit returns the action to the planner rather than changing it in place.

**Estimates:** Small remaining effort, reassessed 2026-11-09: delivery code, final full CI and fresh-context review are accepted; one focused owner Mac interaction/permission/banner/VoiceOver session remains. Actual OS permission/device findings may widen this estimate.

| Field | Value |
|---|---|
| PR / evidence | Acceptance reconcile: [PR #233](https://github.com/voidbrain/nerv/pull/233); T03: [PR #232](https://github.com/voidbrain/nerv/pull/232); Review: [fresh-context report](../../reviews/2026-11-09-native-approval-delivery.md), no blocking findings, stale documentation corrected; Test: test/approval-delivery.test.ts (committed failing contract 1a878ac), native TLS/notification and Telegram joins;  [PR #230](https://github.com/voidbrain/nerv/pull/230) T02 full-CI acceptance, T03 ready; [PR #229](https://github.com/voidbrain/nerv/pull/229) T02 bounded native cards and HTTPS authority join; [PR #228](https://github.com/voidbrain/nerv/pull/228) T01 native authority contract; [PR #220](https://github.com/voidbrain/nerv/pull/220) task/capability and evidence reconciliation; 2026-11-08: [authored task capability requirements](../README.md#active-task-capability-requirements); no model qualification or feature acceptance claimed; [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan); [PR #8](https://github.com/voidbrain/nerv/pull/8) (gate, ledger, approvals); [PR #9](https://github.com/voidbrain/nerv/pull/9) (approvals API) |
| Opened | 2026-11-02 |
| Verification | 2026-11-09 Unit/integration: PR232 exact head1b23c68, CI42588026092 passed plan, validate, Windows, native-macos and full-suite, merged maincdb4f6. Linux Node467: 466 passed, one platform skip; headless three passed, one Windows skip. Native TLS/Swift and packaging passed in CI; local final Swift/TLS20/20 passed. Browser/accessibility passed in full CI. Human/real-device: actual menu/VoiceOver/banner/sleep acceptance pending. Review: fresh-context report found no blocking issue; stale documentation corrected. |
| Reviewed | 2026-11-09 |

</details>

---

### F-081

**Native pairing: recovery on the service host with its profile stopped, and the stale client of 2026-11-07**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18: Verified 2026-11-15; archived at the 2026-11-18 reconciliation.

| | |
|---|---|
| **Issue** | Split from F-015 when it closed on 2026-11-13. F-015's live trials (T02, T03) ran on an isolated profile; stopped-profile recovery on the host that runs the live service was deferred until the owner chooses that host. T02 also left a 2026-11-07 native client unrevoked on the live service. |
| **Reproduce** | `npm start -- clients` on the live service lists the 2026-11-07 client; the [renewal and recovery guide](../../../native/README.md#renew-an-unexpired-native-credential) is so far verified only on an isolated profile. |
| **Check** | The stale client is revoked and the companion still works; on the service host, the stopped-profile rotation in native/README.md keeps the profile's data, gives a new identity and pin, and the companion recovers by pairing again; evidence recorded. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** F-081-T01 passed 2026-11-15 ([PR #459](https://github.com/voidbrain/nerv/pull/459); owner, Neo Tokyo-3, part D of the companion live checks): with the companion and service stopped, the data home was backed up and only the native TLS/auth set (native-cert, native-key, native-tls.cnf, native-auth.sqlite) moved to a private recovery folder; `native-init` and a service start gave a new identity and pin; after forgetting and pairing again, `clients` lists only the new client and the reminders are unchanged. The 2026-11-07 client was not revoked one by one: replacing native-auth.sqlite invalidated every earlier client. F-081-T02 closed the same day (this evidence). F-081-T01. Split from F-015 (archived 2026-11-13).

**Estimates:** Small, estimated 2026-11-13: 0.25 h agent + 0.5 h owner. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #380](https://github.com/voidbrain/nerv/pull/380) [F-015 live failure evidence](../../acceptance/f015-live-failures-2026-11-12.md) |
| Opened | 2026-11-13 |
| Verification | Pending. |
| Reviewed | 2026-11-13 |

</details>

---

### B-071

**Owner steps shown under 💻 and without their procedure link (F-005-T15, F-007-T05, F-060-T01, F-078-T05)**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18; verified by the green CI of PR #504.

| | |
|---|---|
| **Issue** | Found 2026-11-18 by the owner, the third or fourth time: F-005 said "💻 Next: F-005-T15 … (Implemented; verification pending)" while only the owner's trial remained, and its 🧑‍🔧 had no link. Causes: the harness `work-items.mjs` kept the authored 💻 whatever the next step's actor; its missing-`ownerLink` report skipped implemented steps and was only a warning (F-007-T05 and F-060-T01 had been warned about, unlinked); and 33 open records carried hand-written Next sentences that drifted as steps changed (F-060 and F-078 said 💻 for an owner step; F-078's source said 💻 with "Procedure"). |
| **Reproduce** | On `main` before the fix: `npm run work:build` and read F-005, F-060 and F-078; `npm run check:work` exits 0. |
| **Check** | Harness 10.0.0 (B-047 in the template, test committed failing first): the Next line is 🧑 with the step's linked page when the next step is the owner's and no agent step can start; `check:work` fails on an owner-turn step without `ownerLink`. Every open record here uses `Next: from tasks.`; the four owner steps link a copy-paste page. |
### B-049

**Misato invents a reminder title instead of asking, when an Italian request gives none**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18; every step verified on green CI.

| | |
|---|---|
| **Issue** | Found 2026-11-12 in the owner-approved B-021 real-model run (gemma4:12b, local): for `Imposta un promemoria per il primo gennaio 2031 alle 09:00 UTC.` (no title), Misato proposed `reminders.add` with an invented title (`Promemoria`, `Promemoria per il primo gennaio 2031`) instead of asking. The prompt for this case is byte-identical to main before B-021's change. The same case passed on 2026-11-08. Misato's prompt already says never to invent a title. |
| **Reproduce** | `npm run evals:model -- --role=misato --model=gemma4:12b --limit=4` (case `italian-missing-title` in evals/planner-v1.json), or the probe of the same case; 2 of 5 attempts asked on 2026-11-12. |
| **Check** | A request without a title gets a question in the request's language, never an invented title; measured on the frozen case over repeated runs with its rate recorded, and any deterministic guard covered by a test. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18: every acceptance check is automated and passed in the CI of [PR #504](https://github.com/voidbrain/nerv/pull/504) (run green: plan, validate, windows, native-macos). Review: fresh-context review of the template change in project-harness PR #217, cited in #504; the project side was records and owner pages. Test: template `tools/test-work-items.mjs` "Next line: when the next step is the owner's…", committed failing first in project-harness PR #217 (commit 619fe5a). Opened 2026-11-18. New owner pages: [F-005-T15](../../acceptance/f005-t15-forward-upgrade-trial.md) (runs only once a revision raises `readerSchema` above the live schema; both are 6 on 2026-11-18), [F-007-T05](../../acceptance/f007-t05-voice-corpus-procedure.md), [F-060-T01](../../acceptance/f060-t01-herdr-trial.md). Steps still waiting on agent work and without a page get it in the PR that finishes their last prerequisite; `check:work` now fails otherwise.

**Estimates:** Small, estimated 2026-11-18: 1.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #504](https://github.com/voidbrain/nerv/pull/504); [project-harness PR #217](https://github.com/voidbrain/project-harness/pull/217) |
| Opened | 2026-11-18 |
| Verification | 2026-11-18: CI on #504 green (`check:work`, `check:backlog`, `check:harness`). Closed 2026-11-18. |
**Owner approval 2026-11-12:** real-model reruns for B-049, at most 12 invocations and 60 minutes of model time, gemma4:12b on loopback Ollama, no cloud route and no paid usage (the same limits as B-021). State the exact cases before running. Not started (owner: finish current work first).

**Next action / closure evidence:** Classify the failure: model competence on gemma4:12b (a prompt or model change), or a deterministic guard (for example, a reminder title that occurs nowhere in the request or earlier exchanges goes back to Misato as invalid). Plan a fix with a failing case first. Real-model reruns need the owner's approval and budget.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 1 open step has 1.25 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Small: classification, a guard or prompt change with tests, and an owner-approved rerun. Estimated 2026-11-12, not a measurement.

| Field | Value |
|---|---|
| PR / evidence | PR #367: failing-first regression test (`3c48c46`) + fix in `src/misato.ts` (`validateReminderTitle` + explicit no-subject reminder prompt rule) and `src/runtime.ts` (rejects missing, generic/date-only, or ungrounded `reminders.add` titles back to Misato as `invalid`). Owner-approved loopback `gemma4:12b` rerun (2026-11-13, 4/12 invocations): 4 of 4 asked in Italian. Prior evidence: `docs/evaluations/2026-11-12-misato-b021.json`. |
| Opened | 2026-11-12 |
| Verification | Test: `test/misato.test.ts` (`validateReminderTitle`, PR #367). 2026-11-18: B-049-T01 verified: [PR #367](https://github.com/voidbrain/nerv/pull/367) merged on green CI (live rerun 4/4 recorded). Deterministic: `test/misato.test.ts`, `test/clarification.test.ts`, `test/consultant.test.ts`, `test/resume.test.ts`, `test/telegram.test.ts`, `test/watch-runtime.test.ts` (62/62 pass), `npm run typecheck`, `npm run check:fast`. Live model: 4/4 `gemma4:12b` on `127.0.0.1:11434` (`italian-missing-title`) asked in Italian. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-067

**Snapshot schedule test fails on Windows with EPERM removing its data folder**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18; every step verified on green CI.

| | |
|---|---|
| **Issue** | Found 2026-11-15 on [PR #451](https://github.com/voidbrain/nerv/pull/451) (CI 43748182800, Windows job, first attempt): `test/snapshots.test.ts` "the schedule takes the snapshot once and logs a failure by reason only, without paths" failed with `EPERM, Permission denied` on its fixture folder `nerv-snap-*`; the rerun passed and `main` passed with the same code, so it is intermittent. Likely cause, unconfirmed: cleanup removes the folder while a snapshot started by the schedule still holds a file open (Windows refuses), as in the earlier `nerv-winsvc-*` case in the archive. |
| **Reproduce** | Run `test/snapshots.test.ts` repeatedly on the Windows CI job; it fails now and then on the first attempt. |
| **Check** | A committed test fails first (for example by holding the snapshot in flight at `stop()`); `stop()` of the snapshot schedule waits for an in-flight snapshot, or the test awaits it before cleanup; 10 consecutive Windows runs of the file pass. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** B-067-T01 implemented in [PR #463](https://github.com/voidbrain/nerv/pull/463); its committed regression and the Windows/full-suite CI jobs passed. The acceptance still requires 10 consecutive Windows runs of `test/snapshots.test.ts`, so the task is not closed yet.

**Estimates:** Small, estimated 2026-11-15: 0.75 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #463](https://github.com/voidbrain/nerv/pull/463) (merged; CI green); [PR #451](https://github.com/voidbrain/nerv/pull/451) CI 43748182800 (Windows, first attempt) |
| Opened | 2026-11-15 |
| Verification | Test: `test/snapshots.test.ts` (PR #463). 2026-11-18: B-067-T01 verified: [PR #463](https://github.com/voidbrain/nerv/pull/463) merged on green CI (test/snapshots.test.ts passed in every Windows run since (20 clean first attempts; the 6 failed ones failed other tests)). Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-059

**Without a web build the browser evaluation case is recorded as a failure, not as an unmet requirement**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18; every step verified on green CI.

| | |
|---|---|
| **Issue** | 2026-11-13: in a fresh worktree without `dist/`, `node tools/gauntlet.mjs all --execute --allow-expensive` ran the `browser` case, which declares the `built-browser-assets` requirement, and recorded it in the ledger as a failed critical case ("Adapter incomplete, changed source or failing checks"). After `npm run build` it passed. A missing build is a setup gap, not a product failure; recording it as failed hides the real cause and could be read as a regression. |
| **Reproduce** | Fresh worktree, `npm ci`, no build; run the command above with a new `--out-dir`. |
| **Check** | When `dist/web/browser` is missing, the wrapper refuses the browser case (or builds first) and says which requirement is unmet; nothing is written to the ledger for it; a regression covers it. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** The wrapper now blocks an execution whose `built-browser-assets` requirement is unmet and leaves the ledger unchanged. Close after the full suite and required CI pass.

**Estimates:** Small, estimated 2026-11-13: a requirement check before execution and one test. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #390](https://github.com/voidbrain/nerv/pull/390) implementation; [PR #376](https://github.com/voidbrain/nerv/pull/376) found in F-075, 2026-11-13. Test: `B-059: browser case refuses a missing build without writing failed evidence`; committed failing in `4139150`, then passed without editing that regression. A separate build-present regression preserves the prior execution path. |
| Opened | 2026-11-13 |
| Verification | 2026-11-18: B-059-T01 verified: [PR #390](https://github.com/voidbrain/nerv/pull/390) merged on green CI. Unit/integration 2026-11-13: the focused missing-build and build-present regressions pass; full suite and CI pending. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### F-070

**Authenticated directory of base communication operators**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18; every step verified on green CI.

| | |
|---|---|
| **Issue** | Resolve tell Aoba on another base through configured operator aliases, without guessing from role labels or changing a destination silently. |
| **Reproduce** | Address an enrolled base by operator alias; rename it; exercise duplicate and unknown aliases. |
| **Check** | Explicit per-base configurable names/defaults; authenticated discovery; ambiguity asks for clarification; stale/unknown names fail safely; no private channel IDs exposed. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Define operator alias ownership and signed directory contract before changing routing. See [the source assessment](../../design/operator-flow-review-2026-11-07.md). Preserve observed communication separately from step activity; do not infer delivery or execution from a UI state.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 2 open steps total 2.75 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Medium remaining effort. Reassessed 2026-11-07: implementation and integration verification remain; no measured duration available.

| Field | Value |
|---|---|
| PR / evidence | [PR #368](https://github.com/voidbrain/nerv/pull/368) F-070-T01 and F-070-T02 implementation (`src/operator-directory.ts`, `src/config.ts`, `src/kaji-link.ts`, `src/runtime.ts`, `src/chat-command.ts`, `src/server.ts`, `test/operator-directory.test.ts`); [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; Owner report 2026-11-07; source assessment linked above |
| Opened | 2026-11-07 |
| Verification | 2026-11-18: F-070-T01 verified: [PR #368](https://github.com/voidbrain/nerv/pull/368) merged on green CI; F-070-T02 verified: [PR #368](https://github.com/voidbrain/nerv/pull/368) merged on green CI. Passed `node --test test/operator-directory.test.ts` (5/5), `npm test`, `npm run typecheck`, `npm run check:fast`. Pending CI and merge. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### F-048

**Parallel work: a visible queue, limits per model, a lock per item**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🔴 Large |

💻 **→ Human action required: No**<br />Closed 2026-11-18; every step verified on green CI.

| | |
|---|---|
| **Issue** | Owner questions 2026-11-05 on parallelism. Telegram requests run one at a time in order (a queue nobody sees); dashboard and CLI requests run side by side; within a sortie the pilot advises before Misato plans, and the seats vote in parallel; the real limit is the local model server (Ollama serves one model a few requests at a time and swaps models in and out of memory). Two sorties can act on the same item at once (edit and cancel the same reminder). |
| **Reproduce** | Send two requests on Telegram quickly; send two from the dashboard; edit a reminder in one while another cancels it. |
| **Check** | Each channel says when a request waits and behind how many ("queued, 2 ahead"); the dashboard shows queued and running sorties; a limit of concurrent model calls per model (a setting, from what the machine can hold) queues the rest instead of overloading; actions on the same item (a reminder, a fact) never run at the same time: the second waits for the first, then re-reads; tests cover the queue order, the limit and two actions on one item. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-16 (F-048-T04): written contract published in [specialist orchestration](../../decisions/specialist-orchestration.md) (states, limits, role separation, ordered dependencies, failure paths, resumable handoff history; no multi-step specialist execution claimed yet). Owner extension 2026-11-07: large plans need bounded chunking, separate coder/reviewer consultants, ordered dependencies, multiple review/refinement loops and resumable handoff history; define orchestration before claiming multi-step specialist execution.  Planned 2026-11-05 (owner).

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 3 open steps total 3.75 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Large remaining effort. Original Medium estimate dated 2026-11-05 is superseded by the expanded orchestration scope. Reassessed 2026-11-07: Large remains valid: chunking, multiple consultants and coder/reviewer handoffs need resumable orchestration and integration evidence.

| Field | Value |
|---|---|
| PR / evidence | [PR #462](https://github.com/voidbrain/nerv/pull/462); [PR #471](https://github.com/voidbrain/nerv/pull/471) (merged; CI green); [PR #372](https://github.com/voidbrain/nerv/pull/372) F-048-T01..T03 (visible bounded request queue, per-model budgets, per-item locks); [PR #220](https://github.com/voidbrain/nerv/pull/220) task/capability and evidence reconciliation; 2026-11-08: [authored task capability requirements](../README.md#active-task-capability-requirements); no model qualification or feature acceptance claimed; [Scoped architecture reassessment](../../audits/2026-11-08-architecture-reassessment.md), 2026-11-08; [PR #196](https://github.com/voidbrain/nerv/pull/196) remaining-effort reassessment;  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; Owner questions 2026-11-05 |
| Opened | 2026-11-05 |
| Verification | 2026-11-18: F-048-T01, F-048-T02 and F-048-T03 closed (were Verified). 2026-11-18: F-048-T04 verified: [PR #471](https://github.com/voidbrain/nerv/pull/471) merged on green CI. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-080

**Windows: every lifecycle command fails with "Lifecycle command could not start"**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18; verified on Tabgha.

| | |
|---|---|
| **Issue** | Found 2026-11-18 running F-005-T24 on Tabgha: `nodes lifecycle-inspect --action start` exited 1 with "Lifecycle command could not start." and wrote no plan. `command()` in `src/node-lifecycle-execution.ts` joined Node's folder to the child's `PATH` with `:`; on Windows the separator is `;`, so the first PATH entry was corrupted and `schtasks` was not found (`ENOENT`; `git` and `powershell` still started). CI never saw it: the Windows lifecycle tests inject their own runner. |
| **Reproduce** | On Windows, before the fix: `node --use-system-ca src/cli.ts nodes lifecycle-inspect --action start --out plan.json`. A spawn probe on Tabgha with NERV's environment gave `schtasks: spawn error ENOENT`; with `;` all three helpers started. |
| **Check** | Test committed failing first: `childPath` joins with `;` on win32 and `:` elsewhere; the lifecycle tests pass; on Tabgha a clone of the fix writes a start plan (exit 0, `execution: none`). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. Verified on Tabgha's own checkout after `git pull` to `7c027b5b`: `nodes lifecycle-inspect --action stop` exited 0 and wrote a plan, and the fenced install from the desktop completed (`definition`, `start`, `verify`). Review: fresh-context design review of PR #516 (2026-11-18): no blocking issues; its should-fix, a win32 `childEnv` test joining `command()`'s environment to the separator, is added in the B-077 PR. 2026-11-18: B-080-T01 implemented. Test: `test/node-lifecycle-execution.test.ts` "B-080: lifecycle commands put Node first on PATH with the platform separator" (committed failing first). Lifecycle tests 47/47. Live: a temporary clone of the fix on Tabgha ran `lifecycle-inspect --action start` with exit 0 and saved plan `034f5373…` (`execution: none`); its blockers were the expected ones for an unbuilt clone that is not the installed source; the clone was removed. Tabgha's own checkout (`C:\Projects\nerv` at `b8367586`) still has the bug, so its first fixed revision has to arrive by `git pull`, not by the lifecycle update. The change moved the system source key, so the seven `nerv-system-flows` cases were rerun on this branch: all passed at `91206f76bc85…` (ledger committed). Opened 2026-11-18.

**Estimates:** Small, estimated 2026-11-18: 0.75 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/node-lifecycle-execution.test.ts` B-080; Tabgha spawn probe and clone check 2026-11-18 |
| Opened | 2026-11-18 |
| Verification | 2026-11-18: CI green on PR #516; live on Tabgha (lifecycle-inspect exit 0, fenced install completed from the desktop). Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-069

**Open sortie re-asks an expired or rejected approval every hour, at night too**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Found 2026-11-16 by the owner: the Blue test card of 2026-11-15 22:32 ("Ricorda questo fatto di prova…", `memory.remember`, sortie `2683cff6`) came back on Telegram every hour through the night (23:42, 00:43, 01:44 … 09:12). The live store shows each card is a new approval on the same open sortie: every earlier one is `expired` (1 h TTL, source `ttl`) or `reject` (22:37, 22:39, 06:07), and the sortie never closes. The service did not restart (started 22:45, one run), so the overnight merges are unrelated. Likely cause, unconfirmed: after `approval.expired` or `approval.reject` the sortie stays open and the planner proposes the same step again with a fresh approval (`src/store-sorties.ts`, `src/ledger-approvals.ts` around line 103); and `deliverApproval` honours the quiet hours only for watch sorties (`src/store-sorties.ts` line 42), so ordinary cards go out at any hour. |
| **Reproduce** | `nerv chat "Ricorda questo fatto di prova: il drone di test si chiama Prova"`; leave the Telegram card unanswered: after 1 h a new card arrives; ❌ Reject gives a new card within two minutes. |
| **Check** | A committed test fails first: an expired or rejected approval does not produce a second approval for the same step; the sortie closes with a reply saying so; owner-initiated cards keep going out at any hour (there is no global quiet-hours setting, and the owner who just asked is awake; proactive cards already bundle overnight), so no quiet-hours change: the loop was the night problem; the owner repeats the reproduction and gets exactly one card. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. B-069-T02 run by the agent on the live service: `docs.save` produced exactly one approval card (Blue); after `nerv reject` and three minutes no second card, and the sortie closed with "Richiesta chiusa: hai rifiutato docs.save e non lo ripropongo." (events: one `approval.requested`, `approval.reject`, `misato.reply`, `sortie.done`). Note: the NERV-02 reminder text no longer makes a card (Misato granted it Green); the test reminder it created was cancelled. 2026-11-18: B-069-T02 moved from the owner to the agent. Owner decision 2026-11-18: the agent runs this itself (over SSH to nerv-linux or Tabgha, or the CLI on the Mac) and records the commands and output; the owner page stays as the procedure. B-069-T01 implemented 2026-11-16 in [PR #503](https://github.com/voidbrain/nerv/pull/503): on resume the owner's refusal or the expiry is recorded structurally (`ownerDeclined` in `src/misato.ts`), and the planning loop refuses in code any later proposal of that tool in the same sortie, closing it with a reply that names the tool and why (`src/runtime-planning.ts`, next to the "already ran" guard). Two tests in `test/resume.test.ts` fail without the fix (a second card after an expiry; after a rejection) and pass with it. Quiet hours left alone, see Check. Opened 2026-11-16 from the owner's report and the live store rows (approvals, actions, deliveries for sortie `2683cff6`). Next: the owner repeats the reproduction once the fix is live (one card, then a closing reply).

**Estimates:** Small, estimated 2026-11-16: 1 h agent + 0.25 h owner. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Owner report 2026-11-16; live store evidence 2026-11-16 (11 approvals on one sortie, all `ttl` or `reject`); opened in [PR #500](https://github.com/voidbrain/nerv/pull/500) |
| Opened | 2026-11-16 |
| Verification | 2026-11-18: B-069-T02 run by the agent on the live service: `docs.save` produced exactly one approval card (Blue); after `nerv reject` and three minutes no second card, and the sortie closed with "Richiesta chiusa: hai rifiutato docs.save e non lo ripropongo." (events: one `approval.requested`, `approval.reject`, `misato.reply`, `sortie.done`). Note: the NERV-02 reminder text no longer makes a card (Misato granted it Green); the test reminder it created was cancelled. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-070

**SBOM test fails locally on a fresh install: duplicate dependency entries from npm sbom**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Found 2026-11-16 while verifying B-069: `test/bom.test.ts` ("F-067: npm lock-only dependency SBOM validates…") fails on unmodified `main` in a worktree freshly installed with `npm ci` (Node 26.12, npm 10.8.2): `npm sbom --package-lock-only --sbom-format cyclonedx` returns 13 duplicate `dependencies` entries (e.g. `@inquirer/type@4.2.1` ×10, `ansi-styles@6.2.3` ×3), so the CycloneDX `uniqueItems` validation fails. The same lockfile in a checkout with an older `node_modules` gives no duplicates, and CI (Node 24) passes; removing `node_modules/.package-lock.json` does not change it. Cause unconfirmed: npm's SBOM output may depend on the installed tree or the Node version. **Cause (2026-11-18):** the nvm Node 26.12 install has a broken bundled npm (`npm-cli.js` missing), so `npm` is the old `/usr/local/bin/npm` 10.8.2, which lists packages reached through several paths more than once; the old checkout gives the same 13 duplicates with it, and npm 11 (Node 24.19, as in CI) gives none. |
| **Reproduce** | `git worktree add ../x origin/main && cd ../x && npm ci && node --test test/bom.test.ts`. |
| **Check** | The cause is named; either the SBOM export deduplicates `dependencies` before validation (a committed test with a duplicated entry), or the test pins the condition it needs; `npm test` passes on a fresh install under Node 24 and the local Node. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. B-070-T02 run by the agent: `npm-cli.js` was missing from Node 26.12; `npm install -g --prefix ~/.nvm/versions/node/v26.12.0 npm@11` with Node 24.19's npm gave npm and npx 11.21.3; `node --test test/bom.test.ts` 3/3 with that npm. 2026-11-18: B-070-T02 moved from the owner to the agent. Owner decision 2026-11-18: the agent runs this itself (over SSH to nerv-linux or Tabgha, or the CLI on the Mac) and records the commands and output; the owner page stays as the procedure. 2026-11-18: B-070-T01 implemented: the test asserts npm 11 or later and names the fix; the owner repairs npm under Node 26.12 ([procedure](../acceptance/b070-npm-repair.md), B-070-T02). Opened 2026-11-16 in [PR #503](https://github.com/voidbrain/nerv/pull/503) with the local evidence above; not caused by B-069 (fails with the B-069 change stashed). Next: B-070-T01.

**Estimates:** Small, estimated 2026-11-16: 0.75 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #506](https://github.com/voidbrain/nerv/pull/506) (merged; CI green: B-070-T01); local run 2026-11-16 in a fresh worktree; CI on #502 passed the same test |
| Opened | 2026-11-16 |
| Verification | 2026-11-18: B-070-T02 run by the agent: `npm-cli.js` was missing from Node 26.12; `npm install -g --prefix ~/.nvm/versions/node/v26.12.0 npm@11` with Node 24.19's npm gave npm and npx 11.21.3; `node --test test/bom.test.ts` 3/3 with that npm. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### F-009

**Run NERV Agency headless as one local user service**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-18; Mac and Linux service acceptance done.

| | |
|---|---|
| **Issue** | Service commands and definitions implemented. Portable tests validate rendering/process lifecycle; later owner-authorized F-005 Mac default-profile service operations passed. Linux/session acceptance remains incomplete. |
| **Reproduce** | Follow the [service and login acceptance procedure](../acceptance/f009-service-login-procedure.md) and [docs/INSTALL.md](../INSTALL.md). |
| **Check** | Single process serves production UI/API on 4317; config survives init; clean SIGTERM and restart catch-up; private credentials; install/status/start/stop/uninstall on real target OS. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. F-009-T03 (Linux service target, Calvary instead of the VM by owner decision): 2026-11-18 on Calvary (NERV-03, Debian 11 arm64, Node 24.22.3, linger on): fenced install, stop, start (all completed); a fenced update `bf1e27ef` → `e61388cf` through NERV's own flow (backup, fetch, rehearse, checkout, dependencies, build, start, verify, all completed; after B-088); fenced uninstall (unit removed, data kept) and reinstall (completed); after `systemctl reboot` the user service started by itself through linger and served within 30 s, Kaji listening and NERV-01/NERV-02 reachable; a reminder due while the service was stopped (17:32:53Z) was delivered once after the fenced start (17:33:38Z). An earlier update attempt was refused safely at the rehearsal (B-088: backup kept, nothing changed). Mac login/logout was F-009-T02 (2026-11-15). No review: records-only closure; the code changes behind it (B-085, B-086, B-088) get their own fresh-context review. F-009-T03 progress ([PR #520](https://github.com/voidbrain/nerv/pull/520)): 2026-11-18 on Calvary (NERV-03, Debian 11 arm64, Node 24.22.3, linger on), checkout `main` at `261ad183`: fenced install completed (`definition`, `start`, `verify`), `nerv.service` enabled and active, `http://127.0.0.1:4317/` 200, `doctor` quick_check ok; then a fenced stop (unit inactive, no answer) and a fenced start (active, 200) both completed. Left for T03: restart catch-up after a reboot. 2026-11-18: F-009-T03 moved from the owner to the agent. Owner decision 2026-11-18: the agent runs this itself (over SSH to nerv-linux or Tabgha, or the CLI on the Mac) and records the commands and output; the owner page stays as the procedure2026-11-18: the owner found `nerv service status` failing ("Could not find service io.nerv.agent"): launchd had not loaded the agent since about 2026-11-16 14:48 (last `service-error.log` write; the plist is present, enabled, RunAtLoad and KeepAlive; no lifecycle operation since 2026-11-12; boot 2026-11-15), and NERV ran from a manual `nerv launch` started 2026-11-18 10:42. Likely the companion's Stop (`launchctl bootout`), not proven: the system log no longer covers that day. 2026-11-18: F-009-T04 closed; F-009-T02's evidence below was already recorded with PR #455 and no failure needed a B- record. Next: the owner's Linux VM acceptance (F-009-T03). F-009-T02 passed 2026-11-15 (owner, [PR #455](https://github.com/voidbrain/nerv/pull/455)): after logout and login, launchd restarted `io.nerv.agent` unaided (`state = running`, new pid, HTTP 200). 2026-11-13: the owner chose a Linux VM on the Mac as the Linux acceptance target (also F-005-T26). Owner later selected this Mac default installation and authorized service work on2026-11-10 under F-005. [PR #253](https://github.com/voidbrain/nerv/pull/253) / full CI42874665479 and [accepted service evidence](../acceptance/node-service-2026-11-10.md) establish the selected per-user Mac install/status/stop/start/uninstall/reinstall and recovery checks; this is not a system service or linger exception. Actual login/logout and a selected Linux service target remain pending; no fresh owner choice for the already selected Mac is required. The following is earlier history, not a current prohibition: 2026-11-08: read-only launchctl/plist inspection confirms no NERV service is installed or registered on the execution Mac. docs/agents/areas.md prohibits installing services or enabling linger here; a separate target host is required for OS-service/login acceptance. Target choice requested from the owner; no service was installed, started or stopped. Portable process and recent Windows/macOS CI remain distinct from that trial.  Validate launchd/systemd installation and login/logout on target hosts; PR #1 CI is green. Single process serves production UI/API on 4317; config survives init; clean SIGTERM and restart catch-up; private credentials; install/status/start/stop/uninstall on real target OS.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 2 open steps total 1 h agent + 0.75 h owner (steps table; each task basis gives old → new). Figures after this sentence are dated history. Re-estimated 2026-11-11 in agent hours (harness 5.6.0): the 2 open steps in hours total 1 h agent + 0.75 h owner (steps table; method in each task basis). Day figures below are dated history. Medium remaining validation effort; provisionally 1–2 focused hours per target OS, excluding time waiting for access or troubleshooting. Reassessed 2026-11-08; no completion is inferred from portable tests.

| Field | Value |
|---|---|
| PR / evidence | [PR #380](https://github.com/voidbrain/nerv/pull/380) [PR #255](https://github.com/voidbrain/nerv/pull/255) related-state reconciliation; [PR #254](https://github.com/voidbrain/nerv/pull/254) accepted Mac service evidence under F-005; [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #1](https://github.com/voidbrain/nerv/pull/1); 10 regression tests and headless process test pass; CI run 41254646946 green |
| Opened | 2026-11-01 |
| Verification | 2026-11-18: Linux target acceptance on Calvary (install/status/start/stop/update/uninstall, reboot start, restart catch-up). 2026-11-10 selected per-user Mac lifecycle operations accepted under F-005-T04; actual session/login and Linux target acceptance remain pending. Earlier2026-11-08: read-only execution-host check confirms no installed/registered launchd service. Existing portable headless checks pass; separate target-host install/status/start/stop/uninstall and login/logout acceptance remain pending. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-085

**Linux: lifecycle commands drop the user session bus, so no user service can be installed**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Found 2026-11-18 on Calvary (Debian 11): with linger on and `systemctl --user show-environment` working in the SSH shell, `nodes lifecycle-inspect --action install` still reported "Non-interactive service environment is unavailable" and "The selected GUI user session is unavailable". `command()` passed children only PATH, HOME, USER, TMPDIR, LANG and LC_ALL; without `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`, `systemctl --user` answers "Failed to connect to bus". Tests never saw it: they inject the runner. |
| **Reproduce** | On Linux with a user session: `env -i PATH=$PATH HOME=$HOME USER=$USER systemctl --user show-environment` fails; with `XDG_RUNTIME_DIR` it succeeds. |
| **Check** | Test committed failing first: `childEnv` keeps XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS and drops unlisted variables; on Calvary the install inspection has no blockers. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. Review: fresh-context design review of PR #518 and PR #522 (2026-11-18): no blocking issues; childEnv still drops unlisted variables, and the bus variables give children no power the same user lacked. 2026-11-18: verified live on Calvary: 2026-11-18 on Calvary (NERV-03, Debian 11 arm64, Node 24.22.3, linger on): fenced install, stop, start (all completed); a fenced update `bf1e27ef` → `e61388cf` through NERV's own flow (backup, fetch, rehearse, checkout, dependencies, build, start, verify, all completed; after B-088); fenced uninstall (unit removed, data kept) and reinstall (completed); after `systemctl reboot` the user service started by itself through linger and served within 30 s, Kaji listening and NERV-01/NERV-02 reachable; a reminder due while the service was stopped (17:32:53Z) was delivered once after the fenced start (17:33:38Z). An earlier update attempt was refused safely at the rehearsal (B-088: backup kept, nothing changed). Live: 2026-11-18 on Calvary (NERV-03, Debian 11 arm64, Node 24.22.3, linger on), checkout `main` at `261ad183`: fenced install completed (`definition`, `start`, `verify`), `nerv.service` enabled and active, `http://127.0.0.1:4317/` 200, `doctor` quick_check ok; then a fenced stop (unit inactive, no answer) and a fenced start (active, 200) both completed. Closing needs the fresh-context review (P1). 2026-11-18: B-085-T01 implemented (`childEnv` in `src/node-lifecycle-execution.ts`). Live: with the fix, Calvary's install inspection wrote plan `975e30ca…` with no blockers. Opened 2026-11-18.

**Estimates:** Small, estimated 2026-11-18: 0.75 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/node-lifecycle-execution.test.ts` "B-085: lifecycle commands keep the user session bus…" (committed failing first) |
| Opened | 2026-11-18 |
| Verification | 2026-11-18: CI green; verified live on Calvary. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-088

**Every lifecycle update is refused at the rehearsal: the candidate reader runs without dependencies**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Found 2026-11-18 updating NERV-03 on Calvary (F-005-T26): `lifecycle-apply --action update` ran backup, fetch and rehearse, then was refused: "The reader refused or failed on the first open: The candidate reader exited with a failure." The rehearsal exports the candidate with `git archive` into `~/.nerv-lifecycle/staging/<digest>`, outside the checkout, so it has no `node_modules`; the real reader imports `src/rpc.ts`, which imports `ajv`, and Node answered `ERR_MODULE_NOT_FOUND: Cannot find package 'ajv'`. So every update is refused on every host, the Mac's live service and automatic updates (F-102) included; the refusal is safe (backup kept, nothing changed). The adapter test's readers import only Node built-ins, so CI never saw it. |
| **Reproduce** | On any host: `nodes lifecycle-inspect --action update --revision <newer main>` after a fenced stop, then `lifecycle-apply`. Directly: export a revision into `~/.nerv-lifecycle/staging/x` and run `node src/upgrade-reader.ts <copy.sqlite> <home>` there. |
| **Check** | Test committed failing first: a candidate reader importing a package present only in the installed checkout's `node_modules` rehearses with no blockers; no tree, archive or link is left; the installed dependencies and checkout stay untouched; an update on Calvary completes. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. Review: fresh-context design review of PR #518 and PR #522 (2026-11-18): no blocking issues; cleanup is safe (rmSync does not follow the link; the explicit unlink is extra protection). Its should-fix, candidates whose dependencies differ from the installed ones, is B-090. 2026-11-18: verified live on Calvary: 2026-11-18 on Calvary (NERV-03, Debian 11 arm64, Node 24.22.3, linger on): fenced install, stop, start (all completed); a fenced update `bf1e27ef` → `e61388cf` through NERV's own flow (backup, fetch, rehearse, checkout, dependencies, build, start, verify, all completed; after B-088); fenced uninstall (unit removed, data kept) and reinstall (completed); after `systemctl reboot` the user service started by itself through linger and served within 30 s, Kaji listening and NERV-01/NERV-02 reachable; a reminder due while the service was stopped (17:32:53Z) was delivered once after the fenced start (17:33:38Z). An earlier update attempt was refused safely at the rehearsal (B-088: backup kept, nothing changed). 2026-11-18: B-088-T01 implemented: the rehearsal links the exported tree's `node_modules` to the installed checkout's (a junction on Windows) and unlinks it before removing the tree. Lifecycle and update tests 72/72. The update flow rehearses with the installed code, so each host gets this fix by one `git pull` of its checkout (as Tabgha got B-080), then updates normally. Opened 2026-11-18.

**Estimates:** Small, estimated 2026-11-18: 1 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/upgrade-lifecycle.test.ts` "B-088: the candidate reader resolves packages from the installed checkout…" (committed failing first) |
| Opened | 2026-11-18 |
| Verification | 2026-11-18: CI green; verified live on Calvary. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-077

**Role evaluation runs refuse three repeats, which the approved F-006 campaigns need**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Found 2026-11-18 while checking the owner's F-006 run: `node tools/gauntlet.mjs role-plan --role=both` with `limits-repeat3.json` stops with "Unsupported role limits repeat; only repeat=1 is supported" (`validateRoleBundleConfig` in `tools/evaluate-model.mjs`, added 2026-11-13). The owner approved three runs per case on 2026-11-15 and both campaign plans (F-006-T19, F-006-T20) use `role-run` with `repeat: 3`, so neither campaign can run. |
| **Reproduce** | `node tools/gauntlet.mjs role-plan --role=both --profile=<gemma4-12b profile> --limits=<limits with "repeat": 3> --machine-profile=<machine> --scenario=node_modules/@voidbrain/gauntlet-protocol/examples/scenarios/moderate-load.json` |
| **Check** | A committed test fails first: a role bundle with `repeat: 3` plans and runs each case three times against a fake Ollama, with per-repeat results and the budgets counted over all repeats; `repeat: 1` behaves as before. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. Merged in PR #519 on green CI; the test covers three repeats per case. 2026-11-18: B-077-T01 implemented: `runRoleBundle` runs each selected case `limits.repeat` times and every result carries its `iteration`; the budgets already counted every call. Test: `test/gauntlet.test.mjs` "B-077: a role bundle with repeat 3 runs each case three times…" (committed failing first with "only repeat=1 is supported"); gauntlet tests 23/23. Next: the owner's F-006 Mac page can run once this merges. Opened 2026-11-18 in [PR #513](https://github.com/voidbrain/nerv/pull/513). The owner's F-006 Mac page ([f006-mac-runs.md](../acceptance/f006-mac-runs.md)) waits on it.

**Estimates:** Small, estimated 2026-11-18: 1.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/gauntlet.test.mjs` B-077; Dry run 2026-11-18 on main, scratch profile copied from the protocol's `gemma4-12b.json` |
| Opened | 2026-11-18 |
| Verification | 2026-11-18: Merged in PR #519 on green CI; the test covers three repeats per case. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-078

**Project report on a web page: script text in the summary and repository-only gaps listed as risks**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Found 2026-11-18 in F-085-T03: `nerv quarantine report https://nodejs.org/en/about --kind page` put the page's inline `<script>` text after its title in `whatItIs.summary`, and reported licence, build/test and commit history as missing for a web page, listing "Missing licence increases reuse and compliance risk" under `visibleRisks`. The repository report on the same run was correct. |
| **Reproduce** | `nerv quarantine report https://nodejs.org/en/about --kind page` |
| **Check** | A committed test fails first with an invented page fixture holding an inline script: the summary is the title (and description) without script or style text; a `page` report says which fields do not apply instead of listing them as missing, and adds no licence risk. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. Merged in PR #523 on green CI (CodeQL alerts fixed there); live on nodejs.org/about. 2026-11-18: B-078-T01 implemented: scripts, styles and comments are removed before the summary, a page prefers its title and meta description, and a page report marks licence, build and history "Not applicable to a web page" with no licence risk. Test: `test/quarantine.test.ts` "B-078: a page report names the page…" (committed failing first); the older page test's licence expectation changed with this requirement. Live: nodejs.org/about now reads "Node.js — About Node.js® — Node.js® is a free, open-source, cross-platform JavaScript runtime…". Opened 2026-11-18 from F-085-T03.

**Estimates:** Small, estimated 2026-11-18: 1 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/quarantine.test.ts` B-078; F-085-T03 run 2026-11-18 |
| Opened | 2026-11-18 |
| Verification | 2026-11-18: Merged in PR #523 on green CI (CodeQL alerts fixed there); live on nodejs.org/about. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-079

**`gauntlet:all` reused system results recorded at another source, and reported them as passed**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Found 2026-11-18 running F-097-T01: `npm run gauntlet:all -- --allow-expensive --execute` ran nothing and reported `passed: true`, reusing the seven `nerv-system-flows` results of 2026-11-14 (browser among them as failed), while `npm run gauntlet:pending` listed all seven as `source-changed`. `all()` in `tools/gauntlet.mjs` built its pending options without the per-case system source key that `pending` uses, so unless `--source-key` was given a source change never made a system case pending. The documented F-097 rerun could not rerun anything. |
| **Reproduce** | On main before the fix, with the ledger behind the source: `npm run gauntlet:pending` lists the system cases; `npm run gauntlet:all` plans them as reuse. |
| **Check** | Test committed failing first: with a ledger at a stale source key, `all` plans the seven system cases with reason `source-changed` and reuses none, as `pending` lists them; the existing test that reuses cases at the current source still passes; F-097-T01's real run executes the seven cases. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. Merged in PR #515 on green CI; the F-097-T01 run executed all seven system cases. 2026-11-18: B-079-T01 implemented: `all()` passes the same per-case `systemSourceKey` default as `pending` (an explicit `--source-key` still wins). Test: `test/gauntlet.test.mjs` "B-079: the root command reruns system cases whose source changed…" (06e47fc9, failing first); `test/gauntlet.test.mjs` 22/22. The F-097-T01 run then executed all seven cases (all passed). Opened 2026-11-18.

**Estimates:** Small, estimated 2026-11-18: 0.75 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/gauntlet.test.mjs` B-079 (06e47fc9) |
| Opened | 2026-11-18 |
| Verification | 2026-11-18: Merged in PR #515 on green CI; the F-097-T01 run executed all seven system cases. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-083

**Inspecting a target whose Node is older than 14 fails with a generic error**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Found 2026-11-18 on Calvary (Node 12.22.12): `nodes inspect --ssh Calvary` said "Read-only command failed" instead of naming the version as too old. The probe sent to the target's `node` used `require('node:os')`, which Node 12 lacks, so it crashed before reporting. |
| **Reproduce** | `nerv nodes inspect --ssh <host with Node 12>` |
| **Check** | Test committed failing first: the probe uses no `node:` require and no `??` or `?.`; on Calvary the inspection reports "Node.js 12.22.12 on the target is below the version NERV requires (>=24.0.0)". |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. Merged in PR #517 on green CI; live on Calvary (Node 12 reported as too old). 2026-11-18: B-083-T01 implemented and checked live on Calvary: "Node.js 12.22.12 on the target is below the version NERV requires (>=24.0.0) … no installation was requested." Opened 2026-11-18.

**Estimates:** Small, estimated 2026-11-18: 0.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/node-inspection.test.ts` "B-083: the read-only probe runs on an old Node…" (committed failing first) |
| Opened | 2026-11-18 |
| Verification | 2026-11-18: Merged in PR #517 on green CI; live on Calvary (Node 12 reported as too old). Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-084

**Lifecycle inspection on a fresh data home fails with a raw ENOENT**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Found 2026-11-18 on Calvary: after `nerv init`, `nodes lifecycle-inspect --action install` stopped with `ENOENT: no such file or directory, lstat '/home/db/.nerv/base-key'`, and after `nerv base pubkey` with the same for `nerv.sqlite`. `init` creates neither; the F-005-T22 page says to initialize with `nerv setup` or `nerv doctor`. |
| **Reproduce** | Fresh host: `nerv init --base X --name Y --no-model-setup`, then `nerv nodes lifecycle-inspect --action install --out plan.json`. |
| **Check** | A committed test fails first: on a data home without `base-key` or `nerv.sqlite`, the inspection names what is missing and how to create it (or `init` creates them), and changes nothing. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. Merged in PR #523 on green CI. 2026-11-18: B-084-T01 implemented: `requireServiceHome` names each missing file (config.json, token, base-key, base.pub, nerv.sqlite) and the command that creates it (`nerv init`, `nerv base pubkey`, `nerv doctor`), changing nothing. Test: `test/node-lifecycle-execution.test.ts` "B-084: a fresh data home names the files…" (committed failing first). Opened 2026-11-18 from F-005-T22 on Calvary.

**Estimates:** Small, estimated 2026-11-18: 0.75 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/node-lifecycle-execution.test.ts` B-084; F-005-T22 run on Calvary, 2026-11-18 |
| Opened | 2026-11-18 |
| Verification | 2026-11-18: Merged in PR #523 on green CI. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### B-089

**No check catches merge conflict markers in committed files**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Found 2026-11-18: conflict markers reached pushed branches twice in one day while `check:fast` passed: in the F-005 record (PR #520, a patch applied with conflicts) and in `evals/gauntlet/ledger.json` (PRs #522 and #523, a merge whose conflicts a shell loop failed to resolve). Both were found by the agent and fixed by follow-up pushes before merging. |
| **Reproduce** | Commit a file with `<<<<<<<` / `=======` / `>>>>>>>` lines; `npm run check:fast` passes. |
| **Check** | Test committed failing first: a tracked file with a conflict block fails `check:conflicts` naming file and line; a lone `=======` line passes; the check runs first in `check:fast` and in CI's `validate` job. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. Merged in PR #524 on green CI; check:conflicts runs in check:fast and CI. 2026-11-18: B-089-T01 implemented: `tools/check-conflict-markers.mjs` (`npm run check:conflicts`) scans tracked text files for an ordered `<<<<<<<` / `=======` / `>>>>>>>` block. Test: `test/check-conflict-markers.test.mjs` (committed failing first). Opened 2026-11-18.

**Estimates:** Small, estimated 2026-11-18: 0.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/check-conflict-markers.test.mjs` |
| Opened | 2026-11-18 |
| Verification | 2026-11-18: Merged in PR #524 on green CI; check:conflicts runs in check:fast and CI. Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### F-105

**A pull request names itself in a record, or CI fails**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Found 2026-11-16: 36 of the 40 PRs merged overnight (#457–#498) named no record, so the ledger fell 40 PRs behind `main`; `work:next` kept offering steps already delivered and 21 duplicate branches were started for closed tasks. The rule exists (name the PR by its number in the records it touches, and push that before the checks finish) but nothing enforces it, so the catch-up reconciliation ([PR #499](https://github.com/voidbrain/nerv/pull/499)) was the only thing keeping the ledger honest. |
| **Reproduce** | Open a PR that changes `src/` without touching `docs/work/`: every check passes. |
| **Check** | On a `pull_request` run a NERV-owned check (`tools/check-pr-record.mjs`, run from `ci.yml`; `tools/check-backlog.mjs` is a copied harness file and stays untouched) fails unless the PR's number appears in a record, a task file (`prs`) or the reconciliation log on the branch; a PR that touches no product record names itself in the reconciliation log entry instead; the message says which to edit; a committed test covers both outcomes; proposed to the harness template once it has run here. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18. Merged in PR #511 on green CI; the check has run on every PR since (#512–#525). 2026-11-18: F-105-T01 implemented in [PR #511](https://github.com/voidbrain/nerv/pull/511): `tools/check-pr-record.mjs` (`npm run check:pr-record`) runs in the `validate` job on pull_request and fails unless the PR number appears in a record, a task `prs` entry or the reconciliation log; bot PRs and pushes are skipped; `test/check-pr-record.test.mjs` covers both outcomes. Started 2026-11-16 in another session and finished here. Its tests failed on Windows CI (job 134689577350): reported paths used `\` there; they are now `/` on every platform. Planned 2026-11-16 with the owner, after the 40-PR catch-up of PR #499: F-105-T01 the check and its CI step. Proposed to the harness template once it has run here.

**Estimates:** 1 h agent in one step. Estimated 2026-11-16. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Owner decision 2026-11-16; [PR #499](https://github.com/voidbrain/nerv/pull/499) the catch-up it prevents; opened in [PR #502](https://github.com/voidbrain/nerv/pull/502) |
| Opened | 2026-11-16 |
| Verification | 2026-11-18: Merged in PR #511 on green CI; the check has run on every PR since (#512–#525). Closed 2026-11-18. |
| Reviewed | 2026-11-18 |

</details>

---

### F-085

**Check an outside project from a URL or a GitHub repository**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔶 P2 | Closed | 🟣 Very large |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Owner job 2026-11-14: "check that project" for a web URL or a GitHub repository. NERV cannot fetch and assess outside content, and anything it reads there is untrusted. |
| **Reproduce** | Ask Misato to check a public repository URL. |
| **Check** | NERV fetches the page or clones the repository read-only into a quarantine class (EVA-03, F-049) and marks the content tainted (F-027); it runs none of the project's code by default; the report says what the project is, its activity, licence, how it is built and tested, and visible risks, each with its source; text in the project never changes NERV's instructions (a test plants such text). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18 in PR #529. All three steps closed; the live `quarantine report` run on a GitHub repository was F-085-T03. 2026-11-18: F-085-T03 closed by the agent: `nerv quarantine report https://github.com/sindresorhus/slugify --kind repo` gave what it is, latest commit, MIT licence, `xo && node --test` and no static risks, each citing package.json, git log or the licence file. `… https://nodejs.org/en/about --kind page` was wrong in two ways, opened as B-078: the summary carries the page's inline script after the title, and repository fields (licence, build, history) are reported missing on a web page, with "Missing licence" listed as a risk. 2026-11-18: F-085-T03 moved from the owner to the agent. Owner decision 2026-11-18: the agent runs this itself (over SSH to nerv-linux or Tabgha, or the CLI on the Mac) and records the commands and output; the owner page stays as the procedure. Opened 2026-11-14 from the [owner jobs case study](../design/owner-jobs-case-study-2026-11-14.md), job 4. Priority P2 set by the owner for all case-study records, to be re-ranked.

**Estimates:** Estimated 2026-11-14: 0src/**,test/**src/**,test/**docs/acceptance/** h agent over 3 steps, at agent speed before any design work. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #490](https://github.com/voidbrain/nerv/pull/490) (merged; CI green); [PR #391](https://github.com/voidbrain/nerv/pull/391) (opened); [Owner jobs case study](../design/owner-jobs-case-study-2026-11-14.md) |
| Opened | 2026-11-14 |
| Verification | 2026-11-18: F-085-T02 verified: [PR #490](https://github.com/voidbrain/nerv/pull/490) merged on green CI. `F-085-T01` verified via `test/quarantine.test.ts` (read-only shallow clone + page fetch into discarded per-job dir, `tainted: true`, no code executed, planted instruction isolation), `tsc`, `check:conventions`, and `check:fast`. |
| Reviewed | 2026-11-18 |

</details>

---

---

### F-097

**Rerun the seven NERV system cases at the harness 8.14.1 source**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔶 P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | The harness 8.14.1 reconcile ([PR #404](https://github.com/voidbrain/nerv/pull/404)) changed evaluation-source inputs, so the seven `nerv-system-flows` cases became pending (`source-changed`). Harness 8.15.0 and the Gauntlet 0.9.0 pin keep them pending under this record until the system-only rerun is recorded. The agent's earlier rerun was refused by that session's permission classifier on 2026-11-14. |
| **Reproduce** | `npm run gauntlet:pending` on the reconcile branch lists policy, ledger, conversation, channels, bases, stress and browser as source-changed. |
| **Check** | `npm run gauntlet:pending` prints nothing; `evals/gauntlet/ledger.json` records the seven runs at the merged source; `npm run check:evals` passes without this step. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18 in PR #529. Its one step closed: the seven system cases passed at the harness 8.14.1 source. 2026-11-18: F-097-T01 closed by the agent: `npm run build && npm run gauntlet:all -- --allow-expensive --execute` ran the seven `nerv-system-flows` cases (policy, ledger, conversation, channels, bases, stress, browser), all passed at source key `c127a5a7e2b2…` (ledger committed here); `gauntlet:pending` lists no system case. The first attempt ran nothing and reported passed because of B-079, fixed in the same PR. 2026-11-18: F-097-T01 moved from the owner to the agent. Owner decision 2026-11-18: the agent runs this itself (over SSH to nerv-linux or Tabgha, or the CLI on the Mac) and records the commands and output; the owner page stays as the procedure. Copy and paste: `cd <a worktree of this branch or of main after merge> && npm run build && npm run gauntlet:all -- --allow-expensive --execute --out-dir=/private/tmp/nerv-system-8141 && npm run gauntlet:pending`. Expected: the build succeeds, the run reports seven passing system cases, and `gauntlet:pending` prints nothing. Then commit `evals/gauntlet/ledger.json` in a PR naming F-097. No model is called (`modelCallsAuthorized: false`); `stress` is capped at 180 s and the suite at 15 min.

**Estimates:** Small, estimated 2026-11-14: 0.25 h owner (about 15 min of running). Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Opened in [PR #404](https://github.com/voidbrain/nerv/pull/404) |
| Opened | 2026-11-14 |
| Verification | Pending. |
| Reviewed | 2026-11-18 |

</details>

---

---

### B-093

**The Revoked bases section closes itself a few seconds after opening**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔹 P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-18.

| | |
|---|---|
| **Issue** | Owner report 2026-11-18: the folded "Revoked (n)" section (F-107) closed again after a few seconds: the base list is rebuilt from scratch on every poll, so the details element lost its open state. |
| **Reproduce** | Dashboard with a revoked base: open "Revoked (1)" and wait for the next poll. |
| **Check** | Test committed failing first: with `state.revokedOpen` the section renders `open`; a `toggle` handler keeps the state in step with the owner's click. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-18 in PR #530: the owner opened Revoked on the live dashboard (NERV-01 at 228ab45) and it stayed open across polls. 2026-11-18: B-093-T01 implemented. Opened 2026-11-18.

**Estimates:** Small, estimated 2026-11-18: 0.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/dashboard.test.ts` B-065/B-093 bases test (committed failing first) |
| Opened | 2026-11-18 |
| Verification | 2026-11-18: CI green (PR #527) and the owner's live check. |
| Reviewed | 2026-11-18 |

</details>

---

---

## Closed 2026-11-19

### B-090

**Update rehearsal uses the installed dependencies, so a candidate whose dependencies differ is judged wrongly or refused forever**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-19.

| | |
|---|---|
| **Issue** | Found 2026-11-18 by the fresh-context review of PR #522 (B-088): the candidate reader resolves packages through a link to the installed checkout's `node_modules`, and `dependencies` runs only after `checkout`. If a new revision adds a runtime dependency its reader path needs, every update to it is refused at the rehearsal, safely but forever; if a dependency's version changes (for example an ajv major), the rehearsal runs against the old version and can pass or fail wrongly. |
| **Reproduce** | A candidate whose `src/upgrade-reader.ts` path imports a package absent from the installed `node_modules`: `lifecycle-apply --action update` is refused at `rehearse`. |
| **Check** | A committed test fails first: when the candidate's `package-lock.json` differs from the installed one, the rehearsal installs the candidate's own dependencies into the staging tree (`npm ci --ignore-scripts`, bounded) and runs its reader against them, or refuses with a message naming the dependency change; equal locks keep the link. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-19: verified and closed: B-090-T01 by PR #538 (test committed failing first in `test/upgrade-lifecycle.test.ts`), CI run 44429968461 passed every job; B-090-T02: stress and browser system cases passed at main `16bfcc0f`. Used live the same day: the NERV-03 update `e61388cf` → `9613f0df` and the NERV-01 update `9613f0df` → `477d6afc` both rehearsed and completed (F-005-T29). 2026-11-19: B-090-T01 implemented: the rehearsal compares the candidate's `package-lock.json` with the installed one; when they differ it runs `npm ci --engine-strict --ignore-scripts` in the staging tree (bounded, 600 s) and the candidate reader uses those dependencies, or the update is refused naming the lockfile change; equal locks keep the B-088 link. Test committed failing first (`test/upgrade-lifecycle.test.ts`, B-090: a local `file:` dependency at 1.0.0 installed, 2.0.0 in the candidate). Shared by the Mac, Linux and Windows adapters. Opened 2026-11-18 from the review of PR #522.

**Estimates:** Small, estimated 2026-11-18: 1.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #538](https://github.com/voidbrain/nerv/pull/538) B-090-T01 (`test/upgrade-lifecycle.test.ts`); Review of PR #522, 2026-11-18 |
| Opened | 2026-11-18 |
| Verification | 2026-11-19: CI run 44429968461 (PR #538); live updates on NERV-01 and NERV-03 (F-005-T29). |
| Reviewed | 2026-11-19 |

</details>

---

### B-098

**`npm ci` in a worktree whose `node_modules` links to the primary checkout empties the primary's**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-19.

| | |
|---|---|
| **Issue** | Found 2026-11-19 in F-005-T29: the agent ran `npm ci` in two existing worktrees under `.claude/worktrees/` to merge `main` into their PRs. Their `node_modules` was most likely a symlink to the primary checkout's (`npm run worktree:link` makes one); `npm ci` removed the contents through the link and left a real folder in the worktree. The primary's `node_modules` was empty from 09:12:06, while the live service ran from it: a restart or a lifecycle command would have failed (`ng: command not found`, `Cannot find package 'ajv'`). The owner restored it with `npm ci --ignore-scripts` (lockfile identical for the running and the checked-out revision). |
| **Reproduce** | In a worktree: `npm run worktree:link`, then `npm ci`; the linked `node_modules` of the primary checkout is empty afterwards. |
| **Check** | Test committed failing first: dependency installs run by NERV's tools refuse when `node_modules` is a symbolic link, naming the link, and the worktree procedure says to remove the link (`rm node_modules`, not its contents) before `npm ci`. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-19: verified and closed: B-098-T01 by PR #543, CI run 44508528108 passed every job on the first attempt; `docs/INSTALL.md` names the unlink step and `npm run deps:install` refuses a linked `node_modules`. 2026-11-19: B-098-T01 implemented: `tools/install-deps.mjs` (`npm run deps:install`) refuses when `node_modules` is a symbolic link, naming the link and target; failing test committed first in `test/install-deps.test.mjs` (3 pass after fix); worktree unlink guidance added to `docs/INSTALL.md`. Awaiting CI and merge to verify/close. Opened 2026-11-19.

**Estimates:** Small, estimated 2026-11-19: 1 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Opened in [PR #541](https://github.com/voidbrain/nerv/pull/541); [PR #543](https://github.com/voidbrain/nerv/pull/543) B-098-T01 (`tools/install-deps.mjs`, `test/install-deps.test.mjs`, `docs/INSTALL.md`); primary `node_modules` mtime 09:12:06 = the worktree `npm ci` |
| Opened | 2026-11-19 |
| Verification | 2026-11-19: CI run 44508528108 (PR #543). |
| Reviewed | 2026-11-19 |

</details>

---

## Closed 2026-11-20

### B-106

**Development tooling includes a vulnerable minimatch release**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-20.

| | |
|---|---|
| **Issue** | `npm audit` on main reports GHSA-g3hv-75wg-m249 through `typescript-eslint` 8.72.2: `minimatch` before 11.0.1 can consume excessive resources for crafted glob patterns. The affected path is development lint tooling, not the shipped runtime. |
| **Reproduce** | On main, run `npm ci && npm audit`. |
| **Check** | `npm audit` reports zero vulnerabilities after the non-major `typescript-eslint` update; lint, typecheck and the full test suite pass. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Exact-pinned `typescript-eslint` 8.72.2 → 8.73.0 updates the transitive `minimatch` dependency past GHSA-g3hv-75wg-m249 without changing lint configuration. Harness classification: project-only dependency setting; no template change. No test: third-party development-tool advisory; `npm audit` is the failing check, committed in the preceding audit commit. Fresh-context review found the initial caret range and stale audit wording; both were corrected before merge.

**Resolution:** Closed 2026-11-20 as Verified. PR #598 merged after CI run 44809792450 passed plan, validate, Windows, native-macos and full-suite; CodeQL's Actions, JavaScript/TypeScript and Swift analyses passed. `npm audit` reports zero vulnerabilities.

**Estimates:** Closed; 0.25 h estimated. Closed 2026-11-20.

| Field | Value |
|---|---|
| PR / evidence | [PR #600](https://github.com/voidbrain/nerv/pull/600) (closure); [PR #598](https://github.com/voidbrain/nerv/pull/598); [Full audit 2026-11-20](../../audits/2026-11-20-full.md); GHSA-g3hv-75wg-m249 reported by `npm audit`; `package-lock.json` resolves `typescript-eslint` 8.73.0; Review: fresh-context dependency/security review, three findings corrected before PR |
| Opened | 2026-11-20 |
| Verification | 2026-11-20: CI run 44809792450 passed all five jobs/full-suite; CodeQL passed all three analyses. Local: `npm audit` 0 vulnerabilities; lint, typecheck, build and `check:fast` passed; full tests 1,041 pass / 2 platform skips; browser 5/5; SBOM 3/3. |
| Reviewed | 2026-11-20 (closed) |

</details>

---

### F-079

**Experiment: each system evaluation case covers only the source it exercises**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-20.

| | |
|---|---|
| **Issue** | The Gauntlet system source key is one hash over `src`, `test`, `shared`, `web`, `evals` and the evaluation tools. 100 of the 155 merges between 2026-11-08 and 2026-11-13 changed it, and each one made all seven `nerv-system-flows` cases (stress and browser included) pending again, so the ledger is stale almost all the time ([architecture reassessment](../../audits/2026-11-13-architecture-reassessment.md), finding 4). |
| **Reproduce** | Count merges since `1869340` whose diff touches the inputs of `systemSourceKey` in `tools/gauntlet.mjs`. |
| **Check** | A case may declare the paths it exercises; its key hashes only those plus the runner, adapter and dependency pin; a case without a declaration keeps the whole-tree key. A measured comparison over recent merges shows how many reruns are saved, and a seeded change inside a declared path makes its case pending. If a scoped case misses a real regression, that case returns to the whole-tree key. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-20: verified and closed: F-079-T02 by PR #585, CI run 44732108271 passed every job; every acceptance check was automated (replay report, seeded-regression test). Closed 2026-11-20. F-079-T01 closed in [PR #469](https://github.com/voidbrain/nerv/pull/469). F-079-T02 implemented 2026-11-20: declared per-case `inputs` on all 7 cases in `evals/gauntlet/system-v1.json`, measured the `1869340..origin/main` replay (362 merges: 1568 reruns without declarations → 1088 with declarations, saving 480 reruns / 30.6%, `policy` 224 → 13 / 94.2%) in [the F-079-T02 report](../../evaluations/2026-11-20-f079-t02-system-case-paths.md), and added a seeded-regression test in `test/gauntlet.test.mjs`. Awaiting CI before closure. Proposed by the [architecture reassessment of 2026-11-13](../../audits/2026-11-13-architecture-reassessment.md).

**Estimates:** Small, estimated 2026-11-13: 1 h agent over two steps. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #585](https://github.com/voidbrain/nerv/pull/585) (T02 implementation; merged, CI run 44732108271 green); [PR #469](https://github.com/voidbrain/nerv/pull/469) (merged; CI green); [PR #377](https://github.com/voidbrain/nerv/pull/377) (its `.harness.json` bump alone made all seven cases pending again; rerun 7/7 on the branch) [Architecture reassessment 2026-11-13](../../audits/2026-11-13-architecture-reassessment.md) |
| Opened | 2026-11-13 |
| Verification | 2026-11-20: CI run 44732108271 (PR #585). Before merge: `node --test test/gauntlet.test.mjs` (24/24 passed), `npm run check:fast`, and `npm run check:gauntlet-runs` passed. F-079-T01 verified in PR #469. |
| Reviewed | 2026-11-20 |

</details>

---

## Closed 2026-11-21

### B-086

**Linux: an install stops at start because a written unit already counts as registered**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-21.

| | |
|---|---|
| **Issue** | Found 2026-11-18 on Calvary: the fenced install wrote `~/.config/systemd/user/nerv.service`, then the start step stopped with "Selected service ownership changed." (receipt `uncertain`, `definition:completed,start:started`). systemd loads a unit as soon as its file exists (`LoadState=loaded`, `UnitFileState=disabled`), and the adapter counted any loaded matching unit as registered, while the start step requires it absent before `enable --now`. The same rule would make a stop wait forever for "absent" after `disable`. The test fake answered `not-found` until `enable`, unlike systemd. |
| **Reproduce** | On Linux: `nodes lifecycle-inspect --action install`, then `lifecycle-apply`. |
| **Check** | Test committed failing first (the systemctl fake loads a unit once its file exists, like systemd): Linux install, stop and update tests pass with registration meaning `UnitFileState=enabled`; the NERV-03 install on Calvary completes. A matching unit that is disabled but still active reads as NERV's, so a fenced stop disables and stops it; a foreign unit still reads foreign (B-086-T02, B-086-T04). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-21: B-086-T05 ran every source-changed `nerv-system-flows` case at main `df14a73a`; ledger, conversation, channels, bases, stress and browser all passed and completed. The command authorized expensive system cases but no model calls; private reports remain outside Git. `gauntlet pending` no longer lists stress or browser. Earlier implementation/review/live evidence is retained below and in the [evidence archive](../../archive/evidence-2026.md#b-086-moved-2026-11-19).

**Resolution:** Closed 2026-11-21 as Verified. Failing-first lifecycle regressions, green CI, the fresh-context review of PR #536, live Calvary install/stop/update evidence, transition/foreign-unit tests and the final system stress/browser runs satisfy the recorded Check. No review: this closure PR changes only neutral evaluation-ledger and backlog evidence; the runtime fix had its fresh-context design review in PR #536.

**Estimates:** Small, estimated 2026-11-18: 0.75 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #623](https://github.com/voidbrain/nerv/pull/623) B-086-T05 closure; system ledger at main `df14a73a`; No review: evidence-only closure with no runtime or test change; the fix had its fresh-context design review in PR #536. [PR #542](https://github.com/voidbrain/nerv/pull/542) B-086-T04 (tests); [PR #536](https://github.com/voidbrain/nerv/pull/536) B-086-T02; Test: `test/linux-service-lifecycle.test.ts` fake now loads a written unit (committed failing first: F-005-T10 and F-005-T25 failed) |
| Opened | 2026-11-18 |
| Closed | 2026-11-21 |
| Verification | 2026-11-21 System: `nerv-system-flows/stress` and `/browser` passed and completed at `df14a73a`; neither remains pending. 2026-11-19: CI run 44483736523 (PR #536); live on Calvary 2026-11-18 (install) and 2026-11-19 (stop, update). |
| Reviewed | 2026-11-21 |

</details>

---

## Closed 2026-11-18

### F-084

**Coding job on a local repository: change, test, open a PR**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟣 Very large |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Owner job 2026-11-14: "open this project folder, refactor this function, open a PR on GitHub". F-006 places models and workers; no record owns the coding job itself (repository, worktree, coding agent, tests, PR). |
| **Reproduce** | Ask for a named change in a repository on a base; today nothing runs. |
| **Check** | A job names a repository the owner allowed and a change; it runs in a fresh worktree from the default branch inside a sandbox (F-049) with a coding agent; the owner sees the diff, the test result and the cost before anything leaves the machine; pushing and opening the PR is an Orange action on an approval card; the PR link comes back to the channel; the primary checkout is never edited; the instruction load is measured in tokens and a model route that cannot hold it is refused; long work is split into steps, each in a fresh session with a persisted handoff, so a full context never silently drops a rule. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-18: F-084-T04 moved from the owner to the agent. Owner decision 2026-11-18: the agent runs this itself (over SSH to nerv-linux or Tabgha, or the CLI on the Mac) and records the commands and output; the owner page stays as the procedure. Opened 2026-11-14 from the [owner jobs case study](../design/owner-jobs-case-study-2026-11-14.md), job 3. Priority P2 set by the owner for all case-study records, to be re-ranked.

**Estimates:** Estimated 2026-11-14: 0docs/decisions/**src/**,test/**src/**,test/**docs/acceptance/** h agent over 4 steps, at agent speed before any design work. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #654](https://github.com/voidbrain/nerv/pull/654) (closure); [PR #637](https://github.com/voidbrain/nerv/pull/637) (`f084-scratch-repo-check.md`); [PR #632](https://github.com/voidbrain/nerv/pull/632); [PR #462](https://github.com/voidbrain/nerv/pull/462); [PR #494](https://github.com/voidbrain/nerv/pull/494) (merged; CI green); [PR #391](https://github.com/voidbrain/nerv/pull/391) (opened); [Owner jobs case study](../design/owner-jobs-case-study-2026-11-14.md) |
| Opened | 2026-11-14 |
| Verification | 2026-11-18: F-084-T02 verified: [PR #494](https://github.com/voidbrain/nerv/pull/494) merged on green CI. `F-084-T01` decision written in [coding-job-contract.md](../decisions/coding-job-contract.md); verified with `npm run check:fast`. 2026-11-22: F-084-T03 verified (`coding.push_pr` Orange gate + `pushBranchAndOpenPr`); `node --test test/coding-job.test.ts` (5/5 passed) and `npm run check:fast`. 2026-11-22: F-084-T04 scratch-repository check recorded in [f084-scratch-repo-check.md](../acceptance/f084-scratch-repo-check.md). |
| Reviewed | 2026-11-18 |

</details>

---

### F-091

**Apply the project harness to a repository as a coding job**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟣 Very large |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Owner job 2026-11-14: "apply the harness to this project". It is a coding job (F-084) that uses the apply-harness skill from a pinned template release. |
| **Reproduce** | Ask NERV to apply the harness to a scratch repository. |
| **Check** | The job uses a pinned template tag, follows its APPLY procedure in a fresh worktree, runs the project's checks and opens a PR behind approval like any coding job; it never applies an untagged or cached template as a release. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-18: F-091-T02 moved from the owner to the agent. Owner decision 2026-11-18: the agent runs this itself (over SSH to nerv-linux or Tabgha, or the CLI on the Mac) and records the commands and output; the owner page stays as the procedure. Opened 2026-11-14 from the [owner jobs case study](../design/owner-jobs-case-study-2026-11-14.md), job 11. Priority P2 set by the owner for all case-study records, to be re-ranked.

**Estimates:** Estimated 2026-11-14: 0src/**,test/**docs/acceptance/** h agent over 2 steps, at agent speed before any design work. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #642](https://github.com/voidbrain/nerv/pull/642) (F-091-T03); [PR #639](https://github.com/voidbrain/nerv/pull/639) (`f091-harness-scratch-check.md`); [PR #635](https://github.com/voidbrain/nerv/pull/635); [PR #391](https://github.com/voidbrain/nerv/pull/391) (opened); [Owner jobs case study](../design/owner-jobs-case-study-2026-11-14.md) |
| Opened | 2026-11-14 |
| Verification | 2026-11-22: F-091-T01 verified (`runHarnessJobInWorktree`, `assertPinnedTemplateTag`, `buildHarnessPushProposal` behind `coding.push_pr` Orange gate); `node --test test/coding-job.test.ts` (7/7 passed) and `npm run check:fast`. 2026-11-22: F-091-T02 scratch-repository check recorded in [f091-harness-scratch-check.md](../acceptance/f091-harness-scratch-check.md). 2026-11-22: F-091-T03 gauntlet reruns (`multi-step-agent/*` + `nerv-system-flows/*`) passed; `node tools/gauntlet.mjs pending` and `npm run check:gauntlet-runs` exited 0. |
| Reviewed | 2026-11-18 |

</details>

---


## Closed 2026-11-20

### F-114

**Domain packs: turn FPV and Cooking on and off**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Owner question 2026-11-20: FPV and cooking are personal to the owner, not NERV core, and should be packs that can be switched on and off, with NERV as the hub. Today their stores, tools and chat phrases are wired straight into `store.ts`, `runtime-chat.ts`, `telegram.ts`, `server.ts` and `executors.ts`. |
| **Reproduce** | `grep -c -iE "batter\|fleet\|recipe\|cooking" src/store.ts src/runtime-chat.ts` on main 2026-11-20: 18 each. |
| **Check** | A pack manifest declares tools with effect classes, tables, chat phrases, Telegram captions and dashboard panels; `config.json` turns a pack on or off; a pack switched off offers no tools to Misato and shows no panel, and its data stays; reminders, todos, timers and photos stay in the core and packs use them; a phrase two packs claim is never silently routed to one; join tests across the registry, the planner tool list and the dashboard API; a live off-and-on check on the main base. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-22: F-114-T03 implemented: extracted pantry store/schema and cooking session chat handling into `src/cooking-pack.ts` registered via `src/packs.ts`, leaving zero cooking-session/pantry imports in `store.ts`, `runtime-chat.ts`, `telegram.ts`, or `server.ts` (16/16 passed across `packs`, `cooking-session`, `pantry`, `documents`). 2026-11-22: F-114-T02 implemented: extracted all FPV store, schema, Telegram phrase/photo, and HTTP fleet/photo wiring into `src/fpv-pack.ts` registered via `src/packs.ts`, leaving zero FPV module imports in `store.ts`, `runtime-chat.ts`, `telegram.ts`, or `server.ts` (verified across all 7 FPV/pack suites, 24/24 passed). 2026-11-21: F-114-T04 implemented: `RuntimeChat.chatOnce()` (`src/runtime-chat.ts`) checks `packRegistry.resolveChatPhrase()` and asks the owner back when two enabled packs claim the same message, never silently routing to one (`test/packs.test.ts`, test committed first). 2026-11-21: F-114-T01 implemented: `PackManifest`, `CoreServices`, `PackRegistry`, `validatePacksConfig()`, and `builtinPackRegistry` (`src/packs.ts`), `Config.packs` validation (`src/config.ts`), planner tool filtering (`src/brain-process.ts`, `src/runtime-planning.ts`), chat phrase gating (`src/runtime-chat.ts`), and `GET /api/packs` (`src/server.ts`) with unit and join tests (`test/packs.test.ts`). Opened 2026-11-20 from the owner's [FPV packs decision](../decisions/fpv-packs.md) (F-101-T02). F-114-T02 unlocks the FPV core extraction (F-101-T04). Related: F-113 (compact tool index) also shrinks what Misato sees; packs remove tools, F-113 shortens the ones that remain. Next: from tasks.

**Estimates:** Medium, estimated 2026-11-20: 6.75 h agent (F-114-T01 2 h, F-114-T02 2 h, F-114-T03 1.5 h, F-114-T04 1 h, F-114-T05 0.25 h). Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [FPV packs decision](../decisions/fpv-packs.md); opened in [PR #593](https://github.com/voidbrain/nerv/pull/593); F-114-T01 in [PR #621](https://github.com/voidbrain/nerv/pull/621); F-114-T02 in [PR #628](https://github.com/voidbrain/nerv/pull/628); F-114-T03 in [PR #629](https://github.com/voidbrain/nerv/pull/629); F-114-T04 in [PR #627](https://github.com/voidbrain/nerv/pull/627); F-114-T05 in [PR #641](https://github.com/voidbrain/nerv/pull/641); F-114-T06 in [PR #642](https://github.com/voidbrain/nerv/pull/642) |
| Opened | 2026-11-20 |
| Verification | 2026-11-22: F-114-T05 FPV pack off-and-on toggle check recorded in [f114-t05-fpv-toggle.md](../acceptance/f114-t05-fpv-toggle.md). 2026-11-22: F-114-T06 expensive system-flow reruns (`nerv-system-flows/stress` and `nerv-system-flows/browser`) passed; `node tools/gauntlet.mjs pending` and `npm run check:gauntlet-runs` exited 0. |
| Reviewed | 2026-11-20 |

</details>

---


## Closed 2026-11-21

### B-087

**Windows: a fenced start applied from an SSH session is refused by the startup fence**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Found 2026-11-18 on Tabgha (F-005-T24): a fenced install applied over SSH registered the task (after B-082), but `serve`, started by Task Scheduler in the desktop session, stopped with "Lifecycle startup is not authorized by the live selected operation" and the receipt stayed `uncertain`. The same install applied from Tabgha's desktop completed. The fence checks the applying handler's process identity (`processIdentity`, PowerShell `GetProcessById` start time and main module); the SSH session is elevated and in another logon session, so the desktop `serve` most likely cannot read it the same way. Not yet confirmed which part differs. Also seen: a task registered from the elevated SSH session cannot be deleted from the desktop ("Access is denied"). |
| **Reproduce** | Over SSH on Tabgha: `nodes lifecycle-inspect --action install`, then `lifecycle-apply`; `serve` logs the refusal in `service-error.log`. |
| **Check** | The differing identity part is named from a probe run in both sessions; a committed test fails first if the cause is in code; a fenced start applied over SSH completes on Tabgha, or the record states why it cannot and `lifecycle-apply` says so before changing anything. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-21 by [PR #613](https://github.com/voidbrain/nerv/pull/613). PR #612 refuses Windows lifecycle actions that start the service (install, start and update) when `SSH_CONNECTION` is present. The blocker is part of inspection/planning, so `lifecycle-apply` rejects the blocked plan before it creates the Task Scheduler task or lifecycle files; stop and uninstall remain available. A live read-only two-session probe on Tabgha confirmed the boundary: the SSH handler in session 0 could read its own `StartTime` and `MainModule`; a temporary least-privilege interactive task in session 1 could read neither value for that handler. The temporary probe task and files were deleted immediately and the NERV task was not changed. The join regression was committed failing first; the full CI matrix passed.

**Estimates:** Small, estimated 2026-11-18: 1.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #612](https://github.com/voidbrain/nerv/pull/612); F-005-T24 run on Tabgha, 2026-11-18; Test: `test/windows-service-lifecycle.test.ts` refuses an SSH-applied install before Task Scheduler or definition changes (committed failing first); read-only two-session probe 2026-11-21 |
| Opened | 2026-11-18 |
| Verification | 2026-11-21: PR #612 plan, validate, Windows, native-macOS, full-suite and all CodeQL analyses passed. Local: Windows lifecycle targeted suite 4/4; full suite 1,059 passed / 2 skipped; headless integration 5 passed / 1 Windows-only skipped; `check:fast` and production build pass. Live probe confirmed both process-identity parts are inaccessible from the desktop session. |
| Reviewed | 2026-11-21 |

</details>

---

### B-105

**An older running service rejects configuration written by newer code: `/api/models` fails**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Seen 2026-11-20 on the main base: the dashboard showed `GET /api/models: Unsupported updatePolicy field: schedule`. The service had started 2026-11-19 09:24 on `477d6afc`, before F-110-T02 (`48d4e74c`) taught `validateAutoUpdatePolicy` the `schedule` field; `config.json` was rewritten 2026-11-20 11:07 by newer code and now holds `updatePolicy.schedule`. Meanwhile the primary checkout moved six times by `git pull --tags origin main` (outside the `nodes lifecycle-*` flow), so the files on disk no longer matched the running process and nothing said so. |
| **Reproduce** | Run a service from a revision before `48d4e74c`; save the update schedule with current code against the same home; open the dashboard. |
| **Check** | Test committed failing first: a service whose validator predates a field in `config.json` answers the dashboard with a message naming the cause (configuration written by a newer NERV; update this base) instead of a raw validator error, and strict validation still rejects a field no NERV version knows; `nerv doctor` reports when the running service's revision differs from its checkout's HEAD; on the main base after an update through the lifecycle flow, `/api/models` loads. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-20: B-105-T01 implemented (`UPDATE_POLICY_FIELDS_BY_VERSION` version-skew error in `src/update-policy.ts`; `checkRevisionSkew` in `src/build.ts`, wired into `/api/doctor` in `src/server.ts` and `nerv doctor` in `src/cli.ts`; tested in `test/update-policy.test.ts` and `test/build.test.ts`). Opened 2026-11-20 at the owner's request. Immediate remedy, the owner's to run: `nodes lifecycle-inspect --action update` then `lifecycle-apply`, which restarts the service on code that knows `schedule`. Strict configuration validation is deliberate (an invalid file stops startup rather than falling back), so the fix names version skew; it does not silently accept unknown fields. Next: B-105-T02.

**2026-11-21 closure:** B-105-T02 passed on the main base. The checkout was already at `9b69150b` while a foreground `nerv launch` still ran `78ed6504`, so update and stop inspection refused safely. The authenticated stop endpoint ended that foreground runtime; a fresh fenced start plan had no blockers and `lifecycle-apply` completed `start` and `verify`. `/api/models` returned HTTP 200, `/api/doctor` reported `skewed: false` with both revisions at `9b69150b`, and `service status` showed launchd running `io.nerv.agent` from the managed checkout.

**Estimates:** Small, estimated 2026-11-20: 1.75 h agent (B-105-T01 1.5 h, B-105-T02 0.25 h). Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #599](https://github.com/voidbrain/nerv/pull/599) B-105-T01 (`src/update-policy.ts`, `src/build.ts`, `src/server.ts`, `src/cli.ts`, `test/update-policy.test.ts`, `test/build.test.ts`); opened in [PR #595](https://github.com/voidbrain/nerv/pull/595); owner report 2026-11-20; process start time and checkout reflog read on the main base |
| Opened | 2026-11-20 |
| Verification | 2026-11-21 Real-device: authenticated foreground stop; fenced start receipt `5a5d4615…` completed `start` and `verify`; `/api/models` HTTP 200; doctor `skewed: false` at `9b69150b`; launchd service running. Test: PR #599's failing-first version-skew and doctor regressions passed on green CI. Closure: PR #616. |
| Reviewed | 2026-11-21 |

</details>

---

### F-051

**Dashboard: a sortie shows where it runs and who contributed**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Owner test on Tabgha 2026-11-05: on Tabgha the chat shows *Misato is planning… (local models take 10–30 s per step)* but not that the request went to Neo Tokyo-3, and the previous sortie stays selected; a running sortie card always blinks MAGI whatever its phase; the flow shows only "ok" for the MAGI, so whether shadow or peer seats voted is not visible, and Plan · current action does not say whether a pilot advised; a node the sortie did not need (Misato's Apt when no approval was needed) looks the same as one that is unavailable. |
| **Reproduce** | Ask something on a base that is not the main one; select a finished sortie with a Green action; look at a running sortie's card. |
| **Check** | The chat line reads *Misato is planning* (no timing note) and, for a relayed request, *Forwarded to Neo Tokyo-3*; the forwarded request appears on the asking base as a sortie card that says where it runs and links to it, and the main base shows it as a sortie from that base; a new request (or a refresh) selects the running sortie (F-019); the running card names its phase (Misato, MAGI, approval, EVA, a pilot); the MAGI detail lists every seat's vote, shadow and peer seats marked; Plan · current action names the pilot that advised; a node not needed by the sortie is shown as skipped, distinct from unavailable; the Sephirot shows a relay step when the request came from or went to another base. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-20 (F-051-T06): recorded optional `evaInstance` (`{ jobId, evaClass, pilot }`) on `action.done` / `action.failed` events and `ActionDetail` (`src/events.ts`, `src/ledger.ts`, `src/ledger-queries.ts`), preserved it in `web/public/dashboard/live.js`, and added `sephirotEvaLabel()` in `web/public/dashboard/dashboard.js` so the Sephirot EVA cage (`#sd-eva`) shows the recorded pilot and EVA instance for running/finished actions, `pilot none · instance none` when absent, and `instance data unavailable` when live instance reporting is unavailable (`test/dashboard.test.ts`, `test/angular.browser.mjs`). F-051-T07 closed 2026-11-13: the owner chose **all sorties** for any enrolled base (every base is the owner's); the signed Kaji link already refuses unknown and revoked bases (test/kaji-link.test.ts, test/one-channel.test.ts), so no code changed and the choice is documented in docs/guides/kaji-and-nodes.md. 2026-11-13 (T01–T05): implemented authenticated cross-base sortie inspection (`POST /kaji/sortie` over signed Kaji link, `GET /api/bases/:baseId/sorties/:sortieId`, and live dashboard "Inspect on <base>" detail panel), truthful hub-and-spoke Kaji topology when a main base exists, directional Sephirot debrief return labels (`awaiting`/`returned from`/`reply to`), and explicit `(peer · shadow)` / `(peer · veto-only)` / `(shadow)` labels in MAGI detail verdicts. EVA cage pilot labels remain pending F-049 runtime isolation. See [2026 evidence archive](../archive/evidence-2026.md#f-051).

**Full audit 2026-11-13 (hypothesis, not a confirmed defect):** the peer-side `/kaji/sortie` handler (`src/cli.ts`, `onSortie`) ignores which base asks and returns the whole sortie with up to 100 events to any enrolled base, including a sortie that never involved that base, one held local-only, or one with tainted intake (F-027). Every base is the owner's and the line is signed, so this may be intended; the Check does not say. Owner decision in F-051-T07 ([options](../audits/2026-11-13-full.md#f051-scope)); remaining EVA cage labels are F-051-T06, after F-049-T09. All five earlier steps are closed.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 5 open steps total 5.75 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Re-estimated 2026-11-11 in agent hours (harness 5.6.0): the 5 open steps in hours total 9 h agent (steps table; method in each task basis). Day figures below are dated history. Medium remaining effort. Reassessed 2026-11-06: local rendering gaps repaired, but authenticated cross-base navigation and F-049 instance data still prevent closure; remaining work still needs browser/CI acceptance. Reassessed 2026-11-07: Raised to Large remaining effort: authenticated remote inspection, truthful directional base/channel topology and contributor/execution joins exceed three focused days; visual color/line tuning alone does not complete them.

| Field | Value |
|---|---|
| PR / evidence | [PR #604](https://github.com/voidbrain/nerv/pull/604) (F-051-T06); [PR #377](https://github.com/voidbrain/nerv/pull/377) [PR #374](https://github.com/voidbrain/nerv/pull/374) [full audit 2026-11-13](../audits/2026-11-13-full.md) peer inspection scope (F-051-T07) and the missing step for EVA cage labels (F-051-T06); [PR #371](https://github.com/voidbrain/nerv/pull/371) authenticated cross-base inspection and directional contributor topology (T01–T05); [PR #196](https://github.com/voidbrain/nerv/pull/196) remaining-effort reassessment;  [PR #195](https://github.com/voidbrain/nerv/pull/195) project tuning and regressions;  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #163](https://github.com/voidbrain/nerv/pull/163) channel telemetry and CI reconciliation;  [PR #162](https://github.com/voidbrain/nerv/pull/162) relay detail and acceptance review; Owner test on Tabgha 2026-11-05 |
| Opened | 2026-11-05 |
| Verification | 2026-11-21: F-051-T06 closed by PR #604 on green CI; its browser test rendered recorded EVA/pilot data and the distinct none/unavailable cases. Earlier cross-base, phase, seat and relay acceptance is recorded in the linked evidence archive. All F-051 steps are closed. |
| Reviewed | 2026-11-21 |

</details>

---

### F-056

**Slash commands in Telegram and the dashboard chat, and how much Aoba tells you**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🔴 Large |

💻 **→ Human action required: No**<br />Next: —.

| | |
|---|---|
| **Issue** | Owner question 2026-11-05: can commands be used from Telegram and the chat with "/"? At that report only `/start` had a dedicated path; other text went to Misato with a model call. Owner confirmed 2026-11-06 that `/status` gets a working reply from Aoba; at that time source still routed it through store.chat; the status/help slice below now provides deterministic acceptance. The owner also proposed `/log` to set how much is reported (all, conversation, …). |
| **Reproduce** | Send `/status` to Aoba and compare the returned facts with the records; check that the command router answers without a model and without a new sortie. |
| **Check** | The same commands in Telegram (registered, so typing "/" shows the list) and the dashboard chat, answered before Misato and without a model: `/help`, `/status` (this base's health, the other bases, cards waiting, the next reminder), `/cards` (with their buttons), `/reminders`, `/why S-…`, `/brief`, `/pilots`, `/bases`, `/spear [S-…]` (with a confirmation button), `/log conversation\|steps\|all` (conversation: replies and cards, the default; steps: also one line per action that ran; all: every trace line, advice, votes with shadow seats, other bases' results); read-only commands open no sortie, `/spear` and `/log` changes are recorded; an unknown command answers with `/help`. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-21: F-056-T05 completed: wrote [group and connected-account assessment](../design/telegram-group-and-connected-account-2026-11-21.md) evaluating multi-bot Telegram groups, official Business Bot vs MTProto user-client, and rejecting ambient browser impersonation; private-chat authorization remains unchanged. 2026-11-21: F-056-T04 implemented: `telegramCommands()` (`src/chat-command.ts`) registers the catalog via `setMyCommands` on `TelegramChannel.start()` (`src/telegram.ts`), `GET /api/commands` (`src/server.ts`) serves `COMMAND_CATALOG`, and the dashboard chat (`web/public/dashboard/index.html`, `dashboard.js`, `live.js`) shows a filtered `#slash-menu` when typing `/` (`test/chat-command.test.ts`, `test/telegram.test.ts`, `test/dashboard.test.ts`). 2026-11-21: F-056-T03 implemented: `/spear [S-XXXX]` returns confirmation details in dashboard chat (`RuntimeChat.chatOnce()`, `src/runtime-chat.ts`) and sends inline Confirm Spear / Cancel buttons in Telegram (`src/telegram.ts`, with `pendingRows` preserving non-approval rows and `spear:confirm`/`spear:cancel` callback handling); `/log conversation|steps|all` stores per-conversation verbosity and records the change in the ledger (`sorties.open` + `sorties.finish`); verified in `test/chat-command.test.ts` and `test/telegram.test.ts`. 2026-11-21: F-056-T02 implemented and merged in PR #619: dashboard and Telegram read commands use deterministic data, `/cards` carries inline decisions, and regressions establish zero model calls and zero new sorties. F-056-T01's catalog/router and the earlier `/status` history moved verbatim to the [2026 evidence archive](../archive/evidence-2026.md#f-056-moved-2026-11-21).

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 5 open steps total 5.75 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Medium remaining effort. Reassessed 2026-11-06: status/help entry points are implemented, while most commands, menu and verbosity controls remain.  Reassessed 2026-11-06: the observed /status reply adds human evidence, but the agreed deterministic router/menu and command checks remain unimplemented. Reassessed 2026-11-07: explicit prerequisite outcomes preserve the existing scope and remaining-work estimate; independent slices can proceed. Reassessed 2026-11-07: Raised to Large remaining effort: the shared command catalog, welcome/common-action UI and group/account-integration assessments exceed the current two-command surface; account messaging remains assessment scope, not an implemented integration.

| Field | Value |
|---|---|
| Depends on | [F-042](#f-042) — Record-reading interface for agency query commands |
| PR / evidence | [PR #626](https://github.com/voidbrain/nerv/pull/626) (F-056-T05); [PR #625](https://github.com/voidbrain/nerv/pull/625) (F-056-T04); [PR #624](https://github.com/voidbrain/nerv/pull/624) (F-056-T03); [PR #619](https://github.com/voidbrain/nerv/pull/619) (F-056-T02); [PR #608](https://github.com/voidbrain/nerv/pull/608) (F-056-T01); [PR #196](https://github.com/voidbrain/nerv/pull/196) remaining-effort reassessment;  [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #187](https://github.com/voidbrain/nerv/pull/187) reviewed prerequisite links;  [PR #167](https://github.com/voidbrain/nerv/pull/167) archive adoption/source review and CI reconciliation;  [PR #166](https://github.com/voidbrain/nerv/pull/166) map/tabs and Midori routing/status;  [PR #159](https://github.com/voidbrain/nerv/pull/159) unused-contract removal and owner-evidence reconciliation; Owner question 2026-11-05 |
| Opened | 2026-11-05 |
| Closed | 2026-11-21 |
| Verification | 2026-11-21 Unit/integration: PR #619 merged with required CI green; F-056-T02's dashboard and Telegram regressions cover `/cards`, `/reminders`, `/why`, `/brief`, `/pilots` and `/bases` without model calls or new sorties. 2026-11-06 Human: owner reports Telegram `/status` works. Remaining mutation commands, menu registration and verbosity controls stay open in later steps. |
| Reviewed | 2026-11-21 |

</details>

---

### F-111

**Typed results for tool calls**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Next: —.

| | |
|---|---|
| **Issue** | A tool call's result is `unknown` (`execute` in `src/executors.ts`) and its arguments are described in prose (`toolDocs`); a malformed result reaches the planner unchecked, and the planner is not told what a call returns. |
| **Reproduce** | Call any read tool (for example `reminders.list`) through the runtime and inspect the value handed back to the planner: nothing checks its shape. |
| **Check** | Every built-in read tool declares its result shape; the tool boundary refuses a result that does not match it with a named error; a join test runs planner → gate → executor → planner with a valid and a malformed result; the planner's tool docs show each result shape, and the prompt-size change is recorded. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-20: F-111-T01 implemented: `READ_TOOL_RESULT_SHAPES`, `resultShape` on `builtinToolDescriptors`, and `validateToolResult()` wired at the `execute()` boundary (`src/executors.ts`) with unit and gate/executor join tests (`test/read-tool-shapes.test.ts`). 2026-11-21: F-111-T02 implemented: `formatResultShape()` populates `ToolDoc.returns` for built-in read tools (`src/executors.ts`), `formatToolDoc()` (`src/misato.ts`) renders `Returns: ...` in `misatoAsk` and shares the exact line format with `measureMisatoPrompt()` (`src/prompt-samples.ts`). Measured `promptMetrics` on local route (`toolDocs`): before `promptTokens: 3968`, `toolSchemaTokens: 2609`, `toolSchemaShare: 0.6575`; after `promptTokens: 4141`, `toolSchemaTokens: 2782`, `toolSchemaShare: 0.6719` (+173 tokens). Opened 2026-11-20 from the [Agentica review](../reviews/2026-11-20-agentica.md) at the owner's request.

**Estimates:** Medium, estimated 2026-11-20: 3 h agent (F-111-T01 2 h, F-111-T02 1 h). Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [Agentica review 2026-11-20](../reviews/2026-11-20-agentica.md); opened in [PR #587](https://github.com/voidbrain/nerv/pull/587); F-111-T01 in [PR #611](https://github.com/voidbrain/nerv/pull/611); F-111-T02 in [PR #618](https://github.com/voidbrain/nerv/pull/618) |
| Opened | 2026-11-20 |
| Closed | 2026-11-21 |
| Verification | 2026-11-21 Unit/integration: PR #611 merged with green CI (F-111-T01); F-111-T02 passed the directed 38/38 tests and `check:fast`, then PR #618 merged with required CI green. |
| Reviewed | 2026-11-21 |

</details>

---


## Closed 2026-11-22

### B-073

**Windows CI: the service lifecycle test times out a lifecycle command**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Found 2026-11-18 on PR #507 (no lifecycle change): the `windows` job failed `test/windows-service-lifecycle.test.ts:104` ("windowsServiceAdapter executes install, status, start, stop and uninstall under the fencing journal") with "Lifecycle command timed out; effects remain uncertain." from `src/node-lifecycle-execution.ts`. First seen; the same day B-072 showed another Windows timing failure. |
| **Reproduce** | Run `npm test` on the Windows runner; the failure is intermittent. |
| **Check** | The slow command and its bound are named from the CI log or a local trace; a committed test fails first if the cause is in code, or the bound is set from measured Windows timings; the Windows job passes without reruns. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-18: B-073-T01 implemented. Cause: `applyService` recorded its own handler identity by spawning a real cold `powershell` (`processIdentity`) under the generic 15 s command bound, outside the test's injected runner; Windows CI passed 15 s on that single call (run 44208231306 and attempt 3 of run 44259214063, after a first fix that only queried once per process). Fix: `ServiceHost.identity(pid)`; the Windows adapter asks through its own runner with a 60 s bound (`WINDOWS_IDENTITY_TIMEOUT_MS`, a read-only query), and both apply and the startup check use it, so the test spawns no real process. Verification: the Windows job passes without reruns. Opened 2026-11-18 in [PR #507](https://github.com/voidbrain/nerv/pull/507). Failed run: job 134498480987 of run 44213770369.

**Estimates:** Small, estimated 2026-11-18: 1 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #508](https://github.com/voidbrain/nerv/pull/508); Test: `test/node-lifecycle-execution.test.ts` "the handler identity of the running process is queried once…" (committed failing first); `test/windows-service-lifecycle.test.ts` "B-073: the Windows adapter asks the process identity through its own runner with a 60 s bound" (committed failing first, 922c075c). CI run 44213770369 (windows job failed) |
| Opened | 2026-11-18 |
| Verification | 2026-11-22: PR #508 merged with green CI (including windows); closed in [PR #648](https://github.com/voidbrain/nerv/pull/648). |
| Reviewed | 2026-11-22 |

</details>

---

### B-074

**Windows CI: the real-CLI root-binding export/import test sees no exit status**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Found 2026-11-18 on PR #508 (no change to root migration): the `windows` job failed `test/root-migration.test.ts:599` ("real CLI export/import propagates migrated root binding to a new profile without private root material") at line 623 with `null !== 0`: the CLI child ended without an exit status (killed, most likely by a timeout). First seen; B-072 and B-073 were Windows timing failures too. |
| **Reproduce** | Run `npm test` on the Windows runner; intermittent. |
| **Check** | The cause is named from the CI log or a local trace; a committed test fails first if it is in code, or the bound comes from measured Windows timings; the Windows job passes without reruns. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-18: B-074-T01 implemented in [PR #508](https://github.com/voidbrain/nerv/pull/508): the cause is the test's 5 s `spawnSync` bound (status `null` = killed at the bound), not the CLI: a CLI start takes 0.2–0.3 s locally and the Windows suite runs 5–6x slower under load (374–480 s against 66–77 s). The three spawned-CLI bounds in `test/root-migration.test.ts` are now 30 s. No failing-first test: the cause is a test bound, not product code. Verification: the Windows job passes without reruns. Opened 2026-11-18 in [PR #510](https://github.com/voidbrain/nerv/pull/510) during the verification sweep of implemented steps. Failed: windows job 134648345069 of run 44259214063 (PR #508, first attempt).

**Estimates:** Small, estimated 2026-11-18: 1 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #508](https://github.com/voidbrain/nerv/pull/508) (`test/root-migration.test.ts`). No test: test timeout bound adjusted from measured Windows timings. |
| Opened | 2026-11-18 |
| Verification | 2026-11-22: PR #508 merged with green CI (including windows); closed. |
| Reviewed | 2026-11-22 |

</details>

---

### B-075

**Windows CI: Telegram checkpoint and quiet-hours tests time out**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Found 2026-11-18 in the history of the `windows` job: on 2026-11-16 (PR branch `feat/f-089-t02-browser-click`, no Telegram change) two tests failed in one run: "F-003: failed Bot delivery keeps its checkpoint across restart, retries once accepted, and is not replayed" and "F-026: Telegram defers proactive cards and resumed replies during quiet hours…". Not seen since in 20 clean Windows runs; recorded so it is not lost. |
| **Reproduce** | Run `npm test` on a slow Windows runner; F-003 timed out in five runs on 2026-11-18 and 2026-11-19. |
| **Check** | The failure messages are read from the CI log and the cause named; a committed test fails first if it is in code; otherwise the record closes with the investigation and the remaining uncertainty stated. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-19: B-075-T02 implemented in [PR #571](https://github.com/voidbrain/nerv/pull/571). The F-003 checkpoint test timed out ("timed out after 15000ms") on Windows in five runs from 2026-11-18 to 2026-11-19, all on branches with no Telegram change: 44425362399, 44508724969, 44530198915, 44609450749 and 44631617976 (PR #570). Cause: the same as B-075-T01: a 15 s bound around three Runtime restarts and two `until` waits that may each take 15 s on Windows. Windows now gets 60 s, as F-026 does. No failing-first test: the cause is a test bound, not product code. Verification: the Windows job passes without reruns. 2026-11-18: B-075-T01 implemented in [PR #513](https://github.com/voidbrain/nerv/pull/513). The F-026 quiet-hours test timed out again on Windows (job 134698968962 of run 44274417465, PR #511: "timed out after 20000ms"). Cause: the test's 20 s bound, not a hang: it takes 0.84 s locally, makes several waits in a row that each may take 15 s on Windows (its `until` helper), and Windows CI ran 6–9x slower that day. Windows now gets 60 s. No failing-first test: the cause is a test bound, not product code. The F-003 checkpoint test of 2026-11-16 has not failed since. Verification: the Windows job passes without reruns. Opened 2026-11-18 in [PR #510](https://github.com/voidbrain/nerv/pull/510) during the verification sweep of implemented steps. Failed: windows job 133087302320 of run 43802969338 (2026-11-16).

**Estimates:** Small, estimated 2026-11-18: 1 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #513](https://github.com/voidbrain/nerv/pull/513) (B-075-T01), [PR #571](https://github.com/voidbrain/nerv/pull/571) (B-075-T02). No test: test timeout bounds adjusted from measured Windows timings. |
| Opened | 2026-11-18 |
| Verification | 2026-11-22: PR #513 and PR #571 merged with green CI (including windows); closed. |
| Reviewed | 2026-11-22 |

</details>

---

### B-092

**Every NERV command refused to create a missing base key (regression from B-084)**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Found 2026-11-18 re-enrolling NERV-03 after its revocation (F-005-T27): with the old key moved aside, `nerv base pubkey` answered "NERV data home … is not fully initialized (missing base-key, base.pub) … Create them first: nerv base pubkey". B-084 (PR #523) put the file check in `requireServiceHome`, which every host constructor calls, and the startup guard builds a host for every command when `~/.nerv-lifecycle` exists, so no command could create the key. Worked around on Calvary by calling `baseKey()` directly. |
| **Reproduce** | On a host with `~/.nerv-lifecycle`: move `~/.nerv/base-key` aside, run `nerv base pubkey`. |
| **Check** | Test committed failing first: `requireServiceHome` (host construction) needs only the data home; `requireServiceFiles`, called by `planService`, names missing files; B-084's test moves to `requireServiceFiles` with its requirement unchanged. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-18: B-092-T01 implemented. Opened 2026-11-18.

**Estimates:** Small, estimated 2026-11-18: 0.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #527](https://github.com/voidbrain/nerv/pull/527). Test: `test/node-lifecycle-execution.test.ts` "B-092: building a host needs only the data home…" (committed failing first). |
| Opened | 2026-11-18 |
| Verification | 2026-11-22: PR #527 merged with green CI; closed. |
| Reviewed | 2026-11-22 |

</details>

---

### B-097

**Merging a PR from the primary checkout pulls it past the running service**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Found 2026-11-19 preparing F-005-T29: `tools/merge-when-green.mjs` runs `gh pr merge` in the current directory; run from the primary checkout (on `main`), `gh` fast-forwards it (`pull --tags origin main` in the reflog after every merge since at least 2026-11-18 19:28). The primary checkout then holds a newer revision than the running service, against AGENTS ("never `git pull` it; it moves only through the `nodes lifecycle-*` update flow"), and the lifecycle plans read its runtime as unknown. |
| **Reproduce** | `cd ~/Projects/NERV/NERV && node tools/merge-when-green.mjs <PR>`; after the merge, `git reflog -1` shows `pull --tags origin main: Fast-forward`. |
| **Check** | Test committed failing first: `merge-when-green` runs `gh` with `--repo` from a directory outside any checkout, so no local branch moves; the template carries the fix and this project reconciles it. Until then the agent runs it only outside any checkout, with `GH_REPO` set. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-22 ([PR #658](https://github.com/voidbrain/nerv/pull/658)): owner approved (`B-097-T01`), fixed in `project-harness` PR #225 (released in `v10.2.0`), and reconciled into `tools/merge-when-green.mjs` in [PR #657](https://github.com/voidbrain/nerv/pull/657). Opened 2026-11-19. The tool is a harness file (`.harness.json` copied), so the fix goes to the template first (AGENTS, "Changing a harness file"): B-097-T01 is the owner's approval of that change. Workaround now (corrected 2026-11-19): run it from a directory outside any checkout with `GH_REPO=voidbrain/nerv`. Running it from a worktree does not help: `merge-when-green 536` run from a worktree still left `pull --tags origin main: Fast-forward` in the primary checkout's reflog (09:09:31), so the runtime read as unknown again until the owner put the checkout back. `merge-when-green 535` and `539` run from the scratchpad with `GH_REPO` merged and left the primary checkout's reflog unchanged.

**Estimates:** Small, estimated 2026-11-19: 1 h agent after approval. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Opened in [PR #537](https://github.com/voidbrain/nerv/pull/537) |
| Opened | 2026-11-19 |
| Verification | 2026-11-22: `project-harness` `test:tools` (274/274) and `NERV` [PR #657](https://github.com/voidbrain/nerv/pull/657) CI passed. |
| Reviewed | 2026-11-22 |

</details>

---

### B-100

**`nerv eva run-tools-03` never starts when the checkout is under `$HOME`**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Found 2026-11-19 in F-049-T13: the EVA-03 profile denies reading `$HOME`, and the checkout lives under it (on the owner's Macs and on CI's macOS runner). Node cannot resolve the tools process's entry: `EPERM, lstat '/Users/<user>'` while it walks the path, then `Cannot read package config …/package.json`. The tools process is also given the NERV home, which the profile denies on purpose. The F-049-T04 test passed because it checked only that the instance was discarded, not the exit code. EVA execution is not enabled, so no live job is affected. |
| **Reproduce** | `nerv eva run-tools-03` from a checkout under `$HOME`: exit 1, stderr `EPERM … lstat '/Users/<user>'`. |
| **Check** | Test committed failing first: from a checkout under `$HOME`, the tools process in EVA-03 exits 0 and lists tools; NERV state, keys and the rest of `$HOME` stay denied and the gate tests still pass (B-100-T01). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-19: owner decision (b), given earlier with Gemini's PR #560 (closed unmerged) and recorded here now: the tools process in EVA-03 reads `config.json` of the NERV home, read-only, and nothing else of it. B-100-T01 implemented: `readableStateFiles` opens named files of the state directory one by one (`literal`), after every deny; the directories above the read-only inputs give their metadata only, never a listing; `run-tools-03` reads the checkout's `src`, `node_modules` and `package.json`, and the tools process has a `--list` mode that prints one listing and exits (an EVA-03 instance has no IPC channel). Test committed failing first in `test/eva-runner.test.ts`: from a checkout under `$HOME` the fake MCP server's tools are listed, while `nerv.sqlite` and `base-key` next to `config.json` stay unreadable. Limit: an MCP server whose files live under `$HOME` (an npx cache) needs its own read-only path. Awaiting CI on [PR #568](https://github.com/voidbrain/nerv/pull/568). 2026-11-19: opened from the F-049-T13 probe. Allowing the metadata of the directories above the read-only paths moves the failure to reading the checkout's `package.json`; what the tools process may read (its config inside the NERV home) needs a decision before the profile changes. Until then every failed `eva run-tools-03` adds an uncertain EVA receipt to `nerv eva jobs` for the owner to reconcile (review of PR #553). Opened 2026-11-19.

**Estimates:** Small, estimated 2026-11-19: 1.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Found in F-049-T13 ([PR #553](https://github.com/voidbrain/nerv/pull/553)); [PR #568](https://github.com/voidbrain/nerv/pull/568) B-100-T01. Test: `test/eva-runner.test.ts`. |
| Opened | 2026-11-19 |
| Verification | 2026-11-22: PR #568 merged with green CI; closed. |
| Reviewed | 2026-11-22 |

</details>

---

### B-101

**The dashboard says a model is down when the base is degraded for another reason, and never shows the reason**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Reported by the owner 2026-11-19 on NERV-01: the health card read "DEGRADED · Dummy Plug: reminders and rule-based actions keep running; requests that need a model fail with the reason below until it is back" while every route was reachable. The reason was the 03:02 Instrumentality run, which failed because the local route was down at night (it came back at 09:24); a failed latest run stays a degraded reason until a later one succeeds. The banner text is fixed in `web/public/dashboard/live.js`, the reasons it points to are never listed, and the bases map marks the base standby for any reason. |
| **Reproduce** | A failed Instrumentality run with all model routes reachable: the dashboard shows the model-failure banner with no reason, and the base as standby. |
| **Check** | Test committed failing first: the banner lists each reason; its model-failure sentence and the standby state appear only for a down model route or brain (B-101-T01). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-19: B-101-T01 merged: PR #559, CI run 44593061227 green on the first attempt; stays implemented until seen on NERV-01's dashboard after its next update. 2026-11-19: B-101-T01 implemented (`web/public/dashboard/live.js`): the DEGRADED banner lists every reason (escaped); its model-failure sentence, the bases map's standby state and the overview tile's "a model route is down" appear only when a reason is a down model route or brain (`modelDown`); otherwise the tile names the first reason. Test committed failing first: `test/degraded-banner.test.mjs`. Seen on the live dashboard once NERV-01 runs this revision. 2026-11-19: opened from the owner's report; doctor on NERV-01 showed `instrumentality` failed at 03:02 with `local-unavailable`, routes reachable. Opened 2026-11-19.

**Estimates:** Small, estimated 2026-11-19: 0.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Owner report, NERV-01 dashboard, 2026-11-19; [PR #559](https://github.com/voidbrain/nerv/pull/559) B-101-T01. Test: `test/degraded-banner.test.mjs`. |
| Opened | 2026-11-19 |
| Verification | 2026-11-22: PR #559 merged with green CI; closed. |
| Reviewed | 2026-11-22 |

</details>

---

### B-102

**Backlog IDs appear in text the owner sees: "(F-045)" on the dashboard's Skills tab, and in denial reasons and errors**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Reported by the owner 2026-11-20: the dashboard's Skills tab read "…grows through its own stages (F-045)." A scan of every string and template literal found ten more: EVA-03 and proactive-code denial reasons and a granted-tool reason ("(F-049)"), MCP write-grant errors ("F-021 slice 2"), a Misato prompt line a model could repeat ("(B-024)"), a restore warning ("under F-062"), the Windows launcher header ("(F-037)") and a load-forwarding error ("requires F-048 acceptance"). Backlog IDs belong to the repository, not to what the owner reads. |
| **Reproduce** | Open the dashboard's Skills tab, or be denied an EVA-03 tool: the text names a backlog ID. |
| **Check** | Test committed failing first: no string or template literal in `src/` or the dashboard script names a backlog ID (B-102-T01). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-20: B-102-T01 implemented in [PR #573](https://github.com/voidbrain/nerv/pull/573): the eleven strings keep their meaning without the ID; `test/user-text-ids.test.ts` (committed failing first, 11 strings) scans every string and template literal of `src/*.ts` and `web/public/dashboard/dashboard.js` with the TypeScript parser, so comments may still cite IDs. Verification: the Skills tab on NERV-01 after its next update. Opened 2026-11-20.

**Estimates:** Small, estimated 2026-11-20: 0.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Owner report, dashboard Skills tab, 2026-11-20; [PR #573](https://github.com/voidbrain/nerv/pull/573). Test: `test/user-text-ids.test.ts`. |
| Opened | 2026-11-20 |
| Verification | 2026-11-22: PR #573 merged with green CI; closed. |
| Reviewed | 2026-11-22 |

</details>

---

### B-103

**A channel-state privacy test fails whenever a timestamp contains "123"**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Found 2026-11-20 in CI run 44647978230 (PR #575, a docs and tooling reconcile): "failed relay and failed own-bot sends report failure without private error data…" (`test/channel-state.test.ts`) asserts the channel state never contains the fixture's private values, one of them the chat ID 123. The state carries ISO timestamps, and this one was `00:44:43.123Z`, so the check failed with no private data present. It fails whenever a timestamp in the state contains "123". |
| **Reproduce** | Run the test when a delivery timestamp's seconds or milliseconds produce "123" (for example `…:43.123Z`). |
| **Check** | The fixture chat ID is one no ISO timestamp can contain (987654321) and the privacy assertion matches it; the test passes. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-20: B-103-T01 implemented in [PR #578](https://github.com/voidbrain/nerv/pull/578): chat ID 987654321 in the fixture and in the assertion. No separate failing-first test: the defect is in the test itself, and the failing evidence is CI run 44647978230 (input `"at":"2026-11-20T00:44:43.123Z"`). The other numeric privacy assertions (`test/documents.test.ts`, `test/approval-delivery.test.ts`) cannot match a timestamp. Opened 2026-11-20.

**Estimates:** Small, estimated 2026-11-20: 0.25 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | CI run 44647978230 (PR #575); [PR #578](https://github.com/voidbrain/nerv/pull/578). Test: `test/channel-state.test.ts`. |
| Opened | 2026-11-20 |
| Verification | 2026-11-22: PR #578 merged with green CI; closed. |
| Reviewed | 2026-11-22 |

</details>

---

### B-104

**The Instrumentality daily-run test waits a fixed 400 ms and fails on a slow Windows runner**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Found 2026-11-20 on Windows in CI run 44650057242 (PR #578, a test-only change): "Instrumentality runs once a local day at its time, and a failed digest is not retried in a loop" (`test/instrumentality.test.ts`) found 0 digest attempts where it expects 2, after a fixed 400 ms wait. The idle-mode test below it had the same fixed wait and was changed to wait until the run happens. |
| **Reproduce** | Run the test on a loaded Windows runner: the scheduler has not run within 400 ms. |
| **Check** | The test waits until both attempts happened (up to 10 s), then 400 ms more in which a looping retry would show, and still expects exactly 2. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-20: B-104-T01 implemented in [PR #578](https://github.com/voidbrain/nerv/pull/578). No separate failing-first test: the defect is the test's wait, and the failing evidence is the Windows log of CI run 44650057242. The assertion still fails if a failed digest is retried in a loop. Verification: the Windows job passes without reruns. Opened 2026-11-20.

**Estimates:** Small, estimated 2026-11-20: 0.25 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | CI run 44650057242 (Windows); [PR #578](https://github.com/voidbrain/nerv/pull/578). No test: polling helper replaced fixed 400 ms sleep for slow Windows runners. |
| Opened | 2026-11-20 |
| Verification | 2026-11-22: PR #578 merged with green CI (including windows); closed. |
| Reviewed | 2026-11-22 |

</details>

---

### F-027

**Naoko desk provenance and Ireul taint with an egress allowlist**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Email, web and third-party content can carry injected instructions. Durable provenance/taint is implemented; enforced egress remains missing. |
| **Reproduce** | Feed a sortie an email body that asks to send data elsewhere; run the same request from the owner directly. |
| **Check** | Every intake item records source and trust; taint propagates into the LCL and memory; a tainted context asking for an external effect is Pattern Blue; network egress only to Scrolls-allowed destinations; untrusted code runs in the EVA-03 quarantine class. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** T01 accepted 2026-11-09 after [PR #237](https://github.com/voidbrain/nerv/pull/237), exact head be60c19 / full CI42614209749, merged main81b1106. Durable intake/MCP/LCL/memory taint, approval/restart/conversation propagation and conservative legacy migration pass. Independent fresh-context review found reject-limit escalation, fixed and rechecked; final migration/clock-delta review also found no blockers.

T02 implemented 2026-11-20: Scrolls `egressAllow` (`src/policy.ts`, default-deny, validated by `validatePolicy`) enforced by `startEgressProxy` (`src/egress-proxy.ts`: HTTP/CONNECT allowlist, 128-bit IPv6/IPv4-mapped/DNS-rebinding and private/link-local/metadata IP blocking, HTTP redirect target validation) and wired into `runEvaJob` (`src/eva-runner.ts`) with Seatbelt port-only localhost proxy confinement (`eva-01`/`eva-02`) and fail-closed on missing sandbox, `eva-03`, or Linux `bwrap` host-netns. Review: fresh-context subagent review found Linux fail-open, IPv6/IPv4-mapped/obfuscated-IP bypasses, `eva-02` raw-egress bypass, `null` policy arrays, and `CONNECT` lifecycle bugs; all fixed and retested. Awaiting CI and `F-049-T14` production wiring before closure. 2026-11-20: merged in [PR #584](https://github.com/voidbrain/nerv/pull/584), CI run 44727701080 passed every job. T02 stays Implemented until its listed validation, the review of supported-platform confinement and deployment evidence, is done.

**Retained test references 2026-11-09:** [external-project assessment](../reviews/2026-11-09-external-agent-projects.md): AgentDojo supplies candidate hostile-tool-output cases; AgentFS is an F-049 filesystem-layer alternative to evaluate. T02 enforced egress remains blocked on F-049; neither reference supplies acceptance evidence.

**Estimates:** Re-estimated 2026-11-12 at 0.6x from `work-items calibrate` (harness 6.1.0; median 0.55x over 6 closed steps, bug steps 0.6x over 5): the 1 open step has 1.75 h agent (steps table; each task basis gives old → new). Figures after this sentence are dated history. Medium remaining effort, reassessed 2026-11-09: egress policy/enforcement integration and its acceptance remain after F-049 isolation; original estimate 2026-11-04.

| Field | Value |
|---|---|
| PR / evidence | [PR #584](https://github.com/voidbrain/nerv/pull/584) (T02 implementation); [PR #242](https://github.com/voidbrain/nerv/pull/242) retains/supersedes PR241 and adopts diagnostics;  Reference/operator documentation: [PR #241](https://github.com/voidbrain/nerv/pull/241); Acceptance: [PR #238](https://github.com/voidbrain/nerv/pull/238); [PR #237](https://github.com/voidbrain/nerv/pull/237); Review: independent fresh-context report in [provenance boundary](../reviews/2026-11-09-provenance-boundary.md), finding fixed and rechecked; [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #7](https://github.com/voidbrain/nerv/pull/7) (NERV M2a plan) |
| Opened | 2026-11-04 |
| Verification | 2026-11-22: PR #584 (F-027-T02) merged with green CI; closed. Earlier: 2026-11-20: 58/58 targeted tests + `check:fast` passed. |
| Reviewed | 2026-11-22 |

</details>

---

### F-076

**What reaches main is tested together, not only each PR on its own**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Branch protection requires only `validate` and `native-macos`, with `strict` off; CI runs on pull requests and on Mondays only (no push trigger). On 12–13 November 41 PRs merged, several in parallel and some with `full-suite` skipped by scoped verification, so the combination on main was not run in CI until the audit dispatched one. `windows` and `full-suite` are not required. |
| **Reproduce** | `gh api repos/voidbrain/nerv/branches/main/protection` and `.github/workflows/ci.yml` `on:`; compare `gh run list --branch main` with the merge times. |
| **Check** | The chosen option is in place (a repository setting or the CI workflow); a PR whose combination with main breaks a test cannot reach main unnoticed for more than a day; the choice is recorded here. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-22: F-076-T05 closed: `project-harness` v10.2.0 released `push: branches: [main]` in `ci.yml` (`F-086`, PR #227); reconciled `.github/workflows/ci.yml` and `tools/merge-when-green.mjs` (`v10.2.0`), closing `F-076`. 2026-11-18: F-076-T02 cancelled by the owner (no merge queue on a user-owned repository; F-076-T05 replaces it). F-076-T04 closed 2026-11-15: ([PR #454](https://github.com/voidbrain/nerv/pull/454)) the owner chose option 2, CI on every push to `main`, for every project: the harness template changes `ci.yml` first, NERV reconciles the release (F-076-T05). 2026-11-13: lowered to P3 by the owner. 2026-11-13: turning on the queue (F-076-T04) failed: GitHub refuses a merge_queue rule on a user-owned repository (`Invalid rule 'merge_queue'`; `voidbrain/nerv` is owned by a user), so the owner decides again. In place and harmless either way: the `merge_group` trigger, the queue-aware `merge-when-green` (8.7.0) and automatic deletion of merged branches (repository setting turned on the same day). F-076-T03 implemented 2026-11-13: template v8.7.0 (project-harness #156, design-reviewed) makes `merge-when-green` queue-aware; copied here. Next F-076-T04, the merge queue rule. F-076-T01 closed 2026-11-13: the owner chose option 3, a GitHub merge queue (free on this public repository), approved as recommended. Order: F-076-T02 CI runs on `merge_group`; F-076-T03 the template's `merge-when-green` waits for a queued PR to merge (template first, then reconcile); F-076-T04 turn on the merge queue rule for `main` with the required checks. Found by the full audit of 2026-11-13; the dispatched run on main is its evidence.

**Estimates:** Small, estimated 2026-11-13: a setting or a workflow trigger. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #657](https://github.com/voidbrain/nerv/pull/657) (v10.2.0 reconcile & F-076-T05 closure); [PR #386](https://github.com/voidbrain/nerv/pull/386) [PR #383](https://github.com/voidbrain/nerv/pull/383) [PR #382](https://github.com/voidbrain/nerv/pull/382) [PR #379](https://github.com/voidbrain/nerv/pull/379) [PR #374](https://github.com/voidbrain/nerv/pull/374) [full audit 2026-11-13](../audits/2026-11-13-full.md) |
| Opened | 2026-11-13 |
| Verification | 2026-11-22: `node tools/check-harness.mjs --strict` (`v10.2.0`), `npm run check:fast` pass; Review: fresh-context review of `.github/workflows/ci.yml`, `.harness.json`, and `tools/merge-when-green.mjs` passed (LGTM). 2026-11-18: F-076-T03 verified: [PR #382](https://github.com/voidbrain/nerv/pull/382) merged on green CI. |
| Reviewed | 2026-11-22 |

</details>

---

### F-078

**Model evaluation: the four candidate models by role and base, Mac and mini PC**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | The four candidate profiles in docs/agents/model-profiles.json (gemma4:12b, qwen2.5-coder:14b, devstral-small-2:24b, qwen3-coder:30b) are all unmeasured candidates. The Gauntlet ledger holds 55 runs, none with a model; the only real-model evidence is the gemma4:12b smoke of 2026-11-09 (7/10, three invalid structured outputs) and the B-021/B-049 Misato runs. Nothing measures the mini PC (Tabgha, NERV-02). The inventory of 2026-11-13 found `qwen2.5-coder:14b` on Neo Tokyo-3, not on Tabgha: Tabgha (Intel N97, 12 GB, no usable GPU) has only `qwen2.5:1.5b`, and none of the four candidates fits it. |
| **Reproduce** | [Inventory steps](../acceptance/f078-model-inventory.md); `node -e "console.log(require('./evals/gauntlet/ledger.json').runs.filter(r=>r.model).length)"`; docs/agents/model-profiles.json; [evaluation guide](../evaluations/README.md). |
| **Check** | Each approved model × role × base cell has a recorded run with model and base identity; each profile is qualified or not per role with evidence; the 2026-11-09 smoke failures are explained; F-006-T12 receives the comparison; new Gauntlet packs are adopted when released. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-22: F-078-T08 closed ([timeout rerun report](../evaluations/2026-11-22-f078-t08-timeout-rerun.md)): under the owner-approved 180 s per-case limit (`evals/gauntlet/limits.json`), `gemma4:12b` completed all 10 cases in `refusal-permission` (0/4) and `tool-use` (0/6) with zero timeouts and 0 pending cases left for `F-078-T08` in `evals/gauntlet/ledger.json`. 2026-11-22: F-078-T07 closed ([comparison report](../evaluations/2026-11-22-f078-t07-comparison.md)): `gemma-local` (`gemma4:12b`) qualified for Casper only (`5/5`), all other candidates (`qwen2.5-coder:14b`, `devstral-small-2:24b`, `qwen3-coder:30b`) marked `not-qualified` per role in `docs/agents/model-profiles.json`, and findings handed off to `F-006-T12`. 2026-11-22: F-078-T08 overnight rerun at minimal load ([report](../evaluations/2026-11-22-f078-t08-rerun.md)): the same three cases time out at 30 s with identical token counts, so load is not the cause; 9 cases remain pending (refusal-permission, five tool-use). Next: owner decides a longer case limit or another model for them. (2026-11-22: owner approved a longer per-case timeout for the 9 pending `F-078-T08` cases.) 2026-11-22: F-078-T08 campaign run on owner request ([report](../evaluations/2026-11-22-f078-t08-new-packs.md)): of the 28 new cases 7 passed, 11 failed, 3 errored on the 30 s case limit and 7 were not run after them; 17 cases stay pending. Earlier evidence: [archive](../archive/evidence-2026.md#f-078).

**Estimates:** 3.5 h agent + 0.75 h owner over 8 steps, estimated 2026-11-13; not a measurement. Campaign wall time on the hosts is extra and set by the budget in T02.

| Field | Value |
|---|---|
| PR / evidence | [PR #655](https://github.com/voidbrain/nerv/pull/655) T08 timeout rerun & closure; [PR #646](https://github.com/voidbrain/nerv/pull/646) T07 comparison; [PR #643](https://github.com/voidbrain/nerv/pull/643) T09 Tabgha campaign; [PR #634](https://github.com/voidbrain/nerv/pull/634) T08 rerun; [PR #630](https://github.com/voidbrain/nerv/pull/630) T08 campaign; [PR #475](https://github.com/voidbrain/nerv/pull/475); [PR #477](https://github.com/voidbrain/nerv/pull/477) (merged; CI green); Gauntlet 0.9.0 pin and harness 8.15.0 reconciliation prepared for PR #427; [PR #403](https://github.com/voidbrain/nerv/pull/403) T03 close; [PR #402](https://github.com/voidbrain/nerv/pull/402) T03; [PR #379](https://github.com/voidbrain/nerv/pull/379) [PR #377](https://github.com/voidbrain/nerv/pull/377) [PR #375](https://github.com/voidbrain/nerv/pull/375) plan; owner request 2026-11-13; [Gemma smoke 2026-11-09](../evaluations/2026-11-09-gemma-common-smoke.md); docs/agents/model-profiles.json |
| Depends on | — |
| Opened | 2026-11-13 |
| Verification | 2026-11-22: F-078-T09 Tabgha campaign (local `qwen2.5:1.5b` / `qwen2.5:3b`, remote `gemma4:26b` / `qwen2.5-coder:14b` to Neo Tokyo-3, asleep probe, memory stats) recorded in [2026-11-22-f078-t09-tabgha-campaign.md](../evaluations/2026-11-22-f078-t09-tabgha-campaign.md); verified with `npm run check:fast`. 2026-11-16: T04/T06 report per-role model outcomes and aggregate metadata; PRs #475/#477 plan, validate, Windows and native-macos passed, full-suite skipped. 35 cases remain pending: 28 under F-078-T08 and seven system-flow cases under F-079. 2026-11-14: T03 recorded 144/144 graded outcomes across the three approved models and three packs; `node tools/gauntlet.mjs pending` exits 0; PR #402 CI run 43595307489 passed plan, validate, Windows, native-macos and full-suite on rerun after one transient Windows temp-directory cleanup failure. |
| Reviewed | 2026-11-22 |

</details>

---

### F-107

**Kaji map: routes and the heartbeat mesh, readable base names and status colours**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | Owner request 2026-11-18, after NERV-03 joined: with a main base the map drew only peer-to-main lines, so it showed routing but not that every pair of bases exchanges heartbeats (Tabgha and Calvary talk directly); base names were all capitals; the names in the list under the map did not follow their base's status; peer-to-main lines used the accent colour rather than a "communicating" green. |
| **Reproduce** | Dashboard with three enrolled bases and a main base: map and list under it. |
| **Check** | Routes to the main base are green while both ends are up; peers are joined by a thin neutral dotted heartbeat-mesh line that carries no pulses; base names keep their case; list names take their status colour; legend and design notes say so (F-107-T01). The mesh line is coloured from both peers' own reports once heartbeats carry them (F-107-T02). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-22: F-107-T02 closed: `KajiLink` heartbeats exchange validated enrolled `reachable` peer lists, `RuntimeBases` exposes them via `/api/bases`, and `live.js`/`dashboard.js` colour mesh lines `--ok` (mutual), `--warn` (one-way), or `--muted` (unreported). 2026-11-18: F-107-T01 closed on the owner's live check of NERV-01 at 228ab45 (lowercase names, status-coloured names, green main↔peer lines, dotted mesh). Midori lost its distinct blue: B-095. 2026-11-18: also folded the revoked bases under a closed "Revoked (n)" section (the registry keeps them) and shortened the header to "● Midori live / failed / unchecked". 2026-11-18: owner follow-up: Midori takes the bases' status colours (green while the Bot API responds, matching the header's "API live"; it was blue), and its message dots turn `--info` so they stay visible; base pulses already used status colours. Opened 2026-11-18 at the owner's request. F-107-T01 implemented: `live.js` builds `route` and `mesh` links and keeps names' case; `dashboard.js` draws them; list names use `baseTone`; legend and `docs/design/dashboard-and-native-ui.md` updated; `test/dashboard.test.ts` covers three bases (routes, mesh, names, colours).

**Estimates:** Small, estimated 2026-11-18: 1.5 h agent over two steps. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #649](https://github.com/voidbrain/nerv/pull/649) (F-107-T02); `test/dashboard.test.ts` (B-065 bases test extended) |
| Opened | 2026-11-18 |
| Verification | 2026-11-22: `test/kaji-link.test.ts` (`F-107-T02`) and `test/dashboard.test.ts` (`F-107-T02`) + `npm run check:fast` passed. Earlier: 2026-11-18: CI green (PR #521) and the owner's live dashboard check. |
| Reviewed | 2026-11-22 |

</details>

---

### F-112

**Script plans over read-only tools**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Next: from tasks.

| | |
|---|---|
| **Issue** | A request that needs several reads (for example the reminders of each of the next seven days) takes one planner step per tool call, repeating context each time. Code-mode frameworks let the model write one short script over the calls instead. |
| **Reproduce** | Ask Misato for something that needs the same read tool several times and count the planner steps in the sortie record. |
| **Check** | A design note says which script subset is allowed, where it runs (an EVA instance), how every call inside it still passes the MAGI gate, and its limits; the owner decides whether to adopt it. If adopted: read-only tools only, one gate decision per call, time/call/output budgets, fail-closed outside EVA; a Gauntlet case compares planner steps and tokens with and without scripts. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-22: F-112-T04 closed: registered `nerv-system-flows/script-plans` in `evals/suite.json`, `evals/gauntlet/runners.json`, and `evals/gauntlet/system-v1.json`, ran the deterministic comparison on a neutral 4-read request (`test/script-plan.test.ts`: 5 -> 2 planner steps, 21,861 -> 8,835 total tokens, 4/4 gated calls), recorded the Gauntlet run in `evals/gauntlet/ledger.json`, and documented results in [the script-plan comparison](../evaluations/2026-11-22-f112-t04-script-plan-comparison.md). 2026-11-22: F-112-T03 closed: `src/script-plan.ts` parses/validates the declarative read-only subset (forbidding non-read tools, computed tool names, and direct/indirect result-derived arguments), runs inside a fresh EVA-03 instance via `onBridgeLine` in `src/eva-runner.ts` with per-call MAGI gating and tool fingerprint checks in `src/runtime-planning.ts`, and fails closed when EVA-03 is unavailable; `test/script-plan.test.ts` (4/4) and `check:fast` pass. Next: `F-112-T04`. 2026-11-22: F-112-T02 closed: owner approved adopting script plans under [the script-plan design note](../design/script-plans.md); next is `F-112-T03`. 2026-11-21: F-112-T01 implemented in [the script-plan design note](../design/script-plans.md): a deliberately small declarative subset runs only in a fresh EVA-03 instance, sees only registered read tools, and returns every individual call through schema validation, MAGI, a distinct grant, the existing tools boundary and durable receipts. Explicit call/iteration/time/output budgets and fail-closed recovery preserve the ordinary planner path when isolation is unavailable. Fresh-context design review passed after the note capped encoded IPC envelopes below the existing frame limit, preserved uncertainty for in-flight calls after EVA teardown, forbade result-derived call arguments pending verified Scrolls/provenance enforcement, pinned tool fingerprints, and named the repaired-boundary tests. Next: F-112-T02, the owner adoption decision.

**Estimates:** Medium, estimated 2026-11-20: 6.5 h agent and 0.25 h owner (F-112-T01 1.5 h, F-112-T02 owner decision, F-112-T03 4 h, F-112-T04 1 h). Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #653](https://github.com/voidbrain/nerv/pull/653) (closure); [PR #652](https://github.com/voidbrain/nerv/pull/652) (F-112-T04); [PR #651](https://github.com/voidbrain/nerv/pull/651) (F-112-T03); [PR #647](https://github.com/voidbrain/nerv/pull/647) (F-112-T02 approval); [PR #614](https://github.com/voidbrain/nerv/pull/614) (F-112-T01); [Agentica review 2026-11-20](../reviews/2026-11-20-agentica.md); opened in [PR #587](https://github.com/voidbrain/nerv/pull/587) |
| Opened | 2026-11-20 |
| Verification | 2026-11-22: PR #651 (`F-112-T03`) and PR #652 (`F-112-T04`) merged on green CI (`plan`, `validate`, `native-macos`, `windows`, `full-suite`); deterministic 4-read comparison recorded in `docs/evaluations/2026-11-22-f112-t04-script-plan-comparison.md` (5 -> 2 steps, 21,861 -> 8,835 tokens). |
| Reviewed | 2026-11-22 |

</details>

---

<a id="archive-week-2026-11-23"></a>
## Closed 2026-11-23

### B-095

**On the map Midori looks like a base: it lost its own blue**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔹 P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-23.

| | |
|---|---|
| **Issue** | Owner report 2026-11-18 after F-107: Midori now takes the bases' status colours (green while live), so on the map it reads as one more base. It is the Telegram channel, not a base. |
| **Reproduce** | Live dashboard with Midori live: its node and dots are green like the bases. |
| **Check** | Test committed failing first: Midori's node keeps the `--info` blue; only its status dot and label take green, amber or grey. The owner confirms on the live dashboard. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-22 ([PR #658](https://github.com/voidbrain/nerv/pull/658)): Updated per owner feedback: `drawTelegram` uses `--info` blue when connected/responding, `--warn` when failed, `--muted` when offline/unknown, removes the extra status dot, draws expanding blue contour waves when connected, and animates route lines back-and-forth (`Math.sin(now / 650) * 8`); `test/dashboard.test.ts` updated failing-first and passes. 2026-11-18: B-095-T01 implemented: `drawTelegram` keeps the node ring and dotted links in `--info` and adds a small status dot beside the node; the dot and the *Midori* label take `--ok` / `--warn` / `--muted`; legend *○ Midori* in `--info`; design note updated. Test committed failing first (`test/dashboard.test.ts`, B-095). Next: the owner's live check after the update. Opened 2026-11-18 from the owner's F-107-T01 check. The owner suggested a phone mark near Midori or the old blue; the agent proposes the blue node with a status dot.

**Resolution:** Closed 2026-11-23 as Verified: the agent opened the live NERV-01 dashboard (main `2e0c1996`) in headless Chrome at the owner's request; the map draws Midori as a small blue node with a blue label and a blue link, apart from the square bases.

**Estimates:** Small, estimated 2026-11-18: 0.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | Fix in [PR #531](https://github.com/voidbrain/nerv/pull/531) (`test/dashboard.test.ts`, B-095); opened in PR #530 |
| Opened | 2026-11-18 |
| Closed | 2026-11-23 |
| Verification | 2026-11-18: Unit: B-095 test failed before the fix, passes after (dashboard suite 36 pass). Owner live check pending. |
| Reviewed | 2026-11-23 |

</details>

---

### F-108

**Dashboard: flow header shows the sortie code; EVA cage status on its own line**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | 🔹 P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-23.

| | |
|---|---|
| **Issue** | Owner requests 2026-11-18: the *Sephirot · sortie flow* header shows the sortie code only (for example S-6E26), not code and title; in the EVA cages, the status (IDLE and the others) sits on its own line under the EVA name so every cage has the same layout. |
| **Reproduce** | Dashboard: select a sortie; look at the EVA cages panel. |
| **Check** | Tests on the rendered header and cage markup; the owner confirms on the live dashboard. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-19: F-108-T01 implemented: The flow header shows the sortie code only; each EVA cage stacks its name and status (`.cage .ch` in a column). Test `test/dashboard.test.ts` (F-108). Next: the owner's live check after the update. Opened 2026-11-18 from the owner's dashboard review.

**Resolution:** Closed 2026-11-23 as Verified: the agent opened the live NERV-01 dashboard (main `2e0c1996`) in headless Chrome at the owner's request; with S-15E3 selected the flow header reads only `S-15E3`, and the EVA cage node shows its pilot and instance on their own line.

**Estimates:** Small, estimated 2026-11-18: 0.5 h agent. Not a measurement.

| Field | Value |
|---|---|
| PR / evidence | [PR #650](https://github.com/voidbrain/nerv/pull/650) (Settings hours, editable Brief, Update now, 3-up Pilot cards); [PR #533](https://github.com/voidbrain/nerv/pull/533) (`test/dashboard.test.ts`); opened in PR #531 |
| Opened | 2026-11-18 |
| Closed | 2026-11-23 |
| Verification | 2026-11-19: Unit: dashboard suite 38 pass. Owner live check pending. |
| Reviewed | 2026-11-23 |

</details>

---

## Closed 2026-11-24

### B-106

**Sephirot flow: answer edge lags behind Debrief activation and marker arrowheads lack fill**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-24.

| | |
|---|---|
| **Issue** | Owner report 2026-11-22 on S-F11B: after Misato (`plan`), `DEBRIEF` activates before the `plan → debrief` (`answer`) line lights up, and arrowheads on `answer` and `sync → apt` (`MISATO'S APT`) do not render filled (`fill: none` on `.sephirot svg.edges path` matched `<marker><path>` and `context-stroke` failed to fill). |
| **Reproduce** | Open the live dashboard EVA full view on an answer-only sortie (`S-F11B`) and inspect the `plan → debrief` and `sync → apt` edges. |
| **Check** | Test committed failing first: `.sephirot svg.edges > path` leaves `<marker>` arrowheads filled, `drawEdges` emits explicit per-state markers (`#edge-arrow`, `#edge-arrow-passed`, `#edge-arrow-owner`, `#edge-arrow-skip`), and `passedEdge` marks `answer` / `relay` / `declined` passed as soon as `debrief` is `on`, `wait`, or `done`. The owner confirms on the live dashboard. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** 2026-11-24 ([PR #692](https://github.com/voidbrain/nerv/pull/692)): `B-106-T02` closed: the owner confirmed on the live dashboard that S-F11B looks correct (answer edge lights with Debrief, arrowheads filled). 2026-11-22 ([PR #659](https://github.com/voidbrain/nerv/pull/659)): `B-106-T03` closed (`gauntlet-protocol@0.9.1` pin + owner-authorized `gauntlet:all --execute --allow-expensive --allow-models` passed all 4 `multi-step-agent/*` and all 8 `nerv-system-flows/*` cases; `gauntlet:pending` 0 pending). 2026-11-22 ([PR #658](https://github.com/voidbrain/nerv/pull/658)): Fixed `edgeShown` for `declined` (`apt → debrief`): removed `s.status !== "active"` and gated on `stepState(s, "debrief") === "on" || stepState(s, "debrief") === "done"`, so the arrow is hidden before `debrief` is active and visible/lit as soon as `debrief` activates (`test/dashboard.test.ts` committed failing-first). Opened and implemented 2026-11-22 (`B-106-T01` and `B-106-T03` closed; `B-106-T02` awaits owner live confirmation).

**Resolution:** Closed 2026-11-24 as Verified: all three steps closed; the owner's live confirmation of S-F11B completes the Check.

**Estimates:** Small, 0.5 h agent + 0.25 h owner.

| Field | Value |
|---|---|
| PR / evidence | [PR #692](https://github.com/voidbrain/nerv/pull/692) (closed); PR #644 (`fix/b-106-sephirot-arrows`). Test: `B-106: answer edge activates with debrief and Sephirot markers are filled cleanly without context-stroke` in `test/dashboard.test.ts`. |
| Opened | 2026-11-22 |
| Closed | 2026-11-24 |
| Verification | Human: 2026-11-24, owner confirmed S-F11B on the live dashboard. Unit: 2026-11-22: `node --test test/dashboard.test.ts` and `npm run check:fast` passed. |
| Reviewed | 2026-11-24 |

</details>

---

### B-109

**Blackbox analysis rejects a real Blackbox Explorer CSV export**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-24: PR #674 merged on green CI (run of 2026-11-23); the owner's real Blackbox Explorer CSV decodes.

| | |
|---|---|
| **Issue** | Found 2026-11-23 running F-100-T04 on the owner's real fleet log: Betaflight Blackbox Explorer's CSV export starts with about 150 `"key",value` settings lines before the column header, and `parseBlackboxCsv` took the first line as the header, so the analysis failed with "missing required time, gyroADC[0..2], or motor[0..3] columns". |
| **Reproduce** | Export a log to CSV with Blackbox Explorer and analyse it. |
| **Check** | Test committed failing first (`test/blackbox.test.ts`, B-109): a CSV with a settings preamble is read in full, using unfiltered gyro and eRPM; a CSV without a recognisable header still reports the missing columns. The real log then decodes (84,789 samples). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-24: PR #674 merged on green CI (run of 2026-11-23); the owner's real Blackbox Explorer CSV decodes. 2026-11-23: B-109-T01 implemented; the header is the first line naming the time and gyro columns. Verified on the owner's real log (F-100-T04).

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #674](https://github.com/voidbrain/nerv/pull/674) |
| Opened | 2026-11-23 |
| Verification | Unit/integration 2026-11-23: Test: test/blackbox.test.ts 4/4; the owner's real CSV export decodes (F-100-T04). CI: PR #674 green. |
| Reviewed | 2026-11-23 |

</details>

---

### B-114

**EVA-03 script-plan test fails under load**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-24: PR #694 merged on green CI; no EVA-03 script-plan failure in CI runs after it (reconciliation 2026-11-24).

| | |
|---|---|
| **Issue** | 2026-11-23: "executes inside EVA-03 with a MAGI gate decision per call, fails closed on denial/fingerprint change/missing sandbox" (`test/script-plan.test.ts:88`) and "F-112-T03: read-only script plans inside EVA-03" failed in PR #674's validate run and in a local full `npm test` while five agents loaded the machine; alone it passes 3/3. |
| **Reproduce** | Run `npm test` while the machine is busy (parallel gauntlet runs). |
| **Check** | The cause is named with evidence, a regression reproduces the load case, and the fix keeps the test green under load. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-24: PR #694 merged on green CI; no EVA-03 script-plan failure in CI runs after it (reconciliation 2026-11-24). 2026-11-24 ([PR #694](https://github.com/voidbrain/nerv/pull/694)): cause: case 8 of the EVA-03 test gave the script a fixed 120 ms budget that also had to cover sandbox start (43–48 ms idle, 51–71 ms under 36 busy shells); 24 parallel runs failed 21/24, all at script-plan.test.ts:233 (late receipt undefined, not completed_late). Fix: a warm-up measures sandbox start and the budget is max(500 ms, 4× start); a regression wraps the real sandbox with a 0.3 s delayed start. After: 24/24 and 36/36 parallel runs pass. B-114-T01.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #694](https://github.com/voidbrain/nerv/pull/694); Opened in [PR #687](https://github.com/voidbrain/nerv/pull/687). |
| Opened | 2026-11-23 |
| Verification | Unit/integration 2026-11-24: Test: test/script-plan.test.ts (delayed-start regression) 24/24 and 36/36 parallel runs; CI: PR #694 green, no recurrence in the CI runs of 2026-11-24 after it. |
| Reviewed | 2026-11-23 |

</details>

---

### B-116

**F-023 notice test fails when a random ID contains a forbidden word**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-24: PR #694 merged on green CI.

| | |
|---|---|
| **Issue** | PR #684 validate 2026-11-23: "F-023: approval and generic durable inbox notice commit together and survive restart" matched its forbidden-text regex (Private neutral fixture, 2099, grantId, args) against the whole serialized notice, whose random UUID can contain 2099. |
| **Reproduce** | Rerun the test until a UUID contains 2099 (rare). |
| **Check** | The assertion checks only the message text; a committed case with a UUID containing 2099 passes. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-24: PR #694 merged on green CI. 2026-11-24 ([PR #694](https://github.com/voidbrain/nerv/pull/694)): the forbidden-text regex now checks only the notice's message; the notice and approval must carry an exact field set (keeps args/grantId out); a regression builds a notice with fixed ids containing 2099. B-116-T01.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #694](https://github.com/voidbrain/nerv/pull/694); Opened in [PR #689](https://github.com/voidbrain/nerv/pull/689). |
| Opened | 2026-11-23 |
| Verification | Unit/integration 2026-11-24: Test: test/approval-delivery.test.ts (fixed ids containing 2099); CI: PR #694 green. |
| Reviewed | 2026-11-23 |

</details>

---

### B-117

**Gauntlet `nerv-system-flows/bases` and `browser` fail under machine load and pass alone**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-24: PR #710 merged on green CI; both gauntlet cases passed under load and alone.

| | |
|---|---|
| **Issue** | Seen 2026-11-23 in several landers and agents: the gauntlet cases `nerv-system-flows/bases` and `nerv-system-flows/browser` failed while other runs loaded the machine, and passed when run alone. A case that fails on load gives no evidence about the change under test and costs a rerun. |
| **Reproduce** | Run `npm run gauntlet:run` for `nerv-system-flows/bases` and `nerv-system-flows/browser` while another full `npm test` or gauntlet run loads the same machine; then run each case alone. |
| **Check** | The failing step of each case is read from its run output and its cause named (a fixed deadline, a shared port or profile, ordering); a regression reproduces the load case and fails before the fix; with the fix both cases pass under the same load, or the case states the bound that absorbs it. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-24: PR #710 merged on green CI; both gauntlet cases passed under load and alone. 2026-11-24: B-117-T01 implemented in [PR #710](https://github.com/voidbrain/nerv/pull/710): inspected all 10 failed native evaluation reports from 2026-11-23..24 across the worktrees. (1) `nerv-system-flows/browser` (5 of 5 failed runs: `2026-11-23T17-37-23.353Z`, `18-53-10.762Z`, `19-49-18.017Z`, `2026-11-24T02-33-47.812Z`, `04-07-18.460Z`): every run failed at `test/angular.browser.mjs:894` (`ticking dashboard chat checklist updates store`, `false !== true`). Cause: clicking `<input type="checkbox" data-checklist-toggle>` flips `checked = true` synchronously in the DOM before the `change` handler in `web/public/dashboard/live.js:195` finishes `await api("lists/toggle", { method: "POST" })` (while in flight `chk.disabled = true`); `until('...?.checked===true')` resolved before `POST /api/lists/toggle` reached `store.lists` under load. Fix: wait for `input[data-checklist-toggle="${milkItemId}"]:not(:disabled)` with `checked === true`, and align `test/angular.browser.mjs` Chrome startup (45 s) and `until` (15 s) budgets with `test/fixtures/browser.mjs`. (2) `nerv-system-flows/bases` (5 failed runs: 3 in `F-006-T11` before B-066 waited for both sides of `f.start()`; `2026-11-23T19-03-54.108Z` at `B-046: a healthy session survives an event-loop stall longer than the heartbeat budget` with `coordinator kaji.main 156ms ...; coordinator kaji.seen 156ms` exceeding the 150 ms non-Windows heartbeat/grace budget while both directions ran heartbeats in one process; `2026-11-24T06-51-41.546Z` at `test/worker-outbox.test.ts:188` timing out at 15 s below `STARTUP_MS = 30_000` while spawning a real `brain-process.ts`). Fix: `test/worker-link-heartbeat.test.ts` uses `hb = 400` and `fixture(400, 60000)` for the busy-slot and event-loop-stall cases (above 50–270 ms nervous IPC latency, single-direction heartbeat in the shared-process fixture); `test/worker-outbox.test.ts` uses `idle-brain.ts`, teardown `scope('worker-outbox')`, and 60 s / 30 s budgets (`>= STARTUP_MS`); `test/kaji-seats.test.ts` holds both reserved ephemeral ports across `Runtime` startup via `reservePorts(2)`. Regression `test/gauntlet-load.test.ts` committed failing first (3/3 failed before fix, 3/3 passed after). Both `nerv-system-flows/bases` and `nerv-system-flows/browser` pass concurrently under load and alone.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #710](https://github.com/voidbrain/nerv/pull/710) (Test: `test/gauntlet-load.test.ts`); [PR #692](https://github.com/voidbrain/nerv/pull/692) (opened) |
| Opened | 2026-11-24 |
| Verification | Unit/integration 2026-11-24: `node --test test/gauntlet-load.test.ts test/worker-outbox.test.ts test/kaji-seats.test.ts test/worker-link-heartbeat.test.ts` (24/24 pass); `npm run gauntlet:run` for `nerv-system-flows/bases` and `nerv-system-flows/browser` passed concurrently under load and alone (`npm run check:gauntlet-runs` and `npm run check:fast` pass). |
| Reviewed | 2026-11-24 |

</details>

---

### F-100

**FPV blackbox analysis for vibration**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-24: F-100-T04 done in PR #674 (merged on green CI): the real Supernova log decoded locally and reported with candidate causes and what the log cannot tell.

| | |
|---|---|
| **Issue** | Owner request 2026-11-14: "Smoke vibrates and shakes; props changed, the problem stays; the frame seems fine: frame, motors or ESC? Analyse the blackbox." NERV cannot read Betaflight blackbox logs. |
| **Reproduce** | Send a blackbox log of the shaking flight and ask what causes the vibration. |
| **Check** | Feasibility first: decode the log locally and read the gyro spectrum per axis and motor; then a report that names candidate causes with the evidence for each (motor-specific peaks, frame resonance, prop or ESC signs) and says what the log cannot tell. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-24: F-100-T04 done in PR #674 (merged on green CI): the real Supernova log decoded locally and reported with candidate causes and what the log cannot tell. 2026-11-23: F-100-T04 moved to the agent (owner: analyse Supernova, a fleet quad; Smoke shaking was an example). Real log 2026-10-10 (Betaflight 4.5.5, 84,789 samples at ~820 Hz, unfiltered gyro, bidirectional DShot eRPM, `debug_mode` 0) decoded after B-109: roll/pitch/yaw peaks 54.6/163.8/149.3 Hz at low throttle and 306.6/305/272.9 Hz at high throttle, all weak and none constant or throttle-tracking; no eRPM dropouts; M1 drive variation ~15% above M2, so the only candidate is a motor bearing (score 0.65) on M1; the log cannot name a loose screw or mount, and the eRPM-to-frequency mapping was not confirmed. A shaking flight with GYRO_SCALED and a throttle sweep would sharpen the report. F-100-T02 closed 2026-11-15: ([PR #454](https://github.com/voidbrain/nerv/pull/454)) decode with the WASM `blackbox-log` parser inside Node, locally; the owner records the real log with `debug_mode = GYRO_SCALED` and bidirectional DShot over a throttle sweep (F-100-T04, its page written by F-100-T03). F-100-T01 is feasibility; T02 the owner's decision; T03 is estimated after it.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #486](https://github.com/voidbrain/nerv/pull/486) (merged; CI green); [FPV blackbox feasibility](../design/fpv-blackbox-feasibility.md) (`F-100-T01`); Owner request 2026-11-14; [plan](../design/fpv-and-cooking-plan-2026-11-14.md); [PR #408](https://github.com/voidbrain/nerv/pull/408) |
| Opened | 2026-11-14 |
| Verification | 2026-11-18: F-100-T03 verified: [PR #486](https://github.com/voidbrain/nerv/pull/486) merged on green CI. `F-100-T01`: `npm run check:fast` passed. |
| Reviewed | 2026-11-18 |

</details>

---

### F-119

**Periodic skill discovery review**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-24: PR #709 merged on green CI; docs/reviews/skills/2026-11-24.md written, each candidate has an outcome.

| | |
|---|---|
| **Issue** | Owner 2026-11-23: enable the periodic skill review (reviews.skills.days 30, harness v10.4.0); discovery stays periodic, validity on updates is template F-089. |
| **Reproduce** | npm run check:freshness reports the skills review missing. |
| **Check** | docs/reviews/skills/<date>.md exists and each candidate has an outcome. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-24: PR #709 merged on green CI; docs/reviews/skills/2026-11-24.md written, each candidate has an outcome. 2026-11-24: F-119-T01 implemented in [PR #709](https://github.com/voidbrain/nerv/pull/709): wrote [docs/reviews/skills/2026-11-24.md](../reviews/skills/2026-11-24.md) reviewing recent commits, the 22-sample friction log, recurring owner and agent operations, domain CLI commands, procedure budgets and existing agent definitions; each of the six candidates ends in one of the four outcomes, and `npm run check:freshness` no longer reports the skills review missing.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #709](https://github.com/voidbrain/nerv/pull/709) ([2026-11-24.md](../reviews/skills/2026-11-24.md)); opened in [PR #689](https://github.com/voidbrain/nerv/pull/689). |
| Opened | 2026-11-23 |
| Verification | Documentation 2026-11-24: [2026-11-24.md](../reviews/skills/2026-11-24.md) written per docs/agents/skills.md; `npm run check:freshness` and `npm run check:fast` pass. |
| Reviewed | 2026-11-24 |

</details>

---

## Closed 2026-11-25

### B-121

**A re-targeted move can take over from a standby older than an epoch that ran**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-25: PR #717 and PR #721 merged on green CI (runs 45422935936, 45461777302); Check items automated (test/coordinator-partition.test.ts, test/coordinator-relocation.test.ts); Review: #721 four fresh-context design reviews.

| | |
|---|---|
| **Issue** | Found 2026-11-24 by the F-016-T08 mixed-epoch fixture: B promoted to epoch 3 and renewed through C; the owner then re-targeted the move to C at epoch 4. C's standby store still held epoch-2 state (nothing re-seeds it), yet readiness took over from it (previous epoch 2, previous main X revoked), so C would undo what B did at epoch 3 and could repeat it. The decision allows taking over from the standby's epoch only when the first target never promoted. |
| **Reproduce** | `test/coordinator-partition.test.ts`, "mixed epochs": X at 2; revoke X, main B at 3, B promotes and renews through C; main C at 4; `kaji promote` on C. |
| **Check** | C is refused (`standby_behind`) while any unrevoked base, C itself included, ran or acked a lease at a later epoch than C's standby state. T01 covers C's own acks; T02 (owner agreed the scope 2026-11-24) adds `ranOrAckedEpoch` to the signed `/kaji/epoch-push` reply and asks every other unrevoked base before any push, so a refused move leaves the running main acting. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-25: PR #717 and PR #721 merged on green CI (runs 45422935936, 45461777302); Check items automated (test/coordinator-partition.test.ts, test/coordinator-relocation.test.ts); Review: #721 four fresh-context design reviews. 2026-11-25 reconciliation: verified and closed. Every Check item is automated: [PR #721](https://github.com/voidbrain/nerv/pull/721) merged on green CI ([run 45461777302](https://github.com/voidbrain/nerv/actions/runs/45461777302) attempt 3; attempts 1 and 2 failed only on Windows in unrelated tests: telegram and watch-runtime with "nervous process not ready" (B-126) and three worker-link tests timed out (B-066)); [PR #717](https://github.com/voidbrain/nerv/pull/717) (B-121-T01) merged on green CI (run 45422935936). Review: #721 design review in a fresh context, four rounds, the fourth clean with three minors fixed in the PR (below). Left to other records: reply signatures not bound to the request ([B-125](../work/records/B-121.md#b-125)), `kaji relocate` fencing before the target's checks ([B-124](../work/records/B-121.md#b-124)). 2026-11-24 (#721 fourth check: clean, three minors): `kaji drain` does not stop the old main's service (the mesh helper had; it no longer does, and the earlier "it is stopped" rationale is corrected); the receipt now carries the drainer's `ranOrAckedEpoch`, and before any probe or push promote refuses `standby_behind` when it is later than the standby's state (closing the drained-main-with-a-standby-store residual) and `drain_receipt_invalid` unless the receipt hands the standby's epoch to this base at the epoch being promoted. Test first: a9acbed9 failed (X's receipt for B at 3 passed to C at 4: probe and push went out; drained X that acked B at 3 from its own standby store: "Missing expected rejection"); fix c54d3ef7. 2026-11-24 (#721 third check: one blocker, one minor): the planned branch dropped revoked skipped mains from the bases that must answer; revoking B does not undo epoch 3, which D acked (X drains to B at 3, B runs through D, B lost and revoked, D asleep, X drains to C at 4 listing B: C took over from epoch 2). Now any skipped main (listed or held here, revoked or not) makes a planned move need every unrevoked base to answer (the drained main is exempt only when it does not answer: its receipt answers for it) at or below the standby's epoch. Minor: the receipt's signature is verified before the probe and the push (a tampered receipt had passed them, fencing the running main, before readiness refused it). Test first: b79252bb failed ("Missing expected rejection"; tampered receipt: probe and push `[0, 4]`); fix 1f88cbef. 2026-11-24 (#721 re-check: two should-fix, one record): the drain refusal is replaced, keeping the adopted planned re-target (F-016-T07 SHOULD-FIX 3 test restored; it only passes the verified main records now) and its final-batch check. A receipt lists, signed, every main record the drained main holds between its epoch and the target (`skippedMains`); before any push a planned promote needs each listed base, and each its own registry names main in that range, to answer with `ranOrAckedEpoch` at or below the standby's epoch unless revoked (unanswered `old_host_unconfirmed`, newer `standby_behind`, field-less `peer_epoch_unknown`); a field-less reply whose signed `maxSeenCoordinatorEpoch` lies after the standby's epoch and before the new one also refuses a planned move. Test first: 1ff883e3 failed (reviewer repro and the planned re-target: the drain threw; older-peer planned move: "Missing expected rejection", C took over); fix 44100398. Reply signatures not bound to the request nonce: [B-125](../work/records/B-121.md#b-125). Earlier the same day (#721 review: one blocker, two should-fix): a drained, fenced old main gave a second receipt (X drained to B at 3; B ran through D; B and D asleep; main C at 4; X drained again; C took over from epoch 2 while B acted); fixed first by refusing that drain (385685e2, 52e7b874), now by the listed-base answers above. Should-fix 1: [B-124](../work/records/B-121.md#b-124) for `kaji relocate` fencing the running main before the target's checks. Should-fix 2: planned-path probe tests and the serve wiring (`coordinatorLeaseService.kajiOptions`) answering a real epoch push. 2026-11-24 (B-121-T02): `/kaji/epoch-push` replies carry `ranOrAckedEpoch`, the newest coordinator epoch in the base's stores or lease acks (`ranOrAckedCoordinatorEpoch`). After the local precheck, `kaji promote` probes every other unrevoked base with a record-free push (it commits nothing) and refuses `standby_behind` when any reports a later epoch than the standby's state; an unplanned move also refuses before any push when a base does not answer (`old_host_unconfirmed`) or answers without the field, an older NERV (`peer_epoch_unknown`); a planned move goes on, bound by its drain receipt. Test first: bb38e264 failed on main (mesh "B runs epoch 3 through D, re-target to C": "Missing expected rejection", C promoted from epoch-2 state; older-peer mesh: same; contract: reply lacked the field); fix bdec7c39. Three promote tests whose mocked peers answered unplanned pushes now report the field (requirement changed deliberately, B-121-T02). Open risk, not in scope: `kaji relocate` still pushes the records it signs, so a re-target signed while a coordinator runs fences it even if the target's promote is then refused. 2026-11-24 (#717 review should-fix 2): the `standby_behind` refusal came after the epoch push, so a refused re-target had already told B and D epoch 4 and nobody could act. `checkStandbyCandidate` (named main, verified standby, `standby_behind`) now runs before the push; B and D keep epoch 3 and B re-arms through D. Test first: a10429ff (mixed epochs, expectation changed deliberately: local refusals precede the push) failed (`registryOf(B).epoch` 4, expected 3); fix c45c5db1. 2026-11-24 (B-121-T01, [PR #717](https://github.com/voidbrain/nerv/pull/717)): `checkRelocationReadiness` refuses `standby_behind` when the candidate's `standby_lease_state` holds a later epoch than its store, before the service stops. Test first: commit f9a75fbd failed on main ("Missing expected rejection" in the mixed-epoch fixture); the fix (7ecbf37b) makes it pass. Open: B-121-T02, for when B renewed through another base (D), so C never acked epoch 3 itself.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #717](https://github.com/voidbrain/nerv/pull/717) (Test: `test/coordinator-partition.test.ts`, mixed epochs) · B-121-T02: [PR #721](https://github.com/voidbrain/nerv/pull/721) (Test: `test/coordinator-partition.test.ts`, B-121-T02; `test/coordinator-relocation.test.ts`, epoch-push witness) |
| Opened | 2026-11-24 |
| Verification | Unit 2026-11-24: `test/coordinator-partition.test.ts` and the coordinator suites pass locally, B-121-T02 included; full `npm test` 1375 pass, 0 fail (2 skipped) after the #721 fourth-check fixes; gauntlet: the 10 pending cases ran and passed again (ledger committed in PR #721). CI 2026-11-24: [run 45461777302](https://github.com/voidbrain/nerv/actions/runs/45461777302) (PR #721) green. |
| Reviewed | 2026-11-25 |

</details>

---

### F-115

**Grouped, alphabetical CLI help**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-25: PR #595 and PR #630 merged on green CI; test/cli-help.test.ts 4/4 at main 774a08f; gauntlet pending none.

| | |
|---|---|
| **Issue** | Owner report 2026-11-20: `nerv help` printed every command on one long line, in no order and without themes, and it had drifted: `batteries`, `fleet`, `skills`, `eva`, `seats` and others were missing. |
| **Reproduce** | `nerv help` on main before this change. |
| **Check** | `nerv help` groups commands by theme, sorts them alphabetically within each group and aligns the descriptions in one column within 100 characters; `nerv help COMMAND` prints that command's full usage and an unknown command says so; a test fails when a command the CLI dispatches is missing from the help or the help lists one it does not handle. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-25: PR #595 and PR #630 merged on green CI; test/cli-help.test.ts 4/4 at main 774a08f; gauntlet pending none. 2026-11-25 reconciliation (coordinator gap review): verified and closed. F-115-T01 ([PR #595](https://github.com/voidbrain/nerv/pull/595)) and F-115-T02 ([PR #630](https://github.com/voidbrain/nerv/pull/630)) closed, both merged on green CI. The Check holds at main `774a08f`: `node --test test/cli-help.test.ts` 4/4 pass (every dispatched command listed once and no command the CLI does not handle; groups sorted alphabetically; lines within the width with aligned descriptions; `nerv help COMMAND` gives full usage and an unknown command says so: `nerv help nope` prints "Unknown command: nope. Run nerv help for the list."); `node tools/gauntlet.mjs pending` lists none. Opened and implemented 2026-11-20: `src/cli-help.ts`, `test/cli-help.test.ts`. Next: from tasks.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #595](https://github.com/voidbrain/nerv/pull/595) (CI green); [PR #630](https://github.com/voidbrain/nerv/pull/630) (F-115-T02 gauntlet reruns, CI green); `test/cli-help.test.ts` |
| Opened | 2026-11-20 |
| Verification | Unit/integration 2026-11-25: `test/cli-help.test.ts` 4/4 at main `774a08f`; CI green on PR #595 and every main run since. |
| Reviewed | 2026-11-25 |

</details>

---

### B-082

**Windows: a service installed from an SSH session cannot register its logon task**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-25: PR #517 and PR #601 merged on green CI; live read-only SSH probe on Tabgha 2026-11-25: the rule's account maps to the registered task's SID.

| | |
|---|---|
| **Issue** | Found 2026-11-18 on Tabgha (F-005-T24): the fenced install over SSH ended `uncertain` at the register step; `schtasks /Create` with NERV's task XML answered "ERROR: No mapping between account names and security IDs" because the XML named `WORKGROUP\\<user>`: `renderService` used `USERDOMAIN\\USERNAME`, and an SSH session on a workgroup machine reports `USERDOMAIN=WORKGROUP`, which names no account (the account is `KITCHEN\\<user>`). |
| **Reproduce** | On a workgroup Windows machine, over SSH: `nodes lifecycle-inspect --action install`, then `lifecycle-apply`. |
| **Check** | Test committed failing first: `windowsServiceUser` gives `COMPUTERNAME\\user` for a local account (also when USERDOMAIN is WORKGROUP) and `USERDOMAIN\\user` when USERDNSDOMAIN is set; on Tabgha an SSH install registers the task. |
### F-021

**MCP and standardized tool/expert protocol**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🔴 Large |

💻 **→ Human action required: No**<br />Closed 2026-11-25: PR #563 merged on green CI run 44618006632; every step closed (T02 #381, T03 #547, T04 #556, T05 #563).

| | |
|---|---|
| **Issue** | Tool and expert integration is currently undefined; custom wrappers will not scale. |
| **Reproduce** | Register a tool/expert via MCP or OpenAPI descriptor; invoke from a task; confirm schema validation, capability scope and audit. |
| **Check** | Versioned tool descriptors (from MCP servers and NERV's own tools); deny-by-default capability binding to Misato and to each pilot (a pilot lists the tools it may use, F-045); works for local and remote (other-machine) endpoints; the registered tools are listed in the dashboard; no silent privilege escalation. (Wording corrected 2026-11-05: "expert roster (F-018)" predates F-045; tools are actions, skills are procedures, pilots are agents that use both.) |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-25: PR #517 and PR #601 merged on green CI; live read-only SSH probe on Tabgha 2026-11-25: the rule's account maps to the registered task's SID. 2026-11-25: B-082-T01 closed and the record closes. Its last clause ("on Tabgha an SSH install registers the task") was deliberately superseded by B-087 (PR #612, closed by #613): Windows now refuses install, start and update applied from an SSH session before any Task Scheduler change, so no SSH install can register a task by design. Live read-only probe on Tabgha over SSH (`SSH_CONNECTION` set, `USERDOMAIN=WORKGROUP`, `COMPUTERNAME=KITCHEN`), from a temporary clone of main fa9ab0b under `%TEMP%` (deleted afterwards; the NERV service, task and data untouched): `windowsServiceUser(process.env)` gives `KITCHEN\\<user>`, which maps to a SID; the old `USERDOMAIN\\USERNAME` form (`WORKGROUP\\<user>`) still fails to translate ("Some or all identity references could not be translated", the original error); the registered `NERV Agency` task's principal is that same SID, `KITCHEN\\<user>`. No owner action remains: the task installed from Tabgha's desktop already runs as the account the rule names. No review: records-only closure; the code merged in #517 and #601 (T02 had a fresh-context review). 2026-11-21: B-082-T02 closed by [PR #601](https://github.com/voidbrain/nerv/pull/601), CI run 44815656209 (plan, validate, Windows and native-macos passed; full-suite correctly skipped by scoped selection; CodeQL analyses passed). `windowsServiceUser` keeps every non-empty `USERDOMAIN` except `WORKGROUP`, so Entra ID (`AzureAD\\user`) and domain accounts survive SSH sessions without `USERDNSDOMAIN`; empty and workgroup domains still use `COMPUTERNAME\\user`. B-087 now makes the SSH limitation an up-front refusal; the remaining live install check runs from Tabgha's desktop after B-087 merges.
**Next action / closure evidence:** Closed 2026-11-25: PR #563 merged on green CI run 44618006632; every step closed (T02 #381, T03 #547, T04 #556, T05 #563). 2026-11-25: F-021-T05 closed and the record closes: PR #563 merged 2026-11-19 on CI run 44618006632 (plan, validate, windows, native-macos, full-suite and CodeQL passed on the first attempt; an earlier head's failed run 44609450749 was superseded by fixes in the PR). Live wiring checked on main: the dashboard's Tools panel (`web/public/dashboard/index.html` `#tools-list`) is filled by `loadTools` in `live.js` from `GET /api/tools` in `src/server.ts`; `test/tool-listing.test.ts` passes 3/3 on main. Every Check item has its step closed: versioned descriptors (T02, #381), deny-by-default per-pilot binding with no escalation without a grant (T03, #547), remote endpoints over Kaji with the same grant checks (T04, #556), dashboard listing with axe (T05, #563). No review: records-only closure; the code it cites merged through its own PRs (T04's had a fresh-context design review). 2026-11-19: F-021-T05 implemented: `GET /api/tools` (`src/tool-listing.ts`) lists NERV's own tools and the MCP tools granted now, with descriptor versions, grant and EVA class, and the suspended grants with why; the static dashboard has its own Tools panel (owner's choice, separate from the Marduk Institute pilots and Kaji's watermelons skills): granted MCP tools and suspended grants first, NERV's own in a collapsed list. Tests: `test/tool-listing.test.ts` (listing, the route through the server with and without a runtime, the panel's HTML and escaping) and axe on the panel in `test/evaluation.browser.mjs`. Awaiting CI on [PR #563](https://github.com/voidbrain/nerv/pull/563). 2026-11-19: F-021-T04 closed: PR #556, CI run 44573406969 green on attempt 2 (no macOS runner on attempt 1). 2026-11-19: Review of PR #556 (design-reviewer, fresh context): two blockers, fixed in the PR: (1) the approval refusal never rejected the card (its source failed the RPC schema, silently) and left the worker job open: now one store transaction rejects the card (source `kaji-mcp`) and finishes the job with the refusal the main base hears; (2) the MCP output reached the main base's sortie as trusted: it is now marked tainted when the result arrives, even after the sortie closed (`Ledger.taintLate`). Should-fix done: the job's sortie on the other base closes with the call's outcome and records its duration; `kaji offer` lists only MCP names the name rule accepts; the guide says what the refusal does. Tests added for the refusal path, a stale fingerprint, an EVA-03 grant, and the taint and closing on both bases. 2026-11-19: F-021-T04 implemented (owner approved the scope, 0.75 h → 2.5 h): a base can offer its granted MCP tools over Kaji (`nerv kaji offer notes.read_note`); the base that runs one re-checks that it is granted now (a changed or removed tool is suspended), refuses EVA-03 grants, and makes the call through its tools process after its own gate. One that its gate sends to the owner there is refused and its card rejected, since nothing would make the call after an approval. Tool names everywhere offers and jobs pass (offers, config, worker link and jobs, RPC schema, verdict request, kaji.run) share one rule, `OFFER_NAME` in `src/mcp.ts`. Join test across two bases (`test/kaji-run.test.ts`): the MCP fixture answers on Tabgha through kaji.run, an offered but ungranted tool is refused there; plus the `kaji offer` CLI and the name rule. Awaiting CI on [PR #556](https://github.com/voidbrain/nerv/pull/556). Earlier evidence: [moved 2026-11-22](evidence-2026.md#f-021-moved-2026-11-22).

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #744](https://github.com/voidbrain/nerv/pull/744) closure; [PR #601](https://github.com/voidbrain/nerv/pull/601) (B-082-T02); Test: `test/node-inspection.test.ts` "B-082: the Windows task user keeps Entra and domain accounts but repairs workgroup users" (committed failing first in B-082-T02); Review: fresh-context P1 review found no blocking code, security, privacy or compliance issue and confirmed the later test edit is formatting-only; prior T01 test committed failing first |
| Opened | 2026-11-18 |
| Verification | 2026-11-21: B-082-T02 CI run 44815656209 and required fresh-context review passed. Local: targeted regression 2/2, full tests 1,041 pass / 2 platform skips, build, `check:fast`, headless 5 pass / 1 Windows skip. 2026-11-25: live read-only SSH probe on Tabgha: the rule's account maps to the SID of the registered task; the legacy form does not. |
| PR / evidence | [PR #743](https://github.com/voidbrain/nerv/pull/743) closure; [PR #563](https://github.com/voidbrain/nerv/pull/563) dashboard Tools panel; [PR #556](https://github.com/voidbrain/nerv/pull/556) MCP over Kaji; [PR #547](https://github.com/voidbrain/nerv/pull/547) per-pilot binding; [PR #381](https://github.com/voidbrain/nerv/pull/381) versioned NERV and MCP tool descriptors; [PR #194](https://github.com/voidbrain/nerv/pull/194) format migration and operator assessment; [PR #187](https://github.com/voidbrain/nerv/pull/187) reviewed prerequisite links. |
| Opened | 2026-11-02 |
| Verification | 2026-11-25: every Check item closed by its step (T02 #381, T03 #547, T04 #556, T05 #563, each on green CI); `test/tool-listing.test.ts` 3/3 on main. Earlier: unit/integration and CI 2026-11-13: every built-in registration has a stable versioned descriptor; MCP fingerprints remain compatible; PR #381 CI 43496658350 passed validate, native-macos, windows, plan and full-suite. |
| Reviewed | 2026-11-25 |

</details>

---

### B-131

**Role-sized placement probes fail their own token budget: it counts the prompt but is sized from the output limit**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-25: PR #735 and PR #738 merged on green CI (run 45553326990 attempt 4); Test: test/placement-campaign.test.ts (B-131 case); live F-006-T31 check passed on NERV-02.

| | |
|---|---|
| **Issue** | Found 2026-11-24 in F-006-T29 on NERV-02: `placementProbe` (`src/placement-campaign.ts`) sets `maxTotalTokens` to 2 × `maxOutputTokens`, and the orchestrated runtime counts input and output tokens against it after the remote reply. A role-sized probe (Misato's own system message, about 4,500 input tokens) with `maxOutputTokens` 2048 therefore ends with `Orchestrated token budget exhausted (4781–5206 > 4096).` after the Mac has already generated the answer: all 15 Misato P3 cases failed this way, so role-sized probes (F-006-T27) still cannot carry Misato. |
| **Reproduce** | On NERV-02, `node tools/placement-live.mjs roles --transport=nerv,P3 --execute`: every `misato:*` case errors with `Orchestrated token budget exhausted`; the Casper cases (about 350 input tokens) pass. |
| **Check** | A committed test that fails first: a P3 placement run whose prompt and system message take more input tokens than 2 × `maxOutputTokens` (within the probe's byte limits) returns its result; the total budget still bounds the run. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-25: PR #735 and PR #738 merged on green CI (run 45553326990 attempt 4); Test: test/placement-campaign.test.ts (B-131 case); live F-006-T31 check passed on NERV-02. 2026-11-25 reconciliation: [#738](https://github.com/voidbrain/nerv/pull/738) merged on green CI (run 45553326990, attempt 4); verified and closed. 2026-11-25: live check passed in F-006-T31 ([#738](https://github.com/voidbrain/nerv/pull/738)), so B-131-T01 is verified; close B-131 after [#738](https://github.com/voidbrain/nerv/pull/738) merges. 2026-11-24: opened from F-006-T29 (private report `p3-roles-t29.json` on NERV-02: 15 Misato errors, 14 with the budget message at 4,781–5,206 tokens, the first a `Worker result unknown after timeout.` at 30 s). Only the executing base (NERV-02) applies the budget, so the Misato P3 rerun needs NERV-02 on the fixed revision (F-006-T30) before F-006-T31.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [#732](https://github.com/voidbrain/nerv/pull/732) (opened), [#735](https://github.com/voidbrain/nerv/pull/735) (fix; Test: `test/placement-campaign.test.ts`, B-131 case, failing first in 63da1369, then the budget from the input bound plus output; F-006-T29 evidence in the [F-006-T29 report](../evaluations/2026-11-24-f006-t29-placement-report.md)) |
| Opened | 2026-11-24 |
| Verification | Unit/integration: the B-131 regression across the placement route passes in #735. Live 2026-11-25 (F-006-T31, [#738](https://github.com/voidbrain/nerv/pull/738)): passed: on NERV-02 at `e05aae22` all 15 Misato P3 probes returned a graded answer (8 passed, 3 failed, 4 invalid), none with `Orchestrated token budget exhausted` or any other error; longest 28.1 s ([F-006-T31 report](../evaluations/2026-11-25-f006-t31-placement-report.md)). |
| Reviewed | 2026-11-25 |

</details>

---

### B-119

**Placement probes longer than 15 s are cut off by the HTTP server**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-25: PR #708 and PR #732 merged on green CI; Test: test/placement-campaign.test.ts (B-119 case); live P3 probes over 15 s completed on NERV-02 (F-006-T29).

| | |
|---|---|
| **Issue** | Found 2026-11-24 in F-006-T23 on NERV-02: `POST /api/placement/run` accepts `timeoutMs` up to 120,000 ms, but the server's `requestTimeout`/`timeout` of 15,000 ms (`src/server.ts`) closes the socket at 15 s because this route, unlike `/api/chat` and the other model routes, never calls `req.setTimeout`. Eleven P3 Casper probes ended at 15.0 s with `fetch failed` (`other side closed`), so any cross-node probe longer than 15 s cannot complete. |
| **Reproduce** | On a base with a P3 endpoint, run `nerv placement run` with a probe whose inference takes more than 15 s (for example a long prompt with `timeoutMs: 60000`); the client sees the connection closed at 15 s instead of a result or a timeout error. |
| **Check** | A committed test that fails first: a placement run whose inference takes longer than 15 s but less than its `timeoutMs` returns its result; the route's socket timeout follows the probe's budget like the chat routes. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-25: PR #708 and PR #732 merged on green CI; Test: test/placement-campaign.test.ts (B-119 case); live P3 probes over 15 s completed on NERV-02 (F-006-T29). 2026-11-25 reconciliation: [#732](https://github.com/voidbrain/nerv/pull/732) merged on green CI; every Check item passed (failing-first test, live P3 probes over 15 s); closed. 2026-11-24 (F-006-T29, [#732](https://github.com/voidbrain/nerv/pull/732)): live check passed on NERV-02 at `d9d9aed4` with NERV-01 at `c43bbb57`: P3 probes over 15 s returned through `/api/placement/run` (a Casper case at 20.9 s; Misato errors at 20.7 s and 22.4 s were NERV's own budget messages, B-131, not a closed socket); no case ended at 15 s (F-006-T23: 11). Close in the next reconciliation. Earlier: 2026-11-24 (B-119-T01, [PR #708](https://github.com/voidbrain/nerv/pull/708)): cause: `/api/placement/run` never set its socket timeout, so the server's 15 s idle `timeout` closed the connection. Fix: `placementProbe` returns `requestBudgetMs` (2 × `timeoutMs` for the concurrency lease and the inference, + `waitBudgetMs` + 5 s) and the route holds the socket for it, restoring 15 s on finish, as the chat routes do. Test first: `test/placement-campaign.test.ts` (B-119 case: HTTP client → server → a 15.5 s run with `timeoutMs: 30000`) failed on main at 15.09 s with `fetch failed` / `other side closed`, the live error; passes with the fix. Live P3 rerun: F-006-T29. 2026-11-24: opened from F-006-T23 (P3 role run on NERV-02, private report `p3-roles.json`: 11 errors at 15,007–15,021 ms) and F-006-T25 (a probe queued behind a cancelled generation was cut at 15,021 ms). It blocks the P3 role comparison rerun (F-006-T27).

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [#732](https://github.com/voidbrain/nerv/pull/732) (F-006-T29 live check); [PR #708](https://github.com/voidbrain/nerv/pull/708) (socket budget; Test: `test/placement-campaign.test.ts`); [PR #698](https://github.com/voidbrain/nerv/pull/698) (opened); F-006-T23 evidence in the [F-006-T26 report](../evaluations/2026-11-24-f006-t26-placement-report.md) |
| Opened | 2026-11-24 |
| Verification | Unit/integration 2026-11-24: `test/placement-campaign.test.ts` passes; CI green on PR #708. Real-device 2026-11-24: live P3 probes over 15 s on NERV-02 completed (F-006-T29, [report](../evaluations/2026-11-24-f006-t29-placement-report.md#b-119-live-check)). |
| Reviewed | 2026-11-24 |

</details>

---

### B-126

**Windows CI: `pilot-model.test.ts` fails with "nervous process not ready; nothing was sent."**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-25: PR #739 merged on green CI; Test: test/store-open-busy.test.ts; five Windows npm test runs with the fix without database is locked (45572380286, 45573197048, 45577116814, 45580660697, 45589471622).

| | |
|---|---|
| **Issue** | On 2026-11-24 the Windows `npm test` step failed three times on the same test, "pilot model API changes one specialist, validates discovery and preserves the other pilots and roles" (`test/pilot-model.test.ts:11`), at `await r.ready()` (line 74) with `nervous process not ready; nothing was sent.` (`src/process-client.ts`), once also after its 30 s timeout. Each time a rerun passed, so each PR needed a rerun. B-076-T01 saw the same test time out on 2026-11-19 (run 44345717840) and named it runner slowness. |
| **Reproduce** | Windows CI `npm test`: [run 45307748925](https://github.com/voidbrain/nerv/actions/runs/45307748925) attempt 2 (PR #688), [run 45362462549](https://github.com/voidbrain/nerv/actions/runs/45362462549) attempt 1 (PR #707), [run 45387061669](https://github.com/voidbrain/nerv/actions/runs/45387061669) attempt 1 (PR #715). Locally: `node --test test/pilot-model.test.ts` while the machine is loaded (e.g. many test files at once). |
| **Check** | A committed test fails first: a Runtime whose nervous child starts slowly (as on a loaded Windows runner) is still ready, or fails with a named cause and bound, not "nothing was sent"; the fix keeps the ready deadline meaningful; no `pilot-model.test.ts` failure in the next five Windows runs. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-25: PR #739 merged on green CI; Test: test/store-open-busy.test.ts; five Windows npm test runs with the fix without database is locked (45572380286, 45573197048, 45577116814, 45580660697, 45589471622). 2026-11-25 reconciliation: verified and closed. [#739](https://github.com/voidbrain/nerv/pull/739) merged at 07:53Z on green CI. Five Windows `npm test` runs since then on heads that contain the fix, all on their first attempt with 0 failures and no "database is locked" or "nervous process not ready": runs 45572380286 (#741), 45573197048 (#745), 45577116814 (#740), 45580660697 (#742), 45589471622 (#745); the Windows jobs of the main pushes skip `npm test`. 2026-11-25, cause named (B-126-T01): the nervous child opens the database at start with `new Store` (`src/nervous-process.ts:18`), and `Store` ran `PRAGMA user_version` and its other first reads before it set `PRAGMA busy_timeout=5000`, so a write lock held for a moment by the runtime opening the same file made the child exit with `database is locked` (run 45511684500, PR #732, at `src/store.ts:167`; run 45553326990 attempt 3, PR #738, `gate.test.ts:108`) and the parent then reported `nervous process not ready`. Fix: open with `new DatabaseSync(path, { timeout: 5000 })`; `test/store-open-busy.test.ts` failed first (a lock held 0.7 s by another process) and a lock never released still fails. Windows CI on #739 then showed the Store kept its file handle when its first read failed (`EPERM` removing the test folder); the constructor now closes it before rethrowing. Next: watch five Windows runs. Not this cause: `runtime-load.test.ts:11` (20 s timeout, PR #732) and `print-transfer.test.ts:476` (PR #738) failed the same nights; B-076 tracks them. Earlier, 2026-11-25 reconciliation: the same error in two other tests that start a Runtime, so the cause is shared: "F-003: owner Italian then English messages keep their language…" (`telegram.test.ts:596`) and "F-026: nonproduction writes remain denied through the planner/gate join…" (`watch-runtime.test.ts:264`), both `nervous process not ready; nothing was sent.` on Windows in [run 45461777302](https://github.com/voidbrain/nerv/actions/runs/45461777302) attempt 1 (PR #721, job 138686221613); passed on rerun. 2026-11-24: opened in the backlog reconciliation from the CI logs of 2026-11-24 (jobs 138160312350, 138336053714, 138421034711, each `Error: nervous process not ready; nothing was sent.` at `test/pilot-model.test.ts:74`). The same error at `Runtime.ready` hit `resume.test.ts` and `seat-pool.test.ts` on 2026-11-19 (B-076-T01, run 44489977085), so the cause may be shared by every test that starts a Runtime on a slow runner; B-126-T01 names it. Related: B-076 (scattered CI failures), B-118 (Windows step time).

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [run 45307748925](https://github.com/voidbrain/nerv/actions/runs/45307748925); [run 45362462549](https://github.com/voidbrain/nerv/actions/runs/45362462549); [run 45387061669](https://github.com/voidbrain/nerv/actions/runs/45387061669); opened in [PR #723](https://github.com/voidbrain/nerv/pull/723); [#736](https://github.com/voidbrain/nerv/pull/736); fix in [#739](https://github.com/voidbrain/nerv/pull/739) |
| Opened | 2026-11-24 |
| Verification | Unit: Test: `test/store-open-busy.test.ts` (failing first, then passing). CI 2026-11-25: five Windows runs without the error (runs 45572380286, 45573197048, 45577116814, 45580660697, 45589471622). |
| Reviewed | 2026-11-25 |

</details>

---

### B-132

**An executor that answers later reached the ledger and the caller as `{}`, and its failure was never caught**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-25: PR #733 merged on green CI; Test: test/async-executors.test.ts (4/4 failed first, pass with the fix).

| | |
|---|---|
| **Issue** | Found 2026-11-24 while adding `browser.click` (F-089-T06): the store ran executors synchronously, so a tool whose executor returns a promise (`gmail.*`, `desktop.replay`, `browser.click`) recorded `{}` as its result in the ledger and returned a promise the IPC reply serialised as `{}`; a rejection was an unhandled rejection, a promise that never settled left the sortie open, and a worker job got `{}` as its result. No such executor was wired to the live store yet. |
| **Reproduce** | In a test, give the store a Gmail client whose `send` rejects, approve a `gmail.send` card: the ledger records `action.done` with `{}` and the rejection is unhandled. |
| **Check** | The store waits for an executor that answers later: its result or error is recorded when it settles (`action.done` / `action.failed`) and returned to the caller over IPC; one that never answers ends as `action.failed` after its tool's bound; the coordinator's IPC calls for those tools wait that bound, not the 5 s default, and resume waiting sorties even on a timeout; a worker-bound card finishes its job with the settled outcome, and a job released meanwhile is no error. Committed tests fail first. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-25: PR #733 merged on green CI; Test: test/async-executors.test.ts (4/4 failed first, pass with the fix). 2026-11-25 reconciliation: [PR #733](https://github.com/voidbrain/nerv/pull/733) merged on green CI; every Check item is automated (`test/async-executors.test.ts`); verified and closed. 2026-11-24: opened from the independent security review of [PR #733](https://github.com/voidbrain/nerv/pull/733). B-132-T01 implemented there: `StoreSorties.run` waits for a promise within `lateExecutorMs(tool)` (browser 30 s, desktop replay 150 s, Gmail 60 s) and records it when it settles; `settledOutcome` folds it into the `actions.act` and `approvals.decide` replies and `nerv approve`; `gateCallTimeoutMs(tool)` sets those IPC calls' timeouts in `Runtime.decide` and the gate, and `Runtime.decide` sweeps resumable sorties in `finally`; a timed-out executor is reported as "outcome unknown — it may still finish; check before retrying" (a send may still go out); the worker path finishes the job when the executor settles, ignores a job released meanwhile and logs any other failure to record it. `test/async-executors.test.ts` (rejection → `action.failed`; a granted promise through the gate returns and records its real result; a never-settling executor ends as `action.failed`; the worker-bound card) failed on origin/main and passes with the fix.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #733](https://github.com/voidbrain/nerv/pull/733) (Test: `test/async-executors.test.ts`) |
| Opened | 2026-11-24 |
| Verification | 2026-11-24: `test/async-executors.test.ts` committed first: 4/4 fail on origin/main, 4/4 pass with the fix. |
| Reviewed | 2026-11-24 |

</details>

---

### B-124

**A re-target `kaji relocate` signs fences the running main before the target's checks run**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-25: PR #734 merged on green CI; Test: test/coordinator-partition.test.ts (B-124), test/coordinator-relocation.test.ts; Review: #734 independent review and re-check, findings fixed in the PR.

| | |
|---|---|
| **Issue** | Found 2026-11-24 in the review of [PR #721](https://github.com/voidbrain/nerv/pull/721) (B-121-T02). `kaji relocate` (src/cli-kaji.ts, `relocate`) pushes the main record it signs to every reachable base at once. When the owner re-targets while a coordinator runs (B at epoch 3, main C signed at 4), B's renewals then meet epoch 4 and B fences, before `kaji promote` on C has checked anything. If C's promote is then refused (`standby_behind`: B ran epoch 3 after C's standby state), no base acts. No way out exists today: nothing re-seeds C's standby from B, a new main record naming B (epoch 5) makes B's promote refuse `context_only` (B's store is no standby store), and `kaji lease-rearm` re-arms only at the epoch the store holds. Safety holds (no two coordinators); availability is lost until the owner restores by hand. |
| **Reproduce** | Mesh as in `test/coordinator-partition.test.ts` (B-121-T02): B runs epoch 3 through D; the owner runs `kaji relocate` for C (epoch 4) on a base that reaches B or D; `kaji promote` on C is refused; nobody holds authority. |
| **Check** | A re-target signed while a coordinator runs leaves that coordinator acting until the target's prechecks (local and the B-121-T02 probe) pass. Proposed fix: `kaji relocate` pushes nothing (only signs and stores the records, for `kaji export`/`import` to the target), and `kaji promote` on the target pushes them after its prechecks, as it already does; or relocate probes first and refuses a target whose standby is behind. A committed test fails first. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-25: PR #734 merged on green CI; Test: test/coordinator-partition.test.ts (B-124), test/coordinator-relocation.test.ts; Review: #734 independent review and re-check, findings fixed in the PR. 2026-11-25 reconciliation: verified and closed. [PR #734](https://github.com/voidbrain/nerv/pull/734) merged on green CI; every Check item is automated (Test: `test/coordinator-partition.test.ts`, B-124); Review: the #734 review and re-check below, all findings fixed in the PR. 2026-11-25 (#734 re-check: one should-fix): `kaji main` could still name the running main again (B at 3 stored at 4, fencing it); it now refuses whenever the main record or this base's coordinator state is at epoch 2 or later, whichever base it names (a revoked newest main included); first setup (all at epoch 1) keeps it. Test first: 7205b00b failed ("Missing expected rejection"); fix 654aa387. 2026-11-25 (#734 review: one blocker, two should-fix, minors): the way out took back an older state after a later epoch ran (X at 2 drained to B at 3, B ran through D, B and D revoked, X named again at 4: X reinstated from epoch 2 with no wait); reinstatement is now refused (`standby_behind`) when a main named between its state and the new epoch is revoked (it cannot be asked: verified standby or owner-approved cold restore only) or its own stores ran or acked a later epoch; unrevoked ones must answer the probe as before. Staging the bundle took the store's write lock (`database is locked` while the service writes): it now fills TEMP tables in a deferred transaction with a busy timeout. `kaji main BASE-ID` refuses a re-target once the main epoch or this base's coordinator state is 2 or later, pointing to `kaji relocate` (first setup keeps it). Minors: help shows FILE as optional (stdout without it); the decision doc says an unreplicated drain refusal leaves the main `draining`; a test shows a failed drain stores no relocation record. Coordinator suites, full `npm test` (1444 pass, 0 fail, 2 skipped), `check:fast` and the gauntlet (pending system and multi-step cases, under the machine lock, ledger committed; none pending) pass. Test first: ebea3e71 failed (reinstated; `database is locked`; `kaji main` stored epoch 3); fix 5cac682a. 2026-11-24 (B-124-T01, [PR #734](https://github.com/voidbrain/nerv/pull/734)): storing the records anywhere live is itself a push (KajiLink's heartbeat registry sync carries any newer record to every base), so `kaji relocate BASE-ID FILE [--revoke ID]` now signs into a relocation bundle and stores and pushes nothing; `kaji import` refuses a bundle. `kaji promote --relocation FILE` reads the records as if held (connection-private TEMP copies of the registry tables) for the local check and the B-121-T02 probe, and only then stores and pushes them. Planned: `kaji drain RECEIPT --relocation FILE` stores them in the transaction that fences the old main (a failed drain stores nothing). Two refusals readiness made after the push now come before it (planned final batch not on the standby: `standby_behind`; unplanned standby with no ack history for an unrevoked old main: `old_host_unconfirmed`). Way out when the epoch already reached the bases (a drain, a hand import, an older NERV): `kaji relocate OLD-ID FILE` and `kaji promote --relocation FILE` on the old main take its own state back at the new epoch, fenced until its standby acks, once every other unrevoked base answers with no later ran-or-acked epoch. Test first: 7e721d68 failed on main (the mesh now models the heartbeat registry sync and runs the real `kaji relocate`: relocate pushed to B, C and D; the way out was refused `context_only`); fix 992de467. The relocate CLI test changed deliberately (requirement B-124: relocate stores nothing; the drain stores the bundle). Residual risk: after a reinstatement the standby store holds the old epoch's state until the shipper re-seeds it.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #734](https://github.com/voidbrain/nerv/pull/734) (Test: `test/coordinator-partition.test.ts`, B-124; `test/coordinator-relocation.test.ts`, kaji relocate bundle) |
| Opened | 2026-11-24 |
| Verification | Unit 2026-11-24: `test/coordinator-partition.test.ts` 20 pass; full `npm test` 1441 pass, 0 fail (2 skipped). Gauntlet 2026-11-24 (owner-approved pattern, under the machine lock, after build): the 7 `nerv-system-flows` cases (no models) and the 4 `multi-step-agent` cases (local `gemma4-12b` profile) passed; `gauntlet:pending` lists none (ledger committed here). CI 2026-11-25: PR #734 merged on green CI. Review: #734 independent review (one blocker, two should-fix, minors) and re-check (one should-fix), each fixed in the PR with a failing-first test. |
| Reviewed | 2026-11-24 |

</details>

---

## Closed 2026-11-26

### B-125

**A signed Kaji reply is not bound to its request, so an old epoch-push reply can be replayed**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-26: #740 merged on green CI; every base on the bound-reply format: NERV-03 updated 2026-11-25 ~17:30 CET from 9613f0df to eff68a3a (manual path, doctor skew false, kaji list on NERV-01 and NERV-03 shows all three enrolled), NERV-02 on 1c407fb8, NERV-01 on 2627d483 or later; reconciled in #779.

| | |
|---|---|
| **Issue** | Found 2026-11-24 in the review of [PR #721](https://github.com/voidbrain/nerv/pull/721) (B-121-T02). Replies on the Kaji line are signed over method, path, time, nonce and body digest, but the nonce is the reply's own, not the request's, so a reply is not bound to the request it answers. Each client refuses a reply nonce it has seen, so a replay must be one this client never received (withheld from it, or captured on the way to another base's request): an attacker on the path could answer a `/kaji/epoch-push` probe with a genuine reply that base signed up to 120 s earlier (the clock-skew window), hiding a newer `ranOrAckedEpoch` or `maxSeenCoordinatorEpoch`, and so let a re-targeted move pass the probe. The same holds for other signed replies (lease renewals included). |
| **Reproduce** | Capture a signed epoch-push reply D sent to base A; within 120 s, after D acks a lease at a later epoch, answer base C's probe to D with it: C accepts it. |
| **Check** | A committed test fails first: a reply signed for another request is refused. Proposed fix: the reply's signature covers the request's nonce (or its digest), and the client checks it, with a mixed-version rule for older peers stated in the decision. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: #740 merged on green CI; every base on the bound-reply format: NERV-03 updated 2026-11-25 ~17:30 CET from 9613f0df to eff68a3a (manual path, doctor skew false, kaji list on NERV-01 and NERV-03 shows all three enrolled), NERV-02 on 1c407fb8, NERV-01 on 2627d483 or later; reconciled in #779. 2026-11-26 reconciliation ([PR #779](https://github.com/voidbrain/nerv/pull/779)): NERV-03 (Calvary) updated on 2026-11-25 at about 17:30 CET from `9613f0df` to `eff68a3a`. That revision predates `nerv update` (F-117-T02, #693), so it was updated by hand: service stop, database backup to `~/.nerv-private/nerv-before-b125.sqlite`, a detached checkout of `origin/main`, `npm ci`, build, start. `nerv doctor` shows `eff68a3a` with skew false; `nerv kaji list` on NERV-01 and NERV-03 shows all three bases enrolled. NERV-02 is on `1c407fb8` and NERV-01 on `2627d483` or later, so every base signs bound replies. The [NERV-03 page](../acceptance/b125-nerv03-update.md) now documents the manual path for a base without `nerv update`. 2026-11-25 reconciliation: [#740](https://github.com/voidbrain/nerv/pull/740) merged on green CI (main `1c407fb8`). Bases on the bound-reply format: NERV-02 (Tabgha) updated to `1c407fb8` at about 10:00; NERV-01 updated through the PWA to `2627d483` (updater status completed 09:12:33Z). NERV-03 (Calvary) has been offline for 3 days and is not updated: it must update when it is back; then B-125 closes. Opened 2026-11-24 from the #721 re-check. 2026-11-25: the owner chose option A (the reply signature covers the request nonce) because the three owner-run bases update together, so the mixed-version window lasts only during an update: an older base refuses an updated base's reply (`bad signature`) and an updated base refuses an older one's (`reply_unbound`, named by `kaji promote`). Failing test 793d00c0, then the fix in #740; decision in [coordinator relocation](../decisions/coordinator-relocation.md), section 5.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [#740](https://github.com/voidbrain/nerv/pull/740) (Test: `test/kaji-reply-binding.test.ts`; failing test 793d00c0, then the binding; found in [PR #721](https://github.com/voidbrain/nerv/pull/721)); [#750](https://github.com/voidbrain/nerv/pull/750); NERV-03 update 2026-11-25 (owner, manual path); [PR #779](https://github.com/voidbrain/nerv/pull/779) |
| Opened | 2026-11-24 |
| Verification | Unit/integration: the replayed epoch-push reply is refused across a real requester and responder in #740. Real-device 2026-11-25: NERV-01 (`2627d483`) and NERV-02 (`1c407fb8`) run the bound-reply format; NERV-03 (`eff68a3a`, 2026-11-25 ~17:30 CET, doctor skew false, `kaji list` on NERV-01 and NERV-03 shows all three enrolled). |
| Reviewed | 2026-11-26 |

</details>

---

### B-126

**Windows CI: Runtime tests fail with "nervous process not ready; nothing was sent."**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: fix #767 merged on green CI; five Windows npm test runs since, each Windows job passing on its first attempt, no nervous process not ready (45681378218, 45682980735, 45688663403, 45690967252, 45694149387); reconciled in #779.

| | |
|---|---|
| **Issue** | Reopened 2026-11-25. The first cause (the Store's first reads without a busy timeout, "database is locked") was fixed in #739 and closed; history in the [2026 archive](#b-126). On 2026-11-25 Windows CI [run 45632224825](https://github.com/voidbrain/nerv/actions/runs/45632224825) attempt 1 (PR #754, config and records only) failed 11 tests at `Runtime.ready` with `nervous process not ready; nothing was sent.`, with no "database is locked" and no error output from the child: `memory.test.ts:126`, `mcp.test.ts:126`, `mcp-remote.test.ts:288`, `telegram.test.ts:165`, `:331`, `:383` (and `:497` timed out at 20 s), `tool-index.test.ts:167`, `:203`, `:222`, `watch-runtime.test.ts:5`, `:48`. The error did not say whether the child had exited or why. |
| **Reproduce** | Windows CI `npm test`: run 45632224825 attempts 1 (job 139268338287) and 3 (job 139284899678). Locally on Windows: `npm test` (not reproduced on a 4-core Windows host, idle or under CPU load). |
| **Check** | The not-ready error names the child's exit code or signal, or that it is still running at the deadline, its last start-up step and its last error output (B-126-T02); the second cause is named from that output and fixed test-first, the ready deadline raised only if measurements show the cause is a start slower than 30 s (B-126-T03); no "nervous process not ready" in the next five Windows runs. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: fix #767 merged on green CI; five Windows npm test runs since, each Windows job passing on its first attempt, no nervous process not ready (45681378218, 45682980735, 45688663403, 45690967252, 45694149387); reconciled in #779. 2026-11-26 reconciliation ([PR #779](https://github.com/voidbrain/nerv/pull/779)): [#757](https://github.com/voidbrain/nerv/pull/757) and [#767](https://github.com/voidbrain/nerv/pull/767) merged on green CI. Since #767 merged (18:39Z), five Windows jobs ran `npm test` (the full suite, 1518–1543 tests, 347–435 s) on PR merge heads that include it, each passing on its first attempt with no "nervous process not ready" and no failed test: [45681378218](https://github.com/voidbrain/nerv/actions/runs/45681378218) (#764), [45682980735](https://github.com/voidbrain/nerv/actions/runs/45682980735) (#765, run attempt 2; its Windows job passed on attempt 1), [45688663403](https://github.com/voidbrain/nerv/actions/runs/45688663403) (#768), [45690967252](https://github.com/voidbrain/nerv/actions/runs/45690967252) (#763), [45694149387](https://github.com/voidbrain/nerv/actions/runs/45694149387) (#771). Another, [run 45715497349](https://github.com/voidbrain/nerv/actions/runs/45715497349) (PR #777, an earlier head), failed one worker-link heartbeat test (B-066) and no Runtime start. None of the five logs has a start-up watch line (`still in start-up step`, a step over 10 s). Before the fix the same step still stalled: run 45677154639 attempt 2 (#764, merge ref from 18:38Z) failed three tests with "nervous process not ready" in `"database: journal mode and core schema"`, and runs 45660215244, 45661798517 and 45664200978 logged that watch line without a not-ready failure. Main pushes skip the Windows suite. B-126-T03 and the record close. 2026-11-25, likely cause (B-126-T03, [PR #767](https://github.com/voidbrain/nerv/pull/767)): #757's watch named the step on Windows [run 45670901865](https://github.com/voidbrain/nerv/actions/runs/45670901865) (PR #761, `orchestration-selection.test.ts:506`): `still in start-up step "database: journal mode and core schema" after 10200 ms`, no error. That test gives each of its three Runtimes a fresh folder, so the nervous child was the file's only opener and no lock was involved. The likely cause, plausible but not proven, is flush time: every start-up statement of the Store commits on its own (423 WAL frames for 194 pages), and at `synchronous=FULL` each commit waits for the disk. A loaded Windows runner pays a lot for each flush; B-118-T04 already turned flushes off for the test processes' own connections, but not for a Runtime's children. Measured on Tabgha (Windows, Node 24.22.2) with three processes writing and flushing 1 MiB in a loop: opening a fresh Store took 1.07–1.17 s, far short of the 30 s seen in CI; what stretches it there is unexplained (core schema 173–241 ms, migrations 357–487 ms; 156–183 ms idle; macOS 17 ms). Fix: the Store runs its start-up at `synchronous=NORMAL` (in WAL mode commits then do not wait for the disk and never corrupt; every start-up statement is idempotent or its own transaction, so a lost one reruns at the next start) and returns the connection's own setting once open, so the running coordinator keeps FULL. It lowers durability only once the switch to WAL has taken, since NORMAL outside WAL can corrupt on power loss (#767 review; test: "a fresh database is in WAL mode before…"). Residual risk: a power loss during start-up can lose the last start-up commits, including pending-approval delivery rows written then, so such a card may be delivered a second time after the restart. With it, the same load: 0.13–0.15 s; idle 45 ms. One outer transaction was rejected: the fleet migration refuses to run inside one. Test: `test/startup-watch.test.ts` ("starts up without a flush per statement"; the test commit failed before the fix). The ready deadline is unchanged. 2026-11-25 (B-126-T03, [PR #757](https://github.com/voidbrain/nerv/pull/757)): the B-126-T02 message caught it on Windows [run 45647383080](https://github.com/voidbrain/nerv/actions/runs/45647383080) (PR #754): 3 tests (`telegram.test.ts:331`, `tool-index.test.ts:222`, `watch-runtime.test.ts:5`), each `It sent no READY after 30000 ms; still running (pid …); last start-up step: opening the database, reported 779–1073 ms after start; last error output: none.` So the child sat over 29 s inside the step that runs `readScrolls` and the whole `Store` constructor, without any statement failing. Refuted from the code: two openers serialising the schema statements. The parent Runtime never constructs a Store (it opens the file only for prompt and health samples, after start), the brain and tools children never open it, and `tool-index.test.ts` gives each Runtime a fresh folder, so the nervous child was the file's only opener; a single holder would also make a statement fail after its 5 s busy timeout, which would have shown in the error output. The blocked step holds the child's main thread, so no IPC report can leave it: a start-up watch on its own thread (`src/startup-watch.ts`) now hears each step, including the Store's own (`database: open the file`, `first reads`, `journal mode and core schema`, `schema migrations`, `feature stores`, `worker jobs`, `pending approvals`), and after 10 s in one step writes `nervous: still in start-up step "…" after N ms` to the error output, which the not-ready error quotes. Test: `test/startup-watch.test.ts` (eb42e3e9 failed before the change). Cause not yet named; the ready deadline is unchanged. Earlier evidence (B-126-T02, #755, and the #758 reconciliation): [archive](evidence-2026.md#b-126-moved-2026-11-26).

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [run 45632224825](https://github.com/voidbrain/nerv/actions/runs/45632224825) attempt 1 (PR #754); diagnostics in [#755](https://github.com/voidbrain/nerv/pull/755); [run 45647383080](https://github.com/voidbrain/nerv/actions/runs/45647383080) (PR #754); start-up watch in [#757](https://github.com/voidbrain/nerv/pull/757); [run 45670901865](https://github.com/voidbrain/nerv/actions/runs/45670901865) (PR #761); fix in [#767](https://github.com/voidbrain/nerv/pull/767); five clean Windows `npm test` runs after it; [#779](https://github.com/voidbrain/nerv/pull/779); first cause: [#739](https://github.com/voidbrain/nerv/pull/739), [archived record](#b-126); [#758](https://github.com/voidbrain/nerv/pull/758) |
| Opened | 2026-11-24 |
| Verification | Unit: Test: `test/process-client.test.ts` and `test/startup-watch.test.ts` (B-126 tests, failing first, passing on macOS and on Windows). CI 2026-11-26: five Windows `npm test` runs with #767 (full suite; each Windows job passed on its first attempt), no "nervous process not ready" (45681378218, 45682980735, 45688663403, 45690967252, 45694149387). |
| Reviewed | 2026-11-26 |

</details>

---

### B-139

**CI: macOS runners not acquired cancel required jobs; docs-only PRs and every PR's Swift CodeQL wait on Windows and macOS runners**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: #756 merged on green CI; CodeQL default setup not-configured (B-139-T02); docs-only PRs #770 and #772-#776 skipped windows and native-macos and merged, code PRs ran both; reconciled in #779.

| | |
|---|---|
| **Issue** | On 2026-11-25 three macOS jobs ended at about 15 minutes with no step run: CI `native-macos` (run 45626156780, a required check) and CodeQL default setup `Analyze (swift)` (runs 45640205435, 45644029795). Each says "The job was not acquired by Runner of type hosted even after multiple attempts" (GitHub macOS arm64 capacity); `timeout-minutes` (30 on `native-macos`) does not govern acquisition. Every PR, records and docs included, still starts a Windows and a macOS runner, and the default setup analyses Swift on every PR (about 12 minutes on macOS) because it cannot filter by path. |
| **Reproduce** | Open a PR that changes only `docs/work/records/*.md`: CI starts `windows` and `native-macos` runners that only print their scope, and CodeQL starts `Analyze (swift)`. |
| **Check** | On a docs-only PR (a rename counts both its old and new path) (every changed file under `docs/`, a root `*.md` or `LICENSE`) `windows` and `native-macos` report skipped and the PR can merge; any other path, and every push to `main`, runs them; CodeQL runs `actions` and `javascript-typescript` on every PR and push and `Analyze (swift)` only when Swift changed, after the default setup is off. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: #756 merged on green CI; CodeQL default setup not-configured (B-139-T02); docs-only PRs #770 and #772-#776 skipped windows and native-macos and merged, code PRs ran both; reconciled in #779. 2026-11-26 reconciliation ([PR #779](https://github.com/voidbrain/nerv/pull/779)): B-139-T02 done: the CodeQL default setup reads `not-configured`; [#756](https://github.com/voidbrain/nerv/pull/756) merged on green CI with the advanced CodeQL jobs passing. Every docs-only PR since shows `windows` and `native-macos` skipped and merged on green CI (#770, #772, #773, #774, #775, #776; e.g. [run 45715615726](https://github.com/voidbrain/nerv/actions/runs/45715615726), #776: `Analyze (swift)` skipped, `actions` and `javascript-typescript` passed); code PRs ran both (#771, #763, #768). Every Check item is met: closed. 2026-11-25 (B-139-T01): the `plan` job's changed-paths step sets `docs_only`; `windows` and `native-macos` skip at job level only on a docs-only PR whose plan selected no work for them (a full plan still runs both); a workflow-level `paths:` filter was not used because it would leave the required checks pending. `native-macos` keeps `timeout-minutes: 30` (unchanged: raising it would not have saved the three cancellations above). `.github/workflows/codeql.yml` adds the advanced setup (same languages, build modes and default suite; Swift gated on `*.swift`, `native/NervMenuBar/**` or the workflow). Its uploads fail while the default setup is on, and a PR never merges with a failing check, so the order is: the owner turns off the default setup (B-139-T02, [procedure](../verification.md#codeql-default-setup-off)); the agent reruns #756's CodeQL jobs until they pass; then #756 merges on green CI and independent review. The changed-paths diffs use `--no-renames`, so moving a file from `src/` into `docs/` lists both paths and is not docs-only (review of #756). The `.harness.json` change (the `github/codeql-action` entry in `ciActionPins` and the CodeQL workflow in the action-pin coupling) is for this project only, per AGENTS "Changing a harness file": a project setting, not a template change. Next: after the merge, a docs-only PR shows both OS jobs skipped and mergeable.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/verification-policy.test.mjs` (B-139 test), `test/ci-pins.test.mjs`; runs 45626156780, 45640205435, 45644029795 (runner not acquired); [#756](https://github.com/voidbrain/nerv/pull/756); docs-only run 45715615726 (#776); [#779](https://github.com/voidbrain/nerv/pull/779) |
| Opened | 2026-11-25 |
| Verification | Unit 2026-11-25: Test: `test/verification-policy.test.mjs` and `test/ci-pins.test.mjs` pass locally. CI 2026-11-26: docs-only PRs #770 and #772–#776 skipped both OS jobs and merged; CodeQL advanced setup green on #756 and after (default setup not-configured). |
| Reviewed | 2026-11-26 |

</details>

---

### F-127

**Point check:conventions at the Angular app in web/src**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: #754 merged on green CI; check:conventions reads web/src and src and passes (194 files); reconciled in #779.

| | |
|---|---|
| **Issue** | Owner approved 2026-11-25. Without `conventions.sourceDirs`, `check:conventions` reads only `src/` (the framework-free backend) and never reads the Angular app in `web/src`, so the Angular rules in [docs/agents/angular.md](../agents/angular.md) were never checked on it. The setting arrived with harness 10.11.0 (reconciled in F-125-T01). |
| **Reproduce** | On `main` before this change, `npm run check:conventions` reports 183 files, all under `src/`; none under `web/src`. |
| **Check** | `.harness.json` names `web/src` and `src` in `conventions.sourceDirs`; `npm run check:conventions` reads both (192 files) and passes. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: #754 merged on green CI; check:conventions reads web/src and src and passes (194 files); reconciled in #779. 2026-11-26 reconciliation ([PR #779](https://github.com/voidbrain/nerv/pull/779)): [#754](https://github.com/voidbrain/nerv/pull/754) merged on green CI (its Windows reruns were B-126 and B-076 flakes, not this change); `.harness.json` names `web/src` and `src` in `conventions.sourceDirs`, and `npm run check:conventions` at main `6b49177c` reads both and passes (194 files). 2026-11-25: opened and implemented at the owner's approval, on top of F-125-T01 (PR #753). `sourceDirs` is `["web/src", "src"]`: `web/src` brings the Angular app under the check; `src` keeps the unused-export check on the backend that the default already ran, so no check is lost. The check found no convention problem in the 9 `web/src` files, so nothing in the app changed. Related: [F-125](../work/records/F-127.md#f-125).

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | F-127-T01 in [PR #754](https://github.com/voidbrain/nerv/pull/754) |
| Opened | 2026-11-25 |
| Verification | Unit 2026-11-26: `npm run check:conventions` passes at `6b49177c` (194 files); CI of #754 green. |
| Reviewed | 2026-11-26 |

</details>

---

### B-118

**Windows CI: the test step runs into its 18-minute limit**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-26: Owner decision 2026-11-26 ("B-118 ok"): 13 clean first-attempt Windows npm test runs since #771 (365–490 s, none rerun) accepted instead of five consecutive green runs; evidence in PR #787.

| | |
|---|---|
| **Issue** | The `windows` job's `npm test` step (limit `timeout-minutes: 18`, set by B-076) ran out twice on PR #679: run 45259024776, attempts 1 (20:31:12–20:49:13 UTC) and 2 (21:20:20–21:38:20 UTC), 2026-11-23. Passing attempts that day took about 9–10 minutes (attempt 3 of the same run 9 m 48 s), so the suite either slows sharply on some runners or a test hangs; either way a PR waits on reruns. |
| **Reproduce** | Rerun the `windows` job of a full-suite PR several times; compare the step duration and the `windows-test-report` artifact (the last line before the stop names the test after which it hung). |
| **Check** | The two stopped attempts are read from their test reports and the cause named (a hanging test, or a slow runner with the slowest files measured); a hang gets a failing-first test and a fix, slowness a split, parallelism or test change; the next five full Windows runs finish within 12 minutes (a third of margin under the limit) without reruns. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: Owner decision 2026-11-26 ("B-118 ok"): 13 clean first-attempt Windows npm test runs since #771 (365–490 s, none rerun) accepted instead of five consecutive green runs; evidence in PR #787. Closed 2026-11-26: owner decision, given in chat on 2026-11-26 and relayed by the coordinator: "B-118 ok", that is, close B-118 on the evidence already recorded (13 clean Windows `npm test` runs since #771, 365–490 s each on the first attempt, none rerun; the 3 failures in that window were single tests owned by other records, B-066 and the Instrumentality daily-run failure, not the step limit) instead of the literal Check's five consecutive green runs; the owner accepted that deviation. B-118's own defect (the step running into its 18-minute limit) did not recur. No review: records-only closure on an owner decision; the evidence it rests on was recomputed by mechanical-reviewer (fresh context, 2026-11-26), below. 2026-11-26 verification ([PR #787](https://github.com/voidbrain/nerv/pull/787)): every full Windows `npm test` run after #771 took between 365 and 490 s on the first attempt, none near the 12-minute bound or the 18-minute limit, and none was rerun (each later run is a new head): 365 s ([run 45715497349](https://github.com/voidbrain/nerv/actions/runs/45715497349), PR #777 head `b02e787c`, failed the B-066-T02 heartbeat test), 475 s ([run 45717358062](https://github.com/voidbrain/nerv/actions/runs/45717358062), PR #778 head `a6dffe64`, failed the Instrumentality daily-run test), 436 s ([run 45717488957](https://github.com/voidbrain/nerv/actions/runs/45717488957), #777), 473 s ([run 45719295342](https://github.com/voidbrain/nerv/actions/runs/45719295342), #778), 384 s ([run 45725001743](https://github.com/voidbrain/nerv/actions/runs/45725001743), #782), 490 s ([run 45728896927](https://github.com/voidbrain/nerv/actions/runs/45728896927), PR #785 head `f90b537c`, failed a worker-link "Worker connection lost" test, B-066), 465 s ([run 45729902400](https://github.com/voidbrain/nerv/actions/runs/45729902400), #786), 449 s ([run 45730760071](https://github.com/voidbrain/nerv/actions/runs/45730760071), #785), 481 s ([run 45731342468](https://github.com/voidbrain/nerv/actions/runs/45731342468), #786). That is 13 clean first-attempt runs within 12 minutes since #753 and no step over 573 s since #741; the three failures in this window were single test failures in other records (B-066, and an Instrumentality timing recurrence after B-104), not the step limit. B-118's own defect (the step running into its limit) did not recur. Review: mechanical-reviewer (fresh context, 2026-11-26) recomputed every cited step time, attempt, head and PR and found the list complete; it found the literal Check (five consecutive runs without a red first attempt) not met, so closing on the step-time reading is an owner decision. Next: the owner decides; if green-run counting continues, three consecutive so far (#786, #785, #786). The 2026-11-26 #779 reconciliation (five clean runs, #764 to #771) and the #758 one (six first-attempt runs, two clean): [archive](evidence-2026.md#b-118-moved-2026-11-26-later). The 2026-11-25 #741 reconciliation and the B-118-T04 summary: [archive](evidence-2026.md#b-118-moved-2026-11-26). Full analysis: [archive](evidence-2026.md#b-118-moved-2026-11-25). Earlier: the 2026-11-24 reconciliation (50 Windows attempts after PR #706) is in the [archive](evidence-2026.md#b-118-moved-2026-11-25). Earlier B-118 evidence (T01–T03): [archive](evidence-2026.md#b-118-moved-2026-11-24).

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | B-118-T04: Test: `test/sqlite-no-fsync.test.ts`; timing logs of runs 45506622094 to 45559316942 (Windows) and [run 45548137584](https://github.com/voidbrain/nerv/actions/runs/45548137584) (Linux); [PR #706](https://github.com/voidbrain/nerv/pull/706) (shared teardown, exit guard, failures named; Test: `test/runtime-exit.test.ts`); [run 45325080543](https://github.com/voidbrain/nerv/actions/runs/45325080543) (Windows 8.6 min); [PR #699](https://github.com/voidbrain/nerv/pull/699) (teardown hooks, bounded stop/close; Test: `test/worker-link-exit.test.ts`); [PR #695](https://github.com/voidbrain/nerv/pull/695) (timings, split); [run 45314998906](https://github.com/voidbrain/nerv/actions/runs/45314998906) (this branch, Windows); [run 45307748925](https://github.com/voidbrain/nerv/actions/runs/45307748925) (hang named); [PR #692](https://github.com/voidbrain/nerv/pull/692) (opened); [run 45259024776](https://github.com/voidbrain/nerv/actions/runs/45259024776); [#741](https://github.com/voidbrain/nerv/pull/741); [#750](https://github.com/voidbrain/nerv/pull/750); [#758](https://github.com/voidbrain/nerv/pull/758); [#787](https://github.com/voidbrain/nerv/pull/787); [#794](https://github.com/voidbrain/nerv/pull/794) (closed on the owner decision) |
| Opened | 2026-11-24 |
| Verification | CI 2026-11-25 (later): 573, 545, 440 and 359 s (runs 45602256057, 45618960815, 45629193344, 45640302693); the first two needed a test rerun; two clean runs since. Unit 2026-11-25: Test: `test/sqlite-no-fsync.test.ts` and `test/coordinator-partition.test.ts` pass locally (B-118-T04). CI 2026-11-25: after PR #741 four Windows `npm test` runs took 352–506 s on the first attempt (runs 45572380286, 45577116814, 45580660697, 45589471622); five needed. Unit/integration 2026-11-24: Test: `test/worker-link-exit.test.ts` (B-118-T02) and `test/runtime-exit.test.ts`, `test/test-timing-reporter.test.mjs` (B-118-T03) pass locally. |
| Reviewed | 2026-11-26 |

</details>

---

### B-127

**F-118-T02 browser test times out when it runs together with many test files**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: PR #793 merged on green CI (run 45781930245: validate, windows, native-macos, full-suite incl. the browser step); test/shared-build.test.mjs failed before the fix and passes after; the concurrent run (33 live.js/web/src files + gauntlet + evaluation.browser) failed 3/3 before and passed 3/3 after, locally 2026-11-26.

| | |
|---|---|
| **Issue** | "F-118-T02: the installed app pairs with a typed code and stays signed in; a browser tab refuses the code" (`test/evaluation.browser.mjs`) fails when it runs in one `node --test` together with many other test files; it fails the same way on main and passes alone. Seen 2026-11-24 while verifying PR #716 (F-118-T05): every test reading live.js or web/src plus touched tests and `test/gauntlet.test.mjs` in one run gave 211/214 (2 skipped), the one failure this test; alone 6/6 twice. CI runs it in its own browser step and was green. |
| **Reproduce** | On a development checkout: `node --test test/evaluation.browser.mjs` alone passes; the same file in one `node --test` with the live.js/web/src tests and `test/gauntlet.test.mjs` fails on the F-118-T02 case. |
| **Check** | The cause under load is named from the run output (timeout, Chrome start, server or build wait); a regression that reproduces the load case fails before the fix and passes after it, or the test states the bound that absorbs it; the concurrent run passes. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: PR #793 merged on green CI (run 45781930245: validate, windows, native-macos, full-suite incl. the browser step); test/shared-build.test.mjs failed before the fix and passes after; the concurrent run (33 live.js/web/src files + gauntlet + evaluation.browser) failed 3/3 before and passed 3/3 after, locally 2026-11-26. 2026-11-24: opened in the backlog reconciliation from the F-118 verification of PR #716 ([evidence](evidence-2026.md#f-118-moved-2026-11-24-reconciliation)). Not seen in CI, so P3. Related: B-117 (gauntlet cases under machine load, closed), F-118. 2026-11-26: B-127-T01 implemented. Cause: not load. `test/gauntlet.test.mjs` renamed the shared `dist/web/browser` away (the two B-059 tests and F-074-T10's source-key check), so a browser test in the same `node --test` was served the server's 404 `{"error":"Not found."}` (Chrome's JSON view, the 185-character document at `/dashboard/`); the fixture's timeout error now prints that page. Fix: `tools/gauntlet.mjs` reads the build path from `NERV_GAUNTLET_BROWSER_BUILD`; the B-059 tests use temporary folders and F-074-T10 checks that the source inputs exclude `dist/`. Regression `test/shared-build.test.mjs` watches the build folder while those tests run: failed before the fix, passes after. The concurrent run (33 live.js/web/src files + gauntlet + evaluation.browser) failed 3/3 before, passed 3/3 after.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [PR #716](https://github.com/voidbrain/nerv/pull/716) (where it was seen); opened in [PR #723](https://github.com/voidbrain/nerv/pull/723); [#793](https://github.com/voidbrain/nerv/pull/793) |
| Opened | 2026-11-24 |
| Verification | 2026-11-26: PR #793 merged on green CI (run 45781930245) with the local concurrent run passing; closed in the #778–#798 reconciliation. |
| Reviewed | 2026-11-24 |

</details>

---

### B-133

**Windows CI: the F-121-T04 cache probe answered in 698 ms while its test allows 300 ms**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: PR #788 merged on green CI (run 45774422823); test/print-transfer.test.ts passed on Windows in five first-attempt CI runs whose heads contain #788: #793 (45781930245), #795 (45783123576), #796 (45783603648), #797 (45786259079), #798 (45784812554); #791 also passed it, but was rerun for other tests (B-076).

| | |
|---|---|
| **Issue** | On 2026-11-24 the Windows `npm test` step of PR #722 (F-121-T04) failed "F-121-T04: asking whether a part is cached never waits behind the slicer or gets busy" (`test/print-transfer.test.ts:476`): `answered in 698 ms` against a 300 ms bound, while two transfers kept a 600 ms fake slicer busy. 698 ms is longer than the fake slice, so the probe may have queued behind it (the behaviour the test forbids) or the runner was slow. A rerun passed. The test is F-121-T04's own regression, so F-121-T04 stays Implemented until this is named. |
| **Reproduce** | Windows CI `npm test`: [run 45472575103](https://github.com/voidbrain/nerv/actions/runs/45472575103) attempt 1 (PR #722 head `d218d531`, after the review fixes). Locally: `node --test test/print-transfer.test.ts` while the machine is loaded (many test files at once). |
| **Check** | The cause is named from the run output and a reproduction under load: a code cause gets a failing-first regression and a fix; a runner cause gets a bound stated in the test that still fails when the probe queues behind the slicer; `test/print-transfer.test.ts` passes in the next five Windows CI runs without a rerun. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: PR #788 merged on green CI (run 45774422823); test/print-transfer.test.ts passed on Windows in five first-attempt CI runs whose heads contain #788: #793 (45781930245), #795 (45783123576), #796 (45783603648), #797 (45786259079), #798 (45784812554); #791 also passed it, but was rerun for other tests (B-076). 2026-11-26 (B-133-T01): cause named, a runner cause. The probe for an uncached part has no `await` (`receivePartTransfer` returns `need: content` synchronously), so it cannot queue behind the slicer; but its answer resumes only after every microtask queued before it, and the first transfer's lane microtask stages the part synchronously (profiles read, two `mkdirSync`, `writeFileSync`, `renameSync`) and starts the slicer, all on the event loop. On a slow Windows disk or a loaded runner that work took 331 and 698 ms, which the old wall-clock bound (300 ms) counted as waiting. Reproduction committed first: `test/print-transfer.test.ts` "B-133: the synchronous staging of a concurrent transfer, not the slicer, delays the cache probe" (a slicer start that blocks the loop for 400 ms puts the probe past 300 ms while no slice has finished). Not reproduced on macOS under CPU load (2× cores of `yes`: 1–2 ms in six runs), consistent with a Windows file-system cost. Bound: the F-121-T04 test now asserts the order (the answer comes before any slice ends) instead of 300 ms (changed expectation: the requirement "never waits behind the slicer" is unchanged, its measure is); with the probe made to await the lane, that test fails (checked locally). 2026-11-25 reconciliation: a second failure, `answered in 331 ms` at `test/print-transfer.test.ts:476` on Windows ([run 45553326990](https://github.com/voidbrain/nerv/actions/runs/45553326990) attempt 2, PR #738; passed on a later attempt); 331 ms is under the 600 ms fake slice but over the 300 ms bound; cause not yet named. 2026-11-25: opened in the backlog reconciliation from the CI log of PR #722 (job 138724380031: `AssertionError: answered in 698 ms` at `test/print-transfer.test.ts:500`). F-121-T03 lists B-133-T01 among its prerequisites. Related: B-076 (scattered Windows CI failures) and B-126 (Runtime not ready on slow runners).

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/print-transfer.test.ts` (B-133 reproduction; F-121-T04 order bound); [run 45472575103](https://github.com/voidbrain/nerv/actions/runs/45472575103) attempt 1 (PR #722); [run 45553326990](https://github.com/voidbrain/nerv/actions/runs/45553326990) attempt 2 (PR #738); opened in [#736](https://github.com/voidbrain/nerv/pull/736); [#750](https://github.com/voidbrain/nerv/pull/750); [#788](https://github.com/voidbrain/nerv/pull/788) |
| Opened | 2026-11-25 |
| Verification | 2026-11-26: five Windows runs without a rerun after #788; closed in the #778–#798 reconciliation. |
| Reviewed | 2026-11-26 |

</details>

---

### B-150

**The Instrumentality daily-run test failed again on Windows after B-104 closed: the run crossed Rome midnight**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: PR #796 merged on green CI (run 45783603648, Windows first attempt); the Instrumentality daily-run test and the B-150 midnight test passed on Windows in the first attempts of #796 and of #797 (45786259079) and #798 (45784812554), whose heads contain #796.

| | |
|---|---|
| **Issue** | Windows `npm test` of [CI run 45717358062](https://github.com/voidbrain/nerv/actions/runs/45717358062) (PR #778 head `a6dffe64`, 2026-11-25 22:58–23:06 UTC) failed "Instrumentality runs once a local day at its time, and a failed digest is not retried in a loop" (`test/instrumentality.test.ts`) with 4 digest calls where it expects 2. B-104 (closed 2026-11-22, [archive](#b-104)) fixed the same test's fixed 400 ms wait (0 calls); this was a different cause and no record owned it. |
| **Reproduce** | Run the old test (real clock) so that its scheduler ticks before and after midnight in Europe/Rome: the first tick claims today's slot and asks twice (one retry of an unreadable reply), a tick after midnight is a new local day and asks twice more. `B-150: a failed daily run that crosses local midnight…` in `test/instrumentality.test.ts` drives that crossing with a set clock. |
| **Check** | The cause is named; the daily-run test does not read the real clock; a test drives the midnight crossing and expects exactly two attempts per local day; the Windows job passes the test without reruns. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: PR #796 merged on green CI (run 45783603648, Windows first attempt); the Instrumentality daily-run test and the B-150 midnight test passed on Windows in the first attempts of #796 and of #797 (45786259079) and #798 (45784812554), whose heads contain #796. 2026-11-26: opened at the owner's request; B-150-T01 done in the same PR. Cause: the test used the real clock and the Windows runner reached it at 23:58–00:05 Rome, so a second local day rightly ran again (the scheduler claims one slot per local day, `src/runtime-instrumentality.ts`). Not a scheduler defect. The daily-run test was already pinned to a fixed clock in commit `aa5e7052` of PR #778 itself (named there under B-136, which is about the planner's invalid replies, so no record owned it); PR #778's next Windows run ([45719295342](https://github.com/voidbrain/nerv/actions/runs/45719295342)) passed. No failing-first test for the fix: the defect was the test's clock, as in B-104; the failing evidence is the Windows log of run 45717358062. The new test reproduces the cause deterministically (4 calls across the crossing, 2 per day). Related: B-104 (archived), B-118 (Windows run times, cites the run).

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [CI run 45717358062](https://github.com/voidbrain/nerv/actions/runs/45717358062) (Windows, PR #778); fix `aa5e7052` in [PR #778](https://github.com/voidbrain/nerv/pull/778); [#796](https://github.com/voidbrain/nerv/pull/796) |
| Opened | 2026-11-26 |
| Verification | 2026-11-26: Windows passes without reruns on #796, #797 and #798; closed in the #778–#798 reconciliation. |
| Reviewed | 2026-11-26 |

</details>

---

### F-098

**FPV fleet diary: crashes, parts, spares and photos**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-26: Closed 2026-11-26: F-098-T01 to T03, T05 and T06 delivered on green CI (#588, #663, #691, #705); F-098-T04 (live crash check) cancelled by owner decision 2026-11-26 (chat, "accept all 17 proposals" of the cross-project audit): the FPV code moves to FPVBuddy (F-101). #802.

| | |
|---|---|
| **Issue** | Owner request 2026-11-14: "ho crashato Smoke, motore sinistro inferiore rotto. Quale avevo rotto l'ultima volta? Quanti ne sono rimasti di scorta (nuovi/usati)? La batteria 7 blu presenta danni ma sembra ancora buona." NERV has no record of drones, their parts, crashes or spares, and cannot keep photos with them. |
| **Reproduce** | `nerv chat "ho crashato Smoke, motore sinistro inferiore rotto"` then `nerv chat "quale avevo rotto l'ultima volta?"`. |
| **Check** | Drones by name with parts by position; a crash entry from chat (drone, part, damage, date); answers to "last time this part broke" and "spares left, new and used"; change spare counts only when the chat phrase explicitly says a new or used spare was used; a battery damage note goes on the battery (F-008); photos from Telegram or the dashboard attach to a crash, a part or a battery and stay local; follow-up planning after fleet.chat remains local-only; invented tests. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: Closed 2026-11-26: F-098-T01 to T03, T05 and T06 delivered on green CI (#588, #663, #691, #705); F-098-T04 (live crash check) cancelled by owner decision 2026-11-26 (chat, "accept all 17 proposals" of the cross-project audit): the FPV code moves to FPVBuddy (F-101). #802. Owner decision 2026-11-26 (chat): "accept all 17 proposals" of the cross-project audit (coordinator `docs/audits/2026-11-26-cross-project.md`), proposal 1 ([#802](https://github.com/voidbrain/nerv/pull/802)): F-098-T04 cancelled; the owner accepted the recommendation to cancel the live checks of NERV FPV code due for removal, reason: the code moves to FPVBuddy ([F-101](../work/records/F-098.md#f-101)). Every other step is closed, so F-098 closes as delivered with its live check withdrawn; the fleet chat moves with [F-101](../work/records/F-098.md#f-101)-T10. 2026-11-26 reconciliation ([PR #779](https://github.com/voidbrain/nerv/pull/779)): F-098-T04 stays open. Its fixes are merged on green CI: B-137-T01 ([#764](https://github.com/voidbrain/nerv/pull/764), drone model and version) and B-138-T01 ([#762](https://github.com/voidbrain/nerv/pull/762), the spares answer), both verified; F-098-T04 depends on both. The owner can rerun once NERV-01 is updated to a main with them (step 0 of the page); that rerun is also B-137's and B-138's live check. 2026-11-25, F-098-T04 owner run on NERV-01 (`2627d483`): the drone was added by chat (`aggiungi il drone Smoke con frame AOS 5 v5.1`, sortie `bd8bd965-b64f-47c1-a4ac-8c8c94dae9d1`, which also added a spares row "AOS 5 v5.1 / frame / qty 0"); the crash chat recorded the crash correctly, motor, rear-left (sortie `59ef2bc2-4179-4f4a-a90e-a2212213f99d`); an earlier crash chat hit "Local route (S²) reply too long: still being written at the 115 s limit" (sortie `4126574b-c238-4716-ae1d-2fabe9f82e4b`) while landing gauntlet runs shared the local model. The spare count failed: `quanti motori di scorta mi restano?` answered twice with a generic greeting ([B-138](../work/records/F-098.md#b-138)). F-098-T04 stays open, waiting on B-138 and B-137 (drone model and version read as part categories, opened in PR #750). Earlier evidence (2026-11-24 reconciliation, the first 2026-11-25 owner run): [archive](evidence-2026.md#f-098-moved-2026-11-26).

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [#802](https://github.com/voidbrain/nerv/pull/802) (F-098-T04 cancelled); F-098-T04 run evidence in [PR #751](https://github.com/voidbrain/nerv/pull/751); [PR #705](https://github.com/voidbrain/nerv/pull/705) (F-098-T06 fleet by chat); [PR #691](https://github.com/voidbrain/nerv/pull/691) (F-098-T05 fleet import); [PR #663](https://github.com/voidbrain/nerv/pull/663) (Italian `fleet` intent fix for `S-6AD9`); [PR #588](https://github.com/voidbrain/nerv/pull/588) (F-098-T03); Owner request 2026-11-14; [plan](../design/fpv-and-cooking-plan-2026-11-14.md); [PR #408](https://github.com/voidbrain/nerv/pull/408); [#750](https://github.com/voidbrain/nerv/pull/750) |
| Opened | 2026-11-14 |
| Verification | Unit/integration 2026-11-24: `node --test test/fleet-chat.test.ts test/fleet.test.ts test/fleet-import.test.ts` (43 passed) with the containment fix; CI green on PRs #691 and #705. Live on the real fleet 2026-11-25 (F-098-T04, owner on NERV-01): crash recorded; spare count failed (B-138). The rerun was cancelled 2026-11-26 (F-098-T04, owner decision). |
| Reviewed | 2026-11-26 |

</details>

---

### B-151

**The dashboard's AA test skipped every black or white text: Eva · Light primary buttons fail AA**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: #801 merged 2026-11-26 on green CI (validate, windows, native-macos, full-suite); test/dashboard.test.ts AA check committed failing first and unedited.

| | |
|---|---|
| **Issue** | `test/dashboard.test.ts` "every theme, mode and colour reaches WCAG AA …" (F-047) computes luminance by reading six hex digits, but `palette()` gives black and white as `#000` and `#fff`: the luminance is NaN, `NaN < 4.5` is false, so every pair with `hdr-fg`, `brand-fg` or `on-danger` in black or white passed unchecked. With the colours read correctly, Eva · Light fails `brand-fg` on `accent` (black on the deep accent, the `.btn.primary` text) in all five colours: orange #000 on #b34700 3.82, blue on #1d5fd1 3.61, green on #166534 2.95, violet on #7e3fc4 3.40, ochre on #7a5d00 3.39 (need 4.5). No other pair fails in the 20 combinations. |
| **Reproduce** | In `test/dashboard.test.ts`, `lum('#000')` returns NaN (`parseInt('', 16)`); on main the test passes although Eva · Light · Orange's primary button is black on #b34700 (3.82:1). |
| **Check** | The test reads three-digit hex and fails any ratio that is not a number (B-151-T01, committed failing first and not edited); every pair passes AA in all 20 combinations; Eva · Dark · Orange (the `:root` default) is unchanged; `src/dashboard-theme.ts` stays equal to `dashboard.js`. |
### B-137

**Fleet chat reads a new drone's model and version as part categories**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: #764 merged on green CI (run 45681378218); owner decision in chat 2026-11-26 ("close B-137 and B-138 on their CI evidence? yes i guess"): the live F-098-T04 rerun was cancelled (#802), no live check planned.

| | |
|---|---|
| **Issue** | Seen by the owner on NERV-01 at `2627d483` on 2026-11-25 at about 12:00. `nerv chat "aggiungi il drone Smoke, modello AOS 5, v. 5.1"` answered (after two "(invalid reply)" lines, [B-136](../work/records/B-137.md#b-136)) "Quale categoria intendevi per 'modello'? Devo scegliere tra: frame, motor, prop, arm, fc, esc, vtx, camera, rx, antenna, gps.": the drone's model was taken for a part category. Answering `nerv chat "frame"` (again two "(invalid reply)" lines) gave "Non riesco a registrare 'v. 5.1' perché non corrisponde a una delle categorie di componenti valide…": the version became another category. The conversation loops instead of adding the drone with frame "AOS 5 v5.1". Likely place: `parseAddDrone` in `src/fleet-chat.ts` splits the text after the name on commas and reads each segment's first word as a part category; drone models live in `drone_models` (F-121-T01). |
| **Reproduce** | With an invented drone: `nerv chat "aggiungi il drone Testdrone, modello Testframe 5, v. 5.1"`; today: a question about the category "modello"; answering `nerv chat "frame"`: a refusal of "v. 5.1" as a category. |
| **Check** | A committed test fails first: adding a drone with "modello <model>" (Italian and English) and a version records the drone with that model (frame or `drone_models` link, as F-121 defines), or asks once whether to create the model; a version segment ("v. 5.1", "v5.1") joins the model; answering the follow-up never loops back to the same question. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: #801 merged 2026-11-26 on green CI (validate, windows, native-macos, full-suite); test/dashboard.test.ts AA check committed failing first and unedited. 2026-11-26: found while building the 🧱 bricks themes. The first report blamed a wrong-arity call (`palette(theme, mode, accent)` against `palette({ theme, mode, accent })` in `src/dashboard-theme.ts`); that is not the cause: `test/dashboard.test.ts` loads the positional `palette()` from `web/public/dashboard/dashboard.js`, and `tsconfig.json` already includes `test/**/*.ts`, so `npm run typecheck` covers the tests and no typecheck step is needed. The cause is the NaN luminance of short hex. B-151-T01 fixes the test; B-151-T02 makes Eva · Light's brand colour the deep accent with white text, as Simple · Light already does and as 🧱 bricks#20 chose for light modes. 2026-11-26: B-151-T01 and B-151-T02 implemented: the test fails on main with the five Eva · Light pairs and passes unedited after the fix; Eva · Light's brand block and primary buttons are now white on the deep accent (`.hdr` panel headers keep black on the bright accent, 4.5:1 or more); Eva · Dark · Orange and `:root` unchanged. Remaining: CI.
**Next action / closure evidence:** Closed 2026-11-26: #764 merged on green CI (run 45681378218); owner decision in chat 2026-11-26 ("close B-137 and B-138 on their CI evidence? yes i guess"): the live F-098-T04 rerun was cancelled (#802), no live check planned. 2026-11-26 ([#802](https://github.com/voidbrain/nerv/pull/802)): the live check named below, the F-098-T04 rerun, was cancelled by owner decision ("accept all 17 proposals" of the cross-project audit; the FPV code moves to FPVBuddy, F-101). The fix stays verified on CI; no live check of it is planned. 2026-11-26 reconciliation ([PR #779](https://github.com/voidbrain/nerv/pull/779)): B-137-T01 verified: [#764](https://github.com/voidbrain/nerv/pull/764) merged on green CI (run 45681378218). Remaining: the live check on NERV-01, done by the F-098-T04 rerun once NERV-01 runs a main with #764. 2026-11-25: B-137-T01 implemented in `src/fleet-chat.ts` with failing-first tests committed in `test/fleet-chat.test.ts` (`2fc02d29`). `parseAddDrone` merges comma/semicolon version segments (`v. 5.1`, `v5.1`, `version 2.0`, `versione ...`) onto the preceding model or part segment before category checking, accepts `modello <model>` / `model <model>`, records the drone's `frame` and `drone_models` link (creating the model in `drone_models` when not yet present or inheriting printed parts when already registered), and asks once without category looping when a model name is omitted or a part keyword is clarified. Review fix (Claude, same PR): the owner's second phrase `aggiungi il drone Smoke con frame AOS 5 v5.1` (no comma) did not parse; `con` / `with` after the name now separates it (test committed failing first). The `frame` spares row at 0 new, 0 used that adding a drone creates is intended: the fleet import records a spares row for every named part model so counts can be set later, and the reply names it; since [B-138](../work/records/B-137.md#b-138) a spares question filters by category, so that row no longer answers a question about motors. Next: CI and merge, then verify on live NERV-01 during F-098-T04. Related: [F-098](../work/records/B-137.md#f-098), [F-121](../work/records/B-137.md#f-121) (drone models).

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | Code reading at main `bce6cd76`: `test/dashboard.test.ts` (lum, need), `web/public/dashboard/dashboard.js` `palette()`, `.btn.primary` and `.brand-block` in `web/public/dashboard/index.html`, `.brand` in `web/src/sign-in.ts`. Test: `test/dashboard.test.ts` "every theme, mode and colour reaches WCAG AA …"; [#801](https://github.com/voidbrain/nerv/pull/801) |
| Opened | 2026-11-26 |
| Verification | Unit: 2026-11-26, CI of #801: dashboard AA check passes all 20 combinations. Browser: 2026-11-26, headless screenshots of Eva · Light and Eva · Dark · Orange (not in the repository). |
| PR / evidence | Test: `test/fleet-chat.test.ts` (committed failing first in `2fc02d29`); owner report 2026-11-25, NERV-01 at `2627d483`; [#750](https://github.com/voidbrain/nerv/pull/750); [#764](https://github.com/voidbrain/nerv/pull/764) |
| Opened | 2026-11-25 |
| Verification | Unit/integration: 2026-11-25 passed locally (`test/fleet-chat.test.ts`, `test/fleet-prints.test.ts`, `test/fleet.test.ts`); live NERV-01 check pending. |
| Reviewed | 2026-11-26 |

</details>

---

### B-138

**`nerv chat` answers a fleet question with a generic greeting, ignoring the `fleet.chat` result**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: #762 merged on green CI (run 45674896663); owner decision in chat 2026-11-26 ("close B-137 and B-138 on their CI evidence? yes i guess"): the live F-098-T04 rerun was cancelled (#802), no live check planned.

| | |
|---|---|
| **Issue** | Seen by the owner on NERV-01 at `2627d483` on 2026-11-25. `nerv chat "quanti motori di scorta mi restano?"` twice answered with a generic Misato greeting, although `fleet.chat` was granted and ran (sorties `e8a4444a-16c1-4d4f-984a-1bf118d78ccf` and `e7849127-dbdd-47ad-b712-8f848f181815`): the tool result was ignored. Expected: no spare motors are registered (the spares table held only one frame row, quantity 0). Likely places: the planner's follow-up turn after a tool step (`misatoAsk` in `src/misato.ts`, history and `steps`) and the spares answer of `handleFleetChat` (`src/fleet-chat.ts`, called from `src/executors.ts`). |
| **Reproduce** | With an invented fleet that has no motor spares: `nerv chat "quanti motori di scorta mi restano?"`; today: a greeting with no spare count. `nerv events e8a4444a-16c1-4d4f-984a-1bf118d78ccf` on NERV-01 shows the granted `fleet.chat` step and the reply. |
| **Check** | The cause is named from the two sorties (the `fleet.chat` result and the next planner reply); a committed test across the tool step and the final reply fails first and passes with the fix; asked with no motor spares, the answer says none are registered; asked with spares, it gives the counts (new and used). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: #762 merged on green CI (run 45674896663); owner decision in chat 2026-11-26 ("close B-137 and B-138 on their CI evidence? yes i guess"): the live F-098-T04 rerun was cancelled (#802), no live check planned. 2026-11-26 ([#802](https://github.com/voidbrain/nerv/pull/802)): the live check named below, the F-098-T04 rerun, was cancelled by owner decision ("accept all 17 proposals" of the cross-project audit; the FPV code moves to FPVBuddy, F-101). The fix stays verified on CI; no live check of it is planned. 2026-11-26 reconciliation ([PR #779](https://github.com/voidbrain/nerv/pull/779)): B-138-T01 verified: [#762](https://github.com/voidbrain/nerv/pull/762) merged on green CI (run 45674896663). Remaining: the live check on NERV-01, done by the F-098-T04 rerun once NERV-01 runs a main with #762. 2026-11-25: diagnosed from the `2627d483` code paths without reading `~/.nerv` or the live service (session rule). Two defects met across `fleet.chat` and the planner follow-up turn for sorties `e8a4444a` and `e7849127`: (1) `handleFleetChat` (`src/fleet.ts`) listed `fleet.listSpares()` unfiltered (ignoring the requested `motor` category) and matched English spares phrases only with `"left"` / `"remaining spares"`, so with one `frame` row at `0/0` and no `motor` rows it returned either the unrelated `frame` spare or `{ handled: false }`; (2) `misatoAsk` (`src/misato.ts`) never defined `"steps"` in `system()`, and `RuntimePlanning.loop` (`src/runtime-planning.ts`) accepted an ungrounded generic greeting after a granted `fleet.chat` step. Fixed in B-138-T01 with failing-first tests committed before the fix (`2b25814f`). Review fix (Claude, same PR): the widened spares match also took drone questions ("quanti droni hanno il gps?", "does any drone have a camera?") for spares queries; it now needs a spares word, or "rimasti/restano/left/remaining" with a part category (negative cases in `test/fleet-chat.test.ts`). Next: CI and merge, then verify on live NERV-01 during F-098-T04. Related: [F-098](../work/records/B-138.md#f-098).

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | Test: `test/fleet-chat.test.ts`, `test/misato.test.ts` (committed failing first in `2b25814f`); owner report 2026-11-25, NERV-01 at `2627d483`; opened in [PR #751](https://github.com/voidbrain/nerv/pull/751); [#762](https://github.com/voidbrain/nerv/pull/762) |
| Opened | 2026-11-25 |
| Verification | Unit/integration: 2026-11-25 passed locally (`test/fleet-chat.test.ts`, `test/misato.test.ts`); live NERV-01 check pending. |
| Reviewed | 2026-11-26 |

</details>

---

### F-134

**Enforce the weekly audit cadence**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-26: #802 (F-134-T01, audit.enforce on) and #806 (F-134-T02, full audit docs/audits/2026-11-26-full.md) merged on green CI; check:audits reports every area fresh.

| | |
|---|---|
| **Issue** | Cross-project audit 2026-11-26 (coordinator `docs/audits/2026-11-26-cross-project.md`, proposal 17): NERV has a full audit baseline but `audit.enforce` is off in `.harness.json`, so a lapsed audit only warns. The last full audit (2026-11-20) is due 2026-11-27. Owner decision 2026-11-26 (chat): "accept all 17 proposals". |
| **Reproduce** | With `audit.enforce` false, `npm run check:audits` exits 0 even when an area is due. |
| **Check** | `audit.enforce` is true (F-134-T01); a full audit dated by 2026-11-27 makes every area fresh (F-134-T02). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: #802 (F-134-T01, audit.enforce on) and #806 (F-134-T02, full audit docs/audits/2026-11-26-full.md) merged on green CI; check:audits reports every area fresh. 2026-11-26: opened from the owner's acceptance of the cross-project audit ([#802](https://github.com/voidbrain/nerv/pull/802)). F-134-T01 implemented in #802 (`audit.enforce` true, a project setting; `npm run check:audits` passes on the 2026-11-20 full audit). F-134-T01 closed on #802's green CI. 2026-11-26: F-134-T02 implemented in [#806](https://github.com/voidbrain/nerv/pull/806): full audit `docs/audits/2026-11-26-full.md` and its manifest at baseline `4a0df337` (all eight areas checked; 10 findings; new B-152, B-153; owner proposals A–C); `npm run check:audits` reports every area fresh from it. Remaining: CI, then close.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [#802](https://github.com/voidbrain/nerv/pull/802) (opened, F-134-T01); [#806](https://github.com/voidbrain/nerv/pull/806) (F-134-T02, full audit) |
| Opened | 2026-11-26 |
| Verification | Unit/integration: 2026-11-26, npm run check:audits lists every area fresh from docs/audits/2026-11-26-full.md; #806 CI passed validate, windows, native-macos and full-suite. |
| Reviewed | 2026-11-26 |

</details>

---

### B-152

**50 CodeQL alerts open on main, never triaged**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-26: nerv#810 (triage, green CI); owner dismissed all 50 alerts 2026-11-26, open-alert count on main 0.

| | |
|---|---|
| **Issue** | The CodeQL workflow's analysis of main `4a0df337` reports 50 open alerts, opened 2026-11-13 to 2026-11-23, and no record owns them. By rule: 9 `js/xss-through-dom` (high) and 2 `js/functionality-from-untrusted-source` in the retired prototypes under `remove/docs/NERV/`; 2 `js/incomplete-sanitization` (high) in `src/chronicle.ts:100,119`; 1 `js/insufficient-password-hash` (high) in `src/kaji.ts:51`; 1 `js/regex-injection` (high) in the harness-copied `tools/work-usage.mjs:975`; 30 `js/bad-code-sanitization` (29 in tests, 1 in `src/browser-cdp-driver.ts:101`); 5 `js/shell-command-injection-from-environment` (3 in tests, `src/node-inspection.ts:35`, `src/node-lifecycle-execution.ts:615`). |
| **Reproduce** | [CodeQL alert triage](../verification.md#codeql-alert-triage); `gh api --paginate 'repos/voidbrain/nerv/code-scanning/alerts?state=open&per_page=100' --jq length` prints 50. |
| **Check** | Every alert is fixed (a true positive gets a failing test first) or listed with its reason in `docs/verification.md#codeql-alert-triage` (B-152-T01); the owner dismissed the listed ones (B-152-T02); the same query prints 0, or only alerts the record names with an owner. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: nerv#810 (triage, green CI); owner dismissed all 50 alerts 2026-11-26, open-alert count on main 0. 2026-11-26: B-152-T02 closed ([#814](https://github.com/voidbrain/nerv/pull/814)): the owner dismissed all 50 alerts with the listed commands; the open-alert count on main is 0 (`gh api repos/voidbrain/nerv/code-scanning/alerts?state=open --paginate -q length` → 0). 2026-11-26: B-152-T01 read all 50 alerts at main `68472266`: none is real, no code changed. By rule: `js/bad-code-sanitization` 30 (29 used in tests, 1 false positive), `js/shell-command-injection-from-environment` 5 (3 used in tests, 2 false positive), `js/xss-through-dom` 9 and `js/functionality-from-untrusted-source` 2 (won't fix: retired `remove/` prototypes, never served; listed rather than excluded, so `codeql.yml` is unchanged), `js/incomplete-sanitization` 2, `js/insufficient-password-hash` 1, `js/regex-injection` 1 (false positive; nothing goes to the template). Reasons and commands: `docs/verification.md#codeql-alert-triage`; next the owner dismisses them (B-152-T02). Earlier: found by the full audit (F-134-T02, `docs/audits/2026-11-26-full.md`, finding 1). A spot check of four source alerts suggests false positives, not confirmed: `chronicle.ts` replaces the one `>` of a two-name detail for display; `kaji.ts:51` hashes a public key for a fingerprint, not a password; the `work-usage.mjs` pattern is built only after `opts.item` matched `^[BF]-\d{3}$`; `browser-cdp-driver.ts:101` embeds `JSON.stringify` of a control name in a CDP expression. Each still needs its own reading. Dismissing an alert is the owner's (AGENTS.md, ask first); excluding `remove/` from the analysis is a workflow change B-152-T01 may propose with its reason. `tools/work-usage.mjs` is a copied harness file: a true positive there goes to the template.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | GitHub code-scanning API at main `4a0df337`, analysis of 2026-11-26 09:48 UTC (50 results); `docs/audits/2026-11-26-full.md`; [#806](https://github.com/voidbrain/nerv/pull/806); [#810](https://github.com/voidbrain/nerv/pull/810) |
| Opened | 2026-11-26 |
| Verification | Pending |
| Reviewed | 2026-11-26 |

</details>

---

### B-165

**A full local test run overwrote the tracked Gauntlet ledger and #806 committed it (18 entries lost)**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🔴 Large |

💻 **→ Human action required: No**<br />Closed 2026-11-26: Closed 2026-11-26: #818 merged as 5c5ca1fb with every check green (validate incl. check:gauntlet-ledger, full-suite, windows, native-macos); local full npm test twice at load average 37 and 53 left evals/gauntlet/ledger.json untouched; Review: design-reviewer, findings fixed in #818.

| | |
|---|---|
| **Issue** | PR #806 (full audit F-134-T02, commit `bfdaab98`, a docs change) rewrote `evals/gauntlet/ledger.json`: main had 122 entries, the commit 104; it removed 10 cad-3d, 4 coding and 4 embedded entries (the F-120 campaign of 2026-11-26 07:26–09:06Z) and rewrote every remaining entry with `finished` 09:58:02–09:59:23Z and new report hashes. #803 restored them. Cause, from the evidence: a tool, not a hand edit. The new times fall inside the audit's two full `npm test` runs (09:50–10:02Z), the rewritten packs are exactly the model-free and fake-model packs the test fixtures run (no Docker-runner pack), and the 104-entry keyset is what a run starting from an empty ledger records. `tools/gauntlet.mjs` resolves the ledger path from `NERV_GAUNTLET_LEDGER` on every read and write (`ledgerPath()`, `:41`), and `test/gauntlet.test.mjs` sets and deletes that variable around async work (`:898`, `:1114`, `:1188`, …): when one test removes it while another is between reading its temp ledger and writing, the write lands on the repository's ledger. The audit commit then took the changed file along with its docs. Suspected cause, corroborated the same day: another agent's local full `npm test` on the F-086 branch also rewrote the tracked `evals/gauntlet/ledger.json` in place and the rewrite was committed by accident, then restored before merge in [#808](https://github.com/voidbrain/nerv/pull/808), so a test writes the tracked ledger in place. Reproduced on demand 2026-11-26 (B-165-T01): `node --test --test-timeout=10000 test/gauntlet.test.mjs` rewrites the ledger to the 104 entries every time. The root-command test (`the root command runs only uncovered cases…`, about 18 s idle) passes the suite's 60 s `--test-timeout` only on an idle host; on a loaded one the runner times it out and moves on while its `gauntlet all --execute` keeps running, and the next test's `finally` deletes `NERV_GAUNTLET_LEDGER`, so the orphaned run's next `writeLedger` resolves the tracked path and writes its temporary ledger's 104 entries there. The same orphan changes the next tests' files: [B-153](../work/records/B-165.md#b-153)'s five failures. |
| **Reproduce** | In a fresh worktree after `npm ci`: run `npm test` on a loaded host (as the 2026-11-26 audit did) and then `git status evals/gauntlet/ledger.json`; or compare `git show bfdaab98^:evals/gauntlet/ledger.json` (122 entries) with `git show bfdaab98:evals/gauntlet/ledger.json` (104). |
| **Check** | A committed test fails first (B-165-T01): it runs the Gauntlet test file (or the whole suite) and asserts `evals/gauntlet/ledger.json` is byte-identical afterwards; the fix makes it pass (B-165-T02); a branch that drops ledger entries present on main fails a check unless it names them (B-165-T03). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: Closed 2026-11-26: #818 merged as 5c5ca1fb with every check green (validate incl. check:gauntlet-ledger, full-suite, windows, native-macos); local full npm test twice at load average 37 and 53 left evals/gauntlet/ledger.json untouched; Review: design-reviewer, findings fixed in #818. 2026-11-26: Owner decision 2026-11-26 in chat: "NERV practices inventory accept all" (all 22 proposals of the coordinator's [practices transfer report](https://github.com/voidbrain/coordinator/blob/main/docs/reviews/2026-11-26-nerv-practices-transfer.md)). Found 2026-11-26 while restoring the entries in #803; investigated for this record from `git show` of `bfdaab98` and its parent, the audit's run times (`docs/audits/2026-11-26-full.md:3,9,20`) and `tools/gauntlet.mjs:41,217-221`. Planned: B-165-T01 (failing test), B-165-T02 (fix), B-165-T03 (entry-drop check). Shares the suspect with [B-153](../work/records/B-165.md#b-153)-T01: whichever step lands first records its finding in the other record. 2026-11-26, implemented: B-165-T01 `test/gauntlet-ledger.test.mjs` (committed first, all three tests fail on main): (a) `test/gauntlet.test.mjs` under a 10 s per-test limit leaves the ledger byte-identical and passes, (b) `gauntlet all --execute` writes the ledger it started with when `NERV_GAUNTLET_LEDGER` changes mid-run, (c) under the test runner a record to the tracked ledger is refused; each restores the file before asserting. B-165-T02 (`tools/gauntlet.mjs`): `main()` captures the `NERV_GAUNTLET_*` settings once per command (AsyncLocalStorage, `withGauntletSettings` for tests), and `writeLedger` refuses `evals/gauntlet/ledger.json` (compared by real path) under the test runner (`NODE_TEST_CONTEXT`, or `--test` in this process for `--test-isolation=none`; a test file run as `node file.mjs` is not recognisable); the root-command test gets a 300 s limit and passes its files as command settings instead of the process environment. With its limit forced to 5 s it still times out, but no other test fails and the ledger is untouched. B-165-T03: `npm run check:gauntlet-ledger` (`tools/check-gauntlet-ledger.mjs`, in `check:fast` and CI) fails when the working tree lacks a ledger entry (pack, case, profile) of the merge base of HEAD and origin/main, so a branch behind main is not blamed for entries main gained since; an entry may leave only when its case left the catalogue (or its pack is excluded in `consumption.json`), which is how a deliberate drop is named; a named `--base` that cannot be read fails. Replayed on #806 (`bfdaab98^` → `bfdaab98`) it names the 18 lost entries. Limit: an entry rewritten in place by a newer run is not a drop, so a fixture run recorded over real evidence passes this check; the test-runner guard covers that path. Its test was committed before the tool. Review: design-reviewer (fresh context), 2026-11-26: no blockers; the 18-not-22 count, the guard's isolation and symlink gaps, a mistyped `--base` passing and the rewrite limit were fixed or stated here; also noted: other Gauntlet tests still set `process.env` around direct helper calls (harmless while none times out), and T01 (a)'s 10 s per-test limit could flake on a much slower host. A run at load average 50 then timed out F-074-T10 (3 s idle) under T01 (a)'s 10 s limit: the Gauntlet tests of a second or more now carry a 120 s limit of their own (`SLOW_HOST`, B-153); T01 unchanged. Full runs in Verification.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [#808](https://github.com/voidbrain/nerv/pull/808) (second rewrite by a local `npm test`, restored before merge); [#806](https://github.com/voidbrain/nerv/pull/806) commit `bfdaab98` (ledger 122 → 104 entries); [#803](https://github.com/voidbrain/nerv/pull/803) (restored); `docs/audits/2026-11-26-full.md`; `tools/gauntlet.mjs:41,217-221`; `test/gauntlet.test.mjs:898,1114`; [#815](https://github.com/voidbrain/nerv/pull/815); [#818](https://github.com/voidbrain/nerv/pull/818); [#819](https://github.com/voidbrain/nerv/pull/819) (closure) |
| Opened | 2026-11-26 |
| Verification | CI: #818 all green 2026-11-26; Test: test/gauntlet-ledger.test.mjs, test/check-gauntlet-ledger.test.mjs |
| Reviewed | 2026-11-26 |
| Impact | Data integrity of the evaluation evidence: entries vanished from main without a check failing; restored by hand in #803. |

</details>

---

### B-153

**Five Gauntlet tests fail in the full local suite but pass alone**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-26: Closed 2026-11-26: cause named and fixed with B-165 in #818 (merged as 5c5ca1fb, every check green); local full npm test twice at load average 37 and 53 with no Gauntlet failure.

| | |
|---|---|
| **Issue** | Two full `npm test` runs at main `4a0df337` on a Mac at load average 43–80 (other agents' jobs) failed the same five `test/gauntlet.test.mjs` cases (lines 893, 1121, 1139, 1193, 1298, and 1820 once): `gauntlet pending` lists 104 cases where the test expects 126, and the pack lookups at 1139/1193/1820 find no entry. Run alone, `test/gauntlet.test.mjs` passes. Each run also had one load-timing failure elsewhere (`dashboard-accounting.test.ts:136`, 100 ms session; `model-setup.test.ts:249`), and one or two cancellations. CI on `main` was green at the same revision. |
| **Reproduce** | In a fresh worktree of main `4a0df337` after `npm ci`: `npm test` on a busy host; then `node --test test/gauntlet.test.mjs` alone passes. |
| **Check** | The cause is named (a test that changes shared repository files while the Gauntlet tests read them, as B-127 found for `dist/web/browser`, or a timing limit); a committed test fails first if it is in code; the full suite passes twice on a loaded host without the five failures. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: Closed 2026-11-26: cause named and fixed with B-165 in #818 (merged as 5c5ca1fb, every check green); local full npm test twice at load average 37 and 53 with no Gauntlet failure. 2026-11-26: found by the full audit (F-134-T02, `docs/audits/2026-11-26-full.md`, finding 2). A missing 22 of 126 cases points at a pack catalogue that another test file changes in the shared checkout (B-127, closed, had `test/gauntlet.test.mjs` move `dist/web/browser`); not confirmed. Candidates to read first: tests that write under the repository's pack or Gauntlet folders (`test/packs.test.ts`, `test/coordinator-snapshot.test.ts`). The 100 ms session in `dashboard-accounting.test.ts:136` is a separate load-timing clue, kept here until T01 says otherwise. 2026-11-26, cause named with [B-165](../work/records/B-153.md#b-165) (B-153-T01): not a shared pack folder but a timing limit plus the process environment. The root-command test (`test/gauntlet.test.mjs:893`, about 18 s idle) exceeds the suite's 60 s `--test-timeout` on a loaded host; the runner moves on while it keeps running, and its `NERV_GAUNTLET_TASKS`, `_CONSUMPTION` and `_LEDGER` settings, then its `finally` deleting them, change the files the following tests read: hence "104 of 126" (its fixture ledger records 104 entries) and the failures at 1121, 1139, 1193, 1300, 1823. Reproduced on demand on main: `node --test --test-timeout=10000 test/gauntlet.test.mjs` fails exactly those seven tests (893 times out) and rewrites the tracked ledger (B-165). Fixed by B-165-T02 and this record's commit: the Gauntlet tests of a second or more get their own limit (300 s for that test, 120 s for the others) and passes its files as command settings, not the process environment, and each command captures its settings when it starts. Failing test first: B-165-T01 (a) in `test/gauntlet-ledger.test.mjs` runs the Gauntlet tests under the 10 s limit and asserts they all pass. The dashboard-accounting and model-setup load failures did not recur in the two runs below; they stay unexplained here and get a record of their own if they return.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | Local full runs 2026-11-26 at `4a0df337`: 1,588 pass, 6 fail, 1 cancelled; then 1,588 pass, 5 fail, 2 cancelled. `node --test test/gauntlet.test.mjs test/dashboard-accounting.test.ts` alone: 34/34. Opened in [#806](https://github.com/voidbrain/nerv/pull/806). Cause and fix: [B-165](../work/records/B-153.md#b-165).; [#818](https://github.com/voidbrain/nerv/pull/818); [#819](https://github.com/voidbrain/nerv/pull/819) (closure) |
| Opened | 2026-11-26 |
| Verification | CI: #818 all green 2026-11-26; Test: test/gauntlet-ledger.test.mjs (B-165-T01 a) |
| Reviewed | 2026-11-26 |

</details>

---

### B-157

**The macOS-only Node tests (EVA sandbox, egress proxy, job user, desktop driver) never ran in CI**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P2 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: PR #805 merged on green CI (run 45801615629: native-macos ran 64 macOS-only Node tests with 0 skipped).

| | |
|---|---|
| **Issue** | Ten Node test files skip on every runner but macOS: the EVA `sandbox-exec` confinement (network and writes outside the workspace refused or let through), the egress proxy, the EVA job user, EVA jobs and pool, the EVA-03 gate's macOS profile, the macOS desktop driver, and the moved-service joins (`test/update-doctor-slow.test.ts`, `test/update-foreground-runtime.test.ts`). CI runs the Node suite on Ubuntu and Windows; the `native-macos` job ran only the Swift tests. The live service runs on macOS, so its confinement was tested only when someone ran `npm test` on a Mac. Found by the coordinator's dormant-checks sweep of 2026-11-26 (finding T1, proposal 1), which listed 14 sites in 7 files; the two moved-service files and `eva-gate` were found here. |
| **Reproduce** | On main, `.github/workflows/ci.yml` `native-macos` has no `node --test` step; `test/eva-runner.test.ts:32` and the other sites carry `skip: !isDarwinWithSandbox` or `platform !== 'darwin'`, so every Linux and Windows run reports them skipped. |
| **Check** | `test/macos-node-tests.test.mjs` (B-157-T01, committed failing first and not edited): every test file with a macOS-only skip is in `MACOS_NODE_TESTS`; a run with a skipped, failed or no test fails; the `native-macos` job runs `node tools/macos-node-tests.mjs` whenever Node work or a full run is selected. The job passes in CI with 0 skipped and adds about a minute. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: PR #805 merged on green CI (run 45801615629: native-macos ran 64 macOS-only Node tests with 0 skipped). 2026-11-26: owner in chat accepted the sweep's fixes ("Accept all fixes"). B-157-T01 and B-157-T02 implemented: `tools/macos-node-tests.mjs` runs the ten files on the macOS runner (64 tests, 15 s locally, 0 skipped) and fails on a skip; checkout, Node and `npm ci` in `native-macos` now also run when Node work or a full run is selected; `docs/verification.md` says so. 2026-11-26: the step's first CI run failed one test, a real defect it was added to find: EVA job-user staging (`stageRuntime`) failed on macOS 15 (recorded and fixed in B-099, same PR); the step now prints the TAP stream on a failure. 2026-11-26: renumbered from B-152 (taken on main by the CodeQL triage record). CI run 45798962499 green: the step ran 64 tests, 0 skipped. Remaining: close on the merged run.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | Coordinator report `docs/audits/2026-11-26-dormant-checks.md` (T1); `.github/workflows/ci.yml` `native-macos`; `tools/macos-node-tests.mjs`; `test/macos-node-tests.test.mjs`; [#805](https://github.com/voidbrain/nerv/pull/805) |
| Opened | 2026-11-26 |
| Verification | Unit: 2026-11-26, local: `test/macos-node-tests.test.mjs` fails on main (no list, no step) and passes with the fix; `node tools/macos-node-tests.mjs` on macOS: 64 passed, 0 skipped. CI: 2026-11-26, PR #805 run 45798962499: `native-macos` "macOS-only Node tests" 64 passed, 0 skipped (the whole job 1 min 46 s). |
| Reviewed | 2026-11-26 |

</details>

---

### B-158

**The dashboard shell showed the owner backlog step IDs, unseen by the B-102 test**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: PR #809 merged on green CI (run 45804069260: B-102 scan covers web/src and browser scripts, shell renders section names only).

| | |
|---|---|
| **Issue** | The B-102 rule says no string the code can show, send or prompt with names a backlog ID, but `test/user-text-ids.test.ts` scanned only the top-level `src/*.ts` and `web/public/dashboard/dashboard.js`. The Angular workspace (`web/src`) was outside it, and the full dashboard's "Moving here" panel showed `F-130-T02` … `F-130-T11` next to each section name (`web/src/dashboard/shell.ts:12-23`, rendered at `:128`). Coordinator dormant-checks sweep of 2026-11-26, finding C1, proposal 2. |
| **Reproduce** | On main, open `/full` signed in: each line of "Moving here" ends with a step ID such as `F-130-T02`. `node --test test/user-text-ids.test.ts` passes because `web/src` is not scanned. |
| **Check** | `test/user-text-ids.test.ts` (B-158-T01, committed failing first and not edited) scans `src/*.ts`, every `web/src/**/*.ts` (inline Angular templates included) and every `web/public/**/*.js`, asserts the shell and the old dashboard are among them, and lists the ten shell IDs on main; after B-158-T02 it passes and the panel shows section names only. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: PR #809 merged on green CI (run 45804069260: B-102 scan covers web/src and browser scripts, shell renders section names only). 2026-11-26: owner in chat accepted the sweep's fixes ("Accept all fixes"). B-158-T01 and B-158-T02 implemented: the scan now covers the workspace and every browser script (only the shell's ten IDs were found); `MOVING` holds the section keys only, the step IDs moved to its comment, and the list no longer renders an ID. Remaining: CI.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | Coordinator report `docs/audits/2026-11-26-dormant-checks.md` (C1); `test/user-text-ids.test.ts`; `web/src/dashboard/shell.ts`; [#809](https://github.com/voidbrain/nerv/pull/809) |
| Opened | 2026-11-26 |
| Verification | Unit: 2026-11-26, local: `test/user-text-ids.test.ts` failed on main with the ten shell IDs and passes after the fix. Browser & CI: 2026-11-26, PR #809 run 45804069260 passed `validate` (`test:browser`), `windows` and `native-macos`. |
| Reviewed | 2026-11-26 |

</details>

---

### B-159

**Coverage regressions never failed CI and the agent-behaviour checks had no runner**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: PRs #811 and #813 merged on green CI (run 45806519489: coverage enforced against measured baseline, Claude Code behaviour runner enabled).

| | |
|---|---|
| **Issue** | Two procedures were configured but dormant. `coverage.enforce` was `false`, so `node tools/coverage-table.mjs --check` in CI only warned and the `drop: 2` tolerance never failed a run; the committed baseline (`docs/agents/coverage.json`) dated from 2026-11-11 and the branch figure had since fallen past it (B-160). No `behaviour` setting, script or tool existed, so the agent-behaviour checks (`docs/agents/rule-review.md`) could not run. Coordinator dormant-checks sweep of 2026-11-26, findings S3 and S1 (proposals 8 and 4). |
| **Reproduce** | On main, `.harness.json` `coverage.enforce` is `false` and has no `behaviour`; CI run 45798962499 shows `::warning` "src/: branches 86.0 % → 82.9 %" and the job passes; `npm run behaviour` does not exist. |
| **Check** | B-159-T01: the baseline is today's measured coverage. B-159-T02: `coverage.enforce` is `true` and a later full CI run fails on a drop of more than 2 points against main's baseline; `behaviour.runner` is Claude Code (`claude -p`, the command `docs/agents/rule-review.md` gives), `tools/behaviour.mjs` is the template's v10.21.4 copy, `npm run behaviour -- list` names the scenarios; no paid run is part of enabling it. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: PRs #811 and #813 merged on green CI (run 45806519489: coverage enforced against measured baseline, Claude Code behaviour runner enabled). 2026-11-26: owner decisions in chat: "coverage enforcement all", "work-usage all" (NERV already has `workUsage.enabled: true`; nothing to change here, jobs recorded for this work), behaviour runner "ok" (Claude Code). B-159-T01 ([#811](https://github.com/voidbrain/nerv/pull/811)): `npm run coverage` on macOS wrote the baseline as measured today (lines 92.8 %, statements 92.8 %, branches 83.2 %, functions 89.4 %; CI on Linux read branches 82.9 % in run 45798962499, the macOS-only tests apart), so enforcement starts from the present and the earlier drop is B-160, not hidden. Enforcement compares a PR with main's baseline, so it could only be switched on once that landed (PR #811). B-159-T02 implemented: `coverage.enforce: true` (CI step comments updated); `behaviour: {times: 3, runner: "claude -p --permission-mode acceptEdits --allowedTools \"Bash(git:*)\" \"Bash(npm:*)\" \"Bash(node:*)\" -- \"$(cat \"$HARNESS_TASK_FILE\")\""}` as `docs/agents/rule-review.md` gives it; `tools/behaviour.mjs` copied byte for byte from template v10.21.4 (listed in `copied`) and `npm run behaviour`; `npm run behaviour -- list` names 10 scenarios. No run was started: enabling needs none, and each run costs agent time (10 scenarios × 3 runs of `claude -p`); once set, the rule-review procedure asks for a run when AGENTS.md, CLAUDE.md or BACKLOG-RULES change. Review: mechanical-reviewer (fresh context), 2026-11-26: copied file byte-identical to v10.21.4, runner equals the rule-review.md command, only the stated settings changed; one stray JSON reformat it found was reverted. Template v10.23.1 updates `behaviour.mjs` (before/after and held-out runs): it comes with the next harness reconcile. Remaining: CI.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | Coordinator report `docs/audits/2026-11-26-dormant-checks.md` (S1, S3); CI run 45798962499 (coverage warning); `docs/agents/coverage.json`; [#811](https://github.com/voidbrain/nerv/pull/811); [#813](https://github.com/voidbrain/nerv/pull/813) |
| Opened | 2026-11-26 |
| Verification | Documentation: 2026-11-26, `node tools/coverage-table.mjs --write` after `npm run test:coverage` (1595 pass, 0 fail). CI: 2026-11-26, PR #813 run 45806519489 passed all five jobs (`coverage-table.mjs --check` enforced). |
| Reviewed | 2026-11-26 |

</details>

---

### B-167

**Owner requests read in the wrong language, or without their battery tools, before Misato plans**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P1 | Closed | 🟢 Small |

💻 **→ Human action required: No**<br />Closed 2026-11-26: Closed 2026-11-26: fix #831 and review fixes #833 merged on green CI (all required checks passed); Review: design-reviewer, fresh context, one regression fixed in #833.

| | |
|---|---|
| **Issue** | Found while building the nerv-planner Gauntlet pack. `requestLanguage` (`src/misato.ts`) reads "quante batterie devo caricare?" and "stampa i piedini di Smoke" as English: the first has no word in its Italian list, and in the second "i" counts as English, so Misato is told to reply in English to the owner's Italian. `detectToolDomains` misses the English plural "batteries" (`batter[iy]\b`), so "how many batteries do I need to charge?" offers no battery tool, even after `tools.read` with subject batteries. |
| **Reproduce** | `node --input-type=module -e "const m=await import('./src/misato.ts'); console.log(m.requestLanguage('quante batterie devo caricare?'), m.requestLanguage('stampa i piedini di Smoke'), [...m.detectToolDomains({request:'how many batteries do I need to charge?'})])"` prints `en en []`. |
| **Check** | The three requests read as `it`, `it` and `batteries` (a test fails first, B-167-T01); the fix keeps the existing language and domain tests passing, and nerv-planner is rebuilt (`node tools/gauntlet-planner-pack.mjs`), so its changed cases are pending again (B-167-T02). |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: Closed 2026-11-26: fix #831 and review fixes #833 merged on green CI (all required checks passed); Review: design-reviewer, fresh context, one regression fixed in #833. 2026-11-26: Closed: #831 (merge e15d63e9) and #833 (merge 89d67918) merged with every required check green (8 success, CodeQL neutral, swift skipped); the B-167 tests pass on main. 2026-11-26: Review: design-reviewer subagent (fresh context, Opus) read the #831 diff with probes: no blocker; one regression, fixed in B-167-T03: a request with no listed word was decided by half votes alone, so "radio", "hello" or "pizza tonight" after an English conversation read as Italian; half votes now count only beside a listed word, else the earlier exchanges, then the fallback decide. Also from the review: Italian "me" ("per me va bene") no longer votes English. Test: `test/misato.test.ts` "B-167 review" (committed failing first). Accepted heuristics, not changed: a phone-capitalised first word never votes and Italian built only on English loanwords ("check mail", "list droni") reads English, both left to the fallback, which B-168 makes the owner's `config.language`; `(?:dis)?charg\w*` and `expir\w*` also route "in charge of" or "expired license" (only extra tool schemas for that turn); determinism and word boundaries hold ("squads", "hotmails" match nothing). 2026-11-26: raised to P1: the owner uses NERV in Italian, and their short requests (an imperative or a question with a name or a word English shares, such as "i", "a" or "in") were answered in English. `B-167-T01` (failing first, `test/misato.test.ts` "B-167"): 14 Italian requests (including "accendi la luce", "spegni il ventilatore per 2 ore", "aggiungi Rocca Calascio al trip di agosto", "ricordami di bere acqua tra 5 minuti", "controlla la mail di oggi", "elenca i promemoria", "a che ora parto?") read as `it`, 13 English ones stay `en`, and English plurals and synonyms reach each topic (batteries, lipos, discharged; PIDs, quads, propellers, drones; expires, recipes, groceries; emails, mails, invoices). `B-167-T02`: `requestLanguage` no longer counts "i", "a" or "in" as English, counts common Italian verbs and question words and a few more English function words, and gives half a vote to Italian for each other lower-case word of four or more letters ending in a, i or o (capitalised names never vote); `DOMAIN_INTENT_PATTERNS` take English plurals and synonyms. nerv-planner rebuilt as 1.1.0 (`node tools/gauntlet-planner-pack.mjs`, `--check` passes): its English battery case asks "how many batteries do I need to charge?" again, and all 18 Italian cases now tell Misato to reply in Italian (three did not), so every case is pending; `docs/test-capability-index.md` regenerated. Not changed: chat callers still pass no fallback, so a request with no telling word (for example "ok" with no earlier exchanges) falls back to English rather than `config.language` (B-168). No real model ran. 2026-11-26: opened while building the nerv-planner pack: it keeps the owner's phrasings for the Italian cases (their prompts carry NERV's real, wrong language line until this is fixed) and uses "how many battery packs do I need to charge?" for the English battery case, which NERV does route. Planned: B-167-T01, B-167-T02.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | `src/misato.ts` (`requestLanguage`, `DOMAIN_INTENT_PATTERNS`); found by the nerv-planner pack; [#829](https://github.com/voidbrain/nerv/pull/829); fix [#831](https://github.com/voidbrain/nerv/pull/831); review fixes [#833](https://github.com/voidbrain/nerv/pull/833) |
| Opened | 2026-11-26 |
| Verification | Unit/integration: 2026-11-26, `test/misato.test.ts` "B-167" and "B-167 review", passed in CI on #831 and #833 |
| Reviewed | 2026-11-26 |
| Impact | The owner uses NERV in Italian: a short Italian request answered in English, and an English battery question that cannot reach the battery tools. |

</details>

---

### F-123

**Connect NERV to Grover's hub over MCP**

| Signal | Priority | Status | Effort |
|:---:|---|---|---|
| 🔵 | ◻️ P3 | Closed | 🟡 Medium |

💻 **→ Human action required: No**<br />Closed 2026-11-26: F-123-T01 merged in #746 on green CI; F-123-T02 owner check passed 2026-11-26 on NERV-01 against the hub on Calvary (19 tools listed, read grant answered in chat, unreachable hub reported); evidence on the record.

| | |
|---|---|
| **Issue** | Owner 2026-11-24 (coordinator gap review): Grover's hub exposes its tools at `/mcp` on the Pi behind Tailscale, and Grover F-005's last check expects NERV to list them. NERV has governed MCP tool registration (F-021) but no record for connecting to a remote MCP server on the tailnet. Grover F-005-T02 waits on this record (grover:F-005-T02). |
| **Reproduce** | There is no documented, tested way to register `https://<pi>.<tailnet>.ts.net/mcp` as an MCP source in NERV. |
| **Check** | The owner registers the hub's `/mcp` URL in NERV; NERV lists the Grover tools with their effect classes; read tools run as Green, actions go through the gate and approval as usual; an unreachable hub is reported, not hidden. |

<details>
<summary>Next action, estimates and evidence</summary>

**Next action / closure evidence:** Closed 2026-11-26: F-123-T01 merged in #746 on green CI; F-123-T02 owner check passed 2026-11-26 on NERV-01 against the hub on Calvary (19 tools listed, read grant answered in chat, unreachable hub reported); evidence on the record. 2026-11-26 (about 20:37-20:45Z), F-123-T02 passed on NERV-01 (grover:F-005-T01 done, hub on Calvary behind Tailscale): step 3, `nerv tools add grover https://<calvary>.ts.net/mcp` then `nerv tools` listed `grover · https://<calvary>.ts.net/mcp · 19 tool(s)`, each read-only or not, `grover_run_pump` marked destructive, none granted. Step 4, `nerv tools grant grover/grover_alerts` then `nerv chat "ci sono allarmi Grover?"`: the Consultant (gemma4:26b) advised calling grover.grover_alerts, MAGI "Pattern GREEN · grant", EVA-02 "grover.grover_alerts done", Misato "Al momento non ci sono allarmi attivi per Grover.", no approval card. Step 5 (agent, owner's OK), hub stopped on Calvary: `nerv tools` showed `could not list its tools: MCP server <calvary>.ts.net answered initialize with HTTP 502.`; hub started: 19 tools again. Actions through the gate and approval are covered by the F-123-T01 join test. The slow first answer (79 s) is baseline evidence on F-144. Owner decision 2026-11-26 (chat): "accept all 17 proposals" of the cross-project audit (coordinator `docs/audits/2026-11-26-cross-project.md`), proposal 12 ([#802](https://github.com/voidbrain/nerv/pull/802)): F-123-T02 waits on grover:F-005-T01, since its check registers the hub running on the Pi. 2026-11-25 reconciliation ([#758](https://github.com/voidbrain/nerv/pull/758)): F-123-T01 closed, [#746](https://github.com/voidbrain/nerv/pull/746) merged on green CI (run 45602256057; Windows attempt 1 failed on B-126 and B-076 flakes, attempt 2 green). Next: F-123-T02, the owner registers the hub URL. 2026-11-25: F-123-T01 implemented: `nerv tools add ID https://…/mcp` registers an MCP server at a URL (streamable HTTP; HTTPS, plain HTTP on loopback only, no credentials in the URL, redirects refused). Grants now name any effect class: a read is Green; `write-external` Orange; `irreversible`/`physical` Blue, and an MCP call the owner approves on its card now runs once under the approval's grant (before, nothing ran after an approval); a tool the server marks destructive must be `irreversible` or `physical`; `write-local` is refused for a remote server. An unreachable server is reported in `nerv tools` and as suspended grants with why. Join test `test/mcp-remote.test.ts` (fake HTTP MCP server: CLI registration, listing, a Green read, a physical action through the card, the server gone); guide [remote MCP](../guides/remote-mcp.md). Review of #746 (fresh context, no blockers) fixed in the PR: an HTTP answer is read as it streams and cut off past 4 MiB; tests for a replayed approval (no second call) and an expired grant (no call); the guide names the `read` default, the 60 s grant and `localhost`. CI was pending on [PR #746](https://github.com/voidbrain/nerv/pull/746) at that time. Opened 2026-11-24 at the owner's request from the coordinator's gap review.

**Estimates:** No remaining effort.

| Field | Value |
|---|---|
| PR / evidence | [#837](https://github.com/voidbrain/nerv/pull/837) (F-123-T02 owner check passed); [#802](https://github.com/voidbrain/nerv/pull/802) (prerequisite grover:F-005-T01); Opened in [PR #730](https://github.com/voidbrain/nerv/pull/730); F-123-T01 in [PR #746](https://github.com/voidbrain/nerv/pull/746).; [#758](https://github.com/voidbrain/nerv/pull/758) |
| Opened | 2026-11-24 |
| Verification | CI 2026-11-25: F-123-T01, Test: `test/mcp-remote.test.ts` green in run 45602256057 (#746). Owner check F-123-T02 pending. |
| Reviewed | 2026-11-26 |

</details>

---
