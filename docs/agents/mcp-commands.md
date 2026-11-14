# MCP selections and commands

Read before you edit the project's MCP selections or run the MCP commands. Moved from [mcp](mcp.md) unchanged (F-076).

## Commands

- `node tools/mcp.mjs recommend`: inspect project selections plus simple Angular/Playwright stack signals; print cached sources, setup procedures and alternatives. Does not perform a web search.
- `node tools/mcp.mjs search --query=angular`: explicit live registry name search, latest-version metadata, timestamped. Searches are substrings, not semantic matching. Narrow broad queries; displayed results may be incomplete. Nothing is installed or selected. `--offline` rejects network search.
- `node tools/mcp.mjs check`: validate this project’s configured IDs, reasons, dates, version pins and endpoint hygiene. Components do not read or validate optional coordinator metadata in this check; coordinators validate their own solution selections. No configuration is a valid single-project setup. This validates metadata, not executable safety or a live connection.
- `node tools/mcp.mjs config --server=angular --client=claude-code`: print a snippet for a reviewed selection. Clients: `claude-code`, `cline`, `gemini`, `vscode`, `codex`. JSON schemas differ; Codex uses TOML. Snippets are output only; merge them deliberately into the correct host configuration. Existing instructions/settings are never overwritten.
- `--offline`: cached recommendation mode; Angular snippets use `--local-only`. Package-runner and remote GitHub snippets are rejected offline. Preinstall dependencies and choose local alternatives explicitly; absence of network calls by a server does not make its agent model offline.

The helper does not scan installed client settings or discover connected MCP tools. The active agent performs that discovery through its host. Angular config uses the installed workspace CLI; package-runner browser tools require a reviewed exact version. Config generation is not installation, authorization, startup or verification. Fusion needs its actual local endpoint; Blender follows its version-specific vendor procedure. No portable command or endpoint is invented.

## Project selections

Use this optional `.harness.json` field, adapted to an actual need:

```json
{
  "integrations": {
    "schemaVersion": 1,
    "recommendations": [
      {
        "id": "angular",
        "reason": "Version-aligned framework guidance for this Angular workspace",
        "required": false,
        "lastChecked": "2026-10-31"
      }
    ]
  }
}
```

A solution manifest may use the same `integrations` shape to share recommendations. The project’s full entry for the same ID explicitly takes precedence; `disabled: true` opts out (it cannot also be required). The helper reports the selection scope. Missing, malformed or invalid optional component context reports inherited recommendations as unknown while valid local project selections remain usable in recommendation/configuration mode. The component metadata check validates only its own selections; a coordinator validates its owned solution selections. Explicit registry research remains usable when local selections need repair. Shared recommendation data contains no credentials or assumed connection state.

Known catalogue IDs: `github`, `angular`, `playwright`, `devtools`, `fusion`, `blender`, `opencre`. The OpenCRE entry is local stdio with public network reads; keep its optional authenticated tools disabled. A package-runner selection includes an exact `version` checked against its publisher. An endpoint override is a credential-free HTTP(S) URL; remote endpoints require HTTPS. Do not commit tokens, headers, environment values or arbitrary executable overrides. A catalogue addition is a template change with a trusted source, purpose, runtime, transport, fallback and dated review. The initial list is intentionally small and non-exhaustive.

`required: true` means required for the named workflow/reason, not for unrelated work or every session. Configured recommendations are not permission grants. Keep runtime distinctions explicit: recommended → configured → installed → started → tools discovered → verified for this task. Only observation can advance connection state; do not commit transient success as a guarantee for another machine or session.
