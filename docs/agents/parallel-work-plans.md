# Upfront feature plans in parallel work

Read when a feature plan splits work across parallel steps. Moved from [parallel work](parallel-work.md) unchanged (F-078).

## Upfront feature plans (optional)

Set `workItems.featurePlans: true` to require at least one task for each active feature and derive a visible step/remaining-effort/status table in the ledger. Keep the table out of record sources: `build` owns it. Existing non-adopters render unchanged; archives are never rewritten. All tasks belonging to an active feature, including completed steps, need an `effort` object with exactly `size` (`small`, `medium`, `large`), `estimate` (remaining range/text), `basis` (assumptions/uncertainty) and `reviewed` (valid ISO calendar date). Use zero remaining for completed work and state when its original estimate is unknown. Tasks of archived parents need no retrospective estimates. A planned task can name pending discovery/acceptance without pretending it is ready.

Before implementation, author a plan for the full anticipated outcome; prefer doing this at registration. [Backlog rules](../backlog/feature-plans.md#optional-upfront-feature-plans) own owner agreement for material expansion/splitting. Routine refinement preserves the accepted outcome and existing authority. Steps do not replace parent acceptance or grant execution permission.
