import { Component, input } from '@angular/core';

/**
 * F-130-T01: the thin component layer the dashboard sections build on. 🧱 Bricks (@voidbrain/bricks) is meant to
 * provide these, but it cannot be consumed yet without publishing: it has no tag or release to pin, its library is
 * not packaged (an Angular workspace, ng-packagr output), and it asks for Angular ^22.3 while NERV is on 22.2.6.
 * Sections import only from this file, so swapping to bricks later changes this file, not the sections (F-130 record).
 * Both components read only theme tokens (`var(--…)`).
 */
@Component({
  selector: 'nerv-panel',
  host: { class: 'nerv-panel', '[attr.aria-labelledby]': 'headingId()' },
  template: `<header class="panel-head">
      <h2 [id]="headingId()">{{ heading() }}</h2>
      <ng-content select="[panel-meta]" />
    </header>
    <ng-content />`,
  styles: `
    :host {
      display: block;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      color: var(--text);
      min-width: 0;
    }
    .panel-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    h2 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--title);
    }
  `,
})
export class Panel {
  readonly heading = input.required<string>();
  readonly headingId = input.required<string>();
}

@Component({
  selector: 'nerv-stat',
  host: { class: 'nerv-stat', role: 'group', '[attr.aria-label]': 'label()' },
  template: `<span class="label">{{ label() }}</span><strong>{{ value() }}</strong
    ><span class="detail">{{ detail() }}</span>`,
  styles: `
    :host {
      display: grid;
      gap: 2px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel2);
      min-width: 0;
    }
    .label,
    .detail {
      font-size: 12px;
      color: var(--muted);
    }
    strong {
      font-size: 18px;
      color: var(--text);
    }
  `,
})
export class Stat {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly detail = input('');
}
