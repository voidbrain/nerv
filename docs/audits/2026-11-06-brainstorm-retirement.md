# Brainstorm retirement review — 2026-11-06

Scoped documentation/backlog review at main `c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b`. This evaluates the 25 tracked files in `docs/NERV`; ignored `.DS_Store` is local metadata. It does not certify a full product/security audit or claim planned features are implemented. PR #166 is a pending implementation candidate at this baseline; its changes are distinguished from merged behavior.

The folder was not wholly obsolete: its architecture vocabulary was still referenced by current plans, and its dated review was useful evidence. The architecture is moved to [docs/NERV-ARCHITECTURE.md](../NERV-ARCHITECTURE.md), with explicit historical-target limits. The [2026-11-04 review](2026-11-04-rebrand-review.md) is moved unchanged. The remaining sources can be removed after this review and proposal register are merged; no other source has been deleted here. The links below pin the original snapshot, so historical references remain recoverable after folder cleanup.

## Method and evidence

Read the three Markdown documents, Mermaid text and CSV; extracted all visible body text from seven HTML prototypes without executing their scripts or fetching CDNs; inspected a contact sheet and local Vision OCR for all 13 images (three generated architecture/dashboard images and ten reference TIFFs). Compared concepts with current Architecture, Roadmap, Style Guide, active and archived backlog records and implemented boundaries in src/policy.ts, ledger.ts, model.ts, pilots.ts, kaji-link.ts, runtime.ts and the live dashboard. The HTML files are simulations, not deployed features; angular.json ships web/public, not docs/NERV. OCR is imperfect; visual references were also inspected. No third-party comparison, library recommendation or legal conclusion was revalidated.

## Concept disposition

