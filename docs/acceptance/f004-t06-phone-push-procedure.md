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

## Push first, Telegram as fallback (F-004-T10)

Checks F-004-T09 on the phone once it is deployed: a reminder goes to the phone first and reaches Telegram only when the push fails, no device is subscribed, or it is not opened (tapped) on the phone within 10 minutes. Needs the dashboard app with notifications on (step 3 above) and Telegram linked. Approvals, replies and chat stay on Telegram.

1. A reminder tapped in time never reaches Telegram. On the Mac:
   ```zsh
   nerv remind "Push first A" "$(date -v+1M +%Y-%m-%dT%H:%M:00%z | sed -E 's/([0-9]{2})([0-9]{2})$/\1:\2/')"
   ```
   Expected: the notification arrives on the phone and nothing on Telegram. Tap it within 10 minutes (the dashboard opens) and mark "Push first A" done there (this was F-004-T06's last check). Reading it on the lock screen without tapping does not count: Telegram would send it at the deadline. Wait 12 minutes after it was due: still nothing about "Push first A" on Telegram.
2. A reminder left alone reaches Telegram once, at the deadline:
   ```zsh
   nerv remind "Push first B" "$(date -v+1M +%Y-%m-%dT%H:%M:00%z | sed -E 's/([0-9]{2})([0-9]{2})$/\1:\2/')"
   ```
   Expected: the notification arrives on the phone; do not tap it. About 10 minutes after it was due, Telegram shows `⏰ … Push first B` once. Tapping the notification afterwards sends nothing more.
3. Read what both channels recorded (read-only):
   ```zsh
   sqlite3 -readonly ~/.nerv/nerv.sqlite "SELECT substr(d.message,1,40), c.channel, c.sent_at, c.failed_at, c.opened_at, c.reason FROM delivery_channels c JOIN deliveries d ON d.id=c.delivery_id WHERE d.message LIKE '%Push first%' ORDER BY d.rowid, c.channel;"
   ```
   Expected: `Push first A` has one `push` row with `sent_at` and `opened_at`, and no `telegram` row; `Push first B` has a `push` row with `sent_at` (and `opened_at` if you tapped it later) and a `telegram` row with `sent_at`.
4. Push off goes straight to Telegram. **Turn off** removes only the device you tap it on, so turn notifications off on every device that has them (the dashboard app: Settings → Notifications → **Turn off**; the workspace app: the header push toggle). Then check none is left and add the reminder:
   ```zsh
   sqlite3 -readonly ~/.nerv/nerv.sqlite 'SELECT count(*) FROM push_subscriptions;'
   ```
   Expected: `0`. Then:
   ```zsh
   nerv remind "Push first C" "$(date -v+1M +%Y-%m-%dT%H:%M:00%z | sed -E 's/([0-9]{2})([0-9]{2})$/\1:\2/')"
   ```
   Expected: Telegram shows `Push first C` when it falls due, with no wait; no notification on the phone. Turn notifications back on afterwards on each device (Settings → Notifications → **Enable notifications**).

Record the result (pass, or which step differed and what was seen) in [F-004](../work/records/F-004.md).

## Read in the app, not tapped (B-149-T03)

Checks B-149 on the phone once it is deployed, in the same sitting as the steps above: a reminder the owner reads in the app, without tapping the notification, never reaches Telegram. The workspace app (NERV at `/`, not `/dashboard/`) shows delivered reminders in its **Inbox** panel; the dashboard shows only the latest brief, which counts as read once its box is opened.

1. On the Mac:
   ```zsh
   nerv remind "Read in app D" "$(date -v+1M +%Y-%m-%dT%H:%M:00%z | sed -E 's/([0-9]{2})([0-9]{2})$/\1:\2/')"
   ```
   Expected: the notification arrives on the phone. Do not tap it. Within 10 minutes, open the workspace app from the Home Screen, stay on **Overview** (tap **Refresh** if needed) and scroll down until "Read in app D" is on screen in the **Inbox** panel (a row counts as read only once it is on screen).
2. Check it was recorded as read (read-only):
   ```zsh
   sqlite3 -readonly ~/.nerv/nerv.sqlite "SELECT substr(message,1,40), read_at FROM deliveries WHERE message LIKE '%Read in app D%';"
   ```
   Expected: one row with a `read_at` time a little after you opened the app.
3. Wait until 12 minutes after it was due. Expected: nothing about "Read in app D" on Telegram. Then:
   ```zsh
   sqlite3 -readonly ~/.nerv/nerv.sqlite "SELECT c.channel, c.sent_at, c.opened_at FROM delivery_channels c JOIN deliveries d ON d.id=c.delivery_id WHERE d.message LIKE '%Read in app D%' ORDER BY c.channel;"
   ```
   Expected: one `push` row with `sent_at` and an empty `opened_at`, and no `telegram` row.

Record the result (pass, or which step differed and what was seen) in [B-149](../work/records/B-149.md).
