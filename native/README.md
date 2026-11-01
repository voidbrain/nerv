# Nodo menu-bar companion (macOS 14+)

Native SwiftUI MenuBarExtra, without Electron. This is a development preview: pairing, Keychain storage, connection status, five pending reminders, background refresh, opt-in notifications, user-service controls, launch-at-login selection, language selection and workspace launch are implemented. Signed/notarized distribution and real native UI/permission/login/logout acceptance remain F-011. Quit companion leaves the daemon running.

## Set up the local service

```bash
npm ci
npm run build
npm start -- native-init
# Restart an installed Nodo service after adding native TLS:
npm start -- service stop
npm start -- service start
# Or run npm start -- serve if no service is installed.
npm start -- pair
```

`native-init` runs ordinary init, then creates a private localhost certificate/key with openssl. It never installs a certificate into system trust. Existing TLS files are preserved. The web workspace stays on 4317; native HTTPS uses 4319 unless config.json sets nativePort. The ports must differ. Certificate lifetime is one year; changing the certificate requires pairing clients again. Do not delete/replace TLS or native credential files while Nodo is running.

`pair` uses the persisted certificate to authenticate the local TLS server before sending the administrative token. It prints a **private two-minute, single-use invitation**. Paste it only into Nodo's companion. Do not share it, place it in a URL, send it to an agent, or commit it. The invitation includes the daemon's certificate fingerprint/runtime identity and ports, so the companion can verify its TLS peer before sending the ticket. A different process occupying the port with a different certificate is rejected.

## Build and run the app locally

Requires Apple's Swift toolchain (Xcode or Command Line Tools) and macOS 14+:

```bash
swift test --package-path native/NodoMenuBar
sh native/build-app.sh
open dist/Nodo.app
```

The app has no Dock window. Open its knot menu, paste the invitation and choose Abbina Nodo. The resulting 30-day credential grants read access to doctor/reminders/inbox only; it cannot mutate reminders, create invitations or manage other clients. It is stored in macOS Keychain, never UserDefaults. Language and the notification-enabled preference use UserDefaults; neither stores credentials. Default language is Italian; English is selectable. Dates are shown in Mac local time. While paired and running, refresh occurs every 15 seconds and on menu appearance/manual request. Sleep, logout and quitting the companion stop this polling; the daemon persists inbox deliveries for later catch-up.

The build script creates a local **ad-hoc signed** app. It is not Developer ID signed or notarized, and a downloaded CI artifact is not a production installer. The macOS CI job builds/tests Swift against a real temporary Node HTTPS fixture, then packages an app ZIP as an Actions artifact. Keychain prompts, menu interaction, accessibility and actual service login/logout still require target-host acceptance. Running Swift tests without the fixture skips that one network integration case explicitly; schema tests still run.

## Inspect and revoke pairing

```bash
npm start -- clients
npm start -- revoke CLIENT_ID
```

These commands require the user's administrative credential and pinned native TLS. Server storage contains hashes of tickets/client tokens, not their cleartext. Revocation applies on the next request. Rimuovi abbinamento locale removes the local Keychain entry only; use revoke to revoke the server-side credential too. Restore of native-auth.sqlite restores its runtime identity and credential verifier state; retain it with the rest of a private backup. A restored or changed daemon identity is not silently trusted. Certificate/key compromise requires explicit local recovery and re-pairing; automatic rotation/recovery is not implemented.

The companion uses pinned HTTPS REST in this step. The existing JSON-RPC endpoint still accepts the administrative credential only; per-client WebSocket sessions are later F-014 work. No provider/API key or root bearer credential is handed to the companion or Brain.

## Notifications

Click **Attiva notifiche da ora / Enable notifications from now** to request macOS permission. After permission and authenticated connection succeed, Nodo records the current inbox head: old messages are not announced on first enable. Later launches catch up from the saved position. Re-enabling after turning notifications off starts from the current head again, deliberately skipping notifications missed while disabled. The inbox remains authoritative and retains those messages.

The companion reads bounded pages and submits at most five notifications per refresh. The local checkpoint is an atomic private file at `~/Library/Application Support/Nodo/notification-checkpoints.json`, with runtime IDs/delivery IDs/sequence only, no tokens or message text. It advances after OS submission or reconciliation with an existing pending/delivered notification of the same deterministic identifier. Failures preserve the unfinished position. Permission denial is displayed; retry requires allowing notifications in macOS settings. Focus/Do Not Disturb, OS settings and a sleeping Mac can delay or suppress banners even when submission succeeds.

This is best-effort duplicate suppression, not an exactly-once banner guarantee: if the app crashes after OS acceptance but before its checkpoint is saved, and the user dismisses that notification before reconciliation, a later submission can repeat it. A checkpoint whose sequence/UUID no longer matches a restored database is reset to the current head with a warning, avoiding a flood of historical notifications; review the inbox for missing banners. Corrupt local checkpoint files fail visibly rather than replaying history automatically.

## Start/stop and login

**Avvia Nodo / Start Nodo** bootstraps the existing `io.nodo.agent` user LaunchAgent. It does not install one: use the CLI installation procedure first. **Ferma Nodo / Stop Nodo** requires a separate confirmation and bootouts that same user agent. This pauses the daemon, so due reminders wait until it starts again. Quit companion leaves the daemon untouched. An agent stopped this way may load again at the next login if its plist remains installed.

When paired, the app compares the authenticated daemon's data directory with `NODO_HOME` in the local agent plist before enabling service controls; a different or unknown local runtime is not silently stopped. With no pairing, the controls explicitly target the known Nodo user service on this Mac. Commands use fixed argv and no shell, sudo, token or arbitrary label. A bounded timeout reports an uncertain result; refresh status before retrying. “Service loaded” means launchd knows the job, not proof that the daemon/API is healthy; connection status is separate.

**Avvia companion al login / Launch companion at login** uses `SMAppService.mainApp`. It registers this app only, not the Node daemon. The displayed state comes from macOS; pending approval is distinct from enabled and has a Login Items settings shortcut. Put Nodo.app in a stable user-chosen location (for example Applications) before registering. Moving/updating the ad-hoc app can require reapproval; Keychain and Gatekeeper prompts are not bypassed. Disabling this login item leaves the current companion and daemon running. Actual permission dialogs, banners, menu accessibility and logout/login still need target-Mac acceptance.

Background refresh uses the authenticated lightweight `/api/status` endpoint (a scheduler-process ping), not a SQLite integrity scan. Full integrity diagnostics remain available through explicit doctor commands/web diagnostics. Update/restart the daemon and update the companion together when adopting this version.
