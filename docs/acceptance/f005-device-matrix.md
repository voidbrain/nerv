# F-005 device matrix for final acceptance

Proposed under [F-005-T11](../BACKLOG.md#f-005-t11) and agreed by the owner on 2026-11-18 ([F-005-T37](../BACKLOG.md#f-005-t37)). It names the machines F-005's remaining acceptance steps run on. It does not limit how many bases the agency has: any base enrolled later joins the Kaji line as usual and is simply outside this acceptance.

| Base | Machine | Platform | Role in acceptance | Already accepted |
|---|---|---|---|---|
| NERV-01 Neo Tokyo-3 | the owner's Mac | macOS arm64, launchd user agent | main base: coordinator, root key, Telegram channel | Mac service lifecycle and update (F-005-T04, F-005-T13) |
| NERV-02 Tabgha | mini PC | Windows x64, Task Scheduler logon task | worker | Windows lifecycle and update (F-005-T24, 2026-11-18) |
| NERV-03 Calvary | ClockworkPi DevTerm (Raspberry Pi CM4) | Debian 11 arm64, `systemd --user` with linger | worker; the Pi-class target | Linux prerequisites, lifecycle, update, reboot start and catch-up (F-005-T22, F-005-T26, F-009-T03, 2026-11-18) |

## Which acceptance runs where

| Step | What | Where |
|---|---|---|
| [F-005-T27](../BACKLOG.md#f-005-t27) | Enrolment, revocation, leases, fencing and cancellation | NERV-01 as main with NERV-02 and NERV-03 as workers; one revocation and re-enrolment of a worker |
| [F-005-T28](../BACKLOG.md#f-005-t28) | Reconnect, locks and uncertain physical results | a worker job interrupted on each worker (network drop, then service stop) |
| [F-005-T29](../BACKLOG.md#f-005-t29) | Upgrades, prerequisites, update policy and platform lifecycle | one fenced update per base through NERV's own flow; update policy on NERV-01 |
| [F-005-T30](../BACKLOG.md#f-005-t30) | Parent acceptance and closure | all three, citing the outcomes above without repeating accepted evidence |

The agent runs these over SSH where it can. Known limits that apply: fenced start, stop and update on Windows run from Tabgha's desktop session (B-087), and Debian 11 on Calvary no longer receives security updates (Node 24 is installed from the checksum-verified nodejs.org build).
