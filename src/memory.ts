import {transaction} from './sqlite-transaction.ts';
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
 CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(text, fact_id UNINDEXED);
 CREATE TABLE IF NOT EXISTS episodes(id TEXT PRIMARY KEY, since TEXT NOT NULL, until TEXT NOT NULL, summary TEXT NOT NULL, exchanges INTEGER NOT NULL, proposed INTEGER NOT NULL, created TEXT NOT NULL);
 CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(summary, episode_id UNINDEXED);`;
export interface Episode {id:string;since:string;until:string;summary:string;exchanges:number;proposed:number;created:string}
export interface Fact {id:string;text:string;status:'active'|'forgotten';source:string;sortieId:string|null;tainted:boolean;shareable:boolean;created:string;updated:string}
const MAX_FACT_CHARS=500;
/** The comparison form of a fact: case, spacing and a final full stop do not make a different fact. */
export const factKey=(text:string)=>text.trim().replace(/\s+/g,' ').replace(/[.!]+$/,'').toLowerCase();
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
 constructor(db:DatabaseSync){
  this.db=db;
  // Summaries written before their index existed are indexed once (F-022: recall finds them too).
  const indexed=(db.prepare('SELECT count(*) AS n FROM episodes_fts').get() as {n:number}).n;
  if(!indexed)db.exec('INSERT INTO episodes_fts(summary,episode_id) SELECT summary,id FROM episodes');
 }
 private history(id:string,kind:string,text:string,source:string,now:string){this.db.prepare('INSERT INTO fact_history(fact_id,kind,text,source,created) VALUES(?,?,?,?,?)').run(id,kind,text,source,now);}
 private tx<T>(work:()=>T):T {return transaction(this.db,work);}
 /** An active fact. Misato's proposals reach here only after the owner approved the memory.remember card. */
 add(text:unknown,source:'owner'|'misato',options:{sortieId?:string;tainted?:boolean;shareable?:boolean}={},now=new Date()):Fact {
  const t=clean(text);const id=randomUUID();const at=now.toISOString();
  return this.tx(()=>{
   const same=(this.db.prepare("SELECT * FROM facts WHERE status='active'").all() as Row[]).find(r=>factKey(r.text)===factKey(t));if(same)return toFact(same);
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
 /** Shareable facts may be offered to a cloud model; every fact starts local-only. The change is part of the history. */
 share(id:string,shareable:boolean,source:string,now=new Date()):Fact|undefined {
  const at=now.toISOString();
  return this.tx(()=>{
   const row=this.db.prepare("SELECT * FROM facts WHERE id=? AND status='active'").get(id) as Row|undefined;if(!row)return undefined;
   if((row.shareable===1)!==shareable){this.db.prepare('UPDATE facts SET shareable=?,updated=? WHERE id=?').run(shareable?1:0,at,id);this.history(id,shareable?'shared':'local-only',row.text,source,at);}
   return toFact(this.db.prepare('SELECT * FROM facts WHERE id=?').get(id) as Row);
  });
 }
 list(limit=50):Fact[] {return (this.db.prepare("SELECT * FROM facts WHERE status='active' ORDER BY updated DESC LIMIT ?").all(Math.min(Math.max(1,limit),200)) as Row[]).map(toFact);}
 /** Best matches first (BM25); an empty or wordless query finds nothing rather than everything. */
 recall(text:string,limit=5):Fact[] {
  const q=ftsQuery(text);if(!q)return [];
  return (this.db.prepare("SELECT f.* FROM facts_fts JOIN facts f ON f.id=facts_fts.fact_id WHERE facts_fts MATCH ? AND f.status='active' ORDER BY bm25(facts_fts) LIMIT ?").all(q,Math.min(Math.max(1,limit),20)) as Row[]).map(toFact);
 }
 /** Instrumentality's summaries that match a request, best first (F-022): what was said and done on earlier days. */
 recallEpisodes(text:string,limit=2):Episode[] {
  const q=ftsQuery(text);if(!q)return [];
  return this.db.prepare('SELECT e.* FROM episodes_fts JOIN episodes e ON e.id=episodes_fts.episode_id WHERE episodes_fts MATCH ? ORDER BY bm25(episodes_fts) LIMIT ?').all(q,Math.min(Math.max(1,limit),5)) as unknown as Episode[];
 }
 /** Instrumentality's summaries, newest first; the latest one's `until` is where the next consolidation starts. */
 episodes(limit=10):Episode[] {return this.db.prepare('SELECT * FROM episodes ORDER BY until DESC LIMIT ?').all(Math.min(Math.max(1,limit),100)) as unknown as Episode[];}
 saveEpisode(e:Omit<Episode,'id'|'created'>,now=new Date(),afterSave?:()=>void):Episode {const id=randomUUID();this.tx(()=>{this.db.prepare('INSERT INTO episodes VALUES(?,?,?,?,?,?,?)').run(id,e.since,e.until,e.summary.slice(0,1500),e.exchanges,e.proposed,now.toISOString());this.db.prepare('INSERT INTO episodes_fts(summary,episode_id) VALUES(?,?)').run(e.summary.slice(0,1500),id);afterSave?.();});return {...e,id,created:now.toISOString()};}
 historyOf(id:string):{kind:string;text:string;source:string;created:string}[] {return this.db.prepare('SELECT kind,text,source,created FROM fact_history WHERE fact_id=? ORDER BY sequence').all(id) as {kind:string;text:string;source:string;created:string}[];}
}
