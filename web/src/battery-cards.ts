import { Component, computed, input, signal } from '@angular/core';

export interface BatteryCardItem {
  id: string;
  packNumber: number;
  series?: string;
  seriesColor?: string;
  label: string;
  brand: string;
  batteryType: string;
  cellCount: number;
  capacityMah: number;
  currentState: 'charged' | 'discharged' | 'stored';
  cycles: number;
  lastResistance: {
    valuesMohm: number[];
    recordedAt: string;
    cyclesAtRecord: number;
  } | null;
  resistanceDueAt: string | null;
  resistanceOverdue: boolean;
  resistanceDueReasons: Array<'days' | 'cycles'>;
  storageReminderActive: boolean;
  healthStatus: 'no_records' | 'healthy' | 'warning' | 'strong_warning' | 'retire';
}

export interface BatteryCardsLabels {
  batteriesTitle: string;
  batteriesEmpty: string;
  batteriesFilterSeries: string;
  batteriesFilterType: string;
  batteriesAll: string;
  batteriesCycles: string;
  batteriesLastResistance: string;
  batteriesNoResistance: string;
  batteriesResistanceDue: string;
  batteriesOverdue: string;
  batteriesStorageDue: string;
  batteriesStored: string;
  batteriesCharged: string;
  batteriesDischarged: string;
}

@Component({
  selector: 'nerv-battery-cards',
  template: `
    <section class="panel batteries" [attr.aria-label]="t().batteriesTitle">
      <div class="batteries-head">
        <h3>{{ t().batteriesTitle }}</h3>
        @if (cards().length > 0) {
          <div class="batteries-filters">
            <label for="bat-filter-series">
              {{ t().batteriesFilterSeries }}
              <select
                id="bat-filter-series"
                [value]="seriesFilter()"
                (change)="seriesFilter.set($any($event.target).value)"
              >
                <option value="">{{ t().batteriesAll }}</option>
                @for (s of seriesOptions(); track s) {
                  <option [value]="s">{{ s }}</option>
                }
              </select>
            </label>
            <label for="bat-filter-type">
              {{ t().batteriesFilterType }}
              <select id="bat-filter-type" [value]="typeFilter()" (change)="typeFilter.set($any($event.target).value)">
                <option value="">{{ t().batteriesAll }}</option>
                @for (tp of typeOptions(); track tp) {
                  <option [value]="tp">{{ tp }}</option>
                }
              </select>
            </label>
          </div>
        }
      </div>

      @if (filteredCards().length === 0) {
        <p class="empty">{{ t().batteriesEmpty }}</p>
      } @else {
        <div class="battery-grid">
          @for (b of filteredCards(); track b.id) {
            <article class="battery-card" [attr.data-battery-id]="b.id" [class.warn]="b.healthStatus !== 'healthy' && b.healthStatus !== 'no_records'">
              <div class="battery-card-head">
                <strong>#{{ b.packNumber }}@if (b.series || b.seriesColor) { ({{ b.series ?? b.seriesColor }})}</strong>
                <span class="battery-state">{{ stateLabel(b.currentState) }}</span>
              </div>
              <p class="battery-meta">{{ b.brand }} · {{ b.batteryType }} · {{ b.capacityMah }} mAh · {{ b.cycles }} {{ t().batteriesCycles }}</p>
              <p class="battery-res">
                <span>{{ t().batteriesLastResistance }}: </span>
                @if (b.lastResistance; as res) {
                  <span>{{ res.valuesMohm.join(', ') }} mΩ ({{ formatDate(res.recordedAt) }})</span>
                } @else {
                  <span>{{ t().batteriesNoResistance }}</span>
                }
              </p>
              @if (b.resistanceDueAt) {
                <p class="battery-due">
                  {{ t().batteriesResistanceDue }}: {{ formatDate(b.resistanceDueAt) }}
                  @if (b.resistanceOverdue) {
                    <strong> · {{ t().batteriesOverdue }}</strong>
                  }
                </p>
              }
              @if (b.storageReminderActive) {
                <p class="battery-storage">{{ t().batteriesStorageDue }}</p>
              }
            </article>
          }
        </div>
      }
    </section>
  `,
})
export class BatteryCards {
  readonly cards = input<readonly BatteryCardItem[]>([]);
  readonly t = input.required<BatteryCardsLabels>();
  readonly language = input<'it' | 'en'>('en');

  readonly seriesFilter = signal('');
  readonly typeFilter = signal('');

  readonly seriesOptions = computed(() => {
    const set = new Set<string>();
    for (const c of this.cards()) {
      const s = c.series ?? c.seriesColor;
      if (s) set.add(s);
    }
    return [...set].sort();
  });

  readonly typeOptions = computed(() => {
    const set = new Set<string>();
    for (const c of this.cards()) {
      if (c.batteryType) set.add(c.batteryType);
    }
    return [...set].sort();
  });

  readonly filteredCards = computed(() => {
    const sf = this.seriesFilter();
    const tf = this.typeFilter();
    return this.cards().filter((c) => {
      const series = c.series ?? c.seriesColor ?? '';
      if (sf && series !== sf) return false;
      if (tf && c.batteryType !== tf) return false;
      return true;
    });
  });

  stateLabel(state: BatteryCardItem['currentState']): string {
    const labels = this.t();
    if (state === 'charged') return labels.batteriesCharged;
    if (state === 'discharged') return labels.batteriesDischarged;
    return labels.batteriesStored;
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(this.language() === 'it' ? 'it-IT' : 'en-GB');
  }
}
