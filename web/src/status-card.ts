import {validateSurface} from '../../shared/surface.ts';
/** Registered executable code is shipped by NERV Agency. Model/server output supplies data only. */
class NervStatusCard extends HTMLElement {
 private titleNode:HTMLElement;private detailNode:HTMLElement;private statusNode:HTMLElement;
 constructor(){super();const root=this.attachShadow({mode:'open'});const panel=document.createElement('section');panel.style.cssText='border:1px solid var(--line);border-radius:8px;padding:20px;margin-bottom:20px;background:var(--panel);color:var(--text)';
 this.titleNode=document.createElement('h3');this.detailNode=document.createElement('p');this.statusNode=document.createElement('span');this.statusNode.setAttribute('role','status');this.detailNode.style.cssText='color:var(--muted);font-size:14px';panel.append(this.titleNode,this.detailNode,this.statusNode);root.append(panel);}
 set surface(value:unknown){try{const s=validateSurface(value);this.titleNode.textContent=s.props.title;this.detailNode.textContent=s.props.detail;this.statusNode.textContent=s.props.status;this.statusNode.style.color=s.props.status==='error'?'var(--error)':'var(--accent)';}catch{this.titleNode.textContent='Nodo';this.detailNode.textContent='Invalid surface';this.statusNode.textContent='error';}}
}
export function registerSurfaces(){if(!customElements.get('nerv-status-card'))customElements.define('nerv-status-card',NervStatusCard);}
