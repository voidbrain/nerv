# Gmail connector owner check

Use the owner's test message to themself; do not paste credentials, message contents or addresses into the repository.

Runs in a Terminal on the owner's Mac (NERV-01), after NERV has updated to a version with the Gmail connect command: `nerv help gmail` prints `nerv gmail connect [--compose] [--client-file FILE] | status | disconnect`.

0. Once, in [Google Cloud Console](https://console.cloud.google.com/) with the owner's account: create a project, enable the **Gmail API**, set up the OAuth consent screen (External, Testing, the owner's address as the only test user), then create an **OAuth client ID** of type **Desktop app** and download its JSON. Expected: a `client_secret_….json` file in `~/Downloads`. It holds the client secret: never copy it into the repository.
1. Connect read-only (the [connector decision](../decisions/gmail-connector.md), phase 1):

   ```bash
   nerv gmail status
   nerv gmail connect --client-file ~/Downloads/client_secret_*.json
   ```

   Expected: `Gmail not connected. The owner connects it on this Mac with: nerv gmail connect`, then `Open this address in the browser on this Mac and allow read-only access:` and a `https://accounts.google.com/…` address. Open it, choose the owner's account and allow; the tab says `Gmail is connecting to NERV…`. The Terminal then prints `Gmail connected: read-only, since <date and time>. Scopes: https://www.googleapis.com/auth/gmail.readonly. The credential is in /Users/<you>/.nerv (mode 600); no secret was printed.` and offers to delete the downloaded file. Then:

   ```bash
   rm ~/Downloads/client_secret_*.json
   ls -l ~/.nerv/gmail-credentials.json
   git -C ~/Projects/NERV/NERV status --short
   ```

   Expected: `-rw-------` on the credential file, and no new file in the repository: the credential remains outside Git and logs.
2. Ask NERV to search for the test message. Expected: results are treated as tainted content and no message text becomes an instruction.
3. Allow drafting and sending (phase 2, the owner's opt-in; it reuses the stored client): `nerv gmail connect --compose`, then allow in the browser. Expected: `Gmail connected: read, draft and send (drafts need an Orange approval, sending a Blue one), since <date and time>. Scopes: https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose. …`. Then ask for a reply draft to the same account. Expected: an approval card appears (Orange; Blue when the same request first read mail, since mail is outside data) and no draft is created before approval.
4. Approve the draft, inspect it, then request send. Expected: sending requires a separate Blue owner approval; expiry or rejection sends nothing.
5. Approve send. Expected: NERV reads back the sent-message identity and reports success without exposing credentials.

To undo: `nerv gmail disconnect` removes the credential and asks Google to revoke it (`Gmail disconnected: the credential was removed and Google revoked it.`).

Record pass/fail and the date in F-086; keep mailbox data private.
