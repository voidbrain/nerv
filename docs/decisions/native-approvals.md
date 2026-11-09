# Native approval cards and owner authority

Accepted implementation contract, 9 November 2026, baseline `3ec54b9`, F-023-T01. Card rendering and durable notification delivery remain F-023-T02/T03. This contract grants no new native network scope.

## Existing authority

The companion pairs over pinned HTTPS with a revocable, expiring read-only credential. `GET /api/approvals?limit=5` is already permitted; `POST /api/approvals/ID` is denied to that credential. Only an existing administrative/dashboard session or Telegram owner decision reaches `Store.decide`, which enforces expiry, idempotency, worker authority and executor authorization. A model verdict or a preview cannot execute an action.

## Decision path

Present at most five complete bounded pending cards in the companion, then offer **Review in dashboard**. Open only `http://127.0.0.1:<paired webPort>/dashboard/`, constructed from the saved pairing; no token, ticket, decision, tool argument or private content enters the URL. The browser uses its own existing dashboard session. If it is not signed in, the owner uses the supported trusted CLI `npm start -- open` sign-in path; the companion cannot mint a session or transfer its read credential. Review in dashboard is navigation, never an approval.

The button identifies this base's dashboard, not a remote Kaji address or a guaranteed exact-card deep link. The owner reviews the current pending card there and decides through the existing API. The dashboard and server remain authoritative if a card expires or Telegram/another browser decides it first. Edits return to the planner through existing behavior; no native in-place argument editing is introduced.

## Read-only card contract

Decode the actual bounded approval envelope: ID, matching envelope/card expiry, sortie/action IDs, tool, complete JSON arguments (including any diff/recipients), effect, Pattern, Sync Ratio/value/inputs, verdicts and reason. Render data as text, never executable markup. Fail the entire page visibly on malformed, duplicate, oversized or inconsistent cards; do not silently truncate argument content or keep an old actionable preview after a failed read. The server supplies the bounded page, and the UI labels its limit rather than implying all pending approvals are shown.

Show the remaining TTL and absolute Mac-local expiry. Expired cards become visibly expired locally without waiting for polling; never display a native approve/reject button. Polling reconciles cards decided elsewhere by replacing the complete page. Clear cards on connection/identity failure and local forget. Runtime identity is checked before the page is accepted. A countdown is a display aid; server time and `Store.decide` determine authority.

## Delivery and limits

T02 supplies the read-only polling surface. T03 adds durable generic approval notices through the existing inbox. Store commits the approval and one notice/identity link together; restart backfills older pending approvals once, preserving existing rowids and delivery UUIDs. The paged feed adds approval ID, expiry and a current pending flag; historical notices remain in the inbox. The companion validates that metadata, skips settled/expired notices while advancing the cursor, and uses existing checkpoint/OS-ID reconciliation for submission retries. Telegram skips these generic entries because its existing full card path owns delivery there. Polling a pending page alone is not durable notification delivery and OS acceptance does not prove a banner was seen.

Notification enable/re-enable starts at the current head, deliberately skipping older notices; the pending-card preview remains available. Catch-up reads up to five entries per refresh. A decision can race the server pending snapshot and OS submission, so a generic banner may be stale; it offers no approval authority and directs the owner to current NERV state. OS acceptance, checkpoint persistence and dismissal cannot be atomic: documented crash windows can repeat banners. Restored-history mismatch resets to the head with a warning, never replaying every old notice. No notification action decides a card or transfers a credential. Keychain, menu interaction, VoiceOver, banner and sleep behavior require explicit live Mac acceptance; compile/schema/HTTPS fixtures prove their named contracts only.

## Alternatives and reconsideration

Retain the established dashboard owner path now. Reject placing the administrative token in the app or URL, broadening paired credentials, or minting a web session from a read-only token: each would violate the existing authority boundary. A dedicated native write credential or one-shot decision capability needs a separate explicit security contract and owner authorization before implementation. Reconsider if dashboard navigation cannot meet observed owner needs; convenience alone cannot silently widen native scope.

Acceptance: inspect the existing read allowlist and write denial, exercise read-only API/Swift fixtures with T02, then verify actual UI separately. F-023 remains open until its complete delivery and owner-interaction requirements are met.
