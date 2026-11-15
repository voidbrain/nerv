# App Workflows: Scripted First, Menus Second (`F-094-T01`)

Status: Architecture decision (`2026-11-15`). Scope: `F-094` (depends on `F-093` for menu fallback).

## 1. Execution Tier Order (Scripted First, Menus Second)

1. **CLI / Headless Converter (preferred when available)**:
   - Use documented, non-interactive app or OS command-line tools when the task is file open/convert/save (for example, `soffice --headless --convert-to`, `textutil`, `sips`, or app-provided CLI flags).
   - Avoids GUI focus races and screen-state fragility.
2. **App Scripting Interface (AppleScript / JXA on macOS)**:
   - For macOS apps with an explicit Scripting Dictionary (`sdef`)—such as `TextEdit`, `Pages`, `Numbers`, `Keynote`, `Preview`, or `Finder`—drive `open`, `export`, and `save ... in` via bounded `osascript` templates.
   - Only fixed, parameterized templates are allowed (no arbitrary user/document-derived script interpolation).
3. **Menu-by-Name Fallback via `F-093`**:
   - For apps without a usable CLI or scripting dictionary, drive `AXMenuBar` items by accessible name and role (`File` -> `Open...`, `Save As...`, `Export...`) through the `F-093` desktop adapter.
   - Never fall back to blind screen coordinates without `F-093` rules.

## 2. Step Read-Back, Approval Card, and Overwrite Guard

- **Single Orange approval card**: The complete multi-step plan (app, input path, output path, tier) is presented on one Orange approval card before execution starts. Any step or dialog outside the approved plan halts the job immediately.
- **Read-back after every step**: After each step (open, menu selection, save), NERV reads back the active window/document state (and target file existence/mtime) before advancing to the next step.
- **No silent overwrite**: `Save As` / `Export` checks whether the destination path already exists; if it exists, NERV refuses to overwrite without explicit owner confirmation.

## 3. Allowed Folders

- Both input (`open`) and output (`save as`) paths must resolve inside owner-configured **allowed folders** (after realpath/symlink resolution).
- Paths outside allowed folders, or inside system/credential directories, are rejected before any app is launched or scripted.
