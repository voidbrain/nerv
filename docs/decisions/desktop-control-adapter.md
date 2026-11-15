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
