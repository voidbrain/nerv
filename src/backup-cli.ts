import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readConfig } from './config.ts';
import { copyDates, createBackupKey, decryptBackup, receivedDir } from './offhost.ts';
import { snapshotDates, snapshotDir } from './snapshots.ts';

interface Io {
  readSecret: (prompt: string) => Promise<string>;
  flag: (name: string) => string | undefined;
  print?: (line: string) => void;
}

const USAGE = 'Usage: backup keygen --out PATH | backup status | backup decrypt COPY --key PATH --out PATH';

/**
 * F-062-T03: `backup keygen` makes the owner's backup key (the service only ever gets its public half), `backup status`
 * shows what is copied where, and `backup decrypt` turns one encrypted copy back into a verified database file for a
 * restore. None of them reads or changes the live database.
 */
export async function backupCommand(home: string, args: string[], io: Io): Promise<void> {
  const print = io.print ?? ((l: string) => console.log(l));
  const [sub] = args;
  if (sub === 'keygen') {
    const out = io.flag('--out');
    if (!out) throw new Error('Usage: backup keygen --out PATH (a place off this machine, for example a USB stick)');
    if (existsSync(out)) throw new Error(`A file already exists at ${out}; it is never overwritten.`);
    const pass = await io.readSecret('New passphrase for the backup key (12+ characters): ');
    if (!args.includes('--passphrase-stdin') && pass !== (await io.readSecret('Repeat it: ')))
      throw new Error('The two passphrases differ.');
    const key = createBackupKey(pass);
    writeFileSync(out, key.privatePem, { mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(out, 0o600);
    print(
      `Backup key created: ${out}\nKeep it and its passphrase off this machine: without them no copy can be restored.\n` +
        `Add this to config.json (the folders are where the encrypted copies go):\n` +
        JSON.stringify({ backup: { publicKey: key.publicKey, copies: ['/Volumes/YOUR-DISK/nerv-backups'] } }, null, 2),
    );
    return;
  }
  if (sub === 'status') {
    const config = readConfig(home).backup,
      local = snapshotDates(snapshotDir(home));
    print(
      JSON.stringify(
        {
          snapshots: { newest: local[0] ?? null, count: local.length },
          ...(config?.peers ? { peers: config.peers } : {}),
          ...(config?.accept
            ? {
                received: config.accept.map((from) => {
                  const dates = copyDates(receivedDir(home, from));
                  return { from, newest: dates[0] ?? null, count: dates.length };
                }),
              }
            : {}),
          copies: config
            ? config.copies.map((folder) => {
                const dates = copyDates(folder);
                return {
                  folder,
                  available: existsSync(folder),
                  newest: dates[0] ?? null,
                  count: dates.length,
                  current: !!local[0] && dates[0] === local[0],
                };
              })
            : 'not configured',
        },
        null,
        2,
      ),
    );
    return;
  }
  if (sub === 'decrypt') {
    const copy = args[1],
      keyFile = io.flag('--key'),
      out = io.flag('--out');
    if (!copy || copy.startsWith('--') || !keyFile || !out) throw new Error(USAGE);
    if (existsSync(out)) throw new Error(`A file already exists at ${out}; it is never overwritten.`);
    const plain = decryptBackup(
      readFileSync(copy),
      readFileSync(keyFile, 'utf8'),
      await io.readSecret('Backup key passphrase: '),
    );
    writeFileSync(out, plain, { mode: 0o600 });
    const db = new DatabaseSync(out, { readOnly: true });
    let ok: boolean;
    try {
      ok = db.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok';
    } finally {
      db.close();
    }
    if (!ok) {
      rmSync(out, { force: true });
      throw new Error('The decrypted copy failed its integrity check; nothing was kept.');
    }
    print(`Decrypted and verified: ${out}\nIt is a copy; the live database is unchanged.`);
    return;
  }
  throw new Error(USAGE);
}
