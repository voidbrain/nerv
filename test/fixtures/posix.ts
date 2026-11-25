import assert from 'node:assert/strict';
import {existsSync,statSync} from 'node:fs';
/** Unix file modes exist on macOS and Linux only; on Windows private files rely on the profile's ACLs (F-037, privateEnough). */
export const POSIX=process.platform!=='win32';
/** A private file: mode 0600 where modes exist; on Windows it only has to exist (its folder's ACL protects it). */
export function assertPrivateFile(path:string):void {
 assert.ok(existsSync(path),`${path} exists`);
 if(POSIX)assert.equal(statSync(path).mode&0o777,0o600,`${path} is readable only by its owner`);
}
