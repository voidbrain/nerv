# Nodo menu-bar companion (macOS 14+)

Native SwiftUI MenuBarExtra, without Electron. This is a development preview: pairing, Keychain storage, connection status, five pending reminders, manual refresh, language selection and opening the web workspace are implemented. Notifications, service controls, launch-at-login, signed/notarized distribution and full native UI/accessibility acceptance remain F-011. Quit companion leaves the daemon running.

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

The app has no Dock window. Open its knot menu, paste the invitation and choose Abbina Nodo. The resulting 30-day credential grants read access to doctor/reminders/inbox only; it cannot mutate reminders, create invitations or manage other clients. It is stored in macOS Keychain, never UserDefaults. Only the language preference uses UserDefaults. Default language is Italian; English is selectable. Dates are shown in Mac local time. Refresh is manual or on menu appearance; notifications and continuous background polling are not implemented.

The build script creates a local **ad-hoc signed** app. It is not Developer ID signed or notarized, and a downloaded CI artifact is not a production installer. The macOS CI job builds/tests Swift against a real temporary Node HTTPS fixture, then packages an app ZIP as an Actions artifact. Keychain prompts, menu interaction, accessibility and actual service login/logout still require target-host acceptance. Running Swift tests without the fixture skips that one network integration case explicitly; schema tests still run.

## Inspect and revoke pairing

```bash
npm start -- clients
npm start -- revoke CLIENT_ID
```

These commands require the user's administrative credential and pinned native TLS. Server storage contains hashes of tickets/client tokens, not their cleartext. Revocation applies on the next request. Rimuovi abbinamento locale removes the local Keychain entry only; use revoke to revoke the server-side credential too. Restore of native-auth.sqlite restores its runtime identity and credential verifier state; retain it with the rest of a private backup. A restored or changed daemon identity is not silently trusted. Certificate/key compromise requires explicit local recovery and re-pairing; automatic rotation/recovery is not implemented.

The companion uses pinned HTTPS REST in this step. The existing JSON-RPC endpoint still accepts the administrative credential only; per-client WebSocket sessions are later F-014 work. No provider/API key or root bearer credential is handed to the companion or Brain.
