# 3D Printing: Slicer, Bambu Connect Hand-Off & Base (F-087-T01)

Date: 2026-11-15  
Status: Accepted (decision for F-087)

## 1. Base & Slicer CLI

- **Target base**: `NERV-02` (Tabgha, Windows 11), where Bambu Connect is installed and signed in, dispatched via `F-050` whole-job handoff.
- **Slicer CLI & profiles**: Use Bambu Studio / OrcaSlicer CLI (`--slice 0 --load-settings <machineProfile> --load-filaments <materialProfile> --export-3mf <out.gcode.3mf> <input.stl>`).
  - Material and machine profiles must match the base's explicit allowlist; any unknown profile is **refused** before slicing.
  - Slicer output reports estimated print time and filament mass/length from the sliced `.gcode.3mf` metadata.

## 2. Bambu Connect Hand-Off & Developer Mode Choice

- **Owner approval**: Opening Bambu Connect is always the owner's approval card (Blue, an `owner` tool in code), whatever Casper or the Scrolls say (owner decision 2026-11-24, F-121; it was Orange in F-087-T03). A test never opens the real app: the default launcher refuses under the test runner.
- **Import link**: Hand off the sliced `.gcode.3mf` via `bambu-connect://import-file?path=<urlEncodedLocalPath>`, accompanied by an owner pre-print checklist (printer, build plate, nozzle, filament/AMS slot mapping, clear plate, someone nearby for first layer).
- **Why Developer Mode is not used**: Enabling firmware Developer Mode forces LAN-only mode and disconnects the printer from Bambu Cloud / Bambu Handy / Bambu Connect. Without Developer Mode, NERV prepares and hands off the sliced file cleanly while the owner presses Print in Bambu Connect. NERV **never** reports a print as started, because it cannot observe printer state.

## 3. Part Files from the Mac (F-121-T04)

- The part library stays on the Mac (`~/.nerv/prints`). A print request there resolves and hashes the part; the coordinator sends the slice request to the slicing base over the Kaji line (`POST /kaji/print`, signed both ways) and sends the file itself (base64, up to 64 MB) only when that base does not hold a copy with the same SHA-256.
- Tabgha verifies sender, size and hash before writing, writes only `%USERPROFILE%\.nerv\prints-cache\<sha256>.<ext>`, slices with its own allowlist into `prints-out`, and returns the time, grams and its own output path. The Mac's reply proposes `kaji.run` on Tabgha with `bambu.handoff`, so the owner card opens Bambu Connect where it is installed.
- Configuration: on the Mac `"prints": {"slicer": "NERV-02"}`; on Tabgha `"prints": {"accept": ["NERV-01"]}` and `bambu.handoff` in its `kaji offer` list. Without `prints.slicer` the base holding the library slices locally.

## 4. Opening Bambu Connect from the Tabgha Background Service

- **Interactive session boundary**: The NERV Windows service runs in Session 0 (non-interactive, no desktop window). Launching a `bambu-connect://` URI directly from Session 0 cannot show a window on the owner's desktop.
- **Session hand-off**: A lightweight per-user interactive helper (registered in the owner's Windows logon / scheduled task running in the active interactive session, polling or receiving the hand-off over a local user-ACL pipe/file) invokes `ShellExecute` / `Start-Process` for `bambu-connect://import-file?...` inside the owner's logged-in desktop session.
- **When nobody is logged in**: If no interactive user session is active on Tabgha, NERV keeps the sliced `.gcode.3mf` and import link staged, does **not** discard the job or pretend Bambu Connect opened, and replies on the owner channel that the slice is ready on `NERV-02` and waiting for an active desktop login to open Bambu Connect.
