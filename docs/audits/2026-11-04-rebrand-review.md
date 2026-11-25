# NERV rebrand: architecture and dashboard review (2026-11-04)

Sources reviewed: `insights.md`, `insights2.md` (Gemini transcript), `insights3.txt`, the lexicon CSV, `gemini-code-*.txt` (mermaid), `../analysis_2026_11_02.txt`, `../ARCHITECTURE.md`, `../ROADMAP.md`, `../BACKLOG.md` (F-017…F-025), `dashboard-agnostic-2.html`.

Baseline reality: what runs today is reminders, the durable inbox, the A/B/C process split, the loopback API and the native companion. Every NERV component is at 0%, so this is a design review, not a code review.

---

## 1. Verdict in one paragraph

The rebrand works as a **label layer**. The metaphors line up with real concepts: Dummy Plug as degraded mode, Umbilical/S² as cloud/local model, A.T. Field as a capability grant, Spear as a kill switch, Terminal Dogma as the ledger, Kaji's watermelons as progressive trust. The Gemini sessions, though, let the lore *generate* architecture. That produced extra components (world model, mercenary seats, the Key of Nebuchadnezzar, a 4-level skill taxonomy, JIT model downloads), inconsistent meanings (Naoko, Lilith, EVA and Pilot each have 2–3 definitions) and a governance pipeline that is heavier than anything shipping today. The real gap is elsewhere. Compared with OpenClaw, Hermes, Dots and Duet, Nodo is missing the **personal agent** half: channels, a proactive loop, memory, integrations and prompt-injection defence. The design keeps elaborating the **governance** half.

Rule to adopt: **code uses plain names (`riskPolicy`, `reviewer`, `grant`), lore lives only in labels/docs.** The dashboard already does this with `LABELS.neutral` / `LABELS.eva`. Keep that pattern everywhere.

---

## 2. Architecture issues (lore aside)

### 2.1 The pipeline is shaped like a batch job; agents are loops
Ingress → classify → plan → MAGI vote → token → execute → commit assumes a plan can be fully known and approved before execution. Real agents (Claude Code, Hermes, OpenClaw, Duet) interleave: call a tool, read the result, decide the next call. A pre-approved plan goes stale after the first tool result.
**Fix:** gate **per action (tool call)**, not per plan. A plan preview is still useful for UX (editable plan surface), but authority is checked at the tool executor, every call.

### 2.2 Risk is a property of actions, not of the request
Gendo classifies Blue/Orange/Red from the request text before any plan exists. Then Ritsuko has to re-check Gendo with "AST scope delta" and "reversibility index" (insights2 §"who checks Gendo"). That is the tell: the deterministic part is the real classifier.
**Fix:** every tool declares an **effect class**: `read` · `write-local-reversible` · `write-external` · `irreversible` · `physical`. Risk = max effect class of the action + data sensitivity + taint (§2.6). This is deterministic, auditable, and needs no LLM. Gendo stays as the **router** (which model, which node, what budget). That is a genuinely useful job, and "role ≠ machine ≠ model" already belongs to it.

### 2.3 MAGI 2/3 vote: keep the name, shrink the default
- "Policy auditor" (Melchior) should not be an LLM. Policy is the deterministic rule pack (SEELE) enforced by Ritsuko. An LLM voting on policy is just a less reliable copy of the rule engine.
- "Safety/reversibility" (Balthasar) is mostly tool metadata (effect class, declared inverse). Again deterministic.
- "Intent" (Casper) is the one place a model reviewer adds real value: *does this action match what the user asked, or was it injected?*
- Three LLM judges with similar training make **correlated** mistakes. Up to N=3 re-plan loops × 3 critics adds 10+ model calls before one action.
- Claude Code auto mode, which Gemini cited as validation, uses **one** reasoning-blind classifier plus rules, not a 3-model vote.

**Fix:** default MAGI = deterministic policy + **one reasoning-blind reviewer model**. Offer the 3-seat heterogeneous ballot as an opt-in for configured high-stakes action classes. This answers the open note in ROADMAP ("to check, can be just one for small tasks"): yes, one.

### 2.4 "Sync Ratio = epistemic uncertainty" is false precision
LLM self-reported confidence is poorly calibrated, and most APIs don't expose usable logprobs. A 0.80 threshold (or 8.0: both scales appear) looks rigorous but isn't.
**Fix:** if you keep a score, compute it only from **observable** signals: deterministic checks passed, reviewer verdict, skill track record (Kaji stage, override rate), reversibility. Show the inputs, not just the number. Drop the per-EVA "sync" meter entirely. It has no real referent.

