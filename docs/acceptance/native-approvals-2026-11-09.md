# Native approval previews

9 November 2026, F-023-T02 candidate based on main `12a24ef`. Builds on the accepted [authority contract](../decisions/native-approvals.md). No production credential, service installation, notification permission or remote target was used.

Implemented: up to five pending cards with full bounded JSON arguments, effect/Pattern, Sync Ratio and inputs, verdicts/reasons, IDs and Mac-local expiry. A periodic view updates the remaining TTL, showing expired and disabling the review shortcut at zero. Successful polling replaces the page; failures clear it and display unavailable. Forget clears cards. The native credential remains read-only; Review in dashboard opens the saved paired web port's dashboard without query/fragment credentials or decisions. Browser authentication is independent.

Evidence:

- Swift approval tests check nested arguments/recipient/diff preservation as text, IDs, enum/value bounds, duplicate/malformed/oversized whole-page rejection, expiry boundaries and credential-free dashboard URLs. Static SwiftUI cards render in English and Italian with nonblank-content checks; temporary PNGs were visually inspected at 350 px width. The renderer uses a fixed card body; the live menu supplies its periodic clock wrapper. This does not establish real pointer/keyboard/VoiceOver interaction.
- The real temporary Node HTTPS fixture supplies a neutral pending card. Swift pins the certificate, reads and validates the actual JSON envelope, and confirms approve/reject/edit requests fail without changing the card. The fixture-backed Swift suite passed all 14 tests before the additional static-render test; the final four approval tests also passed.
- Node native-auth tests read the exact pending card through the native token, refuse every decision type, then apply a privileged decision. The card disappears and replay does not duplicate the reminder effect. Full Node suite: 460 passed, 2 platform skips, no failures (462 total).
- Typecheck and convention checks passed. Local ad-hoc native package built successfully; this is not a notarized release. Planner requests complete deterministic CI because the native HTTPS fixture is risk-mapped; final PR CI owns cross-platform acceptance.

Remaining: durable approval inbox/notification delivery, checkpoint/restart/restore and cross-channel notification races are F-023-T03. No new approval banners were delivered. Actual paired menu navigation, VoiceOver, permissions, sleep and owner observation remain native acceptance; no broader accessibility or real-device claim follows from static render inspection. F-023 remains open.

## Final CI acceptance

PR #229 exact head `f3109c1` merged to main `5933855` after [CI42584230832](https://github.com/voidbrain/nerv/actions/runs/42584230832) passed plan, validate, Windows, native-macos and full-suite. Authenticated `npm run ci:status -- 229` confirms all five jobs. Full deterministic coverage includes Linux coverage/browser/axe/headless, Windows tests/service and native Swift/pinned-HTTPS/package checks. This closes the bounded card implementation task T02, not parent F-023 or live interaction/banner acceptance. T03 is ready; its durable approval delivery remains unimplemented.

The successful native CI job log was inspected: all 15 Swift tests passed, including all four approval tests and the live temporary pinned-HTTPS fixture; no Swift test was skipped in that job.
