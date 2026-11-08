import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,renameSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeAuth,initializeNativeTLS} from '../src/native-auth.ts';

test('stopped-profile recovery rotates native identity and TLS while retaining unrelated data and private recovery evidence',()=>{
 const home=mkdtempSync(join(tmpdir(),'nerv-native-recovery-')),backup=join(home,'private-backup');let auth:NativeAuth|undefined;
 try{
  mkdirSync(backup,{mode:0o700});writeFileSync(join(home,'unrelated-data'),'retain this neutral fixture');
  const previousTLS=initializeNativeTLS(home);auth=new NativeAuth(home);const previousId=auth.runtimeId,previous=auth.claim(auth.issue('Old Mac').ticket);
  auth.close();auth=undefined; // No live daemon/database handle during the documented offline replacement.
  for(const name of ['native-key.pem','native-cert.pem','native-tls.cnf','native-auth.sqlite','native-auth.sqlite-wal','native-auth.sqlite-shm','native-auth.sqlite-journal'])if(existsSync(join(home,name)))renameSync(join(home,name),join(backup,name));
  const currentTLS=initializeNativeTLS(home);auth=new NativeAuth(home);
  assert.notEqual(currentTLS.fingerprint,previousTLS.fingerprint);assert.notEqual(auth.runtimeId,previousId);assert.equal(auth.authenticate(previous.token),false);
  const next=auth.claim(auth.issue('Recovered Mac').ticket);assert.equal(auth.authenticate(next.token),true);assert.deepEqual(next.scopes,['read']);
  assert.equal(readFileSync(join(home,'unrelated-data'),'utf8'),'retain this neutral fixture');assert.ok(existsSync(join(backup,'native-auth.sqlite')));assert.ok(existsSync(join(backup,'native-key.pem')));
 }finally{auth?.close();rmSync(home,{recursive:true,force:true});}
});