### 2.5 Firecracker doesn't run on the coordinator
Firecracker needs Linux KVM. TOKYO-3 is a Mac, and ROADMAP already lists Firecracker under non-goals. The brainstorm keeps putting it at the centre anyway.
**Fix:** EVA = "an isolated executor" with pluggable backends: git worktree + restricted shell for code, macOS sandbox / Apple `container` / Docker on the Mac, bubblewrap or Firecracker on Linux workers later. The docs are right; the brainstorm is wrong.

### 2.6 Missing and more important than MAGI: untrusted content and prompt injection
A proactive agent reads email, web pages and repos. The biggest real-world failure mode (heavily documented around OpenClaw) is injected instructions plus access to private data plus an exfiltration channel. Nothing in the NERV design tracks **where content came from**.
**Fix:** taint tracking. Content from untrusted sources (email bodies, web, third-party files) marks the context. A tainted context cannot trigger `write-external`/`irreversible` actions without human sign-off, and egress goes through an allowlist. In lore, this is the A.T. Field's real job.

### 2.7 Spear of Longinus: revoke yes, "saga rollback" only where it exists
You cannot compensate a sent email or a started charger. **Fix:** Spear = revoke grants + cancel jobs + stop workers. Compensation runs only for tools that declare an inverse; everything else is marked "effect already happened, needs attention". ARCHITECTURE.md already says exactly this ("Reconcile uncertain external results").

### 2.8 Things to drop (lore slop)
| Item | Why drop |
|---|---|
| World model / simulator | Already struck in insights2: dry-run in a sandbox is the "simulation". |
| Mercenary seats via free ChatGPT/Grok web tiers | Scraping consumer UIs breaks ToS, is fragile, and leaks data. Use paid APIs or local models. |
| JIT download of analyzers/models from Hugging Face into micro-VMs for one vote | Overkill. Deterministic analyzers (linters, tests, Semgrep) are just **tools**. |
| 4-level skill taxonomy (atomic/macro/expert/system) | Gemini itself retracted it. Use **tool** (typed function) vs **skill** (instructions + tools, may run as subagent). |
| "Experts" vs "counselors" vs "consultants" vs "ad-hoc deliberators" vs "temporary seats" | Five words for two things: a skill used as an advisor, and a reviewer seat. |
| Key of Nebuchadnezzar as a bypass of MAGI/HITL | A break-glass that bypasses approvals is the opposite of the design. If kept: root **recovery** key only (backup decryption, re-enrolment), never a policy bypass. |
| Third Impact = memory compaction | Keep Third Impact as the name of the **critical-incident** severity (as in the CSV). Compaction is just compaction. |
| Anthropic S-1 governance analogy | Adds nothing to the architecture. |
| L1–L5 layer numbers (ordered 5,3,4,2,1) | Use stage names. |
| Dead Sea Scrolls as a runtime component | It's the roadmap: docs, not architecture. |
| Adam as a separate entity | Redundant with Umbilical/S² (model route) plus the model registry. |

### 2.9 Things that are genuinely good, keep them
- **Dummy Plug** = degraded mode with a deterministic subset. Reminders must keep firing when models are down, and this already matches the A/B/C split.
- **Umbilical vs S²**, including the "5-minute battery" as a budget metaphor (cloud spend ceiling → fall back to local).
- **A.T. Field** = scoped, short-TTL capability grant enforced at the executor. Use a JWT only across nodes (M3); in-process, a DB row plus a check is enough.
- **Kaji's watermelons** = progressive trust (shadow → bounded → full). This is Nodo's best differentiator against Hermes/OpenClaw self-written skills. **Promotion to full must be human-confirmed**, not automatic.
- **Terminal Dogma** = SQLite ledger. For memory, use SQLite **FTS5** + summaries first (the same choice Hermes made), and add vectors only if recall proves weak.
- **Misato** as the one conversational voice that presents approvals (F-020).
- **HITL TTL / escrow** (F-023): timeout = cancel/hold, never approve.

---

## 3. Canonical glossary (one term, one meaning)

