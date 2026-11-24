import {
  defaultPartPositions,
  normalizePartCategory,
  normalizePosition,
  parseFleetImport,
  PART_CATEGORIES,
  type FleetImportPart,
  type FleetStore,
  type ModelPrintedPart,
  type PrintedPartInput,
} from './fleet.ts';

/**
 * F-098-T06: NERV's Italian and English chat phrases that edit the fleet (add a drone, replace a part,
 * set spare stock). This file is the NERV adapter side (docs/decisions/fpv-packs.md, item 4): it parses
 * phrases only and applies them through the src/fleet.ts rules (parseFleetImport, importFleet,
 * replacePart, findSpares, setSpareCounts), so category and position normalisation match the crash log
 * and the import. An ambiguous phrase becomes a question and changes nothing.
 */
export type FleetEdit =
  | { kind: 'add-drone'; name: string; frame?: string; parts: FleetImportPart[] }
  | { kind: 'replace-part'; droneName: string; category: string; position?: string; model: string }
  | { kind: 'set-stock'; category: string; model: string; newCount?: number; usedCount?: number }
  | { kind: 'add-model'; name: string }
  | { kind: 'link-model'; droneName: string; model: string }
  | { kind: 'printed-part'; model: string; part: PrintedPartInput }
  | { kind: 'ask'; question: string };

/** F-121-T01: the F-087 slicer profile allowlist, read only when a printed part phrase needs it. */
export interface FleetChatOptions {
  slicerProfiles?: readonly string[] | (() => readonly string[]);
}

export interface FleetEditReply {
  handled: boolean;
  reply?: string;
  /** The phrase was ambiguous: the reply is a question for the owner and nothing was changed. */
  needsAnswer?: true;
}

const NAME = String.raw`[\p{L}\p{N}_-]+`;
const CATEGORY = String.raw`motori|motore|motors|motor|eliche|elica|propellers|propeller|props|prop|bracci|braccio|arms|arm|frame|telaio|fc|esc|vtx|telecamera|camera|ricevitore|receiver|rx|antenna|gps`;
const END = String.raw`[.!]*$`;

const ADD_DRONE = new RegExp(
  String.raw`^(?:nuovo\s+drone|new\s+drone|aggiungi\s+(?:il\s+)?drone|add\s+(?:a\s+)?(?:new\s+)?drone)\s+(${NAME})\s*(?:[,:;]\s*(.*?))?${END}`,
  'iu',
);
const REPLACE_IT = new RegExp(
  String.raw`^(?:ho\s+)?(?:sostituit[oaie]|cambiat[oaie])\s+(?:il\s+|la\s+|lo\s+|l['’]\s*)?(${CATEGORY})(?:\s+(.+?))?\s+(?:di|del|su|sul)\s+(${NAME})\s+con\s+(?:un[oa]?\s+|il\s+|la\s+)?(.+?)${END}`,
  'iu',
);
const REPLACE_EN_ON = new RegExp(
  String.raw`^(?:i\s+)?(?:replaced|swapped)\s+(?:the\s+)?(?:(.+?)\s+)?(${CATEGORY})\s+(?:on|of|in)\s+(${NAME})\s+with\s+(?:an?\s+|the\s+)?(.+?)${END}`,
  'iu',
);
const REPLACE_EN_POSSESSIVE = new RegExp(
  String.raw`^(?:i\s+)?(?:replaced|swapped)\s+(${NAME})(?:['’]s)?\s+(?:(.+?)\s+)?(${CATEGORY})\s+with\s+(?:an?\s+|the\s+)?(.+?)${END}`,
  'iu',
);
const CONDITION_IT = String.raw`nuov[ioea]|usat[ioea]`;
const STOCK_IT = new RegExp(
  String.raw`^(?:ho\s+)?(\d+)\s+(${CATEGORY})\s+(.+?)\s+(${CONDITION_IT})(?:\s+e\s+(\d+)\s+(${CONDITION_IT}))?(?:\s+(?:di|in)\s+scorta)?${END}`,
  'iu',
);
const STOCK_EN = new RegExp(
  String.raw`^(?:i\s+have|i've\s+got|i\s+got)\s+(\d+)\s+(new|used)(?:\s+and\s+(\d+)\s+(new|used))?\s+(.+?)\s+(${CATEGORY})${END}`,
  'iu',
);

