import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createServer} from 'node:net';
import {Store} from '../src/store.ts';
import {Registry,signRecord,type RegistryBody} from '../src/kaji.ts';
import {KajiLink,type RegistryPort} from '../src/kaji-link.ts';
const keys=()=>{const pair=generateKeyPairSync('ed25519');return {...pair,publicText:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')};};
async function freePort(){const server=createServer();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const p=(server.address() as {port:number}).port;await new Promise<void>(done=>server.close(()=>done()));return p;}
const adapter=(registry:Registry):RegistryPort=>({bases:async()=>registry.bases(),records:async()=>registry.records(),add:async(records)=>{for(const r of records)registry.add(r);return records.length;},seen:async(u)=>registry.seen(u),lastSeen:async()=>registry.lastSeen()});
test('review regression: migrated and old-root peers retaining identical base keys cannot mark each other online',async()=>{
 const roots=[keys(),keys()],base=[keys(),keys()],ports=[await freePort(),await freePort()],stores=[new Store(':memory:'),new Store(':memory:')];const links:KajiLink[]=[],registries:Registry[]=[];
 try{
  for(let i=0;i<2;i++){
   const root=roots[i]!,registry=new Registry(stores[i]!.db,root.publicText);registries.push(registry);
   for(let j=0;j<2;j++){const body:RegistryBody={kind:'enrol',serial:j+1,baseId:'BASE-0'+(j+1),name:'Neutral '+j,publicKey:base[j]!.publicText,address:'127.0.0.1:'+ports[j],issued:new Date().toISOString()};registry.add(signRecord(root.privateKey,body));}
   const options={baseId:'BASE-0'+(i+1),key:base[i]!.privateKey,publicKey:base[i]!.publicText,registry:adapter(registry),trust:{root:root.publicText,required:i===1},log:()=>{}};links.push(new KajiLink(options));
  }
  await Promise.all(links.map(link=>link.start(50)));await new Promise(done=>setTimeout(done,350));
  assert.equal(registries[0]!.lastSeen()['BASE-02'],undefined);assert.equal(registries[1]!.lastSeen()['BASE-01'],undefined);
 }finally{await Promise.all(links.map(link=>link.stop()));stores.forEach(store=>store.close());}
});
