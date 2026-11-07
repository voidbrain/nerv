# Bills of materials

F-067 provides two separate CycloneDX JSON documents.

## Locked dependency inventory

The Linux CI validate job runs `npm sbom --package-lock-only --sbom-format cyclonedx` and publishes `dependencies.cdx.json` as the `dependency-sbom` artifact. It includes production and development dependencies from the committed lock, including transitive packages; it is not an inventory of an installed native app, host operating system or live models. The npm command currently emits CycloneDX 1.5. The regression validates its document against the official vendored schema and checks exact locked versions of every direct dependency. See [npm sbom](https://docs.npmjs.com/cli/commands/npm-sbom/).

## Runtime configuration inventory

```sh
nerv bom > runtime.cdx.json
# Or: npm start -- bom > runtime.cdx.json (npm may add script notices; use nerv for a JSON-only stdout stream)
```

`nerv bom` writes a CycloneDX 1.6 configuration snapshot to stdout. It works while the NERV service is stopped and opens no database. It makes one bounded local Ollama `/api/tags` read when a local route is configured; it never loads a model, starts an MCP server, invokes a granted tool or calls a cloud provider. It reports:

- Configured route defaults and effective Misato, Casper and consultant model roles, plus specialist model roles identified by ordinal. Each has the model name, local/cloud route and enabled state.
- SHA-256 model digests when the configured model matches Ollama's response (including an omitted `:latest` alias). Missing or unreachable discovery is explicit; no hash is invented or reused from an unreachable response.
- Granted MCP tools as services, with server/tool names, pinned tool-description fingerprint, effect class and EVA. This fingerprint is not a hash or version of executable server code. Ungranted servers are omitted.

The output selects only those technical fields. It excludes base names, pilot names/ids/domains, conversation/reminder/memory content, local paths, command arguments, endpoints, channel identifiers and credentials. It never reads credential files. Configured model and server/tool identifiers remain visible because they are the inventory. A disabled cloud route and retired specialist remain labelled disabled.

This is current configuration and current optional discovery, not proof of which model actually answered a past request or which MCP executable ran. Historical per-call model identity and usage remain F-063. No background snapshots or uploads are added.

The [CycloneDX 1.6 reference](https://cyclonedx.org/docs/1.6/json/) defines model components, services, properties and hashes. Ollama documents model digests in its [tags response](https://docs.ollama.com/api/tags). Tests use the official [vendored schemas](../../test/fixtures/cyclonedx/README.md), check privacy with invented sentinel data and run the real CLI against a fake Ollama listener, including provider-unavailable behavior.