// F-121-T01: drone models and their printed parts.
const ADD_MODEL = new RegExp(
  String.raw`^(?:nuovo\s+modello(?:\s+di\s+drone)?|aggiungi\s+(?:il\s+)?modello(?:\s+di\s+drone)?|new\s+drone\s+model|add\s+(?:a\s+)?(?:new\s+)?drone\s+model)\s+(.+?)${END}`,
  'iu',
);
const LINK_MODEL_IT = new RegExp(
  String.raw`^(?:il\s+)?drone\s+(${NAME})\s+(?:è|é|e['’])\s+(?:(?:un[oa]?|il\s+modello)\s+|un['’]\s*)?(.+?)${END}`,
  'iu',
);
const LINK_MODEL_EN = new RegExp(
  String.raw`^(?:the\s+)?drone\s+(${NAME})\s+is\s+(?:an?\s+|the\s+model\s+)?(.+?)${END}`,
  'iu',
);
const PRINTED_PART_IT = new RegExp(
  String.raw`^(?:aggiungi\s+(?:la\s+|una\s+)?)?(?:parte|pezzo)\s+stampat[oa]\s+(?:per|del|della|dello|di|al|a)\s+(?:modello\s+)?(.+?)\s*:\s*(.+?)${END}`,
  'iu',
);
const PRINTED_PART_EN = new RegExp(
  String.raw`^(?:add\s+(?:a\s+)?)?printed\s+part\s+(?:for|of|on|to)\s+(?:(?:the\s+)?model\s+)?(.+?)\s*:\s*(.+?)${END}`,
  'iu',
);
const PART_HELP =
  'file <path>, x<count> or <n> pezzi, profilo <profile>, materiale <material>, variante <text>, <n> oggetti, alias a/b, bobina esterna or AMS';

/** Parse a fleet edit phrase; undefined when the phrase is not one (crash, inventory and battery phrases go on). */
export function parseFleetEditPhrase(phrase: string): FleetEdit | undefined {
  const trimmed = phrase.trim();

  const printed = PRINTED_PART_IT.exec(trimmed) ?? PRINTED_PART_EN.exec(trimmed);
  if (printed) return parsePrintedPart(printed[1]!.trim(), printed[2]!);
  const model = ADD_MODEL.exec(trimmed);
  if (model) return { kind: 'add-model', name: model[1]!.trim() };
  const link = LINK_MODEL_IT.exec(trimmed) ?? LINK_MODEL_EN.exec(trimmed);
  if (link) return { kind: 'link-model', droneName: link[1]!, model: link[2]!.trim() };

  const add = ADD_DRONE.exec(trimmed);
  if (add) return parseAddDrone(add[1]!, add[2] ?? '');

  const it = REPLACE_IT.exec(trimmed);
  if (it) return replaceEdit(it[3]!, it[1]!, it[2], it[4]!);
  const on = REPLACE_EN_ON.exec(trimmed);
  if (on) return replaceEdit(on[3]!, on[2]!, on[1], on[4]!);
  const possessive = REPLACE_EN_POSSESSIVE.exec(trimmed);
  if (possessive) return replaceEdit(possessive[1]!, possessive[3]!, possessive[2], possessive[4]!);

  const stockIt = STOCK_IT.exec(trimmed);
  if (stockIt) {
    return stockEdit(stockIt[2]!, stockIt[3]!, [
      [stockIt[1]!, stockIt[4]!],
      ...(stockIt[5] ? [[stockIt[5], stockIt[6]!] as [string, string]] : []),
    ]);
  }
  const stockEn = STOCK_EN.exec(trimmed);
  if (stockEn) {
    return stockEdit(stockEn[6]!, stockEn[5]!, [
      [stockEn[1]!, stockEn[2]!],
      ...(stockEn[3] ? [[stockEn[3], stockEn[4]!] as [string, string]] : []),
    ]);
  }
  return undefined;
}

function parseAddDrone(name: string, rest: string): FleetEdit {
  const parts: FleetImportPart[] = [];
  let frame: string | undefined;
  for (const segment of rest.split(/\s*[,;]\s*/).filter(Boolean)) {
    const [, word = '', model = ''] = /^(\S+)\s*(.*)$/u.exec(segment) ?? [];
    const category = normalizePartCategory(word);
    if (!PART_CATEGORIES.includes(category)) {
      return {
        kind: 'ask',
        question: `I don't know the part category "${word}" for ${name}. Use one of: ${PART_CATEGORIES.join(', ')}. Which one did you mean?`,
      };
    }
    if (!model.trim()) {
      return {
        kind: 'ask',
        question: `Which model is the ${category} of ${name}? Say it after the part, e.g. "${category} <model>".`,
      };
    }
    if (category === 'frame') frame = model.trim();
    const positions = defaultPartPositions(category);
    parts.push({
      category,
      model: model.trim(),
      ...(positions.length > 1 ? { positions: [...positions] } : {}),
    });
  }
  return { kind: 'add-drone', name, ...(frame ? { frame } : {}), parts };
}

