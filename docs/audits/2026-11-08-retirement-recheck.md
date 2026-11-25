# Retirement recheck and target correction — 8 November 2026

Scoped documentation review at main `7d3d091` (full baseline in the manifest). This corrects the disposition in the earlier [organization assessment](../design/documentation-organization-2026-11-08.md); that dated document remains unchanged. No full product audit, model benchmark or production/device acceptance is claimed.

## Finding and correction

The whole target-schema document was classified too broadly. Its overall flow remains useful, although bot routing, fallback, host/EVA identity, trust scoring and planned isolation/backup details needed correction. Restore an active [status-labelled target](../architecture/target-schema.md), retain the original outside remove/, and distinguish usable design intent from current implementation. Four other mixed design inputs also deserve explicit historical-source retention; they are not wholly invalid.

## Method

Rehashed all 26 original inputs against the prior manifest. Re-read the architecture schema, original notes/Mermaid/CSV and analysis export; inspected static visible text from all seven HTML files without executing scripts. Visually inspected all 13 image references in four contact sheets. Reused the earlier retirement review’s detailed concept/OCR mapping only because the recorded input bytes are unchanged; this recheck does not claim fresh OCR of every embedded image label. Compared current architecture/vocabulary, policy/runtime/model/worker ownership and backlog scopes, plus evaluator manifest and real-model runner boundaries.

## File-by-file current disposition

| Original source | Current location/classification | Valid intent / current owner |
|---|---|---|
| `docs/NERV/.DS_Store` | [filesystem-metadata](../../remove/docs/NERV/.DS_Store) | No product behavior or architecture authority |
| `docs/NERV/Gemini_Generated_Image_497wj4497wj4497w.jpg` | [visual-reference](../../remove/docs/NERV/Gemini_Generated_Image_497wj4497wj4497w.jpg) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/Gemini_Generated_Image_80g37a80g37a80g3.jpg` | [visual-reference](../../remove/docs/NERV/Gemini_Generated_Image_80g37a80g37a80g3.jpg) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/Gemini_Generated_Image_ubgqvtubgqvtubgq.jpg` | [visual-reference](../../remove/docs/NERV/Gemini_Generated_Image_ubgqvtubgqvtubgq.jpg) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/Pasted 2026-11-01 at 9.32.12 PM.tiff` | [visual-reference](../../remove/docs/NERV/Pasted%202026-11-01%20at%209.32.12%20PM.tiff) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/Pasted 2026-11-01 at 9.32.28 PM.tiff` | [visual-reference](../../remove/docs/NERV/Pasted%202026-11-01%20at%209.32.28%20PM.tiff) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/Pasted 2026-11-01 at 9.32.51 PM.tiff` | [visual-reference](../../remove/docs/NERV/Pasted%202026-11-01%20at%209.32.51%20PM.tiff) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/Pasted 2026-11-01 at 9.33.33 PM.tiff` | [visual-reference](../../remove/docs/NERV/Pasted%202026-11-01%20at%209.33.33%20PM.tiff) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/Pasted 2026-11-02 at 12.14.21 AM.tiff` | [visual-reference](../../remove/docs/NERV/Pasted%202026-11-02%20at%2012.14.21%20AM.tiff) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/Pasted 2026-11-02 at 12.20.39 AM.tiff` | [visual-reference](../../remove/docs/NERV/Pasted%202026-11-02%20at%2012.20.39%20AM.tiff) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/Pasted 2026-11-02 at 12.23.36 AM.tiff` | [visual-reference](../../remove/docs/NERV/Pasted%202026-11-02%20at%2012.23.36%20AM.tiff) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/Pasted 2026-11-02 at 12.29.44 AM.tiff` | [visual-reference](../../remove/docs/NERV/Pasted%202026-11-02%20at%2012.29.44%20AM.tiff) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/Pasted 2026-11-02 at 12.31.38 AM.tiff` | [visual-reference](../../remove/docs/NERV/Pasted%202026-11-02%20at%2012.31.38%20AM.tiff) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/Pasted 2026-11-02 at 12.31.55 AM.tiff` | [visual-reference](../../remove/docs/NERV/Pasted%202026-11-02%20at%2012.31.55%20AM.tiff) | Visual/diagram references; valid style cues remain in dashboard/STYLE-GUIDE; depicted votes/hosts/scopes are not current contracts |
| `docs/NERV/dashboard-agnostic-2.html` | [superseded-prototype](../../remove/docs/NERV/dashboard-agnostic-2.html) | UI concepts retained in dashboard/STYLE-GUIDE and F-019/F-020/F-023/F-045/F-048/F-051/F-052/F-056; old majority/risk/host examples are not current |
| `docs/NERV/dashboard-agnostic.html` | [superseded-prototype](../../remove/docs/NERV/dashboard-agnostic.html) | UI concepts retained in dashboard/STYLE-GUIDE and F-019/F-020/F-023/F-045/F-048/F-051/F-052/F-056; old majority/risk/host examples are not current |
| `docs/NERV/dashboard-examples.html` | [superseded-prototype](../../remove/docs/NERV/dashboard-examples.html) | UI concepts retained in dashboard/STYLE-GUIDE and F-019/F-020/F-023/F-045/F-048/F-051/F-052/F-056; old majority/risk/host examples are not current |
| `docs/NERV/dashboard.html` | [superseded-prototype](../../remove/docs/NERV/dashboard.html) | UI concepts retained in dashboard/STYLE-GUIDE and F-019/F-020/F-023/F-045/F-048/F-051/F-052/F-056; old majority/risk/host examples are not current |
| `docs/NERV/dashboard1.html` | [superseded-prototype](../../remove/docs/NERV/dashboard1.html) | UI concepts retained in dashboard/STYLE-GUIDE and F-019/F-020/F-023/F-045/F-048/F-051/F-052/F-056; old majority/risk/host examples are not current |
| `docs/NERV/dashboard2.html` | [superseded-prototype](../../remove/docs/NERV/dashboard2.html) | UI concepts retained in dashboard/STYLE-GUIDE and F-019/F-020/F-023/F-045/F-048/F-051/F-052/F-056; old majority/risk/host examples are not current |
| `docs/NERV/gemini-code-1793557312919.txt` | [historical-design-source](../archive/design-inputs/gemini-code-1793557312919.txt) | Retain raw provenance; active target/vocabulary and prior concept crosswalk distinguish adopted, planned and rejected intent |
| `docs/NERV/insights.md` | [historical-design-source](../archive/design-inputs/insights.md) | Retain raw provenance; active target/vocabulary and prior concept crosswalk distinguish adopted, planned and rejected intent |
| `docs/NERV/nerv-agency-dashboard.html` | [superseded-prototype](../../remove/docs/NERV/nerv-agency-dashboard.html) | UI concepts retained in dashboard/STYLE-GUIDE and F-019/F-020/F-023/F-045/F-048/F-051/F-052/F-056; old majority/risk/host examples are not current |
| `docs/NERV/stay with NERV, just do not forget initial roadma... - stay with NERV, just do not forget initial roadma....csv` | [historical-design-source](../archive/design-inputs/nerv-concept-mapping.csv) | Retain raw provenance; active target/vocabulary and prior concept crosswalk distinguish adopted, planned and rejected intent |
| `docs/analysis_2026_11_02.txt` | [historical-design-source](../archive/design-inputs/analysis_2026_11_02.txt) | Retain raw provenance; active target/vocabulary and prior concept crosswalk distinguish adopted, planned and rejected intent |
| `docs/NERV-ARCHITECTURE.md` | [historical-design-source](../archive/design-inputs/NERV-ARCHITECTURE-2026-11-04.md) | Retain raw provenance; active target/vocabulary and prior concept crosswalk distinguish adopted, planned and rejected intent |

