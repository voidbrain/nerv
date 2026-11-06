import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {Store, OWNER_SOURCE} from '../src/store.ts';
const source=readFileSync('web/public/dashboard/live.js','utf8');
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function fixture(events){
 const {document}=parseHTML('<html><body><div id="detail"></div><div id="detail-sub"></div></body></html>');
 const mapping=source.slice(source.indexOf('  function mapStatus'),source.indexOf('  function toApproval'));
 const loading=source.slice(source.indexOf('  async function loadEvents'),source.indexOf('  // Longer history'));
 const detail=source.slice(source.indexOf('  window.renderDetail ='),source.indexOf('  window.renderBudget ='));
 const code=`const window={},state={log:[]},short=id=>'S-'+id.slice(0,4).toUpperCase(),detailCache={},TOOLS={},known=new Map(),consulted=new Set(),seen=new Set(),phaseOf=new Map(),advisedBy=new Map(),forwardedTo=new Map(),originOf=new Map(),remoteSorties=new Map(),generic=()=>false,baseName=id=>id,baseDetail=()=>{};${mapping}${loading}${detail};return {loadEvents,toSortie,render:window.renderDetail};`;
 return {document,...new Function('document','api','esc',code)(document,async()=>events,esc)};
}
test('ledger relay events reach the live detail with the destination reference, escaped, and no claim that work ran locally',async()=>{
 const store=new Store(':memory:');
 try{
  const id=store.ledger.openSortie(OWNER_SOURCE,'Remote request','trusted');
  store.ledger.note(id,'kaji.forwarded',{base:{id:'NERV-01',name:'Neo <Tokyo>'}});
  store.ledger.note(id,'kaji.answered',{base:{id:'NERV-01',name:'Neo <Tokyo>'},sortieId:'remote-1234'});
  const events=store.ledger.events(id);
  const f=fixture(events);await f.loadEvents(id);
  const raw={id,status:'done',source:'misato',patterns:[],title:'Remote request',created:new Date().toISOString()};
  const mapped=f.toSortie(raw);f.render(mapped);
  assert.match(f.document.getElementById('detail').textContent,/Answered on Neo <Tokyo>\. No actions ran on this base/);
  assert.match(f.document.getElementById('detail').textContent,/Destination sortie: remote-1234/);
  assert.equal(f.document.querySelector('tokyo'),null);
  assert.doesNotMatch(f.document.getElementById('detail').textContent,/answered without using a tool/);
  f.render({...mapped,status:'active',remoteSortie:null});assert.match(f.document.getElementById('detail').textContent,/Waiting for Neo/);
  f.render({...mapped,status:'failed',remoteSortie:null});assert.match(f.document.getElementById('detail').textContent,/No answer received/);
  // The main base never received this request: the same sortie continues locally.
  store.ledger.note(id,'misato.step',{step:{type:'reply',text:'Here'}});
  const local=fixture(store.ledger.events(id));await local.loadEvents(id);const continued=local.toSortie({...raw,status:'open'});
  assert.equal(continued.forwarded,null);assert.equal(continued.remoteSortie,null);local.render(continued);
  assert.match(local.document.getElementById('detail').textContent,/Misato is planning\. No actions yet/);
 }finally{store.close();}
});
test('empty local sorties distinguish planning, failure, stop and a completed tool-free answer',()=>{
 const f=fixture([]);const base={actions:[],pilot:'misato'};
 for(const [status,expected] of [['active',/planning/],['failed',/failed before/],['stood-down',/stopped before/],['done',/answered without using a tool/]]){
  f.render({...base,status});assert.match(f.document.getElementById('detail').textContent,expected);
 }
});
