# NERV Agency menu-bar companion (macOS 14+)

Native SwiftUI MenuBarExtra, without Electron. This is a development preview: pairing, Keychain storage, connection status, five pending reminders, background refresh, opt-in notifications, user-service controls, launch-at-login selection, language selection and workspace launch are implemented. An explicit Developer ID/notarization packaging path is available below; an actual signed release and real native UI/permission/login/logout acceptance remain F-011. Quit companion leaves the daemon running.

## Set up the local service

```bash
npm ci
npm run build
npm start -- native-init
# Restart an installed NERV Agency service after adding native TLS:
npm start -- service stop
npm start -- service start
# Or run npm start -- serve if no service is installed.
npm start -- pair
```

`native-init` runs ordinary init, then creates a private localhost certificate/key with openssl. It never installs a certificate into system trust. Existing TLS files are preserved. The web workspace stays on 4317; native HTTPS uses 4319 unless config.json sets nativePort. The ports must differ. Certificate lifetime is one year; changing the certificate requires pairing clients again. Do not delete/replace TLS or native credential files while NERV Agency is running.

`pair` uses the persisted certificate to authenticate the local TLS server before sending the administrative token. It prints a **private two-minute, single-use invitation**. Paste it only into NERV Agency's companion. Do not share it, place it in a URL, send it to an agent, or commit it. The invitation includes the daemon's certificate fingerprint/runtime identity and ports, so the companion can verify its TLS peer before sending the ticket. A different process occupying the port with a different certificate is rejected.

## Build and run the app locally

Requires Apple's Swift toolchain (Xcode or Command Line Tools) and macOS 14+:

```bash
swift test --package-path native/NervMenuBar
sh native/build-app.sh
open dist/NERV.app
```

The app has no Dock window. Open its menu-bar icon (the seven-eye triangle), paste the invitation and choose Abbina NERV. The resulting 30-day credential grants read access to doctor/reminders/inbox only; it cannot mutate reminders, create invitations or manage other clients. It is stored in macOS Keychain, never UserDefaults. Language and the notification-enabled preference use UserDefaults; neither stores credentials. Default language is Italian; English is selectable. Dates are shown in Mac local time. While paired and running, refresh occurs every 15 seconds and on menu appearance/manual request. Sleep, logout and quitting the companion stop this polling; the daemon persists inbox deliveries for later catch-up.

The build script creates a local **ad-hoc signed** app. It is not Developer ID signed or notarized, and a downloaded CI artifact is not a production installer. The macOS CI job builds/tests Swift against a real temporary Node HTTPS fixture, then packages an app ZIP as an Actions artifact. Keychain prompts, menu interaction, accessibility and actual service login/logout still require target-host acceptance. Running Swift tests without the fixture skips that one network integration case explicitly; schema tests still run.

## Prepare a distribution build

The ordinary `sh native/build-app.sh` command remains ad-hoc only. It also accepts one output app path for isolated local package checks. The release command builds committed native source into a new output directory, signs with the selected Developer ID Application certificate, enables the hardened runtime and secure timestamp, and verifies the signature. It rejects an existing output directory and uncommitted native changes.

```bash
# First review the 40-character certificate fingerprint in your local Keychain.
# Signed only: no notarization upload.
node native/release-app.mjs --identity CERTIFICATE_SHA1 --out /absolute/new-release-directory

# Explicit upload, using credentials already stored locally with notarytool.
node native/release-app.mjs --identity CERTIFICATE_SHA1 --out /absolute/another-new-release-directory --submit --keychain-profile NERV-notary
```

Set up the notary profile interactively with `xcrun notarytool store-credentials NERV-notary`; keep account secrets in Keychain, never command arguments, repository settings or chat. Review the selected account/certificate and authorize the Apple upload before running the second command. This repository configures no signing secrets or automatic release upload in CI.

