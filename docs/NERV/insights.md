+-----------------------------------------------------------------------------------+
| LAYER 5: INTENT & CONSENSUS (Naoko Akagi / MAGI Supercomputer)                    |
| - Ingress Intent Parsing, 2/3 Multi-Model Ballot Voting (Melchior/Balthasar/Casper)|
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
| LAYER 3: STRATEGIC ROUTING & CLASSIFICATION (Gendo's Office)                      |
| - Risk Pattern Assignment (Blue / Orange / Red), Dynamic Committee Selection      |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
| LAYER 4: ENFORCEMENT & COMPLIANCE (SEELE / Ritsuko's Lab / Misato HITL)           |
| - OpenJEV AST Profiling, Sync Ratio Calculation, A.T. Field JWT Token Generation   |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
| LAYER 2: WORKER MATRIX & SANDBOXING (EVAs / Pilots / LCL Micro-VMs)               |
| - Firecracker Isolation, Capability Token Scope Checks, S² Engine Edge Inference   |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
| LAYER 1: DURABLE PERSISTENCE & TRUST (Terminal Dogma / Kaji's Watermelons)       |
| - SQLite Transaction Ledger + Litestream, Progressive Trust Skill Promotion        |
+-----------------------------------------------------------------------------------+

[ User Request ]
       │
       ▼
[ Entry Plug Parsing ]
       │
       ▼
[ Gendo's Office (L3 Risk Classification) ]
       │
       ├─ (If Normal Operation) ─────────────────────────┐
       │                                                 │
       ▼                                                 ▼
[ MAGI Matrix Consensus (L5) ]                 [ Dummy Plug Fallback ]
(Melchior / Balthasar / Casper Vote)           (Activated on API Failure)
       │                                                 │
       ▼                                                 │
[ Ritsuko's Lab (L4 OpenJEV Engine) ]                    │
(AST Parsing & Sync Ratio Evaluation)                    │
       │                                                 │
       ├───────────────────────────────┐                 │
       │ (Sync Ratio >= 8.0 & Blue/Orange)│ (Sync Ratio < 8.0 or Pattern Red)
       ▼                               ▼                 │
[ Issue A.T. Field Token ]   [ Misato's Apartment (HITL) ]│
       │                     (Telegram / PWA Approval)   │
       │                               │                 │
       │                               ├─ (Approved) ────┤
       │                               │                 │
       │                               ▼                 │
       │                     [ Issue Manual Token ]      │
       │                               │                 │
       └───────────────────────────────┴─────────────────┘
                               │
                               ▼
            [ LCL Container / Firecracker Sandbox ]
            (EVA Hardware Unit + Pilot Capability Token)
                               │
                               ├──────────────────────────┐
                               │ (Power Source Selection) │
                               ▼                          ▼
                   [ Umbilical Cable Feed ]      [ S² Engine Organ ]
                   (Cloud API Execution)         (Local Offline Gemma)
                               │                          │
                               └──────────────────────────┘
                               │
                               ▼
            [ Terminal Dogma (Layer 1 Persistence) ]
            (SQLite Transaction Log + Litestream)
                               │
                               ▼
            [ Kaji's Watermelons (Progressive Trust) ]
            (Shadow Mode -> Bounded -> Full Autonomy)




# NERV-Nodo Architecture & Development Roadmap (`ROADMAP.md`)

> *"The A.T. Field is the wall of the heart that isolates every individual existence. Our architecture enforces these exact boundaries using capability tokens, micro-VM sandboxes, and distributed consensus."*

---

## 🗺️ Architectural Mapping Summary

| Milestone | Technical Core | NERV Architecture Component | Layer |
| :--- | :--- | :--- | :--- |
| **M0: Harness** | Deterministic Orchestrator & OpenJEV Stubs | Entry Plug + Gendo's Router + Dummy Plug | Layer 3 / 5 |
| **M1: Reliable Core** | SQLite Inbox Ledger + Litestream Replication | Terminal Dogma Persistence Layer | Layer 1 |
| **M1a.1: Sandbox** | Firecracker Micro-VM Isolation Enclosures | LCL Containment Chambers | Layer 2 |
| **M2: Models + Telegram** | Multi-Model Adapters + Telegram Interface | Distributed MAGI Council (Melchior/Balthasar/Casper) | Layer 5 |
| **M3: Multi-Node** | WireGuard Mesh + Cryptographic Scopes | Kaji Mesh Gateway + A.T. Field Capability Tokens | Layer 4 |
| **M4: PWA / GenUI** | Asynchronous Approval Interlock Portal | Misato's Apartment (Human-in-the-Loop) | Layer 4 |
| **M5: Distributed Fleet**| Bounded Delegation & Hardware Scheduling | Evangelion Fleet Matrix (EVA-01 / EVA-02 / EVA-00) | Layer 2 |
| **M5b: Relocation** | Fencing Leases & Split-Brain Prevention | Geofront Coordinator Relocation Protocols | Layer 3 |
| **M6: Trust Pipeline** | OpenJEV Scoring, Rollbacks & Promotion | Kaji's Watermelons + Spear of Longinus | Layer 1 / 4 |

---

## 📜 Detailed Engineering Deliverables

### M0: Harness — Strategic Command & Ingress Layer
*Establish the core orchestrator, deterministic routing switchboard, and payload parser.*
- [ ] **Entry Plug Payload Parser:** Build structured input parser converting user task definitions into normalized JSON/gRPC execution payloads.
- [ ] **Gendo's Office Router (Layer 3):** Implement risk classification rules mapping tasks to hazard tiers:
  - 🔹 `Pattern Blue`: Low risk (System maintenance, read-only operations).
  - 🔸 `Pattern Orange`: Medium risk (Web scraping, bounded data transformations).
  - 🔺 `Pattern Red`: High risk (File mutations, system systemd changes, network calls).
- [ ] **Dummy Plug Fallback Engine:** Implement hardcoded, rule-based regex fallback to ensure continuous operation during model timeouts.

### M1: Reliable Core — Terminal Dogma State Persistence
*Implement a crash-resilient, durable state engine.*
- [ ] **Terminal Dogma Ledger:** Build an append-only SQLite transaction inbox ledger ensuring restart recovery and state durability.
- [ ] **Litestream Integration:** Configure real-time streaming database replication to off-site storage targets.
- [ ] **Adam & Lilith Registries:** Implement schema registries for base model weight configurations (**Adam**) and versioned tool libraries (**Lilith**).

### M1a.1: Isolated Runtime — LCL Containment Sandbox
*Provide strict OS and process isolation for executing untrusted agent code.*
- [ ] **LCL Containment Chambers:** Deploy Firecracker micro-VM containment enclosures enforcing CPU, RAM, and filesystem boundaries.
- [ ] **Pilot Token Scoping:** Implement role-based container privilege profiles:
  - `Shinji`: Broad execution scope subject to real-time Sync Ratio evaluation.
  - `Asuka`: High-compute performance scope bounded by strict network interceptors.
  - `Rei`: Minimal read-only access scope for high-stability operations.

### M2: Models + Telegram — The Distributed MAGI Council
*Build multi-model provider pipelines and democratic consensus voting.*
- [ ] **Model Provider Adapters:** Integrate Anthropic Claude (Cloud), Google Gemma (Local/Edge via Ollama), and local fallback models.
- [ ] **Distributed MAGI Council Matrix:** Implement 3-node voting logic:
  - **Melchior-1:** Cloud API optimized for logic, code parsing, and AST validation.
  - **Balthasar-1:** Local Gemma instance enforcing safety invariants and firewall rules.
  - **Casper-3:** Cloud/Edge model monitoring intent drift and ethical constraints.
- [ ] **Magi Vote Tally Block:** Require a 2/3 democratic split-majority signed ballot before issuing authorization to execution layers.
- [ ] **Telegram Bot Gateway:** Connect Telegram API webhooks for system event notifications, log monitoring, and direct task dispatch.

### M3: Multi-Node — A.T. Field Capability Security
*Establish secure node-to-node communication and resource capabilities.*
- [ ] **Kaji Mesh Gateway:** Set up Tailscale / WireGuard mesh network for encrypted, asynchronous cross-continent transport.
- [ ] **A.T. Field Capability Tokens:** Implement cryptographic JWT capability tokens restricting permissions (`FS_READ`, `FS_WRITE`, `NET_OUT`) per node.

### M4: PWA / GenUI — Misato's Apartment (HITL Approval Portal)
*Build human-in-the-loop safety interlocks for critical operations.*
- [ ] **HITL Verification Portal:** Build a Progressive Web App (PWA) and Telegram interlock interface.
- [ ] **Pattern Red Intercepts:** Pause execution and route approval requests to **Misato's Apartment** when Sync Ratio falls below 80% or when `Pattern Red` tasks are triggered.
- [ ] **Manual Signature Injection:** Allow human operators to review AST diffs and sign off on capability token release.

### M5: Distributed Fleet & Power Infrastructure
*Scale agent execution across distributed heterogeneous hardware nodes.*
- [ ] **EVA Fleet Deployment:**
  - **EVA-01 (Mac Mini):** Primary system coordinator node.
  - **EVA-02 (Raspberry Pi):** Edge computational processing worker.
  - **EVA-00 (NAS Node):** Heavy storage and file I/O worker.
- [ ] **Dual-Power Infrastructure:**
  - **Umbilical Cable:** Cloud API pipeline powering complex reasoning tasks (subject to rate limits and network dependency).
  - **S² Engine Organ:** Local Gemma inference deployment providing zero-cost, infinite offline operational autonomy.

### M5b: Coordinator Relocation — Geofront Resilience
*Ensure high availability and prevent split-brain states.*
- [ ] **Fencing & Lease Engine:** Implement distributed lock leasing and fencing mechanisms to handle node heartbeats and coordinator failover without split-brain MAGI voting.

### M6: Evaluated Skills — Kaji's Watermelons & Progressive Trust
*Automate skill validation, scoring, and production promotion.*
- [ ] **Ritsuko's Lab (OpenJEV Framework):** Build automated AST linter, static analyzer, and rubric evaluator.
- [ ] **Sync Ratio Evaluation:** Compute real-time confidence metrics ($0.0 - 10.0$).
- [ ] **Spear of Longinus Kill Switch:** Automatically revoke capability tokens and roll back SQLite transaction logs if Sync Ratio drops below $8.0$.
- [ ] **Kaji's Watermelons (Progressive Trust):** Build a 3-stage promotion pipeline:
  1. *Seed (Shadow Mode):* Skill runs in parallel without side effects (Days 1–3).
  2. *Growth (Bounded Autonomy):* Skill executes within strict sandbox scopes (Days 4–7).
  3. *Maturity (Full Autonomy / Berserk Mode):* Skill promotes to system tool library (**Lilith**) for unprompted autonomous execution (Day 8+).


  .......

  2. What Is "Overthought" (Potential Over-Engineering)
3-Node Voting Consensus on Every Low-Tier Task: If the MAGI Council (Melchior, Balthasar, Casper) must run a 2/3 majority vote across three LLM calls for every single operation, latency and token costs will skyrocket.
Fix: The consensus voting matrix should only trigger for Pattern Red or unverified Pattern Orange tasks. Pattern Blue (routine/low risk) should bypass MAGI voting entirely and route straight to deterministic execution.
Complex Multi-Node Coordination Early On (M5 & M5b): Fencing, leasing, and coordinator relocation to prevent split-brain states in distributed voting is heavy distributed-systems engineering. Unless you are running multi-region server clusters right away, a simple primary/failover heartbeat model is more than enough for a local-first setup.
3. What Is Missing (Gaps Compared to OpenClaw / Hermes / Dots)
To compete directly with state-of-the-art agent runners, you need to account for a few practical developer-experience (DX) and operational gaps:
Structured Memory / Context Trimming Engine:
The Gap: Real-world tasks hit context window limits quickly. You have state durability (SQLite), but you need a dedicated Context Compactor / Memory Summarizer step before passing historical logs to the MAGI or local models.
Standardized Tool Protocol (e.g., Model Context Protocol / MCP):
The Gap: Frameworks like OpenClaw benefit heavily from standardized tool integrations. nodo should natively adopt or support the Model Context Protocol (MCP) or OpenAPI tool specs in Layer 1 (Lilith) so developers don't have to rewrite custom tool wrappers for every new integration.
Structured Telemetry & Tracing (OpenTelemetry):
The Gap: When an agent fails deep inside an LCL Firecracker sandbox, debugging raw logs is painful. Integrating standard OpenTelemetry / LangSmith-compatible tracing into Layer 4 (OpenJEV / Ritsuko) will make inspecting multi-step agent reasoning effortless.
Human-in-the-Loop Timeout & Escrow Policies:
The Gap: What happens if a Pattern Red task routes to Misato's Apartment (Telegram/PWA) and the human operator is asleep or offline for 12 hours? You need explicit TTL (Time-To-Live) and transaction expiration policies in the SQLite inbox so pending tasks don't block queue processing indefinitely.

To make nodo truly proactive (acting autonomously on environmental changes, schedules, or background events rather than waiting for an explicit user command), you must bake four specific mechanics into the architecture:
1. The Autonomous Ingress (Event & Time Triggers)
Right now, task ingress is framed around the Entry Plug parsing user tasks. To make it proactive, ingress cannot be limited to human input.
Cron / Heartbeat Daemon: A background scheduler in Layer 1 (Terminal Dogma) that periodically wakes up the orchestrator to evaluate system health, run scheduled maintenance, or check external APIs.
Event Watchers / Webhooks: File-system event listeners (e.g., inotify), database triggers, or incoming webhooks that immediately package environmental changes into a task payload and feed it straight into Gendo's Office (L3 Risk Classifier) without human intervention.
2. Proactive Intent Generation (The "Self-Prompting" Loop)
Proactivity requires the system to decide what needs to be done on its own.
Background Monitoring Agent: A specialized background loop (or periodic MAGI invocation) that evaluates current state against defined system invariants or long-term goals stored in Lilith / Dead Sea Scrolls.
Task Self-Dispatch: If the monitoring agent detects drift, a missing dependency, or an optimization opportunity, it autonomously formats a new Angel Task and submits it to the inbox queue.
3. Proactive Execution via Progressive Trust (Kaji's Watermelons)
This is where nodo's architecture naturally excels at proactive execution compared to other frameworks:
Stage 1 (Shadow Mode): The system generates proactive recommendations or scripts in the background, executes them silently in a isolated LCL sandbox, and logs what would have happened.
Stage 2 & 3 (Full Autonomy / "Berserk Mode"): Once a proactive task type (like disk cleanup, data sync, or automated testing) achieves a high Sync Ratio (≥8/10) across multiple runs, it no longer asks Misato's Apartment (HITL) for permission. It executes proactively the moment the trigger fires.
4. Proactive HITL Interlocks (Push Notifications, Not Polls)
When a proactive task does run into a high-risk scenario (Pattern Red or low Sync Ratio), the Human-in-the-Loop interface cannot be a passive dashboard where a human has to log in to check status.
Push Intercepts: The system actively pushes a Telegram notification or PWA alert to the user's device: "I detected X and generated solution Y. Approve execution?"
Timeout & Fail-Safe Policies: If the user doesn't respond within a defined Time-To-Live (TTL), the proactive task either safe-cancels or rolls back via the Spear of Longinus to prevent blocking the worker fleet.
Summary
nodo has all the architectural "bones" (sandboxes, durable queues, capability tokens, confidence scoring) required to support proactive behavior, but proactivity itself is an operational mode, not a static feature.
If you add background event triggers at the Ingress layer and self-dispatching monitoring agents at the MAGI/Gendo layer, nodo transitions seamlessly from a reactive assistant to a fully autonomous, background-operating system.



these concepts are included but may be more clear:

Explicit Token Cost & Context Window Tracking:
Missing in Lore: The NERV UI focuses on "Power Source (Umbilical vs. S² Engine)."
Real-World Need: You need explicit telemetry tracking Token Burn Rate ($/hr) and Context Window Usage (%) per model call to prevent runaway API costs.
Standardized Tool Integration Protocol (MCP / OpenAPI):
Missing in Lore: Hidden inside "Lilith Repository."
Real-World Need: Real systems need a formal Model Context Protocol (MCP) or OpenAPI specification so third-party tools can be dynamically registered without rewriting core harness logic.   
image_ba0f6c.jpg
Distributed Lock Leasing & Fencing (M5b):
Missing in Lore: Handled conceptually as "Geofront Relocation."
Real-World Need: In multi-node cluster failovers (e.g., Mac Mini coordinator going offline), you need explicit Raft consensus or Redis lock leasing to prevent split-brain state duplication across nodes.
Structured OpenTelemetry / LangSmith Tracing:
Missing in Lore: Obscured by raw log streams.
Real-World Need: Debugging multi-step agent reasoning inside micro-VM sandboxes requires structured span graphs (trace IDs) rather than raw string logs.


=======

question: have a look at project, backlog, radmap, insights. 
i'm thinking of converting nodo to a evangelion lore metaphor, concepts seem to stick. 

you will find also mermaid chart of the architecture / flow. 

(leaving alone eva lore for a moment) are the concepts really useful can compare to openclaw / hermes / dots autonomous improving proattive personal agents? are we missing something / overthinking ?

dashboard1.html is designed to be hevy eva theme (needs to add cleaner versions, monochrome, light and dark, terminal style).
is it really useful? showing real interesting asects? missing something?
