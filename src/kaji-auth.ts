import {createHash,randomBytes,sign,verify,type KeyObject} from 'node:crypto';
import {publicKeyFrom,type BaseEntry} from './kaji.ts';
export const KAJI_CLOCK_SKEW_MS=120_000;
const NONCE_MS=10*60_000;
const digest=(body:string)=>createHash('sha256').update(body).digest('base64');
const message=(kind:'req'|'res',method:string,path:string,time:string,nonce:string,body:string)=>[kind,method,path,time,nonce,digest(body)].join('\n');
export function signedHeaders(baseId:string,key:KeyObject,kind:'req'|'res',method:string,path:string,body:string,now=new Date()):Record<string,string> {
 const time=now.toISOString(),nonce=randomBytes(16).toString('hex');
 return {'x-kaji-base':baseId,'x-kaji-time':time,'x-kaji-nonce':nonce,'x-kaji-signature':sign(null,Buffer.from(message(kind,method,path,time,nonce,body)),key).toString('base64')};
}
/** Replay guard: a nonce is accepted once within its window; old ones are forgotten. */
export class Nonces {
 private seen=new Map<string,number>();
 fresh(nonce:string,now=Date.now()):boolean {for(const [n,t] of this.seen)if(t<now-NONCE_MS)this.seen.delete(n);if(this.seen.has(nonce))return false;this.seen.set(nonce,now);return true;}
}
/** Returns the sender's base id, or throws: unknown or revoked base, stale time, replayed nonce, bad signature. */
export function verifySigned(headers:Record<string,string|undefined>,kind:'req'|'res',method:string,path:string,body:string,bases:BaseEntry[],nonces:Nonces,now=Date.now()):string {
 const id=headers['x-kaji-base'],time=headers['x-kaji-time'],nonce=headers['x-kaji-nonce'],signature=headers['x-kaji-signature'];
 if(!id||!time||!nonce||!signature)throw new Error('unsigned');
 const base=bases.find(b=>b.baseId===id);if(!base||base.status!=='enrolled')throw new Error('unknown or revoked base');
 if(!Number.isFinite(Date.parse(time))||Math.abs(now-Date.parse(time))>KAJI_CLOCK_SKEW_MS)throw new Error('stale or future time');
 if(!/^[a-f0-9]{32}$/.test(nonce)||!nonces.fresh(nonce,now))throw new Error('replayed');
 if(!verify(null,Buffer.from(message(kind,method,path,time,nonce,body)),publicKeyFrom(base.publicKey),Buffer.from(signature,'base64')))throw new Error('bad signature');
 return id;
}
