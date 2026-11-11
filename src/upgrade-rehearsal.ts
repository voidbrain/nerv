import {createHash} from 'node:crypto';
import {chmodSync,closeSync,constants,copyFileSync,existsSync,lstatSync,mkdtempSync,openSync,readFileSync,readSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from './store.ts';
import {UPGRADE_CONTRACT} from './upgrade-contract.ts';

/**
 * Upgrade rehearsal (F-005-T06, review only). The reader of THIS checkout opens a private copy of a lifecycle backup,
 * and the result is compared with the untouched copy: nothing is inferred from markers, and neither the backup, the
 * data home, the checkout nor any service is changed. A clean report is evidence for a review, never an admission.
 */
export type UpgradeReader=(database:string,home:string)=>void|Promise<void>;
export interface RehearsalReport {
 version:1;execution:'rehearsal-only';contract:typeof UPGRADE_CONTRACT;
 source:{digest:string;schema:number};
 result?:{schema:number;forwardOnly:boolean;tables:number;rows:number};
 blockers:string[];note:string;
}
const NOTE='Rehearsal on a private copy only. It admits no upgrade, and a schema that moves forward can be undone only by a separately reviewed restore.';
const LIVE=['nerv.sqlite','nodo.sqlite','base-key','token'];
const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
function fileHash(path:string):string {const fd=openSync(path,'r'),digest=createHash('sha256'),bytes=Buffer.alloc(65536);try{let n:number;while((n=readSync(fd,bytes,0,bytes.length,null))>0)digest.update(bytes.subarray(0,n));return digest.digest('hex');}finally{closeSync(fd);}}
function privateEntry(path:string,uid:number,directory:boolean):void {
 const stat=lstatSync(path);
 if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile())||stat.uid!==uid||stat.mode&0o077||realpathSync(path)!==path)throw Error('The backup must be a private, symlink-free copy owned by this user.');
}
/** The reader a candidate checkout ships: its real Store, with the copied configuration as its data home. */
export const currentReader:UpgradeReader=(database,home)=>{new Store(database,undefined,{home}).db.close();};

