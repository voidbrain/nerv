import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Store } from './store.ts';
async function body(req: IncomingMessage): Promise<Record<string,unknown>> {
  let text=''; for await(const chunk of req) { text+=chunk; if(Buffer.byteLength(text)>8192) throw new Error('Request too large.'); }
  const value:unknown=JSON.parse(text); if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Expected JSON object.'); return value as Record<string,unknown>;
}
export function makeServer(store: Store, token: string) {
  if(token.length<24) throw new Error('NODO_TOKEN must be at least 24 characters.');
  const server = createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    const reply=(status:number,value:unknown)=>{res.writeHead(status);res.end(JSON.stringify(value));};
    const supplied=Buffer.from(req.headers.authorization ?? ''); const expected=Buffer.from(`Bearer ${token}`);
    if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) {reply(401,{error:'Authentication required.'});return;}
    try {
      const path=new URL(req.url ?? '/', 'http://localhost').pathname;
      if(req.method==='GET' && path==='/api/reminders') reply(200,store.list());
      else if(req.method==='POST' && path==='/api/reminders') {const b=await body(req);if(typeof b.title!=='string'||typeof b.due!=='string') throw new Error('Title and due are required.');reply(201,store.add(b.title,b.due));}
      else if(req.method==='DELETE' && /^\/api\/reminders\/[a-f0-9-]+$/.test(path)) reply(store.cancel(path.split('/').at(-1)!)?200:404,{message:'Cancellation processed.'});
      else if(req.method==='GET' && path==='/api/inbox') reply(200,store.inbox());
      else if(req.method==='GET' && path==='/api/doctor') reply(200,{name:'Nodo',mode:'local-core',...store.doctor(),remoteWorkers:'not implemented',providers:'not configured'});
      else reply(404,{error:'Unknown operation.'});
    } catch(e) {reply(400,{error:e instanceof Error?e.message:'Invalid request.'});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.timeout=15000;
  return server;
}
