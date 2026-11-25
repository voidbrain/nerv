# F-015 live failure, recovery and rotation, 12 November 2026

Evidence for [F-015](../archive/backlog-2026.md#f-015) step F-015-T03: revocation, a lost renewal reply, a Keychain save failure and offline TLS/auth rotation, each exercised live with the menu-bar companion on the owner's Mac, and each recovered with the procedure in [native/README.md](../../native/README.md#inspect-and-revoke-pairing).

**Who did what:** the agent prepared an isolated profile and the failure conditions, inspected server and Keychain state and revoked orphans; the owner ran `pair` and the helper scripts, pasted invitations, handled the companion and the macOS prompts and reported what the companion showed. Invitations were never shown to the agent. Owner approval 2026-11-12 for the four cases, the effort and re-pairing to the live service afterwards.

**Setup:** isolated profile `NERV-T2 · F015 Trial 2` from main `829418f` (web 4417, native TLS 4419), with a reminder only it has (*F015 T03 check*); companion from `214b7cb` in `~/Applications/NERV.app`. The live service was not touched. The profile was stopped at the end.

## Results (21:15–21:45 CET)

| Case | How | Observed | Recovery |
|---|---|---|---|
| T03a revocation | Agent revoked the companion's client; owner chose Refresh status | Next request refused; reminders and approvals cleared; message *NERV non disponibile o richiesta rifiutata. Verifica servizio e abbinamento.*, in Italian with English selected, not saying the pairing was revoked (B-057) | Forget local pairing, fresh invitation, paired |
| T03b lost renewal reply | Helper throttled the server (1 ms running every 3 s) while the owner renewed | The server completed the renewal at 21:33:11 (client replaced, old token invalidated); the companion never saved it (Keychain entry unchanged since 21:25:08) and showed *Renewal not confirmed*, without retrying; Refresh then refused the old token | `clients` showed the orphan replacement; agent revoked it; forget, fresh invitation, paired (21:37:31) |
| T03c Keychain failure | Helper locked the login keychain; owner renewed and cancelled the macOS keychain password prompt | The server completed the renewal at 21:39:52; the save failed (Keychain entry unchanged); *Renewal not confirmed*, no retry | Agent revoked the orphan; owner unlocked the keychain; old token refused; forget, fresh invitation, paired (21:41:31) |
| T03d offline TLS/auth rotation | Agent followed "Recover a changed, expired or compromised native certificate" on the stopped profile: companion quit, server stopped, private backup with SQLite sidecars, native cert/key/config and `native-auth.sqlite` moved to a separate recovery folder, `native-init`, restart | New runtime identity and pin (fingerprint and runtime UUID both changed), 0 clients, the profile's reminder retained; the companion refused the new certificate with its old pin (TLS challenge cancelled, nothing sent), message a bare *cancelled* (B-057) | Forget, fresh invitation, paired to the new identity (21:43:52) |

Also observed on the way:

- A renewal at normal speed through a throttled server (2 ms every 1.5 s) completed end to end: client replaced and the companion saved the new credential two seconds later.
- A first throttling attempt that paused the server completely could not produce a lost reply: the TLS handshake never finished, the request never arrived and nothing changed; the companion reported *not confirmed* after its 5 s timeout, which is right for an unknown outcome.
- The renewal field keeps the previous invitation after a failed renewal and shows only dots, so a paste is appended to it; with the generic *not confirmed* message this cost two attempts (added to B-056).

At the end the owner re-paired the companion to the live service (client `Mac companion`, 2026-11-12 21:44).

## Left open

- The live service still lists the companion's previous client from the F-015-T02 trial (`Mac companion`, paired 21:07); nothing holds its token any more. The agent's revocation was blocked by the session's permission check; the owner can run `npm start -- clients` and `npm start -- revoke <id>` in the trusted terminal.
- Messages: B-056 (refused vs unconfirmed renewal, leftover field text) and B-057 (untranslated and undistinguished error messages).

Backups and the moved native set stayed in the private test folder and were deleted with it; this note keeps statuses, labels and times only.
