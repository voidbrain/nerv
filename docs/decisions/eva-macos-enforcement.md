# macOS EVA Enforcement Benchmark & Decision Input (`F-049-T03`)

Measured 15 November 2026 on the Mac host against the `F-049-T01` EVA runner contract (`docs/decisions/eva-runner.md`). Owner selected `sandbox-exec` on 15 November 2026 (`F-049-T11`).

## Host inventory & measurements

| Candidate | Host availability | Startup latency | Filesystem | Network egress | Credentials | CPU / memory / output | Cancellation |
|---|---|---|---|---|---|---|---|
| **`/usr/bin/sandbox-exec` (Seatbelt)** | Installed (`/usr/bin/sandbox-exec`) | **14.05–35.54 ms** (avg **19.20 ms**, 5 runs) | Enforced (`rc=1`, `Operation not permitted`) **only if paths are canonicalized with `realpath`** (e.g. `/var` → `/private/var`) | Enforced (`(deny network-outbound)` blocked `127.0.0.1:80`, `rc=1`) | Enforced only when paired with stripped `env`, Seatbelt file denials, and Mach service denials (Keychain) | **Not enforced by Seatbelt**; requires `ulimit`/`setrlimit` (`ulimit -t 5 -n 64` OK) + coordinator byte cap; no hard cgroup memory cap | POSIX process-group `SIGTERM` → grace → `SIGKILL` |
| **Lightweight VM / Container (`docker`, `container`, `podman`, `tart`, `limactl`, `colima`)** | `docker` CLI at `/usr/local/bin/docker` with **no running daemon** (`docker info` failed); others **not installed** | Not measurable without running daemon (typically 200 ms–2 s+) | Strong VM/mount isolation when daemon runs | Strong network namespace isolation when daemon runs | Strong env/host isolation when daemon runs | Hard Linux cgroups CPU/memory/PID caps when daemon runs | Container stop/kill reaps all PIDs |
| **AgentFS** | **Not installed** | N/A | Per-job copy-on-write / snapshot workspace layer only | **Cannot enforce** | **Cannot enforce** | **Cannot enforce** | **Cannot enforce** |

## What each candidate cannot enforce

1. **`/usr/bin/sandbox-exec` (macOS sandbox profile)**:
   - Cannot enforce hard cgroup-style memory limits (macOS lacks Linux cgroups; `ulimit` covers CPU time and open FDs, while coordinator must cap stdout/stderr frames).
   - Cannot enforce rules written against non-canonical symlink paths (`/var/...` vs `/private/var/...`); the runner must resolve all mount/deny paths with `realpathSync`.
   - Cannot guarantee long-term Apple API stability (`sandbox-exec` is marked deprecated by Apple, though functional on current macOS).
2. **Lightweight VM / Container**:
   - Cannot run on this host without installing/starting an external VM daemon (none is running today), and Linux containers cannot execute macOS-native binaries.
   - Cannot match sub-25 ms per-job startup for high-frequency short `eva-03` tool calls.
3. **AgentFS**:
   - Cannot enforce OS-level filesystem escape denial, outbound network blocking, credential/Keychain isolation, CPU/memory/FD limits, or process-tree cancellation; it is a workspace state layer only and never substitutes for OS confinement.

## Recommendation for `F-049-T11`

- **Primary macOS mechanism (`eva-03` / `eva-00`)**: Use `/usr/bin/sandbox-exec` with canonicalized (`realpathSync`) read/write profiles, `(deny network-outbound)`, stripped `env`, `ulimit` CPU/FD bounds, process-group `SIGTERM`/`SIGKILL` teardown, and coordinator output framing — failing closed if `sandbox-exec` is unavailable or a test-gate probe fails.
- **Deferred option**: Lightweight VM/container remains an optional future backend if an always-on VM runtime is later adopted on the Mac host.
