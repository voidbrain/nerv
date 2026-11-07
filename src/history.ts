/** Keyset pages use immutable SQLite rowids; zero starts at the newest row. */
export interface HistoryPage<T> {items:T[];next:number|null}
export const HISTORY_LIMIT=50;
export const HISTORY_BYTES=32_768;
export function checkHistory(before:number,limit:number):void {
 if(!Number.isSafeInteger(before)||before<0||!Number.isInteger(limit)||limit<1||limit>HISTORY_LIMIT)throw new Error('Invalid history cursor or limit.');
}
/** Keep a page below the IPC frame even with maximum-length Unicode messages. Never lose the first omitted row. */
export function historyPage<T extends {sequence:number}>(rows:T[],limit:number):HistoryPage<T> {
 const items:T[]=[];let bytes=2;
 for(const row of rows.slice(0,limit)){
  const size=Buffer.byteLength(JSON.stringify(row))+1;
  if(bytes+size>HISTORY_BYTES){if(!items.length)throw new Error('History item exceeds the page bound.');break;}
  items.push(row);bytes+=size;
 }
 return {items,next:rows.length>items.length?items.at(-1)!.sequence:null};
}
