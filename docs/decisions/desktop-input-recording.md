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
