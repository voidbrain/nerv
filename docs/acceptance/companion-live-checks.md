# Companion live checks: F-081-T01, B-056-T02, B-057-T02

One session on Neo Tokyo-3 with the paired menu-bar companion. Run the Terminal commands in the NERV checkout of the live service. Nothing here prints or stores a token: an invitation stays on screen and is pasted only into the companion. Parts B and C need the companion in English first, then Italian (menu → language).

<a id="part-a"></a>

## Part A — revoke the stale 2026-11-07 client (F-081-T01)

```bash
npm start -- clients
```

Expected: a list of native clients with their creation dates. Note the ID of the client created on 2026-11-07 that is not the companion you use today (the current one was paired on 2026-11-12).

```bash
npm start -- revoke CLIENT_ID
npm start -- clients
```

Expected: the second list no longer shows that client. In the companion choose **Refresh status**: it still shows the service as running.

<a id="part-b"></a>

## Part B — a refused renewal names its reason (B-056-T02)

1. In the companion open **Renew pairing**, type `not-an-invitation` in the field and choose **Renew pairing**.
   Expected: a message saying the invitation is not valid and that the current pairing is unchanged.
2. In Terminal, create an invitation and wait until it expires (two minutes):

   ```bash
   npm start -- pair
   ```

   After two minutes, paste it into **Renew pairing** and choose **Renew pairing**.
   Expected: a message saying the invitation expired and that the current pairing is unchanged.
3. Close and reopen **Renew pairing**. Expected: the field is empty.
4. Switch the companion to Italian and repeat steps 1–2. Expected: the same two messages in Italian.

<a id="part-c"></a>

## Part C — revoked credential and stopped service (B-057-T02)

Revoking the companion's own credential ends its pairing; step 3 pairs it again.

1. ```bash
   npm start -- clients
   npm start -- revoke CLIENT_ID   # the companion's current client
   ```
   In the companion choose **Refresh status**. Expected: a message saying the pairing was revoked or expired and to pair again, not a generic "unavailable".
2. ```bash
   npm start -- service stop
   ```
   Choose **Refresh status**. Expected: a message saying NERV is not reachable. Then:
   ```bash
   npm start -- service start
   ```
3. Pair again: run `npm start -- pair`, paste the invitation into the companion and choose **Abbina NERV** / **Pair**. Expected: status shows the service as running.
4. Switch to Italian and repeat steps 1–3. Expected: the same messages in Italian.

<a id="part-d"></a>

## Part D — changed certificate and stopped-profile recovery (B-057-T02, F-081-T01)

Follow [Recover a changed, expired or compromised native certificate](../../native/README.md#recover-a-changed-expired-or-compromised-native-certificate) on Neo Tokyo-3, steps 1–3: stop the service and the companion, back up the data home, move only the native TLS/auth set aside, run `npm start -- native-init`, start the service.

1. Start the companion **before** pairing again and choose **Refresh status**.
   Expected: a message saying the service's certificate no longer matches the pairing and that nothing was sent.
2. Then step 4 of the README: `npm start -- pair`, forget the local pairing in the companion, paste the new invitation.
   Expected: status shows the service running; your reminders and inbox are unchanged (the recovery keeps the data); `npm start -- clients` lists only the new client.

## Report

Tell the agent which parts passed. It records the evidence in B-056, B-057 and F-081 and closes the steps.
