# Desktop Control Adapter and Permissions Decision (`F-093-T01`)

Status: Architecture decision (`2026-11-15`). Scope: `F-093` (macOS primary; Windows UI Automation for Tabgha).

## 1. Accessibility Interface per OS

- **macOS (primary)**: Use the macOS Accessibility API (`AXUIElement`) to enumerate the target application (`AXApplication`), window (`AXWindow`), and control (`AXRole`, `AXTitle` / `AXDescription` / `AXIdentifier`), and trigger `AXPress` (or focused click at the resolved element's frame).
- **Windows (Tabgha)**: Use Windows UI Automation (`IUIAutomation`) to resolve `(process/app, window, Name, ControlType)` and invoke `InvokePattern` (or bounded UIA-resolved coordinates).
- **Name-and-role first**: Controls are located by `(app, window, accessibleName, role)` so window movement or resizing does not break targeting.

## 2. Screenshot Fallback

- Screenshot-based targeting is a **fallback only** when the accessibility tree cannot resolve the named control.
- Taking or inspecting a screenshot of the owner's desktop requires **explicit owner approval** before capture; NERV never captures ambient screenshots silently.
- Screenshots remain local to the base unless explicitly approved otherwise, and are never committed to Git.

## 3. Owner-Granted Permissions

- **macOS**: The owner explicitly grants **Accessibility** (`AXIsProcessTrustedWithOptions` checked with `kAXTrustedCheckOptionPrompt: false`) in System Settings -> Privacy & Security -> Accessibility. NERV never prompts silently or attempts to modify TCC state.
- **Windows**: Runs strictly within the owner's active desktop session under standard UIA privileges (no UAC elevation bypass).
- **Action classification and read-back**: A single control click is gated as an **Orange** action. After clicking, NERV re-queries the target window via the accessibility interface and reports the observed state change.

## 4. What Is Always Refused

- **Password and credential inputs**: `AXSecureTextField`, UIA `IsPassword == true`, Keychain / credential / 2FA prompts.
- **System permission and elevation dialogs**: macOS TCC / SecurityAgent / sudo prompts, Windows UAC / SmartScreen / OS settings permission dialogs.
- **Payment and irreversible purchase buttons**: Controls matching payment, checkout, buy, or transfer confirmation patterns.
- **Prompt injection defense**: Screen and accessibility text is strictly untrusted observation data—never parsed or executed as an agent instruction.

## 5. Live binding on macOS

- `nerv desktop-click <app> <control> [--window=<title>] --approved` runs the click adapter with the macOS driver (`src/desktop-macos-driver.ts`). It calls a small JXA helper, `native/desktop-ax.js`, through `osascript`: `AXIsProcessTrusted` (no prompt) for the permission check, System Events for the window tree and `AXPress`.
- Without the grant the command stops and says where to grant it: System Settings -> Privacy & Security -> Accessibility, for the app that runs `nerv` (the terminal for the CLI, `node` for the service). The first window read asks once for Automation consent to control System Events; the owner answers it.
- Other platforms get a driver that refuses with the reason until Windows UI Automation is bound.
