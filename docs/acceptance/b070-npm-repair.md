# B-070-T02: repair npm under Node 26.12, owner procedure

The npm bundled with the nvm Node 26.12 install is missing `npm-cli.js`, so `npm` falls back to the old `/usr/local/bin/npm` 10.8.2 (and `npx` fails). npm 10 writes duplicate SBOM dependency entries, and the service's lifecycle updates also run `npm ci` with whichever npm is first. This puts npm 11 back into the Node 26.12 install. Run it in a local Terminal, not while a NERV update is running. About 5 minutes.

```bash
# 1. Confirm the fault (read-only).
ls ~/.nvm/versions/node/v26.12.0/lib/node_modules/npm/bin/npm-cli.js; which npm; npm --version
```
Expected: `No such file or directory`, then `/usr/local/bin/npm` and `10.8.2`. Anything else: stop and paste it.

```bash
# 2. Install npm 11 into the Node 26.12 prefix, using the working npm of Node 24.19.
~/.nvm/versions/node/v24.19.0/bin/npm install -g --prefix ~/.nvm/versions/node/v26.12.0 npm@11
hash -r; which npm; npm --version; npx --version
```
Expected: `added … packages`, then `…/.nvm/versions/node/v26.12.0/bin/npm`, an `11.x` version twice.

```bash
# 3. The SBOM test now passes (read-only; uses the live checkout's files).
cd ~/Projects/NERV/NERV && node --test test/bom.test.ts 2>&1 | grep -E 'ℹ (pass|fail)'
```
Expected: `ℹ pass 3` and `ℹ fail 0`. Paste steps 2 and 3 back; the agent records them and closes B-070.

To undo: `rm -rf ~/.nvm/versions/node/v26.12.0/lib/node_modules/npm` puts things back as they were (npm then falls back to `/usr/local/bin/npm` again).
