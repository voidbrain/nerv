# NERV architecture schema (canonical, 2026-11-04)

Supersedes the glossary in `review-2026-11-04.md` §3 and every flow in `insights*.md`. Lore names are labels; code uses the plain name in brackets.

```text
══════════════════════════════════════════════════════════════════════════════════════════
 SEELE ················ policy authority = YOU, the owner                       [policy]
   └─ DEAD SEA SCROLLS · the policy pack file: effect rules, budgets, quiet hours,
                         egress allowlist, local-only data classes
 KEY OF NEBUCHADNEZZAR · sealed offline root key                               [rootKey]
   • signs base enrolment, rotates Ritsuko's A.T. Field signing key, decrypts backups
   • NEVER used in the normal flow · NEVER bypasses MAGI or Misato's apartment
══════════════════════════════════════════════════════════════════════════════════════════
 NERV ················ the agency = federated bases, each a full NERV Agency installation
 ├─ NERV-01 NEO TOKYO-3  main base (Mac, owner's choice): Aoba · authoritative MAGI when connected
 ├─ NERV-02 TABGHA ..... base (mini-PC): own persona names, own bot while alone · EVA cage · S²/GPU
 ├─ NERV-03 BETHANY .... base (planned; Pi + 10 TB vault?): EVA cage · vault (weights, replicas)
 ├─ KAJI LINE ......... encrypted base mesh (Tailscale/WireGuard)               [mesh]
 │                      heartbeat · leases · fencing · plug transfer · seat calls
 └─ MARDUK INSTITUTE .. registry: enrols bases, models, pilots; capability ads  [registry]
                        discovery ≠ trust: enrolment needs the Key's signature
══════════════════════════════════════════════════════════════════════════════════════════

 FEDERATION (owner decision 2026-11-04)
   every base is a full installation: its own scheduler, ledger, memory, gate, channel
   alone (Kaji line down) . a base serves its own work with its own MAGI and its own bot
   connected .............. the main base (chosen by the owner, never elected) speaks
                            through Aoba; other bases dispatch to it; their bots go quiet;
                            their MAGI become veto-only seats for the main base's actions
   shared ................. Scrolls (from SEELE, via the main base) · pilots via Marduk ·
                            Lilith facts merged by id with provenance; conflicts → owner card
   never merged ........... Central Dogma ledgers (append-only evidence): shown side by side
   personas ............... role names per base (Misato, Gendo… or Bob, Fritz, Tim);
                            MAGI names fixed on every base (seats are replicas: "Casper@Tabgha")
   remote use ............. dashboard and channels reach other bases through the main base;
                            each base's own gate decides its own actions
   Marduk registry ........ replicated on every base, never held by the main base alone: entries
                            (enrol, revoke, main-base change) are records signed by the Key, so
                            any copy verifies itself; bases exchange them over the Kaji line;
                            revoke wins over enrol, newer signed record over older; last-seen is
                            merged by taking the newest time per base
   main base down ......... the others keep the list and each other's status, keep their own work,
                            show the main base offline; promoting another is an owner-signed
                            decision (fencing), never an election: the list is shared, authority
                            stays single

 NEO TOKYO-3 (main base) — one SORTIE (job), action by action
 ┌─ 1 · DETECTION ────────────────────────────────────────────────────────────────────────┐
 │ AOBA (comms) ....... Telegram · CLI · menu-bar app · PWA        you speak first [ingress]│
 │ HYUGA (watch) ...... reminders · cron · heartbeat · webhooks ·  it speaks first        │
 │                      file/inbox events                                       [triggers]│
 │   proactive sorties are EVA-00 only unless the pilot is PRODUCTION stage              │
 └───────────────────────────────────────┬────────────────────────────────────────────────┘
                                         │ incoming event = ANGEL
                                         ▼
 2 · NAOKO DESK (intake) ...................................................... [intake]
     normalise · attach files/URLs/repos · stamp provenance on every piece:
     trusted (you, your files)  |  IREUL-TAINTED (email bodies, web, third-party content)
     open the SORTIE record in Central Dogma
                                         │
                                         ▼
 3 · GENDO (command / router) ................................................. [router]
     choose pilot(s) · base + EVA · power source · battery
       UMBILICAL = cloud model (costs, limited by battery = budget ceiling)
       S² ENGINE = local model on any base (no per-token cost)
     battery flat → fall back to S² · local-only data → S² or wait, never Umbilical
     no model reachable ──► DUMMY PLUG: deterministic pilots only; reminders keep firing
                                         │
                                         ▼
 4 · MISATO (operations agent) ◄──────────────────────────────────────────┐   [agent]
     plan surface (visible, editable by you) → proposes the NEXT ACTION    │
                                         │                                 │ result /
                                         ▼                                 │ rejection
 5 · MAGI BALLOT — every action, operated by Ritsuko .................. [reviewer]
     MELCHIOR-1 · scientist · rules: tool effect class + Scrolls → PATTERN (deterministic)
     BALTHASAR-2 · mother   · protection: reversibility · battery · Ireul taint (deterministic)
     CASPER-3 · woman       · intent: "is this what was asked, or injected?"
                              reasoning-blind model: sees the request + action, not Misato's notes
     ┌──────────────────────────────────────────────────────────────────────────────┐
     │ PATTERN GREEN   read · reversible local write      → Melchior + Balthasar      │
     │ PATTERN ORANGE  external write, reversible         → all three seats           │
     │ PATTERN BLUE    irreversible · physical · tainted  → all three + Misato's apt, │
     │                 context asking for external effect   always                    │
     └──────────────────────────────────────────────────────────────────────────────┘
     high-stakes classes (Scrolls) → full ballot: Melchior and Balthasar also get model seats
     EXTRA SEATS (MAGI copies) — attached by action class via Marduk, VETO-ONLY:
       • deterministic checks first: tests, linters, type check, Semgrep (code writes)
       • expert pilots (models) and branch MAGI copies: shadow seat (vote logged, not
         counted) until promoted by the watermelons; even then they can only reject
       • a seat that times out abstains; it never blocks Green, and Orange/Blue fall back
         to the core three
     any REJECT ─► back to Misato with the reason (max 3) ─► then Misato's apartment
     CONSULTANTS — pilots Misato asks while planning (step 4): advice enters the LCL with
       its provenance, never a vote; remote/cloud consultants receive only Scrolls-allowed data
                                         │
                                         ▼
 6 · SYNC RATIO — one number, 0–100 %, per action, shown with its inputs ....... [sync]
     = MAGI verdicts + pilot's watermelon record + reversibility
     ≥ 80 % and not BLUE ──► RITSUKO signs the A.T. FIELD ─────────────────────┐
     < 80 % or BLUE      ──► Misato's apartment                                │
                                         │                                     │
                                         ▼                                     │
 7 · MISATO'S APARTMENT (you, the human approver) ......................... [approval]
     PEN PEN delivers the card: Telegram · PWA · menu bar                [notifier]
     card = exact action · args / diff / recipients · pattern · sync · why · TTL
     approve ─► A.T. FIELD │ edit ─► back to Misato │ reject or TTL expired ─► stand down
                                         │                                     │
                                         ▼                                     │
 8 · ENTRY PLUG — assembled per action ◄────────────────────────────────────────┘ [plug]
     pilot (skill) + LCL (context slice) + A.T. FIELD (scope + TTL) + battery
     sent to the chosen base's cage over the Kaji line
                                         │
                                         ▼
 9 · EVA CAGE — sandbox execution (same schema on every base) [executor]
     ┌───────────────────────────────────────────────────────────────────────────────┐
     │ EVA-00 PROTOTYPE   shadow / dry-run · no external effects · no egress          │
     │ EVA-01 TEST TYPE   bounded · scoped writes inside the A.T. Field               │
     │ EVA-02 PRODUCTION  full grant · PRODUCTION-stage pilots only                   │
     │ EVA-03 QUARANTINE  Ireul-tainted content, untrusted code · no secrets/egress    │
     │ backends: git worktree + restricted shell · macOS sandbox / container ·          │
     │           Docker · bubblewrap / Firecracker on Linux branches                   │
     └───────────────────────────────────────────────────────────────────────────────┘
     the A.T. Field is enforced HERE, at the tool executor, on every call
     result ─► back to Misato (step 4) until the sortie is done
                                         │
                                         ▼
 10 · DEBRIEF  sortie closed in Central Dogma · digest to you ("while you were away")
               · watermelon evidence updated

 ── SIDE RAILS (any step) ─────────────────────────────────────────────────────────────────
 SPEAR OF LONGINUS [killSwitch]  pierces every A.T. Field (revoke) · ejects plugs · cancels
                                 sorties · runs only declared inverse actions; anything else
                                 is marked "effect happened, needs attention"
 MAYA (monitoring) [telemetry]   trace span for every step and action → SEPHIROT view
 THIRD IMPACT      [severity]    critical incident: escape, privilege escalation, data loss
                                 → automatic Spear + PEN PEN alert

══════════════════════════════════════════════════════════════════════════════════════════
 MEMORY — depth = durability
 ┌─────────────────────────────────────────────────────────────────────────────────────┐
 │ LCL (inside the plug)      working context: built per action, within battery        │
 │ CENTRAL DOGMA              episodic: sorties, events, ballots, grants, traces,        │
 │                            approvals · append-only ledger (SQLite)                 │
 │ TERMINAL DOGMA · LILITH    semantic: facts about you, with provenance; editable,     │
 │                            forgettable                                              │
 │                            procedural: pilots (skills), versioned                   │
 └─────────────────────────────────────────────────────────────────────────────────────┘
 management
   LCL fill ........ Lilith search (SQLite FTS5) + recent Central Dogma → trimmed to budget;
                     tainted pieces keep their Ireul mark inside the LCL
   memory writes ... Misato proposes facts → held until you confirm (or a PRODUCTION pilot)
   INSTRUMENTALITY . nightly consolidation: episodes → summaries and facts; ledger kept
   correction ...... edit / forget from the UI · every change keeps its provenance trail
   backup .......... Litestream → NERV-02 vault · decrypted only with the Key

══════════════════════════════════════════════════════════════════════════════════════════
 KAJI'S WATERMELONS — progressive trust for pilots (skills) ........................ [trust]
   new pilot: written by Misato · imported · registered via Marduk
     PROTOTYPE stage ──► may pilot EVA-00 only (shadow runs, compared with what you did)
     TEST stage ───────► EVA-01 · Green / Orange actions
     PRODUCTION stage ─► EVA-02 · promotion needs YOUR confirmation in Misato's apartment
   evidence: runs · MAGI rejections · your edits and overrides · failures · eval suite
   demotion: automatic on failure, override spike, or Spear
   the curated patch: duplicates merged, unused pilots retired

══════════════════════════════════════════════════════════════════════════════════════════
 OTHER BASES — same cage schema; shared over the Kaji line
   EVA cages ........ HQ places plugs on branch cages (lease + fencing token per plug)
   MAGI seats ....... branch hosts may run a seat model (e.g. Casper on the NERV-01 S²/GPU).
                      Branch MAGI copies are seats, never authority: Melchior's rules,
                      Ritsuko's signing stay at the main base; each base keeps its own Central Dogma.
   S² engines ....... local models on any base, picked by Gendo (role ≠ base ≠ model)
   NERV-02 vault .... model weights · Litestream replicas · sandbox images
   branch offline ... its plugs wait or expire; local-only work is never moved to Umbilical
══════════════════════════════════════════════════════════════════════════════════════════
```

