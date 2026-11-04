import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
/**
 * Lilith, Terminal Dogma's semantic memory (F-022): facts about the owner, with provenance, editable and forgettable.
 * Every change is appended to fact_history, so an edit or a forget never loses where a fact came from. Recall is SQLite
 * FTS5 over active facts. Facts are local-only unless marked shareable, so they never reach a cloud model by default.
 */
export const MEMORY_SCHEMA=`
 CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY, text TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, sortie_id TEXT, tainted INTEGER NOT NULL DEFAULT 0, shareable INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS fact_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT, fact_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL, created TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS fact_history_no_update BEFORE UPDATE ON fact_history BEGIN SELECT RAISE(ABORT,'fact history is append-only'); END;
 CREATE TRIGGER IF NOT EXISTS fact_history_no_delete BEFORE DELETE ON fact_history BEGIN SELECT RAISE(ABORT,'fact history is append-only'); END;
 CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(text, fact_id UNINDEXED);`;
export interface Fact {id:string;text:string;status:'active'|'forgotten';source:string;sortieId:string|null;tainted:boolean;shareable:boolean;created:string;updated:string}
const MAX_FACT_CHARS=500;
const clean=(text:unknown)=>{if(typeof text!=='string'||!text.trim()||text.length>MAX_FACT_CHARS)throw new Error(`A fact is 1–${MAX_FACT_CHARS} characters.`);return text.trim().replace(/\s+/g,' ');};
type Row={id:string;text:string;status:Fact['status'];source:string;sortie_id:string|null;tainted:number;shareable:number;created:string;updated:string};
const toFact=(r:Row):Fact=>({id:r.id,text:r.text,status:r.status,source:r.source,sortieId:r.sortie_id,tainted:r.tainted===1,shareable:r.shareable===1,created:r.created,updated:r.updated});
/** Words of three or more letters or digits, quoted, OR-ed: FTS5 syntax in user text can never become an operator. */
export function ftsQuery(text:string):string|undefined {
 const words=[...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []))].slice(0,12);
 return words.length?words.map(w=>`"${w}"`).join(' OR '):undefined;
}
export class Memory {
 readonly db:DatabaseSync;
 constructor(db:DatabaseSync){this.db=db;}
 private history(id:string,kind:string,text:string,source:string,now:string){this.db.prepare('INSERT INTO fact_history(fact_id,kind,text,source,created) VALUES(?,?,?,?,?)').run(id,kind,text,source,now);}
 private tx<T>(work:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const v=work();this.db.exec('COMMIT');return v;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 /** An active fact. Misato's proposals reach here only after the owner approved the memory.remember card. */
 add(text:unknown,source:'owner'|'misato',options:{sortieId?:string;tainted?:boolean;shareable?:boolean}={},now=new Date()):Fact {
  const t=clean(text);const id=randomUUID();const at=now.toISOString();
  return this.tx(()=>{
   const same=this.db.prepare("SELECT * FROM facts WHERE status='active' AND lower(text)=lower(?)").get(t) as Row|undefined;if(same)return toFact(same);
   this.db.prepare('INSERT INTO facts VALUES(?,?,?,?,?,?,?,?,?)').run(id,t,'active',source,options.sortieId ?? null,options.tainted?1:0,options.shareable?1:0,at,at);
   this.db.prepare('INSERT INTO facts_fts(text,fact_id) VALUES(?,?)').run(t,id);this.history(id,'created',t,source,at);
   return toFact(this.db.prepare('SELECT * FROM facts WHERE id=?').get(id) as Row);
  });
 }
 edit(id:string,text:unknown,source:string,now=new Date()):Fact|undefined {
  const t=clean(text);const at=now.toISOString();
  return this.tx(()=>{
   const row=this.db.prepare("SELECT * FROM facts WHERE id=? AND status='active'").get(id) as Row|undefined;if(!row)return undefined;
   this.db.prepare('UPDATE facts SET text=?,updated=? WHERE id=?').run(t,at,id);this.db.prepare('UPDATE facts_fts SET text=? WHERE fact_id=?').run(t,id);this.history(id,'edited',t,source,at);
   return toFact(this.db.prepare('SELECT * FROM facts WHERE id=?').get(id) as Row);
  });
 }
 /** Forgotten facts leave recall and lists; their history stays as evidence. */
 forget(id:string,source:string,now=new Date()):boolean {
  const at=now.toISOString();
  return this.tx(()=>{
   const row=this.db.prepare("SELECT text FROM facts WHERE id=? AND status='active'").get(id) as {text:string}|undefined;if(!row)return false;
   this.db.prepare("UPDATE facts SET status='forgotten',updated=? WHERE id=?").run(at,id);this.db.prepare('DELETE FROM facts_fts WHERE fact_id=?').run(id);this.history(id,'forgotten',row.text,source,at);return true;
  });
 }
 list(limit=50):Fact[] {return (this.db.prepare("SELECT * FROM facts WHERE status='active' ORDER BY updated DESC LIMIT ?").all(Math.min(Math.max(1,limit),200)) as Row[]).map(toFact);}
 /** Best matches first (BM25); an empty or wordless query finds nothing rather than everything. */
 recall(text:string,limit=5):Fact[] {
  const q=ftsQuery(text);if(!q)return [];
  return (this.db.prepare("SELECT f.* FROM facts_fts JOIN facts f ON f.id=facts_fts.fact_id WHERE facts_fts MATCH ? AND f.status='active' ORDER BY bm25(facts_fts) LIMIT ?").all(q,Math.min(Math.max(1,limit),20)) as Row[]).map(toFact);
 }
 historyOf(id:string):{kind:string;text:string;source:string;created:string}[] {return this.db.prepare('SELECT kind,text,source,created FROM fact_history WHERE fact_id=? ORDER BY sequence').all(id) as {kind:string;text:string;source:string;created:string}[];}
}
