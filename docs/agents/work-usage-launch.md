# Job usage: client bridges and launch

Read before you set up a client instruction bridge (GEMINI.md, QWEN.md, Copilot) or launch an agent through `work:launch`. Part of [job usage](work-usage.md).

## Client instruction entry points

[Job usage](work-usage.md) owns the rule; AGENTS routes there when `workUsage.enabled`. Claude's existing CLAUDE bridge imports it. Optional GEMINI.md, QWEN.md and `.github/copilot-instructions.md` bridges point to the same authority; merge them into existing client instructions when useful, preserving local rules. Verify the actual client's instruction loading and telemetry access in a neutral job; a filename is not proof that it loaded. ChatGPT/Codex tools with repository access can follow AGENTS; a chat-only session without repository/usage access needs an explicitly supplied task/metadata export and reports missing coverage.

These bridges request registration/import where available; they do not install exporters, scrape conversation history, enable prompt logging, discover credentials, guarantee compliance or provide live client acceptance. Exact source model/version and actual input/output/cache counters remain unknown until observed. No owner needs to predict which agent will eventually run a job for the job to register its observed identity.

## Explicit prelaunch registration

Optionally adopt `tools/usage-launch.mjs` and `work:launch`. Invoke `node tools/usage-launch.mjs --repository=project-harness --item=F-048 --task=F-048-T02 --agent=CLIENT -- executable arguments`. It registers before starting the exact supplied command, inherits normal permissions and stdio, and passes `HARNESS_USAGE_JOB` and `HARNESS_USAGE_STORE`. It never stores command text or captures a transcript. The caller must already be authorized to run that command; this helper is not a model-run grant, sandbox or background hook.

`start` and the launcher accept optional `--parent=JOB_UUID` for an open same-repository parent. Read the child's stored parent identity for handoff; do not reuse a parent's event IDs/counters. Finish retains command failure/interruption and declares coverage unavailable because process success alone cannot prove telemetry coverage. Registration failure prevents launch. External host/client integration owns metadata extraction, actual instruction loading and signal/process supervision. An already running agent cannot retrospectively obtain prelaunch coverage from this helper; ordinary available job registration remains required.