## Lore choices and what changed

| Change | Why it fits better |
|---|---|
| Pattern **Green / Orange / Blue**, with Blue the most dangerous | Canon: Orange = unidentified, Blue = confirmed Angel. Green isn't canon; it is the "nothing hostile" filler. |
| **Entry Plug** = the execution bundle, not ingress | In the show the plug carries the pilot into the EVA, filled with LCL. |
| **LCL** = working context | The liquid the pilot breathes inside the plug. |
| **EVA-00 / 01 / 02** = Prototype / Test Type / Production Model | Canon unit designations. They match the trust stages one for one. |
| **EVA-03** = quarantine | Unit-03 was taken over by an Angel (Bardiel). |
| **Ireul** = prompt injection / taint | The 11th Angel infected the MAGI like a computer virus. |
| **Extra seats are veto-only** | Adding seats can only make a ballot stricter, so an untrusted or new seat can never approve what the core three would refuse. Consultants advise Misato and never vote. |
| **MAGI copies** at branches are seats, never authority | End of Evangelion: the branch MAGI copies attacked Tokyo-3's MAGI. |
| MAGI personalities | Melchior (scientist) = rules, Balthasar (mother) = protection, Casper (woman) = intent. The trio is always present; only Casper is a model by default. |
| **Ritsuko** operates MAGI and signs A.T. Fields | She maintains MAGI in the show. |
| **Spear** revokes A.T. Fields | The Spear pierces an A.T. Field (against Arael). |
| Bridge crew | **Aoba** = comms, **Hyuga** = Misato's operations aide/watch, **Maya** = monitoring (she reads the sync ratios). |
| **Pen Pen** = notifier | He lives in Misato's apartment. |
| **Marduk Institute** = registry | It selects the Children (who may pilot). |
| **Instrumentality** = memory consolidation | Separate episodes merged into one sea. The ledger is kept. |
| **Sync Ratio** = 0–100 % | The show displays it as a percentage. |
| **Key of Nebuchadnezzar** = sealed root key | Back in. It is the key to everything, but it is never used to bypass a gate. |
| Dropped | Adam (redundant with power source + Marduk), pilots as privilege profiles, world model, mercenary seats, L1–L5 numbering |