/** F-121-T01: "motor foot, file kite-5/foot.stl, 4 pezzi, profilo …": the name first, then keyed segments. */
function parsePrintedPart(model: string, rest: string): FleetEdit {
  const [first = '', ...segments] = rest.split(/\s*[,;]\s*/).filter(Boolean);
  const part: PrintedPartInput = { name: first.trim() };
  if (!part.name || applyPartSegment(part, part.name)) {
    return { kind: 'ask', question: `Which printed part of ${model}? Name it first, then ${PART_HELP}.` };
  }
  for (const segment of segments) {
    if (!applyPartSegment(part, segment)) {
      return {
        kind: 'ask',
        question: `I don't understand "${segment}" for the printed part ${part.name}. Use: ${PART_HELP}. What did you mean?`,
      };
    }
  }
  return { kind: 'printed-part', model, part };
}

/** Apply one keyed segment to the part; false when the segment is not one. */
function applyPartSegment(part: PrintedPartInput, segment: string): boolean {
  const text = segment.trim();
  let match: RegExpExecArray | null;
  if ((match = /^file\s*:?\s+(.+)$/iu.exec(text))) part.file = match[1]!.trim();
  else if (
    (match =
      /^(?:x\s*(\d+)|(\d+)\s*x|(\d+)\s+(?:pezzi|pezzo|stampe|stampa|copie|copia|prints?|copies|copy|pcs|pieces?)|(?:count|quantità|quantita|numero)\s+(\d+))$/iu.exec(
        text,
      ))
  )
    part.count = Number(match[1] ?? match[2] ?? match[3] ?? match[4]);
  else if (
    (match = /^(?:(\d+)\s+(?:oggetti|objects)(?:\s+per\s+(?:file|stampa|print))?|(?:oggetti|objects)\s+(\d+))$/iu.exec(
      text,
    ))
  )
    part.objectsPerPrint = Number(match[1] ?? match[2]);
  else if ((match = /^(?:profilo|profile)\s*:?\s+(.+)$/iu.exec(text))) part.profile = match[1]!.trim();
  else if ((match = /^(?:materiale|material)\s*:?\s+(.+)$/iu.exec(text))) part.material = match[1]!.trim();
  else if ((match = /^(?:variante|variant)\s*:?\s+(.+)$/iu.exec(text))) part.variant = match[1]!.trim();
  else if ((match = /^(?:alias|aliases)\s*:?\s+(.+)$/iu.exec(text)))
    part.aliases = match[1]!.split(/\s*[/|]\s*/).filter(Boolean);
  else if (/^(?:bobina\s+esterna|spool\s+esterno|external\s+spool)$/iu.test(text)) part.externalSpool = true;
  else if (/^ams$/iu.test(text)) part.externalSpool = false;
  else return false;
  return true;
}

function replaceEdit(
  droneName: string,
  categoryWord: string,
  positionWords: string | undefined,
  model: string,
): FleetEdit {
  const position = positionWords?.trim() ? normalizePosition(positionWords) : undefined;
  return {
    kind: 'replace-part',
    droneName,
    category: normalizePartCategory(categoryWord),
    ...(position ? { position } : {}),
    model: model.trim(),
  };
}

function stockEdit(categoryWord: string, model: string, counts: Array<[string, string]>): FleetEdit {
  const category = normalizePartCategory(categoryWord);
  const edit: { kind: 'set-stock'; category: string; model: string; newCount?: number; usedCount?: number } = {
    kind: 'set-stock',
    category,
    model: model.trim(),
  };
  for (const [count, condition] of counts) {
    const key = /^(?:new|nuov)/i.test(condition) ? 'newCount' : 'usedCount';
    if (edit[key] !== undefined) {
      return {
        kind: 'ask',
        question: `The ${model.trim()} ${category} count is given twice; how many new and how many used?`,
      };
    }
    edit[key] = Number(count);
  }
  return edit;
}

