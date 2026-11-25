# Native pairing and menu-bar preview — 1 November 2026

Scoped review against main `9248f101f562f7e469b704c26530966d4ad403eb`, plus this branch's native source, TLS/credential server, CLI, test and documentation changes. This is not live macOS GUI or full product acceptance.

## Inspected evidence

| Area | Evidence / limits |
|---|---|
| code | Reviewed private native TLS setup, bounded credential verifier database, atomic single-use claim, read-only capability checks and two-listener lifecycle. Swift source reviewed here; macOS compile/test is a separate required CI job. |
| logic | Traced CLI → pinned TLS invitation → companion pin/hostname/date validation → one-time claim → Keychain credential → authenticated read with runtime UUID. Same-user filesystem compromise is outside this client boundary. |
| tests | 17 backend/protocol/DOM tests and two real process integration tests pass locally. Tests cover expiry/replay/revocation, restart identity, no cleartext client verifier storage, denied mutation/admin access, different CA, Origin rejection and TLS/process lifecycle. Swift invitation and real pinned-transport fixture tests are configured for macOS CI. |
| documentation | Native guide, architecture, decision, install, roadmap, README, style/area notes and F-011/F-015 distinguish preview from notifications/service/login/distribution work. |
| harness | Copied v3.1.1 helpers retained; project impact/coupling rows and review receipt updated. Generic rules unchanged. |
| security | TLS 1.3 loopback, no global CA trust insertion, exact native certificate pin plus hostname/date checks, redirect rejection, private key/verifier permissions, hash-only random verifiers, 2-minute tickets/30-day read clients, per-request revocation/expiry, no master/provider credential handoff to native app/Brain. Apple URLSession manual trust guidance consulted. |
| delivery | Node checks/build pass locally; CI now has native macOS compile/tests and ad-hoc app ZIP packaging. No app is installed on this Linux host. Keychain prompts, menu accessibility and downloaded-app acceptance remain unperformed. |
| backlog | F-011/F-015 now Implemented with pending named acceptance; neither is closed. F-014 still owns native-scoped WebSocket sessions, which this client does not use. |

## Remaining limits

The companion is a read-only development preview. No notifications, automatic service start/stop controls, launch-at-login, credential renewal, automated certificate rotation, notarization or distribution signing. Native refresh is manual/on appearance; large-history pagination remains F-013. Removing local pairing does not revoke the server-side credential; CLI revoke is separate. Keychain credentials are tested by manual host acceptance later, not fabricated here. Certificate/key changes require explicit recovery and re-pairing; expiry is not bypassed. Existing browser workspace root-token authentication is unchanged; native pairing is only on the optional TLS listener. CLI administrative TLS uses the local stored certificate, and invitations must stay private.

A previous certificate/key mismatch could have left children alive during startup construction; the new construction error path closes runtime and verifier state. Both TLS and web listeners join graceful shutdown. Public/private files are preserved on repeated setup rather than rotated silently.
