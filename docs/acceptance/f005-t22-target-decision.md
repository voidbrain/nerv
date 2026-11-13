# F-005-T22: where to show the prerequisite checks (decision)

**Question:** on which machine should NERV demonstrate that it checks its prerequisites (supported Node version, the executable, a non-interactive service environment) before install, start or update, reports what is missing, and offers to manage an engine such as Ollama without replacing one you manage yourself?

| Option | What it shows | Cost |
|---|---|---|
| **Linux VM on the Mac** (recommended) | A fresh machine, so missing or wrong prerequisites are real; the same VM serves F-009-T03 and F-005-T26 | Set up the VM once |
| **Tabgha** | A second real platform (Windows) | Everything is already installed, so only the "all present" path shows; Tabgha also carries F-005-T24 |
| **Neo Tokyo-3** | The machine you use most | Everything present; the live service runs here, so prerequisite changes touch it |

**Why the VM:** a check that only ever sees a complete machine is not demonstrated. The VM can start without Node, then with an old Node, then complete, at no risk to the live service.

Reply with the option. The agent then writes the copy-paste procedure for it.