> **Superseded by [NERV-ARCHITECTURE.md](NERV-ARCHITECTURE.md)** (Misato = planner, Misato's apartment = human approval, Pattern Green/Orange/Blue, Entry Plug = execution bundle, Key of Nebuchadnezzar restored as sealed root key).

The brainstorm files contradict each other. These are the "last/best" picks:

| Lore label | Means exactly | Code name | Notes / replaced variants |
|---|---|---|---|
| NERV | UI skin / brand of Nodo | — | Keep `nodo` in code, CLI and paths. |
| Kaji line (mesh) | Encrypted node network (Tailscale/WireGuard) | `mesh` | Rename from "Kaji mesh" so it isn't confused with Kaji's watermelons. Channels are *not* on the mesh; they are ingress adapters. |
| Entry Plug | Ingress adapter (Telegram, CLI, menu app, PWA, triggers) → typed job | `ingress` | |
| Naoko desk | Context intake: attach files/URLs/repos, normalize | `intake` | Naoko is **not** the user (CSV) and **not** the MAGI personas. |
| Gendo | Router: model / node / budget selection | `router` | No longer the risk authority (§2.2). |
| SEELE pack | The policy rules file | `policy` | |
| Ritsuko's lab | Deterministic policy engine: effect class, scope, budget, taint | `policyEngine` | |
| Misato | The agent loop / persona (plans, acts, talks to you, asks you) | `agent` | One meaning. **You** are "the operator", not a character. |
| MAGI | Action reviewer: 1 reasoning-blind seat by default, 3 opt-in | `reviewer` | Seats are config, not personas of Naoko. |
| A.T. Field | Capability grant (scope + TTL) | `grant` | |
| EVA | Isolated executor slot on a node | `executor` | Not hardware nodes (CSV variant dropped). |
| Pilot | (optional) skill currently loaded in an EVA | — | Privilege profiles (Shinji = root, CSV) dropped: privileges live in grants. |
| Umbilical / S² | Cloud / local model route | `modelRoute` | |
| Dummy Plug | Degraded deterministic mode | `degraded` | |
| Spear of Longinus | Revoke grants + cancel + stop | `killSwitch` | Compensation only where declared. |
| Terminal Dogma | SQLite ledger (jobs, events, audit = episodic) | `store` | |
| Lilith | Memory: facts (semantic) + skills (procedural) | `memory` | Not the tool library, not "full autonomy stage". |
| Kaji's watermelons | Progressive trust for skills | `trust` | |
| Sephirot | Flow/trace view in UI | — | UI only. |
| TOKYO-3 / NERV-01 / NERV-02 | Coordinator / worker nodes | node ids | Your home machines; the globe placement is decoration. |
| Pattern Blue/Orange/Red | Risk tiers derived from effect class | `risk` | Lore trivia: in the anime **Pattern Blue = confirmed Angel**, the *dangerous* one. Fans will notice the inversion. Consider Blue = Red-tier, or just say "Pattern Green". |
| Third Impact | Critical security incident severity | `severity=critical` | |

---

## 4. Comparison with OpenClaw, Hermes, Dots, Duet

| | OpenClaw | Hermes Agent (Nous) | OpenAI Dots | Claude Duet | **Nodo / NERV (design)** |
|---|---|---|---|---|---|
| Runs where | Your machine, gateway daemon | Your machine/server | OpenAI cloud VM + browser | Anthropic cloud VM + browser | Your machines, multi-node |
| Channels | Many (WhatsApp, Telegram, Discord, iMessage…) | Many via gateway | App + connectors | App + web | **0 today** (Telegram planned) |
| Proactive | Heartbeat + cron | Cron + background tasks | "Proactive research", **read-only by default** | Proactive, approval before irreversible steps | Reminders only; no "wake up and think" loop |
| Memory | Markdown workspace files | FTS5 session search + summaries + user model | Notes to itself | Managed | Planned (F-022) |
| Self-improvement | Skills hub (supply-chain incidents) | Writes and refines own skills, Curator prunes | Preference learning | — | Progressive trust (better story, not built) |
| Safety model | Weak defaults, opt-in sandbox | Approvals, sandbox options | Read-only proactive, confirmations | Approval gate on irreversible | Most elaborate on paper (MAGI, grants, HITL) |
| Integrations | Broad | Broad + MCP | 4,000+ apps | Browser/computer use | None yet (MCP planned) |

Note: your `~/AGENTS.md` is the OpenClaw workspace template, so you already have a reference implementation of heartbeat/memory files at hand.

**Takeaways**
1. Dots and Duet reduce governance to two rules: *proactive work is read-only by default* and *ask before irreversible actions*. NERV's Blue/Orange/Red + MAGI + Sync is a far more complex version of those two rules. Ship the two rules first, then add the reviewer.
2. Hermes shows that the self-improvement loop (write skill → reuse → curate) is the feature people value. Kaji's progressive trust is a *safer* version of it, which makes it a real differentiator.
3. Nodo can't win on breadth against cloud agents with thousands of connectors. It can win on **your hardware, your data, physical devices (FPV, printers, Pi), durable scheduling, deny-by-default trust**. The roadmap should spend its effort there.

---

## 5. What is missing from the backlog

| New item | Why | Milestone |
|---|---|---|
| **Proactive trigger engine**: time, event (file/webhook/inbox), heartbeat; read-only by default; quiet hours; "when to interrupt" policy | It's the product's headline ("proactive personal agent") and only exists as a sentence in F-003 / insights3 | M2 |
| **Tool effect classes + per-action gating** | Replaces request-level classification (§2.1–2.2) | M2 (rewrite F-017) |
| **Untrusted content / taint + egress allowlist** | Prompt injection is the #1 real-world risk once email/web are read (§2.6) | M2, before any email/web integration |
| **Activity digest / "while you were away"** | What Dots and Duet both put first; also what makes autonomy trustable | M2 |
| **Agent eval harness (golden tasks)** | Progressive trust (F-007/F-025) and the reviewer need a regression set, or "eval 91%" means nothing | M2 → M6 |
| **Approval card content spec** | An approval without the exact action, args, diff/recipients, reversibility, reason and TTL is a rubber stamp | M2 (with F-023) |

### Changes to existing items
- **F-017**: rewrite as per-action gating from effect classes + single reasoning-blind reviewer; multi-model ballot opt-in only.
- **F-018 + F-025**: merge into one "skills as advisors + progressive trust" item, folded into F-007. Drop JIT downloads/mercenary seats.
- **F-024 (telemetry)**: move from M6 to **M2**, and merge its event schema with F-019. The dashboard can't be bound to real state without it. They are one schema.
- **F-019**: update the evidence path (still points to `dashboard1.html`; current is `dashboard-agnostic-2/3.html`).
- **F-020 (personas)**: lower to P3; skin, not substance.
- **Numbering drift**: `analysis_2026_11_02.txt` cites F-024 for "experts never get Red authority". That rule lives in F-025.
- **ROADMAP M2** now holds F-003 + F-017 + F-021 + F-022 + F-023, which is too large. Split it:
  - **M2a "useful"**: one model route, Telegram, memory (FTS5), proactive triggers (read-only), approvals with TTL, effect classes, activity digest.
  - **M2b "governed"**: reviewer seat, taint/egress, MCP, budgets.

---

## 6. Dashboard (`dashboard-agnostic-2.html`): is it useful?

**What it gets right:** the `SHADOW UI · NOT ARMED` banner (honest about being a simulation), the Dummy Plug banner, a flow timeline, the HITL queue with oldest-item age, Dogma health/lag, the grant card with Spear, cost split by tier, the neutral/EVA label switch.

**The core problem:** it visualises the *machinery* (council, seats, sync, mesh) and hides the *outcomes*. The five questions an owner asks a personal agent every day are:

| Question | Answered? |
|---|---|
| What needs me right now? | Partly: the HITL queue exists, but cards say only "Privileged mutation · confidence 0.62 · policy dissent". **You can't tell what you are approving.** |
| What did you do while I was away? | **No.** The event stream is a debug log, not a digest. |
| What's coming next? (reminders, scheduled jobs, triggers) | **No.** The only working feature of Nodo, reminders, gets a tiny inbox box. |
| Is anything broken or stuck? | Partly: doctor is cosmetic; no failed/retrying/waiting-for-reset jobs (F-012). |
| What did it cost vs budget? | Spend only; no limit, forecast or per-model view. |

**Concrete issues**
1. **The user picks Blue/Orange/Red to submit a job.** Classification is a system *output*; here it's a user input. Replace it with "new task" plus jobs arriving from triggers.
2. **No planner/plan stage** in the flow (Ingress → Gendo → MAGI → Experts → …), although the whole insights2 discussion settles on the plan → review loop. Also no dry-run/diff view.
3. **One active job at a time.** No job list, history, search or trace replay. Real use has concurrency and needs a "what happened to job X" view.
4. **About 40% of the screen goes to the MAGI council.** On realistic traffic (mostly Blue) it sits idle. That's prime space for approvals, the activity digest and the upcoming queue.
5. **Noise to remove:** GPU/CPU/RAM per MAGI seat (meaningless for a cloud Claude seat, and Casper "@ NERV-02 Pi · Claude" is a Pi relaying a cloud call); the globe (home machines placed in Tokyo/SF/Berlin); per-EVA sync waveforms; the confidence slider; `Math.random` jitter.
6. **Missing panels:** memory (what it knows about you, recent writes, edit/forget); channels and integrations health (Telegram connected, tokens expiring); taint marker on jobs that touched untrusted content; skills with *evidence* (runs, overrides, last failure), not just a score.

**Suggested layout (neutral skin; NERV skin re-labels it)**
- **Top strip:** health · degraded-mode · spend vs budget · pending approvals count.
- **Left:** *Needs you* (approval cards with exact action, diff/recipients, effect class, why flagged, TTL countdown, approve/edit/reject).
- **Centre:** *Activity*: job list (running / waiting / done / failed) → click opens the trace (Sephirot view: steps, tool calls, reviewer verdict, grants).
- **Right:** *Upcoming* (reminders, scheduled and proactive jobs) · *Memory* · *Nodes & channels*.
- **Secondary tab:** Council/seats, trust ladder, cost breakdown. This is where MAGI hexagons belong: a detail view, not the home screen.
