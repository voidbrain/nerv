/** Declarative contract only: no HTML, scripts, attributes, styles or URLs accepted. */
export interface StatusSurface {version:1;component:'nerv-status-card';props:{title:string;detail:string;status:'ok'|'waiting'|'error'}}
export const statusSurfaceSchema={type:'object',required:['version','component','props'],additionalProperties:false,properties:{version:{const:1},component:{const:'nerv-status-card'},props:{type:'object',required:['title','detail','status'],additionalProperties:false,properties:{title:{type:'string',maxLength:120},detail:{type:'string',maxLength:500},status:{enum:['ok','waiting','error']}}}}} as const;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validateSurface(value:unknown):StatusSurface {
 if(!record(value)||(Object.keys(value).length!==3||Object.keys(value).some(k=>!['version','component','props'].includes(k)))||value.version!==1||value.component!=='nerv-status-card'||!record(value.props))throw new Error('Invalid surface.');
 const p=value.props;
 if((Object.keys(p).length!==3||Object.keys(p).some(k=>!['title','detail','status'].includes(k)))||typeof p.title!=='string'||p.title.length>120||typeof p.detail!=='string'||p.detail.length>500||!['ok','waiting','error'].includes(p.status as string))throw new Error('Invalid surface props.');
 return {version:1,component:'nerv-status-card',props:{title:p.title,detail:p.detail,status:p.status as StatusSurface['props']['status']}};
}
