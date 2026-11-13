# F-011: macOS companion acceptance and signing identity procedure

Goal: verify menu-bar controls, notifications, Quit-vs-Stop separation, and launch-at-login on the paired Mac, and select a Developer ID identity when ready to distribute.

## Part 1 — Companion UI, notifications, and service controls (Neo Tokyo-3, Terminal + UI)

1. Ensure the NERV service is running and launch the companion app (`~/Applications/NERV.app`).
   Expected: menu-bar icon appears and opens the panel.
2. Enable notifications in the companion and grant macOS notification permission when prompted.
   Expected: status shows notifications enabled.
3. Trigger a reminder or approval and verify a macOS notification banner arrives without duplicate alerts on refresh.
4. Choose **Quit companion** (`Esci dal companion`), then verify the background service is still running:
   ```zsh
   npm start -- service status
   ```
   Expected: service remains running after quitting the companion.
5. Reopen the companion, test **Launch at login**, and test **Stop NERV** (which prompts confirmation before stopping the background service), then start it again.

## Part 2 — Developer ID signing identity (optional release step, Terminal)

1. List available Developer ID Application identities:
   ```zsh
   security find-identity -v -p codesigning
   ```
2. Follow [native/README.md](../../native/README.md#prepare-a-distribution-build) with the chosen certificate fingerprint to build and staple a distribution archive.
