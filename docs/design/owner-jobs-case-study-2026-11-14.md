# Owner jobs: a case study and scope (2026-11-14)

Fourteen jobs the owner wants NERV to do, collected on 2026-11-14 as a case study. They are examples, not a complete list; they set the scope against which features are judged ("does this get one of these jobs done?"). Personal details are made generic here because the repository is public.

This is an assessment, not a decision: each job maps to the record that owns it. What ships is in the [roadmap](../ROADMAP.md) and the [backlog](../BACKLOG.md).

## The jobs

| # | Job (as the owner would say it) | Owning record | Gate (proposed) |
|---|---|---|---|
| 1 | "Add milk, pasta and cheese to the shopping list" by chat, Telegram or voice; asking for the list shows a card with checkboxes | [F-082](../work/records/F-082.md); voice in [F-007](../work/records/F-007.md) | Green: own list, reversible |
| 2 | "Show the recipe from my private category, and work out the quantity of the main ingredient for a given batch and device setting" | [F-083](../work/records/F-083.md) | Green: read and compute only |
| 3 | "Open this project folder, refactor this function, open a PR on GitHub" | [F-084](../work/records/F-084.md) | Orange: push and PR are outward-facing |
| 4 | "Check that project" (a web URL or a GitHub repository) | [F-085](../work/records/F-085.md) | Green read, content quarantined |
| 5 | Gmail: search and read, draft and send | [F-086](../work/records/F-086.md) | Read Green (tainted); send Blue |
| 6 | "Print that STL with PLA settings": the vendor app on the Windows base takes the job; the owner presses Print | [F-087](../work/records/F-087.md) | Orange hand-off; the print itself stays the owner's |
| 7 | On a storage base (a NAS that runs containers): when a card with a known label is inserted, copy its files from a source folder to a folder for that label | [F-088](../work/records/F-088.md) | Orange once to approve the rule, then runs under it |
| 8 | "Click the skip button" on a page open in the browser | [F-089](../work/records/F-089.md) | Orange |
| 9 | In VS Code, a coding agent stopped at its time limit: at the reset time, type "continue" and send it | [F-012](../work/records/F-012.md) | Orange, once, identity rechecked |
| 10 | The same without VS Code: continue the interrupted coding work directly | [F-090](../work/records/F-090.md) | Orange |
| 11 | "Apply the harness to this project" | [F-091](../work/records/F-091.md) | Orange (it is a coding job, job 3) |
| 12 | "Record my mouse movements and replay them" | [F-092](../work/records/F-092.md) | Blue: replay acts on the desktop |
| 13 | "That app is on screen, click the button" | [F-093](../work/records/F-093.md) | Orange |
| 14 | "Open the app, open the file, save as …" | [F-094](../work/records/F-094.md) | Orange, one card for the whole plan |

## What NERV has today

- **Chat and channels:** CLI, dashboard chat and Telegram reach Misato, who plans one step at a time; every action passes the gate. Approval cards exist on the dashboard, in Telegram and in the companion ([memory and chat](../guides/memory-and-chat.md)).
- **Memory:** Lilith keeps one-line facts the owner approved. It is not a store for lists or documents, so jobs 1 and 2 need a new store.
- **Tools:** MCP servers, deny-by-default, read tools grantable as Green ([F-021](../work/records/F-021.md)); writes behind approval cards are F-021's next slice.
- **Bases and workers:** several bases over the Kaji line and enrolled workers ([F-005](../work/records/F-005.md)); whole-job forwarding to the base that has the device is [F-050](../work/records/F-050.md).
- **Not yet:** a sandbox per job ([F-049](../work/records/F-049.md)), coding workers ([F-006](../work/records/F-006.md)), provenance and taint ([F-027](../work/records/F-027.md)), voice ([F-007](../work/records/F-007.md)), and any browser or desktop control ([F-012](../work/records/F-012.md)).

## Building blocks the jobs share

Each job is small on its own; most of the cost is in a few shared parts. Building these once serves several jobs.

| Building block | Jobs | Where it lives |
|---|---|---|
| A store for lists and saved documents, with categories, local-only by default | 1, 2 | F-082, F-083 |
| Interactive cards with validated data (checklist, recipe), on the dashboard, in Telegram and in the PWA | 1, 2 | F-082, F-083 on top of [F-004](../work/records/F-004.md) |
| A coding job: a repository, a fresh worktree in a sandbox, a coding agent, tests, a PR behind approval; the rules' token load measured against the model's context, long work split into fresh sessions | 3, 10, 11 | F-084, then F-090 and F-091; sandbox F-049 |
| Untrusted content kept apart: what a page, repository or e-mail says never becomes an instruction | 4, 5 | F-085, F-086 with F-027 and EVA-03 (F-049) |
| Connectors with owner credentials, read first, writes behind approval | 5 | F-086 with F-021 and [F-066](../work/records/F-066.md) |
| Physical effects: a device acts only after the owner confirms; NERV reads back the state where it can, and never claims what it cannot see | 6, 12 | F-087, F-092 |
| Device events on a base trigger a rule the owner approved once | 7 | F-088 with F-005 and F-050 |
| Browser and desktop control with a narrow adapter and host permission; on the desktop, controls found by accessible name, not screen position | 8, 9, 12, 13, 14 | F-089, F-093 (shared by F-012, F-092, F-094) |

## Limits that apply to every job

- **The gate decides, not the job.** A job never lowers its own gate class. Blue always reaches the owner, and an expired approval never approves.
- **No invented values.** Job 2 computes only from values the owner saved and shows the working; when a value is missing it asks. NERV adds no quantity or advice of its own.
- **Untrusted input stays data.** A web page, repository, e-mail or file never changes NERV's instructions or permissions (F-027).
- **Physical and desktop actions are confirmed and read back.** A print, a replayed macro or a click on a page happens once, after the owner confirms, and NERV reports what it observed afterwards, not what it intended.
- **Local data stays local.** Lists, saved documents and recordings stay on the base unless the owner marks them shareable, like Lilith facts.
- **Test data is invented.** Tests and examples use neutral data, never the owner's lists, recipes, mail or recordings.

## How to use this page

When a record's scope or acceptance is in doubt, check it against the job it serves here. A new owner job joins the table with its owning record; a job that turns out to need a different design gets an architecture reassessment, not a silent change of scope.
