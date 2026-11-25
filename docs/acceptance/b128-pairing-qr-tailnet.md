# B-128: the Settings pairing QR opens on the phone

Owner steps for [B-128](https://github.com/voidbrain/nerv/blob/backlog-views/docs/BACKLOG.md#b-128) (step B-128-T02). Run the commands in a Terminal on the owner's Mac (NERV-01); scan with the iPhone on the same tailnet.

## 1. The installed service has the fix

```bash
git -C ~/.nerv-app merge-base --is-ancestor ccf8adf5 HEAD && echo included
```

Expected: `included`. Otherwise run `nerv update` once and repeat this step.

## 2. Open Settings → Pair a device on the Mac

```bash
nerv open dashboard
```

The dashboard opens at `http://127.0.0.1:4317/dashboard/`. Open **Settings → Pair a device**.

Expected: a QR code, and under it "The QR opens NAME.TAILNET.ts.net, this Mac's address for the phone." (your Mac's tailnet name), not a warning that the phone cannot open it.

If it instead says "which a phone cannot open" with a hint, the Mac has no tailnet address for the service. Run the hint's command, for example:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 4317
```

then close and reopen Pair a device. Note the hint's text in the record either way.

## 3. Scan it with the phone

Point the iPhone camera at the QR and tap the link.

Expected: Safari opens `https://NAME.TAILNET.ts.net/dashboard/` (with a port after the name when the service is not served on 443) and shows the pairing code with the steps (Share → Add to Home Screen, open NERV from the Home Screen, type the code). Pairing itself is F-118's check; for B-128 seeing the code is enough.

Tell the agent the note's text from step 2 and what the phone showed in step 3; it records the evidence in B-128 and closes it.
