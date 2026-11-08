# Node discovery, inspection and bootstrap previews

F-005 adds CLI discovery from selected inventory files, literal SSH aliases, an optional Tailscale status export/client and root-verified registry bundles. Discovery never probes a range automatically, enrolls a host, starts a worker or grants a tool. Registry addresses are candidate locators, not evidence that SSH is available. Reported Tailscale online state remains source metadata, not a fresh NERV health check.

## Read-only inspection

`nodes inspect` runs a fixed Node probe locally or over an explicitly selected SSH destination. SSH uses batch authentication, strict existing known-host checks, no agent/X11/port forwarding, no known-host updates and no multiplexed session reuse. It never accepts a host key automatically. The client still uses the owner's SSH configuration and authentication setup; these are not a sandbox. Literal alias discovery does not evaluate Include or Match/Proxy commands. See the authoritative [OpenSSH client](https://man.openbsd.org/ssh.1) and [configuration](https://man.openbsd.org/ssh_config.5) references.

The child runner forwards a narrow OS/client environment, not NERV/provider/Telegram credentials. Reports contain OS/architecture, Node/Git/npm versions, hostname/user home, current UID where available and selected public default-base metadata. Credentials, SQLite state, model requests and service controls are excluded. `runtime: not-checked` is deliberate: configuration and a successful SSH command do not prove a running or enrolled worker. Only the default `.nerv/config.json` is inspected; custom NERV_HOME/legacy locations and actual service ownership require separate inspection.

Input inventories are regular files bounded to 256 KiB; candidate sets contain at most 64 entries. Reports are bounded to 16 KiB; SSH output including discarded stderr is bounded to 32 KiB and the read-only command has a 15-second deadline. Errors discard raw stderr. No secret or private key appears in command arguments or reports. `--out` creates a new mode-0600 file and refuses overwrites. Keep actual host reports private and outside git.

## Preview contract

A preview binds the validated inspection/digest, SSH locator, observed hostname/platform/runtime, full 40-character source commit, separate absolute checkout/data paths under the inspected user home, proposed base identity, permissions and optional service action. Reports expire after 24 hours. The digest detects changed data; it is neither an enrollment signature nor authority to execute. Unknown/raw report fields do not enter the manifest.

The source repository is fixed to NERV's repository. The preview lists clone/fetch/checkout and explicit revision verification, locked `npm ci --engine-strict`, build, initialization and public-identity commands. The server's Node 24 floor alone does not establish build compatibility: the pinned source/dependency engines must pass. Package lifecycle scripts are code and require review; this is not an untrusted-tool sandbox. No model download or provider account is configured by the preview.

Known missing dependencies, root execution or an existing default configuration appear as blockers. Service ownership/session support is not inspected automatically and blocks a service preview until reviewed. A fresh-install preview never authorizes replacing or migrating an existing NERV/Nodo definition. The current executor remains **not implemented**: CLI `nodes plan` returns structured review data, never runs its steps or provides an apply command. Existing manual installation/update/uninstall commands retain their own documented limits.

Pairing keeps the target's private base key on the target. The owner independently compares its public fingerprint, signs enrollment on the coordinator, and transfers only signed registry/public-root material. There is no root/admin/provider credential distribution or trust on discovery. Verify doctor and an explicitly approved harmless capability after installation; no startup or discovery message proves execution.

Recovery instructions retain checkout/data/keys/logs and require reconciling observed steps after failure or timeout. They do not claim automatic rollback, deletion or undo. Before reusing physical resources, inspect actual state. Downgrade/database restore remains F-062; restoring an old receipt journal is not a safe default.

## Remaining F-005 work

Authenticated bootstrap execution with durable step/outcome reconciliation, update/uninstall ownership checks, additional discovery adapters and real installation/pairing/worker acceptance remain open. The local Mac is the first acceptance target; an existing default NERV configuration prevents treating it as a fresh machine. No remote host was chosen or modified. F-014/B-045 supply the enrolled worker transport; this feature reuses it rather than opening an execution tunnel in local `/rpc`.
