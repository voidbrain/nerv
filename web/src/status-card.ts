import { validateSurface, type StatusSurface, type NoticeSurface } from '../../shared/surface.ts';

/** Registered executable code is shipped by NERV Agency. Model/server output supplies data only. */
export class NervStatusCard extends HTMLElement {
  private titleNode: HTMLElement;
  private detailNode: HTMLElement;
  private statusNode: HTMLElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const panel = document.createElement('section');
    panel.style.cssText =
      'border:1px solid var(--line);border-radius:8px;padding:20px;margin-bottom:20px;background:var(--panel);color:var(--text)';
    this.titleNode = document.createElement('h2');
    this.detailNode = document.createElement('p');
    this.statusNode = document.createElement('span');
    this.statusNode.setAttribute('role', 'status');
    this.detailNode.style.cssText = 'color:var(--muted);font-size:14px';
    panel.append(this.titleNode, this.detailNode, this.statusNode);
    root.append(panel);
  }

  set surface(value: unknown) {
    try {
      const s = validateSurface(value);
      if (s.component !== 'nerv-status-card') throw new Error('Expected nerv-status-card component');
      const p = s.props as StatusSurface['props'];
      this.titleNode.textContent = p.title;
      this.detailNode.textContent = p.detail;
      this.statusNode.textContent = p.status;
      this.statusNode.style.color = p.status === 'error' ? 'var(--error)' : 'var(--accent)';
    } catch {
      this.titleNode.textContent = 'Nodo';
      this.detailNode.textContent = 'Invalid surface';
      this.statusNode.textContent = 'error';
    }
  }
}

export class NervNoticeCard extends HTMLElement {
  private topicNode: HTMLElement;
  private messageNode: HTMLElement;
  private toneNode: HTMLElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const panel = document.createElement('section');
    panel.style.cssText =
      'border:1px solid var(--line);border-radius:8px;padding:20px;margin-bottom:20px;background:var(--panel);color:var(--text)';
    this.topicNode = document.createElement('h3');
    this.topicNode.style.cssText = 'margin:0 0 6px;font-size:16px;color:var(--text)';
    this.messageNode = document.createElement('p');
    this.messageNode.style.cssText = 'color:var(--muted);font-size:13px;margin:0 0 10px;line-height:1.5';
    this.toneNode = document.createElement('span');
    this.toneNode.setAttribute('role', 'status');
    this.toneNode.style.cssText =
      'display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:bold;letter-spacing:0.5px';
    panel.append(this.topicNode, this.messageNode, this.toneNode);
    root.append(panel);
  }

  set surface(value: unknown) {
    try {
      const s = validateSurface(value);
      if (s.component !== 'nerv-notice-card') throw new Error('Expected nerv-notice-card component');
      const p = s.props as NoticeSurface['props'];
      this.topicNode.textContent = p.topic;
      this.messageNode.textContent = p.message;
      this.toneNode.textContent = p.tone.toUpperCase();
      if (p.tone === 'warn') {
        this.toneNode.style.background = 'var(--error)';
        this.toneNode.style.color = 'var(--ink)';
      } else {
        this.toneNode.style.background = 'var(--accent)';
        this.toneNode.style.color = 'var(--ink)';
      }
    } catch {
      this.topicNode.textContent = 'Avviso';
      this.messageNode.textContent = 'Invalid surface';
      this.toneNode.textContent = 'ERROR';
      this.toneNode.style.background = 'var(--error)';
      this.toneNode.style.color = 'var(--ink)';
    }
  }
}

export function registerSurfaces() {
  if (!customElements.get('nerv-status-card')) {
    customElements.define('nerv-status-card', NervStatusCard);
  }
  if (!customElements.get('nerv-notice-card')) {
    customElements.define('nerv-notice-card', NervNoticeCard);
  }
}
