# F-004-T06: Phone install and web push acceptance procedure

Goal: install the NERV PWA on a phone over HTTPS, subscribe to web push, and complete a reminder from the phone.

## Prerequisites

- NERV running and reachable over HTTPS (service workers require a secure context; plain LAN HTTP will not register `ngsw-worker.js`).

## Steps (phone + Mac Terminal)

1. Verify the service is running on Neo Tokyo-3:
   ```zsh
   npm start -- status
   ```
   Expected: service status reports running and listening on port `4317`.
2. Open the HTTPS NERV workspace URL on the phone, install the PWA to the home screen, and open the installed app.
   Expected: app opens in standalone mode without browser chrome.
3. Enable push notifications in the workspace header toggle and grant notification permission when prompted.
   Expected: toggle stays enabled and no error alert appears.
4. Create a reminder due in 1–2 minutes from the workspace (or CLI):
   ```zsh
   npm start -- remind "Phone push test" "in 1 minute"
   ```
   Expected: when due, a push notification arrives on the phone; tapping it opens the PWA where the reminder can be marked done.
