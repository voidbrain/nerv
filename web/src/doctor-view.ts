import { Component, computed, input } from '@angular/core';
import type { messages } from './i18n';

type Messages = { [K in keyof (typeof messages)['en']]: string };

export interface DoctorCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
  hint?: string;
}

function sanitize(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {};
  const cleaned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
    if (/token|secret|password|bearer|auth|privateKey/i.test(key)) {
      cleaned[key] = '[redacted]';
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      cleaned[key] = sanitize(val);
    } else {
      cleaned[key] = val;
    }
  }
  return cleaned;
}

@Component({
  selector: 'nerv-doctor-view',
  template: `
    <section class="panel doctor-panel">
      <div class="doctor-header">
        <div>
          <h2>{{ t().doctor }}</h2>
          <p class="hint">{{ t().doctorHint }}</p>
        </div>
        <span
          class="doctor-overall-badge"
          [class.badge-ok]="overall() === 'ok'"
          [class.badge-warn]="overall() === 'warn'"
          [class.badge-error]="overall() === 'error'"
          role="status"
        >
          {{ overall() === 'ok' ? t().doctorAllOk : overall() === 'warn' ? t().doctorDegraded : t().doctorIssue }}
        </span>
      </div>

      <div class="doctor-grid">
        @for (c of checks(); track c.id) {
          <article
            class="doctor-check"
            [class.check-ok]="c.status === 'ok'"
            [class.check-warn]="c.status === 'warn'"
            [class.check-error]="c.status === 'error'"
          >
            <div class="doctor-check-row">
              <span
                class="doctor-badge"
                [class.badge-ok]="c.status === 'ok'"
                [class.badge-warn]="c.status === 'warn'"
                [class.badge-error]="c.status === 'error'"
              >
                {{ c.status === 'ok' ? 'OK' : c.status === 'warn' ? 'WARN' : 'ERR' }}
              </span>
              <strong>{{ c.label }}</strong>
              <span class="severity-label">
                {{ c.status === 'ok' ? t().healthy : c.status === 'warn' ? t().warning : t().critical }}
              </span>
            </div>
            <p class="doctor-detail">{{ c.detail }}</p>
            @if (c.hint) {
              <div class="doctor-fix" role="note">
                <span class="fix-title">{{ t().hintPrefix }}:</span> {{ c.hint }}
              </div>
            }
          </article>
        }
      </div>

      <div class="doctor-raw-section">
        <h3>{{ t().rawDiagnostics }}</h3>
        <pre tabindex="0" role="region" [attr.aria-label]="t().rawDiagnostics">{{ sanitizedJson() }}</pre>
      </div>
    </section>
  `,
  styles: `
    .doctor-panel {
      display: flex;
      flex-direction: column;
      gap: 20px;
      min-width: 0;
      max-width: 100%;
    }
    .doctor-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 16px;
    }
    .doctor-header h2 {
      margin: 0 0 4px;
    }
    .doctor-header p {
      margin: 0;
    }
    .doctor-overall-badge {
      display: inline-flex;
      align-items: center;
      padding: 6px 14px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    .doctor-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      min-width: 0;
    }
    @media (min-width: 640px) {
      .doctor-grid {
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }
    }
    .doctor-check {
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }
    .doctor-check.check-warn {
      border-color: var(--accent);
    }
    .doctor-check.check-error {
      border-color: var(--error);
    }
    .doctor-check-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .doctor-check-row strong {
      font-size: 13px;
      color: var(--text);
      flex: 1;
    }
    .doctor-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: bold;
      flex-shrink: 0;
    }
    .badge-ok {
      background: var(--accent);
      color: var(--ink);
    }
    .badge-warn {
      background: transparent;
      border: 1px solid var(--accent);
      color: var(--accent);
    }
    .badge-error {
      background: var(--error);
      color: var(--ink);
    }
    .severity-label {
      font-size: 11px;
      color: var(--muted);
    }
    .doctor-detail {
      font-size: 12px;
      color: var(--muted);
      margin: 0;
      word-break: break-word;
    }
    .doctor-fix {
      font-size: 11px;
      line-height: 1.4;
      color: var(--text);
      background: var(--panel);
      border-left: 3px solid var(--accent);
      padding: 6px 10px;
      border-radius: 0 4px 4px 0;
      margin-top: 4px;
    }
    .check-error .doctor-fix {
      border-left-color: var(--error);
    }
    .fix-title {
      font-weight: 600;
      color: var(--accent);
    }
    .check-error .fix-title {
      color: var(--error);
    }
    .doctor-raw-section {
      border-top: 1px solid var(--line);
      padding-top: 16px;
      min-width: 0;
      max-width: 100%;
    }
    .doctor-raw-section h3 {
      font-size: 13px;
      margin: 0 0 10px;
      color: var(--muted);
    }
    pre {
      margin: 0;
      padding: 14px;
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 4px;
      overflow-x: auto;
      max-height: 260px;
      min-width: 0;
      max-width: 100%;
      white-space: pre-wrap;
      word-break: break-word;
    }
  `,
})
export class DoctorView {
  readonly t = input.required<Messages>();
  readonly raw = input.required<unknown>();

