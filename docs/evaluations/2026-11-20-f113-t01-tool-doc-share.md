# F-113-T01: Planner prompt tool-doc share and subject grouping

Measured on 2026-11-20 using `misatoAsk` and `measureMisatoPrompt` (`promptMetrics`) against the full built-in `toolDocs` catalogue (42 documented tools; 43 built-in tools total including `kaji.run`).

## Verdict

A compact subject index is worth building: across neutral sample requests on both `local` and `cloud` routes, full built-in tool docs consume **2,461 tokens** out of **3,820–3,847 prompt tokens** (**63.97%–64.43%** of the planner prompt).

## Neutral sample promptMetrics

| Sample | Route | `promptTokens` | `toolSchemaTokens` | `toolSchemaShare` |
|---|---|---:|---:|---:|
| `short-greeting` | `local` | 3820 | 2461 | 0.6443 |
| `short-greeting` | `cloud` | 3820 | 2461 | 0.6443 |
| `reminder-set` | `local` | 3828 | 2461 | 0.6430 |
| `reminder-set` | `cloud` | 3828 | 2461 | 0.6430 |
| `recipe-scale` | `local` | 3826 | 2461 | 0.6432 |
| `recipe-scale` | `cloud` | 3826 | 2461 | 0.6432 |
| `agency-status` | `local` | 3826 | 2461 | 0.6433 |
| `agency-status` | `cloud` | 3826 | 2461 | 0.6433 |
| `with-memory-and-history` | `local` | 3847 | 2461 | 0.6397 |
| `with-memory-and-history` | `cloud` | 3844 | 2461 | 0.6403 |

## Built-in tools grouped by subject (43 tools, 11 subjects)

Defined in `BUILTIN_TOOL_SUBJECTS` and attached to every entry in `toolDocs` in `src/executors.ts`:

| Subject | Count | Tools |
|---|---:|---|
| `reminders` | 5 | `reminders.list`, `reminders.add`, `reminders.update`, `reminders.cancel`, `reminders.restore` |
| `memory` | 4 | `memory.recall`, `memory.remember`, `memory.edit`, `memory.forget` |
| `lists` | 4 | `lists.add_items`, `lists.show`, `lists.set_done`, `lists.remove_item` |
| `docs` | 6 | `docs.list`, `docs.show`, `docs.compute`, `docs.save`, `docs.edit`, `docs.forget` |
| `gmail` | 2 | `gmail.search`, `gmail.read` |
| `pantry` | 3 | `pantry.purchase`, `pantry.shelf_life`, `pantry.check` |
| `batteries` | 4 | `batteries.list`, `batteries.chat`, `batteries.due`, `batteries.resistance` |
| `fleet` | 1 | `fleet.chat` |
| `fpv` | 4 | `fpv.blackbox_report`, `fpv.import_build`, `fpv.add_doc`, `fpv.wiring_answer` |
| `pilots` | 5 | `pilots.create`, `pilots.promote`, `pilots.split`, `pilots.merge`, `pilots.tools` |
| `agency` | 5 | `sorties.explain`, `approvals.list`, `agency.status`, `settings.schedule`, `kaji.run` |