The submit path retains the response and notary log, requires Accepted status and a log without issues, staples and validates the ticket, checks Gatekeeper assessment, then creates `NERV-macOS.zip` from the stapled app. `release.json` records the source revision, archive SHA-256 and whether notarization actually completed. Signed-only output explicitly says `notarized: false`. These checks follow [Apple's notarization workflow](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

A failed or timed-out command stops the run and retains its private output directory. Do not resubmit blindly: use the retained submission ID with `xcrun notarytool info ID --keychain-profile NERV-notary`, or inspect `notarytool history` when the reply was lost. Download the log with `notarytool log ID --keychain-profile NERV-notary` and review any warnings. A submission can continue at Apple after a local timeout. Do not distribute `submission.zip` or any artifact lacking a successful final receipt. No automatic retry or cleanup removes this evidence. Packaging does not publish a release or establish notification, Keychain, menu accessibility or login/logout acceptance; perform those on the chosen Mac before distribution.

## Inspect and revoke pairing

```bash
npm start -- clients
npm start -- revoke CLIENT_ID
```

These commands require the user's administrative credential and pinned native TLS. Server storage contains hashes of tickets/client tokens, not their cleartext. Revocation applies on the next request. Rimuovi abbinamento locale removes the local Keychain entry only; use revoke to revoke the server-side credential too. Restore of native-auth.sqlite restores its runtime identity and credential verifier state; retain it with the rest of a private backup. A restored or changed daemon identity is not silently trusted. Certificate/key compromise requires the explicit stopped-profile recovery below; automatic certificate replacement is not implemented.

### Renew an unexpired native credential

Generate a fresh invitation with the trusted CLI (`npm start -- pair`). In the paired companion select **Renew pairing**, then paste that invitation into the private field. Renewal accepts only the same runtime UUID, TLS pin and native/web ports, and requires the current credential to be unexpired and unrevoked. A changed certificate or runtime requires recovery and fresh pairing instead; the old token is never sent to that newly supplied identity.

`POST /api/pairing/renew` requires both the owner-issued single-use ticket and the current native bearer token. One SQLite transaction consumes the ticket, invalidates the previous token and issues a new 30-day read-only credential; other clients are unchanged. A native credential cannot mint its own ticket or gain write/admin scope. This also works at the 32-client limit because it replaces one client. The companion saves the replacement in Keychain only after validating the response. The notification checkpoint keeps the same runtime identity.

If the response is lost or Keychain saving fails, the server may already have invalidated the old token. The companion shows an unconfirmed-renewal message and pauses refresh while the renewal form is open; it does not repeat the renewal automatically. Inspect `npm start -- clients`, revoke any orphan replacement with `npm start -- revoke CLIENT_ID`, generate a **new** invitation, forget the local pairing and pair again. Reusing the consumed ticket cannot renew twice. Expired or revoked credentials use this fresh-pairing path too. Forgetting locally alone does not revoke a server credential.

### Recover a changed, expired or compromised native certificate

This is an explicit local-owner procedure, not a live mutation command. On the chosen acceptance host:

1. Stop the companion and every process using this NERV data home, including its installed service or foreground daemon. Confirm they are stopped before touching TLS/SQLite files. Do not perform this service installation/acceptance on the execution host prohibited by F-009.
2. Make a private backup of the data home, retaining SQLite sidecars. Preserve the existing native certificate/key/config and `native-auth.sqlite` together with any `-wal`, `-shm` or `-journal` sidecars in a separate private recovery directory. Move only this native-auth/TLS set out of the active home while it is stopped; leave reminders, ledger, admin/provider credentials and other data in place. If anything fails, keep the daemon stopped and reconcile the complete set before proceeding.
3. Run `native-init` for that exact data home to generate a new native certificate/key. Start the reviewed existing service or foreground process. A new native-auth database creates a new runtime identity; all previous native credentials are invalid on it. Never reuse a compromised verifier database or key to preserve pairing.
4. Obtain fresh invitations through the trusted CLI using the new persisted certificate. Explicitly forget and pair each companion again, then re-enable notifications from the current head. Verify read-only access and rejection of old credentials/pins. A successful TLS setup alone is not live Keychain or notification acceptance.

Do not restore old native-auth state over the new running identity: doing so can resurrect old credentials. Retain private evidence for investigation; this procedure deletes nothing and is separate from application database restore policy. An isolated fixture tests this stopped-profile replacement, new identity/pin, old-token rejection and retention of unrelated data. Actual owner/OS acceptance remains F-015.

The companion uses pinned HTTPS REST in this step. The existing JSON-RPC endpoint still accepts the administrative credential only; per-client WebSocket sessions are later F-014 work. No provider/API key or root bearer credential is handed to the companion or Brain.

## Notifications

Click **Attiva notifiche da ora / Enable notifications from now** to request macOS permission. After permission and authenticated connection succeed, NERV Agency records the current inbox head: old messages are not announced on first enable. Later launches catch up from the saved position. Re-enabling after turning notifications off starts from the current head again, deliberately skipping notifications missed while disabled. The inbox remains authoritative and retains those messages.

The companion reads bounded pages and submits at most five notifications per refresh. The local checkpoint is an atomic private file at `~/Library/Application Support/NERV Agency/notification-checkpoints.json`, with runtime IDs/delivery IDs/sequence only, no tokens or message text. It advances after OS submission or reconciliation with an existing pending/delivered notification of the same deterministic identifier. Failures preserve the unfinished position. Permission denial is displayed; retry requires allowing notifications in macOS settings. Focus/Do Not Disturb, OS settings and a sleeping Mac can delay or suppress banners even when submission succeeds.

This is best-effort duplicate suppression, not an exactly-once banner guarantee: if the app crashes after OS acceptance but before its checkpoint is saved, and the user dismisses that notification before reconciliation, a later submission can repeat it. A checkpoint whose sequence/UUID no longer matches a restored database is reset to the current head with a warning, avoiding a flood of historical notifications; review the inbox for missing banners. Corrupt local checkpoint files fail visibly rather than replaying history automatically.

## Start/stop and login

**Avvia NERV / Start NERV** bootstraps the existing `io.nerv.agent` user LaunchAgent. It does not install one: use the CLI installation procedure first. **Ferma NERV / Stop NERV** requires a separate confirmation and bootouts that same user agent. This pauses the daemon, so due reminders wait until it starts again. Quit companion leaves the daemon untouched. An agent stopped this way may load again at the next login if its plist remains installed.

When paired, the app compares the authenticated daemon's data directory with `NERV_HOME` in the local agent plist before enabling service controls; a different or unknown local runtime is not silently stopped. With no pairing, the controls explicitly target the known NERV Agency user service on this Mac. Commands use fixed argv and no shell, sudo, token or arbitrary label. A bounded timeout reports an uncertain result; refresh status before retrying. “Service loaded” means launchd knows the job, not proof that the daemon/API is healthy; connection status is separate.

**Avvia companion al login / Launch companion at login** uses `SMAppService.mainApp`. It registers this app only, not the Node daemon. The displayed state comes from macOS; pending approval is distinct from enabled and has a Login Items settings shortcut. Put NERV.app in a stable user-chosen location (for example Applications) before registering. Moving/updating the ad-hoc app can require reapproval; Keychain and Gatekeeper prompts are not bypassed. Disabling this login item leaves the current companion and daemon running. Actual permission dialogs, banners, menu accessibility and logout/login still need target-Mac acceptance.

Background refresh uses the authenticated lightweight `/api/status` endpoint (a scheduler-process ping), not a SQLite integrity scan. Full integrity diagnostics remain available through explicit doctor commands/web diagnostics. Update/restart the daemon and update the companion together when adopting this version.
