import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {parseHTML} from 'linkedom';
const source=readFileSync('web/public/dashboard/live.js','utf8');
test('each pilot card owns an independent labelled model selector, drafts survive redraws and missing models stay explicit',()=>{
 const {document}=parseHTML('<html><body><div id="melons"></div></body></html>');
 const roster=[{id:'printer',name:'Print Master',domain:'printing',keywords:['filament'],model:'first',stage:'prototype'},{id:'artist',name:'Artist',domain:'images',keywords:['photo'],model:'second',stage:'prototype'}];
 const drafts=new Map();const models={models:{roles:{consultant:{model:'first'}}},ollama:{models:[{name:'first'},{name:'second'}]}};
 const code=source.slice(source.indexOf('  window.renderMelons ='),source.indexOf('  document.addEventListener("change", e => {',source.indexOf('  window.renderMelons =')));
 const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 const render=new Function('document','state','modelsData','pilotDrafts','esc',`const window={},pilotBusy=new Set(),PLANNED='planned',stageTabs=()=>'',currentTab=()=> 'prototype';${code};return window.renderMelons;`)(document,{pilots:roster},models,drafts,esc);
 render();assert.equal(document.querySelectorAll('.card').length,3);assert.equal(document.querySelectorAll('.card form').length,3);
 const selected=id=>document.getElementById('pilot-model-'+id).querySelector('option[selected]').getAttribute('value');
 assert.equal(selected('generic'),'first');assert.equal(selected('printer'),'first');assert.equal(selected('artist'),'second');
 assert.equal(document.querySelector('label[for="pilot-model-generic"]').textContent,'Generic pilot model');assert.equal(document.querySelector('label[for="pilot-model-printer"]').textContent,'Model for Print Master');
 drafts.set('printer','second');render();assert.equal(selected('printer'),'second');assert.equal(selected('artist'),'second');
 drafts.clear();roster[0].model='not installed';render();assert.match(document.querySelector('#pilot-model-printer option[selected]').textContent,/unavailable locally/);assert.ok(document.querySelector('#pilot-model-printer option[selected]').hasAttribute('disabled'));
 assert.equal(document.querySelector('#pilot-model-printer option[value="off"]'),null,'only the generic fallback can be switched off');
 assert.ok(!source.slice(source.indexOf('  window.renderModels ='),source.indexOf('  const applyModels =')).includes('m-consultant'),'Models panel keeps only role controls');
});
