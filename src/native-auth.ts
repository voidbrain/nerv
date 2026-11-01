import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,X509Certificate} from 'node:crypto';
import {mkdirSync,existsSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {request} from 'node:https';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export interface Invitation {version:1;ticket:string;runtimeId:string;port:number;webPort:number;fingerprint:string;expiresAt:number}
export class NativeAuth {
 private db:DatabaseSync;readonly runtimeId:string;
 constructor(home:string){mkdirSync(home,{recursive:true,mode:0o700});const path=join(home,'native-auth.sqlite');this.db=new DatabaseSync(path);chmodSync(path,0o600);
 const version=this.db.prepare('PRAGMA user_version').get() as {user_version:number};if(version.user_version>1){this.db.close();throw new Error('Native credential schema is newer than this Nodo version.');}
 this.db.exec(`PRAGMA busy_timeout=2000;PRAGMA user_version=1;CREATE TABLE IF NOT EXISTS identity(id TEXT NOT NULL);CREATE TABLE IF NOT EXISTS tickets(hash TEXT PRIMARY KEY,label TEXT NOT NULL,expires INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,hash TEXT UNIQUE NOT NULL,label TEXT NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);`);
 this.db.prepare('INSERT INTO identity SELECT ? WHERE NOT EXISTS(SELECT 1 FROM identity)').run(randomUUID());this.runtimeId=(this.db.prepare('SELECT id FROM identity').get() as {id:string}).id;}
 issue(label:string,now=Date.now()){if(typeof label!=='string'||!label.trim()||label.length>60)throw new Error('Client label must contain 1–60 characters.');this.db.prepare('DELETE FROM tickets WHERE expires<=?').run(now);if((this.db.prepare('SELECT count(*) AS n FROM tickets').get() as {n:number}).n>=8)throw new Error('Too many pending invitations.');const ticket=randomBytes(32).toString('hex'),expiresAt=now+120000;this.db.prepare('INSERT INTO tickets VALUES(?,?,?)').run(hash(ticket),label.trim(),expiresAt);return {ticket,expiresAt};}
 claim(ticket:string,now=Date.now()){
 if(typeof ticket!=='string'||!/^[a-f0-9]{64}$/.test(ticket))throw new Error('Invalid or expired invitation.');
 this.db.exec('BEGIN IMMEDIATE');try{const row=this.db.prepare('SELECT label,expires FROM tickets WHERE hash=?').get(hash(ticket)) as {label:string;expires:number}|undefined;if(!row||row.expires<=now)throw new Error('Invalid or expired invitation.');
 this.db.prepare('DELETE FROM clients WHERE expires<=? OR revoked=1').run(now);if((this.db.prepare('SELECT count(*) AS n FROM clients').get() as {n:number}).n>=32)throw new Error('Too many paired clients.');
 const clientId=randomUUID(),token=randomBytes(32).toString('hex'),expiresAt=now+30*86400000;this.db.prepare('DELETE FROM tickets WHERE hash=?').run(hash(ticket));this.db.prepare('INSERT INTO clients(id,hash,label,expires) VALUES(?,?,?,?)').run(clientId,hash(token),row.label,expiresAt);this.db.exec('COMMIT');return {clientId,token,expiresAt,runtimeId:this.runtimeId,scopes:['read']};
 }catch(e){this.db.exec('ROLLBACK');throw e;}}
 authenticate(token:string,now=Date.now()){if(!/^[a-f0-9]{64}$/.test(token))return false;return !!this.db.prepare('SELECT id FROM clients WHERE hash=? AND expires>? AND revoked=0').get(hash(token),now);}
 clients(){return this.db.prepare('SELECT id,label,expires,revoked FROM clients ORDER BY expires').all();}
 revoke(id:string){return Number(this.db.prepare('UPDATE clients SET revoked=1 WHERE id=?').run(id).changes)>0;}
 close(){this.db.close();}
}
export function initializeNativeTLS(home:string){
 mkdirSync(home,{recursive:true,mode:0o700});const key=join(home,'native-key.pem'),cert=join(home,'native-cert.pem');
 if(existsSync(key)!==existsSync(cert))throw new Error('Incomplete native TLS files; restore them before retrying.');
 if(!existsSync(cert)){
 const config=join(home,'native-tls.cnf');writeFileSync(config,'[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n',{mode:0o600});
 const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','365','-config',config,'-keyout',key,'-out',cert],{stdio:'ignore',timeout:15000});if(result.error||result.status!==0)throw new Error('Native TLS setup failed. Install openssl and inspect private native TLS files before retrying.');
 }
 chmodSync(key,0o600);chmodSync(cert,0o600);return loadNativeTLS(home)!;
}
export function loadNativeTLS(home:string){const key=join(home,'native-key.pem'),cert=join(home,'native-cert.pem');if(!existsSync(key)&&!existsSync(cert))return undefined;if(!existsSync(key)||!existsSync(cert))throw new Error('Incomplete native TLS files.');const certificate=readFileSync(cert),parsed=new X509Certificate(certificate);if(Date.parse(parsed.validTo)<=Date.now())throw new Error('Native certificate expired; rotate it and pair clients again.');return {key:readFileSync(key),cert:certificate,fingerprint:parsed.fingerprint256.replaceAll(':','').toLowerCase()};}
/** CLI administration trusts the persisted certificate, never a network-supplied pin. */
export function nativeAdmin(home:string,port:number,token:string,path:string,method='GET',body?:object):Promise<unknown>{const tls=loadNativeTLS(home);if(!tls)throw new Error('Run native-init and restart Nodo first.');return new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path,method,ca:tls.cert,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},timeout:5000},res=>{let data='';res.on('data',chunk=>{data+=chunk;if(data.length>65536)res.destroy(new Error('Response too large.'));});res.on('error',reject);res.on('end',()=>{try{const value:unknown=JSON.parse(data);if((res.statusCode ?? 500)>=400)reject(new Error('Native administration failed; inspect service status.'));else resolve(value);}catch{reject(new Error('Invalid native response.'));}});});req.on('timeout',()=>req.destroy(new Error('Native administration timed out.')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