  readonly sanitized = computed(() => sanitize(this.raw()));
  readonly sanitizedJson = computed(() => JSON.stringify(this.sanitized(), null, 2));

  readonly checks = computed<DoctorCheck[]>(() => {
    const d = this.sanitized() as Record<string, unknown>;
    const t = this.t();
    const result: DoctorCheck[] = [];

    // 1. Central Dogma (SQLite database)
    const db = d['database'] as { quick_check?: string } | undefined;
    const schema = d['schema'] as { user_version?: number } | undefined;
    const isDbOk = db?.quick_check === 'ok';
    result.push({
      id: 'database',
      label: t.checkDatabase,
      status: isDbOk ? 'ok' : 'error',
      detail:
        (schema?.user_version ? 'schema v' + schema.user_version + ' · ' : '') +
        (db?.quick_check ? 'quick_check ' + db.quick_check : 'quick_check ok'),
      hint: isDbOk ? undefined : t.dbFixHint,
    });

    // 2. Scheduler & nervous process
    const processes = d['processes'] as { nervous?: number; brain?: number; brainAlive?: boolean } | undefined;
    const hasNervous = processes ? Boolean(processes.nervous) : d['mode'] === 'local-core';
    result.push({
      id: 'scheduler',
      label: t.checkScheduler,
      status: hasNervous ? 'ok' : 'error',
      detail: processes?.nervous ? `pid ${processes.nervous}` : 'local-core mode active',
      hint: hasNervous ? undefined : t.schedulerFixHint,
    });

    // 3. Brain process
    const isBrainAlive = processes ? processes.brainAlive !== false : true;
    result.push({
      id: 'brain',
      label: t.checkBrain,
      status: isBrainAlive ? 'ok' : 'error',
      detail: processes?.brain
        ? `pid ${processes.brain}${isBrainAlive ? ' · alive' : ' · stopped'}`
        : 'brain process online',
      hint: isBrainAlive ? undefined : t.brainFixHint,
    });

    // 4. Model routes
    const routes = d['routes'] as
      { local?: { state?: string; error?: string }; cloud?: { state?: string; error?: string } } | undefined;
    const localDown = routes?.local?.state === 'down';
    const cloudDown = routes?.cloud?.state === 'down';
    const routeStatus = localDown || cloudDown ? 'warn' : 'ok';
    const routeDetail = localDown
      ? `S² local route down: ${routes?.local?.error ?? 'unreachable'}`
      : cloudDown
        ? `Cloud route down: ${routes?.cloud?.error ?? 'unreachable'}`
        : 'S² and configured routes healthy';
    const routeHint = localDown ? t.routeFixHint : cloudDown ? t.routeFixHint : undefined;
    result.push({
      id: 'routes',
      label: t.checkRoutes,
      status: routeStatus,
      detail: routeDetail,
      hint: routeHint,
    });

    // 5. Reminders & inbox
    const pending = d['pending'] as { count?: number } | undefined;
    const count = pending?.count ?? 0;
    result.push({
      id: 'reminders',
      label: t.checkReminders,
      status: 'ok',
      detail: `${count} pending`,
    });

    // 6. Degraded notices
    const degraded = d['degraded'] as string[] | undefined;
    if (Array.isArray(degraded) && degraded.length > 0) {
      result.push({
        id: 'degraded',
        label: t.doctorDegraded,
        status: 'warn',
        detail: degraded.join('; '),
        hint: t.degradedFixHint,
      });
    }

    // 7. Base identity
    const base = d['base'] as { id?: string; name?: string } | undefined;
    result.push({
      id: 'base',
      label: t.checkBase,
      status: 'ok',
      detail: base?.id ? `${base.id} · ${base.name ?? ''}` : 'local node active',
    });

    return result;
  });

  readonly overall = computed<'ok' | 'warn' | 'error'>(() => {
    const list = this.checks();
    if (list.some((c) => c.status === 'error')) return 'error';
    if (list.some((c) => c.status === 'warn')) return 'warn';
    return 'ok';
  });
}
