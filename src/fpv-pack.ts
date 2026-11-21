import type { DatabaseSync } from 'node:sqlite';
import {
  BATTERY_SCHEMA,
  BatteryRegistry,
  formatBatteryStateLines,
  parseBatteryStatusPhrase,
  type RegisterBatteryInput,
} from './batteries.ts';
import { buildBatteryDashboardCards } from './battery-health.ts';
import { BatteryStorageReminders } from './battery-storage-reminders.ts';
import { FLEET_SCHEMA, FleetStore } from './fleet.ts';
import { FPV_BUILDS_SCHEMA, FpvBuildStore } from './fpv-builds.ts';
import type { PackManifest } from './packs.ts';
import type { PhotoStore } from './photos.ts';
import type { StoreReminders } from './store-reminders.ts';

export type { RegisterBatteryInput };

export interface FpvStoreSlice {
  readonly batteries: BatteryRegistry;
  readonly fleet: FleetStore;
  readonly fpvBuilds: FpvBuildStore;
  readonly batteryStorageReminders: BatteryStorageReminders;
  tick(now: Date, language: 'it' | 'en'): void;
  batteryCards(): ReturnType<typeof buildBatteryDashboardCards>;
  registerBattery(input: RegisterBatteryInput): {
    battery: ReturnType<BatteryRegistry['register']>;
    items: ReturnType<typeof buildBatteryDashboardCards>;
  };
}

export function createFpvStoreSlice(db: DatabaseSync, reminders: StoreReminders, photos: PhotoStore): FpvStoreSlice {
  db.exec(FPV_BUILDS_SCHEMA);
  db.exec(BATTERY_SCHEMA);
  const batteries = new BatteryRegistry(db);
  db.exec(FLEET_SCHEMA);
  const fleet = new FleetStore(db);
  const fpvBuilds = new FpvBuildStore(db);
  let storageReminders: BatteryStorageReminders | undefined;

  const batteryCards = () =>
    buildBatteryDashboardCards(batteries).map((card) => {
      const attached = photos.list('battery', card.id).map((p) => ({
        id: p.id,
        url: p.url,
        ...(p.caption ? { caption: p.caption } : {}),
      }));
      return attached.length ? { ...card, photos: attached } : card;
    });

  return {
    batteries,
    fleet,
    fpvBuilds,
    get batteryStorageReminders() {
      return (storageReminders ??= new BatteryStorageReminders(db, reminders));
    },
    tick(now: Date, language: 'it' | 'en') {
      batteries.deliverDueResistancePrompts(now, language);
      this.batteryStorageReminders.syncAll(batteries.list(), now);
    },
    batteryCards,
    registerBattery(input: RegisterBatteryInput) {
      const battery = batteries.register(input);
      return { battery, items: batteryCards() };
    },
  };
}

export function fpvFleetSnapshot(store: unknown): {
  drones: unknown[];
  parts: unknown[];
  spares: unknown[];
  crashes: unknown[];
} {
  const s = store as { fleet?: FleetStore; photos?: PhotoStore };
  if (!s.fleet) return { drones: [], parts: [], spares: [], crashes: [] };
  const drones = s.fleet.listDrones();
  const parts = drones.flatMap((d) =>
    s.fleet!.listParts(d.id).map((p) => ({
      ...p,
      photos: s.photos?.list('part', p.id) ?? [],
    })),
  );
  const spares = s.fleet.listSpares();
  const crashes = s.fleet.listCrashes().map((c) => ({
    ...c,
    photos: s.photos?.list('crash', c.id) ?? [],
  }));
  return { drones, parts, spares, crashes };
}

export const fpvPackManifest: PackManifest = {
  id: 'fpv',
  name: 'FPV',
  tools: [
    'batteries.list',
    'batteries.chat',
    'batteries.due',
    'batteries.resistance',
    'fleet.chat',
    'fpv.blackbox_report',
    'fpv.import_build',
    'fpv.add_doc',
    'fpv.wiring_answer',
  ],
  tables: ['batteries', 'battery_logs', 'drones', 'drone_parts', 'spares', 'crashes', 'fpv_builds'],
  chatPhrases: [{ id: 'battery-status', pattern: /^\s*(?:stato batterie|battery status)\s*$/i }],
  telegramCaptions: ['crash', 'part', 'battery'],
  dashboardPanels: [
    { id: 'batteries', title: 'Batteries', route: '/batteries' },
    { id: 'fleet', title: 'Fleet', route: '/fleet' },
  ],
  async handleTelegramText(text: string, store: unknown) {
    const lang = parseBatteryStatusPhrase(text);
    const s = store as { batteryCards?: () => unknown[] | Promise<unknown[]> };
    if (!lang || !s.batteryCards) return undefined;
    const cards = (await s.batteryCards()) as Parameters<typeof formatBatteryStateLines>[0];
    return formatBatteryStateLines(cards, lang);
  },
  resolveTelegramPhoto(store: unknown, ownerKind: string, query: string) {
    const s = store as { fleet?: FleetStore; batteries?: BatteryRegistry };
    if (ownerKind === 'crash' && s.fleet) {
      const exact = s.fleet.getCrash(query);
      if (exact) return { id: exact.id, label: `${exact.position} crash` };
      const byDrone = s.fleet.listCrashes({ droneName: query });
      return byDrone[0] ? { id: byDrone[0].id, label: `${query} ${byDrone[0].position} crash` } : undefined;
    }
    if (ownerKind === 'part' && s.fleet) {
      const exact = s.fleet.getPart(query);
      if (exact) return { id: exact.id, label: `${exact.position} (${exact.componentModel})` };
      const space = query.indexOf(' ');
      if (space > 0) {
        const drone = query.slice(0, space).trim();
        const pos = query
          .slice(space + 1)
          .trim()
          .toLowerCase();
        const parts = s.fleet.listParts(drone).filter((p) => p.position.toLowerCase() === pos);
        if (parts.length === 1) return { id: parts[0]!.id, label: `${drone} ${parts[0]!.position}` };
      }
      return undefined;
    }
    if (ownerKind === 'battery' && s.batteries) {
      const exact = s.batteries.get(query);
      if (exact) return { id: exact.id, label: exact.label };
      const numMatch = /^(\d+)(?:\s+(.+))?$/.exec(query);
      if (numMatch) {
        const hits = s.batteries.findByNumberAndSeries(Number(numMatch[1]), numMatch[2]);
        if (hits.length === 1) return { id: hits[0]!.id, label: hits[0]!.label };
      }
      const byLabel = s.batteries.list().filter((b) => b.label.toLowerCase() === query.toLowerCase());
      return byLabel.length === 1 ? { id: byLabel[0]!.id, label: byLabel[0]!.label } : undefined;
    }
    return undefined;
  },
  resolvePhotoOwner(store: unknown, ownerKind: string, id: string) {
    const s = store as { fleet?: FleetStore; batteries?: BatteryRegistry };
    if (ownerKind === 'crash') return s.fleet?.getCrash(id)?.id;
    if (ownerKind === 'part') return s.fleet?.getPart(id)?.id;
    if (ownerKind === 'battery') return s.batteries?.get(id)?.id;
    return undefined;
  },
};