interface Comparison {schema:number;tables:number;rows:number;blockers:string[]}
/** Compares the untouched copy with the copy a reader opened. Both are opened read-only. */
function compare(prior:string,next:string):Comparison {
 const blockers:string[]=[],db=new DatabaseSync(prior,{readOnly:true});let tables=0,rows=0,schema=-1;
 try{
  db.prepare('ATTACH DATABASE ? AS rehearsed').run(next);
  schema=Number(db.prepare('PRAGMA rehearsed.user_version').get()!.user_version);
  if(db.prepare('PRAGMA rehearsed.integrity_check').get()!.integrity_check!=='ok')blockers.push('The data fails its integrity check after the reader ran.');
  const violations=(name:string)=>db.prepare('PRAGMA '+name+'.foreign_key_check').all().length;
  try{if(violations('rehearsed')>violations('main'))blockers.push('The reader left new foreign-key violations.');}catch{blockers.push('The reader left foreign keys that can no longer be checked.');}
  const listed=(name:string)=>db.prepare('SELECT name,sql FROM '+name+".sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string;sql:string|null}[];
  const before=listed('main'),after=new Set(listed('rehearsed').map(t=>t.name));
  const virtual=before.filter(t=>/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(t.sql??'')).map(t=>t.name);
  for(const table of before){
   if(virtual.some(name=>table.name.startsWith(name+'_')))continue;
   if(!after.has(table.name)){blockers.push('Table '+table.name+' is missing after the reader ran.');continue;}
   if(virtual.includes(table.name))continue;
   tables++;
   const columns=(name:string)=>db.prepare('PRAGMA '+name+'.table_info('+quote(table.name)+')').all() as {name:string;pk:number}[];
   const keys=columns('main').filter(c=>c.pk>0).map(c=>c.name),kept=new Set(columns('rehearsed').map(c=>c.name));
   if(keys.some(key=>!kept.has(key))){blockers.push('Table '+table.name+' lost a key column.');continue;}
   const match=keys.map(key=>'b.'+quote(key)+' IS a.'+quote(key));
   const lost=(conditions:string[])=>Number(db.prepare('SELECT count(*) AS n FROM main.'+quote(table.name)+' a WHERE NOT EXISTS(SELECT 1 FROM rehearsed.'+quote(table.name)+' b WHERE '+conditions.join(' AND ')+')').get()!.n);
   // Row ids are channel cursors (the inbox) and must survive with their keys; a WITHOUT ROWID table has only its keys.
   let missing:number;try{missing=lost([...match,'b.rowid=a.rowid']);}catch(error){if(!keys.length)throw error;missing=lost(match);}
   if(missing)blockers.push('Table '+table.name+' lost or renumbered '+missing+' existing row(s).');
   rows+=Number(db.prepare('SELECT count(*) AS n FROM main.'+quote(table.name)).get()!.n);
  }
 }finally{db.close();}
 return {schema,tables,rows,blockers};
}

/**
 * Rehearses `reader` on a copy of BACKUP (the layout a lifecycle update backup has: database.sqlite, optional
 * config.json and manifest.json). The actual input schema is checked against the contract before the reader runs.
 */
export async function rehearseUpgrade(backup:string,reader:UpgradeReader=currentReader):Promise<RehearsalReport> {
 const uid=process.getuid?.();if(uid===undefined||process.platform==='win32')throw Error('Upgrade rehearsal needs POSIX private-file ownership; it is not available on this platform yet.');
 if(!isAbsolute(backup)||resolve(backup)!==backup)throw Error('Name the backup directory by its absolute path.');
 privateEntry(backup,uid,true);
 if(readdirSync(backup).some(name=>LIVE.includes(name)||/-(wal|shm|journal)$/.test(name)))throw Error('This looks like a live data home. Rehearse on a backup copy only.');
 const database=join(backup,'database.sqlite'),config=join(backup,'config.json'),manifest=join(backup,'manifest.json');
 privateEntry(database,uid,false);if(existsSync(config))privateEntry(config,uid,false);
 const digest=fileHash(database),blockers:string[]=[];
 if(existsSync(manifest)){privateEntry(manifest,uid,false);let recorded:unknown;try{recorded=(JSON.parse(readFileSync(manifest,'utf8')) as {database?:unknown}).database;}catch{recorded=undefined;}if(recorded!==digest)throw Error('The database differs from its backup manifest; take a fresh backup.');}
 const work=mkdtempSync(join(realpathSync(tmpdir()),'nerv-rehearsal-'));
 try{
  chmodSync(work,0o700);const prior=join(work,'prior.sqlite'),next=join(work,'nerv.sqlite');
  for(const copy of [prior,next]){copyFileSync(database,copy,constants.COPYFILE_EXCL);chmodSync(copy,0o600);}
  if(existsSync(config)){copyFileSync(config,join(work,'config.json'),constants.COPYFILE_EXCL);chmodSync(join(work,'config.json'),0o600);}
  if(fileHash(prior)!==digest||fileHash(next)!==digest)throw Error('The backup changed while it was copied; take a fresh backup.');
  const source=new DatabaseSync(prior,{readOnly:true});let schema:number,sound:boolean;
  try{schema=Number(source.prepare('PRAGMA user_version').get()!.user_version);sound=source.prepare('PRAGMA quick_check').get()!.quick_check==='ok';}finally{source.close();}
  const report=(result?:RehearsalReport['result']):RehearsalReport=>({version:1,execution:'rehearsal-only',contract:UPGRADE_CONTRACT,source:{digest,schema},...(result?{result}:{}),blockers,note:NOTE});
  if(!sound)blockers.push('The backup fails its integrity check.');
  if(schema<UPGRADE_CONTRACT.minimumServiceSchema||schema>UPGRADE_CONTRACT.readerSchema)blockers.push('Schema '+schema+' is outside what this reader supports ('+UPGRADE_CONTRACT.minimumServiceSchema+' to '+UPGRADE_CONTRACT.readerSchema+').');
  if(blockers.length)return report();
  let first:Comparison|undefined;
  // Twice: a service restarts, so the reader must leave data it already opened exactly as supported as the first time.
  for(const pass of ['first','second'] as const){
   try{await reader(next,work);}catch(error){blockers.push('The reader refused or failed on the '+pass+' open: '+(error instanceof Error?error.message:'unknown error').replace(/\s+/g,' ').slice(0,200));return report(first&&{schema:first.schema,forwardOnly:first.schema>schema,tables:first.tables,rows:first.rows});}
   const seen=compare(prior,next);blockers.push(...seen.blockers);
   if(seen.schema<schema)blockers.push('The reader lowered the schema from '+schema+' to '+seen.schema+'.');
   if(seen.schema>UPGRADE_CONTRACT.readerSchema)blockers.push('The reader wrote schema '+seen.schema+', beyond its own contract.');
   if(first&&seen.schema!==first.schema)blockers.push('Opening the data again changed its schema.');
   first??=seen;if(blockers.length)break;
  }
  return report({schema:first!.schema,forwardOnly:first!.schema>schema,tables:first!.tables,rows:first!.rows});
 }finally{rmSync(work,{recursive:true,force:true});}
}
