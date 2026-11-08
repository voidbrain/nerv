import type {DatabaseSync} from 'node:sqlite';
/** Synchronous nested units share the outer write lock; savepoint rollback preserves their caller's transaction. */
export function transaction<T>(db:DatabaseSync,work:()=>T):T {
 const nested=db.isTransaction;db.exec(nested?'SAVEPOINT nerv_nested':'BEGIN IMMEDIATE');
 try{const value=work();db.exec(nested?'RELEASE nerv_nested':'COMMIT');return value;}
 catch(error){if(nested)db.exec('ROLLBACK TO nerv_nested; RELEASE nerv_nested');else db.exec('ROLLBACK');throw error;}
}