function ask(question: string): FleetEditReply {
  return { handled: true, needsAnswer: true, reply: question };
}

/** Apply a fleet edit phrase through the src/fleet.ts rules; `{ handled: false }` when it is not one. */
export function handleFleetEditChat(
  fleet: FleetStore,
  phrase: string,
  now = new Date().toISOString(),
  options: FleetChatOptions = {},
): FleetEditReply {
  if (!phrase.trim() || phrase.trim().length > 500) throw new Error('Fleet chat phrase must contain 1–500 characters.');
  const edit = parseFleetEditPhrase(phrase);
  if (!edit) return { handled: false };
  if (edit.kind === 'ask') return ask(edit.question);
  if (edit.kind === 'add-model') return addModel(fleet, edit.name, now);
  if (edit.kind === 'link-model') return linkModel(fleet, edit, now);
  if (edit.kind === 'printed-part') {
    const profiles = typeof options.slicerProfiles === 'function' ? options.slicerProfiles() : options.slicerProfiles;
    return addPrintedPart(fleet, edit, profiles ?? [], now);
  }
  if (edit.kind === 'add-drone') return addDrone(fleet, edit, now);
  if (edit.kind === 'replace-part') return replacePart(fleet, edit, now);
  return setStock(fleet, edit, now);
}

function addDrone(fleet: FleetStore, edit: Extract<FleetEdit, { kind: 'add-drone' }>, now: string): FleetEditReply {
  let file;
  try {
    file = parseFleetImport({
      version: 1,
      drones: [{ name: edit.name, ...(edit.frame ? { frame: edit.frame } : {}), parts: edit.parts }],
    });
  } catch (error) {
    return ask(`I could not read the parts of ${edit.name}: ${(error as Error).message} Which parts did you mean?`);
  }
  const report = fleet.importFleet(file, now);
  const spares = report.spares.created.length
    ? ` Spares records at 0 new, 0 used: ${report.spares.created.join(', ')}.`
    : '';
  if (report.drones.created.length) {
    return {
      handled: true,
      reply: `Added drone ${edit.name}${edit.frame ? ` (frame ${edit.frame})` : ''} with ${report.parts.created} parts.${spares}`,
    };
  }
  return {
    handled: true,
    reply: `${edit.name} is already in the fleet: ${report.parts.created} parts added, ${report.parts.present} already present.${spares}`,
  };
}

function replacePart(
  fleet: FleetStore,
  edit: Extract<FleetEdit, { kind: 'replace-part' }>,
  now: string,
): FleetEditReply {
  const drone = fleet.getDroneByName(edit.droneName);
  if (!drone) {
    const known = fleet.listDrones().map((d) => d.name);
    return ask(
      `I don't know a drone named "${edit.droneName}"${known.length ? ` (known: ${known.join(', ')})` : ''}. Which drone did you mean? To add it, say "nuovo drone ${edit.droneName}, …".`,
    );
  }
  const slots = fleet
    .listParts(drone.id)
    .filter((part) => part.category === edit.category && part.status !== 'removed')
    .map((part) => part.position);
  const allowed = [...new Set([...slots, ...defaultPartPositions(edit.category)])];
  let position = edit.position;
  if (!position) {
    if (slots.length === 1) position = slots[0];
    else if (slots.length === 0 && allowed.length === 1) position = allowed[0];
    else return ask(`Which ${edit.category} position on ${drone.name}: ${allowed.join(', ')}?`);
  }
  if (!position || !allowed.includes(position)) {
    return ask(
      `${drone.name} has no ${edit.category} at position "${position}". Known ${edit.category} positions: ${allowed.join(', ')}. Which one?`,
    );
  }
  const result = fleet.replacePart({
    droneName: drone.name,
    category: edit.category,
    position,
    componentModel: edit.model,
    replacedAt: now,
  });
  const from = result.removed ? `${result.removed.componentModel} → ` : 'no previous part recorded → ';
  const spare = result.spareCreated ? ` Spares record for ${edit.model} added at 0 new, 0 used.` : '';
  return {
    handled: true,
    reply: `Replaced ${drone.name} ${edit.category} (${position}): ${from}${result.installed.componentModel}${result.removed ? '; the old part is marked removed' : ''}.${spare}`,
  };
}

