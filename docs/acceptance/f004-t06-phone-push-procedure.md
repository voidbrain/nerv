# F-004-T06: Phone install and web push acceptance procedure

Goal: install the NERV PWA on a phone over HTTPS, subscribe to web push, and complete a reminder from the phone.

## Prerequisites

- NERV running and reachable over HTTPS (service workers require a secure context; plain LAN HTTP will not register `ngsw-worker.js`).

## Steps (phone + Mac Terminal)

1. Verify the service is running on Neo Tokyo-3:
   ```zsh
   nerv status
   ```
   Expected: service status reports running and listening on port `4317`.
2. Open the HTTPS NERV workspace URL on the phone, install the PWA to the home screen, and open the installed app.
   Expected: app opens in standalone mode without browser chrome.
   To pair the dashboard by QR instead: run `nerv open --phone --qr` on the Mac and scan the QR with the phone's camera. iOS opens a scanned link in Safari, never in the installed app, so Safari shows the code and the steps: Share → Add to Home Screen, open NERV from the Home Screen, type the code (valid 10 minutes).
   Expected: the installed app signs in and stays signed in after a relaunch; Safari never signed in.
3. Enable push notifications and grant notification permission when prompted. iOS asks only after a tap inside the app opened from the Home Screen, never in Safari.
   - Dashboard app: Settings → Notifications → **Enable notifications**, then **Allow**. Expected: the box says "On: this device is subscribed". A Safari tab says to open the Home Screen app instead; "Blocked" means permission was refused: allow it in iPhone Settings → Notifications → NERV and reopen the app.
   - Workspace app: the header push toggle. Expected: the toggle stays enabled and no error alert appears.
   If the dashboard app was added to the Home Screen before this Notifications box existed and the prompt never appears, delete it from the Home Screen and add it again from Safari (Share → Add to Home Screen), then pair it again.
4. Create a reminder due in 1–2 minutes from the workspace (or CLI):
   ```zsh
   nerv remind "Phone push test" "$(date -v+1M +%Y-%m-%dT%H:%M:00%z | sed -E 's/([0-9]{2})([0-9]{2})$/\1:\2/')"
   ```
   Expected: when due, a push notification arrives on the phone; tapping it opens the app it was enabled in (the dashboard app opens the dashboard), where the reminder can be marked done.
   If nothing arrives, `nerv open dashboard` → Health → **Phone push** shows the subscribed devices and the last result (for example `failed (403 BadJwtToken)`); the service log has the same line. The VAPID subject defaults to the project URL; `push.subject` in `config.json` overrides it (an https URL or a mailto with a real domain).
