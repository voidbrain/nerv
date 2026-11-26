# Desktop Input Recording and Replay Feasibility (`F-092-T01`)

Status: Feasibility decision (`2026-11-15`). Scope: macOS host (`F-092`).

## 1. Permissions (Owner-Granted Only)

- **macOS TCC permissions required**:
  - **Accessibility** (`AXIsProcessTrusted()`): required to inspect the frontmost application/window metadata (`NSWorkspace` / AXUIElement) and to post synthetic input events (`CGEventPost`).
  - **Input Monitoring** (`CGPreflightListenEventAccess()`): required to observe owner mouse and keyboard events via `CGEventTapCreate` during recording and to detect owner interrupt input during replay.
- **Never requested silently**: NERV must check preflight status (`AXIsProcessTrustedWithOptions` with `kAXTrustedCheckOptionPrompt: false` and `CGPreflightListenEventAccess()`). If either permission is missing, NERV refuses the action and tells the owner which System Settings pane to enable. It never triggers silent prompts, background TCC modifications, or privilege escalation.

## 2. Recording Format and Bounds

- **Local-only storage**: Recordings are written only to the local NERV data directory (e.g., `recordings/<id>.json`), never sent to remote inference providers and never committed to Git.
- **Start / stop and hard bounds**: Recording starts and stops only on explicit owner command, with a hard ceiling on duration (default max 120 s) and event count (default max 10,000 events) so runaway captures cannot fill disk.
- **Schema**:
  - **Header**: `version`, `recordedAt`, `displayBounds` (`width`, `height`, `scaleFactor`), `frontmostApp` (`bundleId`, `appName`, `windowTitle`, `windowFrame`).
  - **Events**: Ordered array of `{ dtMs, kind, x?, y?, button?, deltaX?, deltaY?, keyCode?, modifiers? }` where `kind` is one of `mouseMove`, `mouseDown`, `mouseUp`, `scroll`, `keyDown`, `keyUp`.

## 3. Replay Preconditions and Interrupt Handling

- **Blue gate**: Replay acts on the live desktop and is always gated as a Blue physical action requiring explicit owner approval/trigger.
- **Preconditions checked before replay**:
  1. Accessibility and Input Monitoring permissions are present.
  2. Active display resolution and `scaleFactor` match the recording header's `displayBounds`.
  3. Frontmost application (`bundleId`, and `windowTitle` / `windowFrame` when present) matches the recording header's `frontmostApp`.
- **Fail-closed during replay**:
  - Check frontmost app and display bounds continuously; halt immediately on the first mismatch.
  - Listen for any physical owner mouse/keyboard input via `CGEventTap`; halt immediately on any owner interrupt.
  - Always emit a post-replay summary reporting how many events were replayed, whether replay completed or halted early (and why), and the observed post-replay frontmost app/window state.

## 4. What Is Never Recorded

- **Passwords and Secure Input**: Whenever macOS Secure Input (`IsSecureEventInputEnabled()`) is active, the focused element role is `AXSecureTextField`, or the frontmost app is a password manager / Keychain / system auth prompt, keyboard events and characters are **never** recorded (and recording pauses or redacts key events).
- **No ambient screen or clipboard capture**: Recording captures only the bounded input event stream and header metadata—never background screenshots, video, audio, or clipboard contents.
- **No off-host exfiltration**: Raw input traces stay strictly on the local base.

## 5. Service Binding (`F-092-T05`, 2026-11-26)

The owner approved a live-binding agent step in chat on 2026-11-26 ("A. Approve an agent step that wires up the driver"). The service now builds the macOS driver (`liveDesktopControl()` in `src/desktop-macos-driver.ts`, `src/desktop-service.ts`), narrowing this decision where noted:

- **Permission**: only Accessibility, granted by the owner to the service's own `node` binary (`process.execPath`, the first `ProgramArguments` entry of the launchd plist). `nerv doctor` and every desktop tool say `desktop control not available: grant Accessibility to <binary> …` without it. Input Monitoring is not needed, because recording polls the pointer instead of tapping events.
- **Mouse only**: `desktop.record` polls pointer position and left/right buttons (`native/desktop-ax.js record`); it never reads the keyboard, so no keystroke is recorded, replayed or logged. A recording lasts 1 to 60 seconds, holds at most 10,000 events and is written with mode 600 to `recordings/<id>.json` in the data home; an existing name is never overwritten. Its result carries counts, app, window and display, never pointer coordinates.
- **Gate**: both tools are owner tools (Pattern Blue): recording starts and replay runs only after the owner approves its card, 3 seconds after approval so the owner can bring the window to the front. The planner proposes a replay by name only; before the gate the proposal is bound to the file's SHA-256, app, window, display and length, which the card shows and the grant's argument hash binds. A file that changed since the card, or holds any non-mouse event, is refused.
- **Window only**: a recording with any event outside the recorded window's frame (4 px margin) is refused, and a replay stops when the window moves, resizes or loses focus, so replayed clicks never reach the Dock, the menu bar or another app. The replay result names the app and window before and after, without frames; the read-back window text taints the sortie.
- **Service only**: only the service's nervous process holds the live control; any other process (a CLI `nerv approve`, which macOS would credit to the terminal) refuses with "it runs only in the NERV service". The permission, display, front-window and read-back reads are short synchronous helper calls in the scheduler process (the click adapter's pattern); recording and the replay's event stream are asynchronous.
- **Replay**: one long-lived helper process (`desktop-ax.js session`) posts the events, paced as recorded, and answers the front-window and owner-input checks (pointer moved away from the last posted position, a button the replay did not press, or any key pressed since the start). The replay stops on the first mismatch, releases any button it holds, ends after 90 seconds at most, and taints the sortie with the read-back window text. A recording is never overwritten: the file is created exclusively.