function setStock(fleet: FleetStore, edit: Extract<FleetEdit, { kind: 'set-stock' }>, now: string): FleetEditReply {
  const matches = fleet.findSpares(edit.model, edit.category);
  if (matches.length === 0) {
    const known = fleet.listSpares(edit.category).map((spare) => spare.componentModel);
    return ask(
      `No ${edit.category} spare matches "${edit.model}"${known.length ? ` (known: ${known.join(', ')})` : ''}. Which model did you mean? A spares record is added when a drone or part with that model is added.`,
    );
  }
  if (matches.length > 1) {
    return ask(
      `"${edit.model}" matches several ${edit.category} spares: ${matches.map((spare) => spare.componentModel).join(', ')}. Which one?`,
    );
  }
  const spare = fleet.setSpareCounts(
    matches[0]!.componentModel,
    {
      ...(edit.newCount !== undefined ? { newCount: edit.newCount } : {}),
      ...(edit.usedCount !== undefined ? { usedCount: edit.usedCount } : {}),
    },
    now,
  );
  return {
    handled: true,
    reply: `Spares for ${spare.componentModel} (${spare.category}): ${spare.newCount} new, ${spare.usedCount} used.`,
  };
}

function addModel(fleet: FleetStore, name: string, now: string): FleetEditReply {
  const existing = fleet.getDroneModel(name);
  if (existing) return { handled: true, reply: `${existing.name} is already a drone model.` };
  const model = fleet.addDroneModel({ name, createdAt: now });
  return {
    handled: true,
    reply: `Added drone model ${model.name}. Add its printed parts with "parte stampata per ${model.name}: …".`,
  };
}

function partList(parts: readonly ModelPrintedPart[]): string {
  return parts.map((part) => `${part.name} x${part.count}`).join(', ');
}

function linkModel(fleet: FleetStore, edit: Extract<FleetEdit, { kind: 'link-model' }>, now: string): FleetEditReply {
  const drone = fleet.getDroneByName(edit.droneName);
  if (!drone) {
    return ask(
      `I don't know a drone named "${edit.droneName}". Which drone did you mean? To add it, say "nuovo drone ${edit.droneName}, …".`,
    );
  }
  if (!fleet.getDroneModel(edit.model)) {
    const known = fleet.listDroneModels().map((model) => model.name);
    return ask(
      `I don't know a drone model named "${edit.model}"${known.length ? ` (known: ${known.join(', ')})` : ''}. Which model did you mean? To add it, say "nuovo modello di drone ${edit.model}".`,
    );
  }
  const { previous, model } = fleet.linkDroneModel(drone.name, edit.model, now);
  const parts = fleet.printedPartsForModel(model.name);
  const was = previous
    ? `${drone.name} was a ${previous.name} and is now a ${model.name}`
    : `${drone.name} is now a ${model.name}`;
  return {
    handled: true,
    reply: `${was}; ${parts.length ? `it inherits ${parts.length} printed parts: ${partList(parts)}` : 'its model has no printed parts yet'}.`,
  };
}

function addPrintedPart(
  fleet: FleetStore,
  edit: Extract<FleetEdit, { kind: 'printed-part' }>,
  slicerProfiles: readonly string[],
  now: string,
): FleetEditReply {
  if (!fleet.getDroneModel(edit.model)) {
    const known = fleet.listDroneModels().map((model) => model.name);
    return ask(
      `I don't know a drone model named "${edit.model}"${known.length ? ` (known: ${known.join(', ')})` : ''}. Which model did you mean? To add it, say "nuovo modello di drone ${edit.model}".`,
    );
  }
  let result;
  try {
    result = fleet.addPrintedPart(edit.model, edit.part, slicerProfiles, now);
  } catch (error) {
    return ask(`${(error as Error).message} What should I record for ${edit.part.name}?`);
  }
  const { part } = result;
  const details = [
    `file ${part.file}`,
    `x${part.count}`,
    ...(part.objectsPerPrint > 1 ? [`${part.objectsPerPrint} objects per print`] : []),
    ...(part.variant ? [`variant ${part.variant}`] : []),
    part.material,
    `profile ${part.slicerProfile}`,
    part.externalSpool ? 'external spool' : 'AMS',
  ].join(', ');
  if (result.created) return { handled: true, reply: `Added printed part ${part.name} to ${part.model}: ${details}.` };
  if (result.linked) {
    return {
      handled: true,
      reply: `Shared printed part ${part.name} (file ${part.file}, profile ${part.slicerProfile}) with ${part.model}, x${part.count}.`,
    };
  }
  return { handled: true, reply: `${part.model} already has printed part ${part.name}; now ${details}.` };
}
