# NERV Agency area notes

Binding area rules and lessons. Read the matching area guide before editing:

| Area | Covers | Guide |
|---|---|---|
| **Local core** | Persistence, reminders, API, doctor, action gate, ledger, context provenance, watches | [areas/local-core.md](areas/local-core.md) |
| **Frontend** | Angular surfaces, style guide, headless install, native companion & notifications | [areas/frontend.md](areas/frontend.md) |
| **Distributed contracts** | Kaji line, remote workers, model routes, pilots, isolated runtime & IPC | [areas/distributed.md](areas/distributed.md) |

## Cross-cutting invariants

- Never expose arbitrary SQL, shell execution, credentials, or unregistered tools through chat or UI.
- Never fall back to cloud inference for local-only input, and never bypass the Scrolls gate (`Ledger.propose` / `Ledger.authorize`).
- Keep `src/` framework-free TypeScript; read [docs/STYLE-GUIDE.md](../STYLE-GUIDE.md) before UI changes and [docs/INSTALL.md](../INSTALL.md) before service lifecycle changes.
