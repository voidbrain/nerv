# Storage Base & Insert Events Decision (F-088-T01)

Date: 2026-11-15  
Status: Accepted (decision for F-088)

## 1. Worker Packaging (Container)

- **Packaging**: The storage-base worker runs as an enrolled NERV Linux worker (`F-005`) packaged in an OCI container (`node:24-slim` base) with read-only bind mount for removable-media mount points (e.g. `/media/cards:ro,rslave` or `bind-propagation=rslave`), read-write bind mount for the configured destination archive root, and a persistent state volume for the worker's SQLite ledger and Kaji identity (`~/.nerv` mode `0700`).
- **Why `rslave` mount propagation**: Inside an unprivileged container, new host automounts under `/media/cards/<label>` only become visible if the bind mount uses `rslave` propagation. Running without `--privileged` keeps the container unprivileged while still seeing newly mounted cards.

## 2. Mount & Insert Detection Events

- **Primary mechanism (inside container)**: Watch the configured mount-root directory (`fs.watch` + bounded polling fallback every `5 s`) for new mountpoints whose filesystem label matches a configured rule (`blkid`/label file or `/dev/disk/by-label` mounted read-only when exposed, or NAS automount directory name `<mountRoot>/<LABEL>`).
- **Optional host udev bridge**: On NAS hosts where the host OS dispatches udev `ACTION=="add"` / `ID_FS_LABEL` events, a lightweight host helper writes a JSON trigger or calls the worker's local Unix socket; however, directory-mount detection under `rslave` works across Synology/TrueNAS/Unraid/generic Linux NAS without requiring custom host udev rules.

## 3. Safety & Operational Limits

- **Read-only source guarantee**: Source card mounts are mounted `:ro` into the container and never modified or deleted.
- **Unknown labels**: Unlisted or unlabelled cards are ignored with zero side effects.
- **Idempotency & verification**: Every copied file is verified by byte size + SHA-256 hash before recording completion; re-inserting the same card skips identical files and flags any hash conflict at the same relative path without overwriting.
- **Limits**: Bounded concurrency (1 copy job per card at a time), bounded file-size/free-space preflight check (abort before copying if destination free space is below required bytes + reserve), and no automatic network egress of copied media.
