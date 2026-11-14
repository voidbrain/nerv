# Backups

NERV keeps reminders, memory, the ledger, enrolment and grants in one SQLite database per base. The service protects it in two layers:

- **Nightly snapshot (local):** at 03:30 in your time zone the service takes a consistent copy with SQLite's backup API, checks it, and keeps the newest 7 in `<data home>/snapshots/`. Up to 24 h of changes can be lost.
- **Encrypted off-host copies:** after each snapshot, the service encrypts the newest one and writes it to every folder you list, for example on an external disk. It keeps the newest 7 there too (`keep` changes that).

The service only holds the backup **public** key. It can write copies but cannot read them. Only the private key file and its passphrase can open a copy, so keep both away from the machine.

## Set it up (once)

1. Create the backup key on a USB stick or another place off the machine:

   ```bash
   nerv backup keygen --out /Volumes/USB/nerv-backup-key.pem
   ```

   Pick a passphrase of 12 or more characters and store it in your password manager. The command prints a `backup` block.

2. Create the folder on the external disk (for example `/Volumes/Backup/nerv-backups`) and add the printed block to `config.json` in the data home, with your folder:

   ```json
   "backup": { "publicKey": "MCowBQYDK2VuAyEA…", "copies": ["/Volumes/Backup/nerv-backups"] }
   ```

   The service picks it up within a minute. Up to 4 folders are allowed. A folder inside the data home is refused, because it would not be off host.

3. Check it:

   ```bash
   nerv backup status
   ```

   Each folder shows `available`, its newest copy and `current: true` once it holds the newest snapshot.

## When the disk is not connected

The service never creates the folder itself. If the disk is unplugged it logs one line a night ("Off-host copy 1 … waits: its folder is not available") and writes the copy within a minute of the disk being connected again.

## Restore a copy

```bash
nerv backup decrypt /Volumes/Backup/nerv-backups/nerv-2026-11-14.sqlite.nbk \
  --key /Volumes/USB/nerv-backup-key.pem --out ~/restore/nerv.sqlite
```

The command asks for the passphrase, checks the result and never overwrites a file. A changed, truncated or wrong-key copy is refused with nothing written. It does not touch the live database. Replace the live database only with the service stopped.