## Preserved intent and rejected assumptions

| Theme from mixed sources | Current interpretation / owner |
|---|---|
| Intake, plan, advice, per-action gate, approval, execution and durable result | Restored active target; F-017/F-023/F-024 core and current runtime |
| Three-model majority, request-level Blue/Orange/Red, broad-root pilot identities | Superseded by per-action Green/Orange/Blue, deterministic rules/protection, veto-only extras and explicit grants |
| Distributed specialists and independent model/worker placement | F-006/F-045/F-050; a pilot adviser is not a sandbox executor |
| Queue, context limits, handoffs and long plans | F-048; development Git claims do not implement runtime resource ownership |
| Trace, displayed contributors, token/context visibility and communication | F-019/F-052/F-063; remaining context/SLA proposals stay proposals, not fabricated telemetry |
| Evaluated improvement and progressive trust | F-025/F-045/F-049 plus existing evaluation decision; no calendar-based or self-approved promotion |
| Litestream/vault backup and automatic incident action | F-062/F-064 decisions remain required; old drawing does not establish implementation |
| Personas, operator aliases, UI topology and menus | F-020/F-051/F-052/F-056/F-070; old prototype remains evidence, not live acceptance |

The remaining 21 files are seven superseded HTML prototypes/redirects, 13 visual references and one metadata file. No second current architectural authority was found among them. This is a scoped confidence finding, not proof that every future useful idea has been exhausted. No deletion is approved, and every original byte remains available.

## Qualification project boundaries

The [Gauntlet proposal](../design/gauntlet-protocol-2026-11-08.md) records the owner’s preference for an independent project that uses the harness for development. Generic evaluator contracts can remain independent; NERV supplies its domain pack and consumes reviewed evidence. Existing benchmarks/runners can be reused. No repository, dependency or model invocation was created.

## Validation and limits

Validate all 26 current hashes and historical locations, current maintained links, source/view equality, archive preservation and generated pages. The evaluator manifest’s bootstrap gap wording is corrected to describe coverage rather than falsely denying the separate bootstrap implementation; no case/group coverage is added. The two retired-reference metadata files are added to NERV documentation selection; source, policy, workflow and unknown executable paths retain full verification. Independent review and required CI remain merge gates. Other audit areas, deployment and model competence are outside this review.
