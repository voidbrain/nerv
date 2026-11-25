# Linux EVA Enforcement Decision (`F-049-T10`)

Chosen 20 November 2026 against the `F-049-T01` EVA runner contract (`docs/decisions/eva-runner.md`) for the Linux mini PC host and Linux CI (`ubuntu-latest`).

## Mechanism: Bubblewrap (`bwrap`)

**`/usr/bin/bwrap`** (unprivileged Linux user, mount, PID, and network namespaces) enforces the `F-049-T01` boundaries without a root daemon:

| Boundary | Linux (`bwrap`) enforcement | Limits & notes |
|---|---|---|
| **Filesystem mounts** | Starts from an empty rootfs (`--proc /proc --dev /dev --tmpfs /tmp`), binds only host runtime dirs (`/usr`, `/lib`, `/lib64`, `/bin`, `/sbin`, `/etc/ld.so.cache`, `/etc/alternatives`, plus the executable's directory if outside `/usr`), `readOnlyPaths` (`--ro-bind`), `workspaceDir` (`--bind` rw), `writablePaths` (`--bind` rw for `eva-01`/`eva-02`), and explicit `readableStateFiles` (`--ro-bind`). `$HOME`, `nervStateDir`, and `deniedReadPaths` are never mounted. Symlink and hardlink escapes fail (`ENOENT` / `EXDEV`). | Overlapping `writablePaths` or `readOnlyPaths` against `$HOME`, `nervStateDir`, or `deniedReadPaths` are refused before launch (`buildEvaBwrapArgs`). |
| **Network egress** | `eva-03` and `eva-00` pass `--unshare-net` (isolated network namespace with no external interfaces, no DNS, and no access to host `localhost` services or NERV ports `4317`/`4319`). | `eva-01` and `eva-02` share the host network namespace until the `F-027-T02` egress proxy lands (same port/proxy boundary as macOS Seatbelt). |
| **Credentials** | `buildEva03CleanEnv` strips `process.env` (`HOME` and `TMPDIR` point to `workspaceDir`); `~/.ssh`, `~/.aws`, and user keyrings are never mounted. | Same clean-env invariant as macOS. |
| **Cancellation & deadlines** | `--unshare-pid --die-with-parent --new-session` kills the sandbox PID 1 and all descendants (including `setsid` children) when `bwrap` terminates, paired with `DescendantTracker` (`ps`). | Host-level `bwrap` missing fails closed (`EvaSandboxUnavailableError`). |

## Host prerequisite

On Ubuntu 24.04+ (including `ubuntu-latest` CI runners), `kernel.apparmor_restrict_unprivileged_userns=1` requires the `bubblewrap` package (`apt-get install -y bubblewrap`) so `/usr/bin/bwrap` carries its AppArmor user-namespace profile.
