# F-093-T04: desktop click on a real app

Date: 2026-11-23  
Operator: the owner, on NERV-01 (macOS), with the owner's Accessibility grant  
Source: `main` after [PR #683](https://github.com/voidbrain/nerv/pull/683) (F-093-T05, macOS accessibility driver)

## What was run

On NERV-01, with Calculator open and visible:

```sh
nerv desktop-click Calculator "Show Sidebar" --approved
nerv desktop-click Calculator "Hide Sidebar" --approved
```

## Result

- `Show Sidebar` opened Calculator's sidebar; `Hide Sidebar` closed it. Both clicks went through the Accessibility interface (System Events window tree and `AXPress`), found by app and accessible name.
- Passed.

## Known limitation

This Calculator build exposes its digit keys without accessible names, so the named-control driver cannot press them: a control with no name cannot be targeted by name. A later step could match on the accessibility description or identifier instead; none is planned yet.

Nothing from the owner's screen is stored here.
