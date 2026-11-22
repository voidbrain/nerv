# F-062-T07: restore drill on NERV-01, owner procedure

Off-host copies are not configured on NERV-01 yet (`nerv backup status` reports `"copies": "not configured"`), so this
sets them up once, waits for the first encrypted copy, and restores it into a separate folder. The live base is never
touched: restore refuses to write where a database already exists. Agreed bounds (F-062-T01): up to 24 h of data lost,
restore within 1 h.

You need a disk that is not this Mac's internal one (a USB stick or external disk). Below it is `/Volumes/YOUR-DISK`:
replace it with yours in every step.

```bash
# 1. Make the backup key on the external disk. It asks for a new passphrase (12+ characters) twice.
nerv backup keygen --out /Volumes/YOUR-DISK/nerv-backup-key.pem
```
Expected: `Backup key created: /Volumes/YOUR-DISK/nerv-backup-key.pem`, then a JSON block with `"publicKey"` to add to
config.json. Keep the passphrase somewhere other than this Mac.

```bash
# 2. Make the copies folder, then add the printed block to ~/.nerv/config.json as its "backup" section,
#    with "copies": ["/Volumes/YOUR-DISK/nerv-backups"].
mkdir -p /Volumes/YOUR-DISK/nerv-backups && open -e ~/.nerv/config.json
```
Expected: the file opens; after saving, `{"backup": {"publicKey": "-----BEGIN PUBLIC KEY-----…", "copies": ["/Volumes/YOUR-DISK/nerv-backups"]}, …}` with the rest of the file unchanged.

```bash
# 3. Wait a minute for the service to copy the newest nightly snapshot, then check.
sleep 70; nerv backup status; ls -l /Volumes/YOUR-DISK/nerv-backups
```
Expected: `"copies"` lists the folder with today's date as newest, and the folder holds `nerv-<today>.sqlite.nbk`.
`not configured` or an empty folder: stop and paste the output.

```bash
# 4. Restore that copy into a new folder, timed. It asks for the passphrase from step 1.
time nerv backup restore /Volumes/YOUR-DISK/nerv-backups/nerv-$(date +%F).sqlite.nbk \
  --key /Volumes/YOUR-DISK/nerv-backup-key.pem --target /tmp/nerv-restore-drill
```
Expected: `Restored and verified in <n>ms: /tmp/nerv-restore-drill/nerv.sqlite`, and a `real` time well under 1 hour.

```bash
# 5. The restored base holds what the night's snapshot holds: identities, grants (revoked included), reminders and
#    delivery checkpoints. Read-only on both sides.
for t in registry grants reminders deliveries approval_deliveries; do
  printf '%-20s snapshot %-6s restored %s\n' $t \
    "$(sqlite3 -readonly ~/.nerv/snapshots/nerv-$(date +%F).sqlite "select count(*) from $t")" \
    "$(sqlite3 -readonly /tmp/nerv-restore-drill/nerv.sqlite "select count(*) from $t")"
done
sqlite3 -readonly /tmp/nerv-restore-drill/nerv.sqlite "select count(*) from grants where revoked is not null and revoked != 0"
```
Expected: on every line the two counts are equal; the last line is the number of revoked grants (it may be 0).
Paste steps 3–5 back; the agent records them and closes F-062.

To undo the drill: `rm -rf /tmp/nerv-restore-drill`. To stop the copies: remove the `"backup"` section from
`~/.nerv/config.json`; copies already on the disk stay there until you delete them.