| Earlier concept | Current owner / disposition |
|---|---|
| Request-level Blue/Orange/Red and 2-of-3 model majority | Superseded. Green/Orange/Blue derive per action from effect metadata; deterministic policy/protection, one intent model, veto-only extras. F-017/F-025; src/policy.ts and ledger.ts. |
| Unconditional rollback, manual root bypass, auto approval from model confidence | Rejected/displaced by single-use grants, owner cards, expiry never approves and Spear only declared inverses. F-023 and current Architecture. |
| EVA equals a physical machine; pilots equal broad-root privilege tokens; Firecracker mandatory on Mac | Superseded. Role/base/model remain independent; F-045 pilots, F-049 per-job sandbox instances and platform-specific backends. No privileged pilot bypass. |
| Lilith as arbitrary tool library; Adam mandatory; Entry Plug as ingress | Superseded vocabulary. Lilith is confirmed semantic memory; MCP/tools belong to F-021; Entry Plug is an action execution bundle. Current canonical vocabulary and F-022/F-045. |
| Quiet secondary bots as a requirement | Superseded by the latest owner request: each configured bot accepts owner messages, while outgoing inbox items may use main (PR #166 candidate). |
| Hidden auto-fallback from cloud/budget depletion to local | Displaced by explicit model routes and privacy: no silent route fallback (F-030, src/model.ts). Future budgeting must preserve that boundary. |
| Heartbeats, signed registry, encrypted transport, peer seats | F-036 implemented slices; F-005/F-006/F-016/F-050 still own discovery, orchestration, fencing/relocation and whole-job forwarding. No future claim established by a drawing. |
| Proactive schedules, file/webhook/inbox triggers, quiet hours | F-026 and the narrower implemented reminder/brief work; broader trigger engine remains planned. |
| Memory/context trimming, consolidation, owner-confirmed writes | F-022/F-028 and current memory/Instrumentality implementation; provenance/taint and egress work remains F-027. |
| MCP and specialist advisors | F-021 and F-025/F-045; advisor access is distinct from grants/execution. JIT mercenary scraping and arbitrary remote installation are not accepted requirements. |
| Progressive trust, golden evaluations, autonomous improvement | F-007/F-025/F-029/F-045; most promotion/evidence/learning behavior remains planned. |
| PWA, voice, FPV, enrolled workers and provider-reset resume | F-004/F-007/F-008/F-005/F-012 and Roadmap; existing plans retain them independently of these source files. |
| Job list, approvals, digest, reminders, memory, themes/CRT, map and trace | F-019/F-023/F-047/F-051/F-052/F-053 and the live dashboard. Old fabricated CPU, spend, confidence sliders and remote bases are not live evidence. |
| Token/cost/context display, backup replication, automatic incident response | Mixed: cost accounting is retained in F-019, but the additional proposals below were not clearly accepted or rejected. Preserved explicitly before retiring the source. |

## Preserved proposals — no silent acceptance

| Proposal | Disposition and future decision |
|---|---|
| Per-model token burn, context-window occupancy and input/output token counters | Cost accounting already belongs to F-019. Context occupancy/counters are retained here as a proposal; scope, provider support and measurement semantics need a deliberate decision. Not an implemented feature or an added closure requirement. |
| Litestream/off-host replicas, encrypted backups and root-key recovery | Retained as a reliability/recovery proposal for F-002 and the architecture. Existing SQLite durability and registry root keys do not establish backup implementation or recovery acceptance. |
| Third Impact automatically revokes work and alerts the owner | Retained as an incident-response proposal related to F-023. Manual Spear and diagnostics do not establish automatic incident detection or safe global cancellation. |

These report-only proposals preserve uncertainty and require no immediate implementation. No claim of complete brainstorming adoption is made. Historical review references to insights2.md, insights3.txt and analysis_2026_11_02.txt are not present in the current folder; their contents were not re-audited in this scope.

## File-by-file retirement inventory

| Original file at the pinned revision | Disposition |
|---|---|
| [.DS_Store](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/.DS_Store) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [Gemini_Generated_Image_497wj4497wj4497w.jpg](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Gemini_Generated_Image_497wj4497wj4497w.jpg) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [Gemini_Generated_Image_80g37a80g37a80g3.jpg](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Gemini_Generated_Image_80g37a80g37a80g3.jpg) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [Gemini_Generated_Image_ubgqvtubgqvtubgq.jpg](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Gemini_Generated_Image_ubgqvtubgqvtubgq.jpg) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [NERV-ARCHITECTURE.md](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/NERV-ARCHITECTURE.md) | Moved to docs/NERV-ARCHITECTURE.md; vocabulary retained, historical-target limits explicit |
| [Pasted 2026-11-01 at 9.32.12 PM.tiff](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Pasted%202026-11-01%20at%209.32.12%20PM.tiff) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [Pasted 2026-11-01 at 9.32.28 PM.tiff](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Pasted%202026-11-01%20at%209.32.28%20PM.tiff) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [Pasted 2026-11-01 at 9.32.51 PM.tiff](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Pasted%202026-11-01%20at%209.32.51%20PM.tiff) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [Pasted 2026-11-01 at 9.33.33 PM.tiff](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Pasted%202026-11-01%20at%209.33.33%20PM.tiff) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [Pasted 2026-11-02 at 12.14.21 AM.tiff](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Pasted%202026-11-02%20at%2012.14.21%20AM.tiff) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [Pasted 2026-11-02 at 12.20.39 AM.tiff](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Pasted%202026-11-02%20at%2012.20.39%20AM.tiff) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [Pasted 2026-11-02 at 12.23.36 AM.tiff](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Pasted%202026-11-02%20at%2012.23.36%20AM.tiff) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [Pasted 2026-11-02 at 12.29.44 AM.tiff](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Pasted%202026-11-02%20at%2012.29.44%20AM.tiff) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [Pasted 2026-11-02 at 12.31.38 AM.tiff](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Pasted%202026-11-02%20at%2012.31.38%20AM.tiff) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [Pasted 2026-11-02 at 12.31.55 AM.tiff](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/Pasted%202026-11-02%20at%2012.31.55%20AM.tiff) | Deletable reference artwork; visual/OCR review found no independent unpreserved requirement |
| [dashboard-agnostic-2.html](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/dashboard-agnostic-2.html) | Deletable superseded prototype/redirect; live replacement is web/public/dashboard (F-019/F-047/F-053) |
| [dashboard-agnostic.html](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/dashboard-agnostic.html) | Deletable superseded prototype/redirect; live replacement is web/public/dashboard (F-019/F-047/F-053) |
| [dashboard-examples.html](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/dashboard-examples.html) | Deletable superseded prototype/redirect; live replacement is web/public/dashboard (F-019/F-047/F-053) |
| [dashboard.html](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/dashboard.html) | Deletable superseded prototype/redirect; live replacement is web/public/dashboard (F-019/F-047/F-053) |
| [dashboard1.html](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/dashboard1.html) | Deletable superseded prototype/redirect; live replacement is web/public/dashboard (F-019/F-047/F-053) |
| [dashboard2.html](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/dashboard2.html) | Deletable superseded prototype/redirect; live replacement is web/public/dashboard (F-019/F-047/F-053) |
| [gemini-code-1793557312919.txt](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/gemini-code-1793557312919.txt) | Deletable superseded design; every concept is adopted/planned or explicitly displaced in the mapping below |
| [insights.md](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/insights.md) | Deletable after this review is merged; adopted ideas mapped and undecided proposals preserved below |
| [nerv-agency-dashboard.html](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/nerv-agency-dashboard.html) | Deletable superseded prototype/redirect; live replacement is web/public/dashboard (F-019/F-047/F-053) |
| [review-2026-11-04.md](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/review-2026-11-04.md) | Moved unchanged to docs/audits/2026-11-04-rebrand-review.md; preserve dated evidence |
| [stay with NERV, just do not forget initial roadma... - stay with NERV, just do not forget initial roadma....csv](https://github.com/voidbrain/nerv/blob/c9e34f1cb5f3cb93a0d2150f90eead730b6a7d5b/docs/NERV/stay%20with%20NERV%2C%20just%20do%20not%20forget%20initial%20roadma...%20-%20stay%20with%20NERV%2C%20just%20do%20not%20forget%20initial%20roadma....csv) | Deletable superseded design; every concept is adopted/planned or explicitly displaced in the mapping below |

## Checks and limits

Current links to the canonical architecture and dated review are updated. Historical archive prose is preserved, with an added path-migration note. The input manifest records original byte sizes and SHA-256 hashes. The Mermaid/CSV and visual prototypes carry both rejected approaches and valid ideas now owned elsewhere; they are deletable because the mapping/proposal register preserves their requirements, not because every sentence was rejected. Product tests and previous audit coverage are not inferred from this documentation review. Harness archive-recap adoption has its own F-058 record and release dependency.
