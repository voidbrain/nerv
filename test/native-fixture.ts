/** Ephemeral local HTTPS fixture for Swift transport tests, never a production service. */
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {NativeAuth,initializeNativeTLS} from '../src/native-auth.ts';import {Store} from '../src/store.ts';import {makeServer} from '../src/server.ts';
const file=process.env.NODO_NATIVE_FIXTURE;if(!file)throw new Error('Fixture destination required.');
const home=mkdtempSync(join(tmpdir(),'nodo-swift-')),tls=initializeNativeTLS(home),auth=new NativeAuth(home),store=new Store(':memory:');
const server=makeServer(store,'fixture-admin-not-a-real-secret-00000',{tls,native:{auth,fingerprint:tls.fingerprint,port:4319,webPort:4317}});
server.listen(0,'127.0.0.1',()=>{const addr=server.address();if(!addr||typeof addr==='string')throw new Error('No fixture address.');const invitation={version:1,...auth.issue('Swift CI'),runtimeId:auth.runtimeId,port:addr.port,webPort:4317,fingerprint:tls.fingerprint};writeFileSync(file,Buffer.from(JSON.stringify(invitation)).toString('base64url'),{mode:0o600});});
function stop(){server.close(()=>{auth.close();store.close();rmSync(home,{recursive:true,force:true});});}
process.once('SIGTERM',stop);process.once('SIGINT',stop);
