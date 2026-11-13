# F-015 isolated pairing and Keychain trial, 12 November 2026

Evidence for [F-015](../archive/backlog-2026.md#f-015) step F-015-T02: the menu-bar companion paired live on the owner's Mac to an isolated NERV profile, with expired and used invitations refused and no credential in URLs, process arguments or logs.

**Who did what:** the agent prepared the profile and the build, ran the server-side checks and stopped the profile; the owner ran `pair`, pasted the invitations into the companion, handled the companion menu and reported what it showed (owner approval 2026-11-12, including replacing the companion's pairing and re-pairing it to the live service afterwards). Invitations were never shown to the agent.

**Build:** companion from main `214b7cb` (`sh native/build-app.sh`, ad-hoc signed, identifier `io.nerv.companion`); `swift test` executed 20 tests, 1 skipped, 0 failures. It replaced a PR #213 build that had been running from a temporary folder, and now runs from `~/Applications/NERV.app`.

**Isolated profile:** `init --base NERV-T1 --name "F015 Trial" --no-model-setup` and `native-init` in a separate data folder, web port 4417 and native TLS port 4419, run in the foreground from `214b7cb` next to the live service (4317/4319), and stopped at the end. The live service, its data and its TLS identity were not changed.

## Steps and observations (20:52–21:08 CET)

| Step | Observed |
|---|---|
| Owner pastes an invitation for NERV-T1 while the companion is still paired to the live service | The companion was in renewal mode, compared the invitation with its current pairing and refused it on the Mac: nothing was sent (the isolated ticket stayed unclaimed and expired), the live credential stayed. Correct refusal, but the message said *Renewal not confirmed. Inspect clients; use a new invitation…*, the text for a lost reply: recorded as B-056 |
| Owner forgets the local pairing and pastes a fresh invitation | Paired. NERV-T1 recorded client `F015 trial`, read scope, expiring 2026-12-12; ticket consumed; the Keychain item (`io.nerv.companion` / `paired-runtime`, login keychain) rewritten at 20:59:59 |
| Reminder `F015 trial check` added to NERV-T1 only; owner selects Refresh status | The owner saw the reminder in the menu, and *The local service does not match the paired NERV* under the Mac's service controls (the installed launchd service uses another data folder), so service controls stay disabled for a runtime that is not the one installed |
| Invitation used twice (agent, `POST /api/pairing/claim` over the pinned certificate) | First claim 201 with a token; the same invitation again 400 `Invalid, expired or used invitation.` |
| Invitation claimed 5 s after its two-minute expiry | 400 `Invalid, expired or used invitation.`, no token |
| Secrets outside the Keychain | No 64-character hex value in the isolated `serve.log`, and not the administrative token; none in the companion's unified log (last 15 minutes) or its preferences; the only process argument list on the Mac with such a value belonged to an unrelated application. The companion builds URLs from host and port only and sends the token in a header |
| Re-pair to the live service | Owner forgot the trial pairing and paired with a fresh live invitation: live client `Mac companion`, expiring 2026-12-12; the Keychain item rewritten at 21:07:06; the owner confirmed live reminders and no mismatch line |

## Left open

- Lost reply, Keychain failure, revocation and offline TLS/auth rotation on the real host (F-015-T03).
- The live service still lists the earlier client `NERV Agency Menu Bar` (paired 2026-11-07, expiring 2026-12-07); its Keychain item was deleted when the owner forgot that pairing, so nothing can use it, but it is not revoked.
- Whether macOS showed a Keychain access prompt was not reported; this run does not show prompt behaviour across differently signed builds.

Commands, invitations and tokens stayed on the Mac; this note keeps statuses, labels and times only.
