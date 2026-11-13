import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PilotRegistry,
  addPilot,
  canRunRemotePilot,
  chooseAdvisers,
  chooseExecutionPilot,
  choosePilot,
  chooseQualifiedExecution,
  describePilots,
  evaluatePilotPlacement,
  genericPilot,
  hits,
  nextStage,
  overlappingDomains,
  pilotExecutor,
  promotionEligible,
  rankPilots,
  sanitizePilotOffers,
  selectRemotePilotRun,
  setPilotFlag,
  stageExecutor,
  toPilotOffers,
  updatePilot,
  validatePilots,
  words,
  type Pilot,
} from '../src/pilots.ts';
import { builtinTools } from '../src/executors.ts';
import { readConfig } from '../src/config.ts';
import { Runtime } from '../src/runtime.ts';
import { Store } from '../src/store.ts';
import { signRecord } from '../src/kaji.ts';
const pilot = (over: Partial<Pilot> & { id: string }): Pilot => ({
  name: over.id,
  domain: 'things',
  keywords: ['thing'],
  model: 'm',
  stage: 'prototype',
  ...over,
});
test('a pilot is data: the roster is checked, the generic pilot is implicit and reserved, a parent must exist', () => {
  const ok = validatePilots([
    {
      id: 'printer',
      name: 'Print Master',
      domain: '3D printing',
      keywords: ['3D print', 'Filament'],
      model: 'gemma4:12b',
    },
  ]);
  assert.deepEqual(ok, [
    {
      id: 'printer',
      name: 'Print Master',
      domain: '3D printing',
      keywords: ['3d print', 'filament'],
      model: 'gemma4:12b',
      stage: 'prototype',
    },
  ]);
  for (const [bad, why] of [
    [[{ id: 'generic', name: 'G', domain: 'd', keywords: ['x'], model: 'm' }], /not "generic"/],
    [[{ id: 'a1', name: 'A', domain: 'd', keywords: [], model: 'm' }], /1 to 30 keywords/],
    [[{ id: 'a1', name: 'A', domain: 'd', keywords: ['x'], model: 'm', stage: 'live' }], /stage/],
    [[{ id: 'a1', name: 'A', domain: 'd', keywords: ['x'], model: 'm', parent: 'nobody' }], /parent nobody/],
    [
      [
        { id: 'a1', name: 'A', domain: 'd', keywords: ['x'], model: 'm' },
        { id: 'a1', name: 'B', domain: 'd', keywords: ['y'], model: 'm' },
      ],
      /twice/,
    ],
    [[{ id: 'a1', name: 'A', domain: 'd', keywords: ['x'], model: 'm', bogus: 1 }], /Invalid pilot:/],
    [[{ id: 'a1', name: 'A', domain: 'd', keywords: ['x'], model: 'm', role: '' }], /role/],
    [[{ id: 'a1', name: 'A', domain: 'd', keywords: ['x'], model: 'm', memoryScope: 'BAD SCOPE' }], /memoryScope/],
    [[{ id: 'a1', name: 'A', domain: 'd', keywords: ['x'], model: 'm', evaClass: 'eva-99' }], /evaClass/],
    [[{ id: 'a1', name: 'A', domain: 'd', keywords: ['x'], model: 'm', skills: [''] }], /skills/],
    [[{ id: 'a1', name: 'A', domain: 'd', keywords: ['x'], model: 'm', tools: [123] }], /tools/],
  ] as const)
    assert.throws(() => validatePilots(bad), why);
  assert.equal(words('Perché la STAMPA 3D?'), 'perche la stampa 3d');
});
test('choosing the pilot: keywords as whole words or phrases; a pinned pilot first, then the most matches, then the later stage; retired never', () => {
  const print = pilot({
    id: 'printer',
    name: 'Print Master',
    keywords: ['3d print', 'filament', 'slicer'],
    stage: 'test',
  });
  const art = pilot({ id: 'artist', keywords: ['image', 'photo', 'print'], stage: 'production' });
  assert.equal(hits('Which filament for a 3D print?', print), 2);
  assert.equal(hits('a filamentous fungus', print), 0, 'whole words only');
  assert.equal(
    choosePilot('Which filament for a 3D print?', [art, print])!.id,
    'printer',
    'more matches win over a later stage',
  );
  assert.equal(choosePilot('print this photo', [art, print])!.id, 'artist');
  assert.equal(
    choosePilot('print the filament spool label', [{ ...art, keywords: ['print', 'label'] }, print])!.id,
    'artist',
    'two each: the later stage wins',
  );
  assert.deepEqual(
    choosePilot('print the filament', [{ ...art, pinned: true }, print]),
    { id: 'artist', name: 'artist', domain: 'things', model: 'm', why: 'pinned' },
    'pinned beats more matches',
  );
  assert.equal(choosePilot('Which filament?', [{ ...print, retired: true }]), undefined, 'retired is never chosen');
  assert.equal(
    choosePilot('Remind me to call Ada', [art, print]),
    undefined,
    'nothing fits: the generic pilot advises',
  );
  assert.match(
    describePilots([print], null),
    /^generic · Generic pilot · anything no specialist covers · off \(nerv pilots generic MODEL\)\nprinter · Print Master/,
  );
});
/** A fake local model: a pilot or the generic consultant advises (each recorded with the model asked), Misato replies. */
async function fake() {
  const asked: { who: string; model: string; system: string }[] = [];
  const misato: string[] = [];
  const s = createServer((req, res) => {
    let raw = '';
    req
      .on('data', (c) => (raw += c))
      .on('end', () => {
        const r = JSON.parse(raw) as { model: string; messages: { content: string }[] };
        const sys = r.messages[0]!.content;
        let out = '{"reply":"ok"}';
        const named = /^You are (.+?), the owner's pilot for/.exec(sys);
        if (named) {
          asked.push({ who: named[1]!, model: r.model, system: sys });
          out = `Advice from ${named[1]}.`;
        } else if (sys.startsWith('You are a consultant')) {
          asked.push({ who: 'generic', model: r.model, system: sys });
          out = 'Generic advice.';
        } else if (sys.startsWith('You are Casper')) out = '{"vote":"approve","reason":"Matches.","confidence":0.9}';
        else misato.push(r.messages.at(-1)!.content);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ model: r.model, choices: [{ message: { content: out }, finish_reason: 'stop' }] }));
      });
  });
  await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
  return {
    url: `http://127.0.0.1:${(s.address() as { port: number }).port}/v1`,
    asked,
    misato,
    close: () =>
      new Promise<void>((d) => {
        s.close(() => d());
        s.closeAllConnections();
      }),
  };
}
test(
  "through every process: the pilot whose keywords fit advises on its own model, named in Misato's prompt and the trace; otherwise the generic pilot; a roster change applies at once",
  { timeout: 30000 },
  async () => {
    const { Runtime } = await import('../src/runtime.ts');
    const { readConfig, savePilots } = await import('../src/config.ts');
    const f = await fake();
    const home = mkdtempSync(join(tmpdir(), 'nerv-pilots-'));
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        models: {
          local: { baseUrl: f.url, model: 'm' },
          roles: { misato: { route: 'local' }, consultant: { model: 'advisor' } },
        },
      }),
    );
    savePilots(home, [
      {
        id: 'printer',
        name: 'Print Master',
        domain: '3D printing',
        keywords: ['filament', '3d print'],
        model: 'printer-model',
        stage: 'test',
      },
    ]);
    assert.equal(readConfig(home).pilots![0]!.name, 'Print Master', 'saved and read back through config.json');
    const r = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
    r.setPilots(() => readConfig(home).pilots ?? []);
    try {
      await r.ready();
      const one = await r.chat('Which filament for a 3D print of a vase?');
      assert.deepEqual(
        f.asked.map((a) => [a.who, a.model]),
        [['Print Master', 'printer-model']],
      );
      assert.match(f.asked[0]!.system, /pilot for 3D printing/);
      assert.equal(JSON.parse(f.misato[0]!).advice, 'Advice from Print Master.');
      const consult = (await r.events(one.sortieId)).find((e) => e.kind === 'misato.consult')!;
      assert.deepEqual(consult.payload, {
        advice: 'Advice from Print Master.',
        model: 'printer-model',
        pilot: { id: 'printer', name: 'Print Master', why: 'keywords' },
      });
      await r.chat('Remind me to call Ada');
      assert.deepEqual(f.asked.at(-1)!.who, 'generic');
      assert.equal(f.asked.at(-1)!.model, 'advisor', 'no specialist fits: the generic pilot on roles.consultant');
      savePilots(home, [{ ...readConfig(home).pilots![0]!, retired: true }]);
      await r.chat('Which filament now?');
      assert.equal(
        f.asked.at(-1)!.who,
        'generic',
        'retired by the CLI: the next request already goes to the generic pilot',
      );
      assert.match(readFileSync(join(home, 'config.json'), 'utf8'), /"retired": true/);
    } finally {
      await r.close();
      await f.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
);
test('the generic pilot names the domain on its first line; the rest is the advice (F-045 detection)', async () => {
  const { parseConsult } = await import('../src/misato.ts');
  assert.deepEqual(parseConsult('Domain: Image Editing\nCrop the photo first.'), {
    domain: 'image editing',
    advice: 'Crop the photo first.',
  });
  assert.deepEqual(parseConsult('**Domain:** 3D printing, slicing and more words\nnone'), {
    domain: '3d printing slicing and',
  });
  assert.deepEqual(
    parseConsult('Check the date.'),
    { advice: 'Check the date.' },
    'no domain line: all advice, as before',
  );
});
test(
  'through every process: three requests in one domain without a specialist bring a pilots.create card; approved, the next request goes to that pilot; turned down, it is not proposed again (F-045)',
  { timeout: 60000 },
  async () => {
    const { Runtime } = await import('../src/runtime.ts');
    const { readConfig } = await import('../src/config.ts');
    const asked: string[] = [];
    const s = createServer((req, res) => {
      let raw = '';
      req
        .on('data', (c) => (raw += c))
        .on('end', () => {
          const r = JSON.parse(raw) as { model: string; messages: { content: string }[] };
          const sys = r.messages[0]!.content;
          let out = '{"reply":"ok"}';
          const req0 = (JSON.parse(r.messages.at(-1)!.content) as { request?: string }).request ?? '';
          if (/^You are .+, the owner's pilot for/.test(sys)) {
            asked.push('pilot:' + r.model);
            out = 'Specialist advice.';
          } else if (sys.startsWith('You are a consultant')) {
            asked.push('generic');
            out =
              (/wood/.test(req0)
                ? 'Domain: woodworking'
                : /brighter/.test(req0)
                  ? 'Domain: image processing'
                  : /square/.test(req0)
                    ? 'Domain: image retouching'
                    : 'Domain: image editing') + '\nGeneric advice.';
          } else if (sys.startsWith('You are Casper')) out = '{"vote":"approve","reason":"Matches.","confidence":0.9}';
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ model: r.model, choices: [{ message: { content: out }, finish_reason: 'stop' }] }));
        });
    });
    await new Promise<void>((d) => s.listen(0, '127.0.0.1', d));
    const url = `http://127.0.0.1:${(s.address() as { port: number }).port}/v1`;
    const home = mkdtempSync(join(tmpdir(), 'nerv-detect-'));
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        models: {
          local: { baseUrl: url, model: 'm' },
          roles: { misato: { route: 'local' }, consultant: { model: 'advisor' } },
        },
      }),
    );
    const r = new Runtime(join(home, 'nerv.sqlite'), undefined, home);
    r.setPilots(() => readConfig(home).pilots ?? []);
    const pending = async (tool = 'pilots.create') => (await r.approvals(5)).filter((a) => a.card.tool === tool);
    const until = async (f: () => Promise<boolean>) => {
      const end = Date.now() + 8000;
      while (!(await f())) {
        if (Date.now() > end) throw new Error('timed out');
        await new Promise((d) => setTimeout(d, 50));
      }
    };
    try {
      await r.ready();
      await r.chat('Remove the background of this photo');
      await r.chat('Make the photo brighter');
      await new Promise((d) => setTimeout(d, 300));
      assert.equal((await pending()).length, 0, 'two are not enough');
      await r.chat('Crop my photo to a square');
      await until(async () => (await pending()).length === 1);
      const card = (await pending())[0]!.card;
      assert.deepEqual(card.args, {
        id: 'image-retouching',
        name: 'Image Retouching',
        domain: 'image retouching',
        keywords: ['image retouching', 'image', 'retouching'],
      });
      assert.equal(card.pattern, 'blue', 'a new pilot always asks the owner');
      assert.deepEqual(
        await Promise.all(['image editing', 'image processing', 'image retouching'].map((d) => r.proposePilot(d))),
        [false, false, false],
        'overlapping proposals are suppressed, including concurrent requests',
      );
      await r.chat('Rotate the photo');
      await new Promise((d) => setTimeout(d, 300));
      assert.equal((await pending()).length, 1, 'not proposed twice while the card waits');
      await r.decide((await pending())[0]!.id, 'approve', 'api');
      const marduk = async () =>
        ((await r.sorties(50)) as { source: string; status: string }[])
          .filter((x) => x.source === 'marduk')
          .map((x) => x.status);
      assert.deepEqual(await marduk(), ['done'], 'B-026: the proposal sortie closes once its card is decided');
      assert.deepEqual(
        readConfig(home).pilots,
        [
          {
            id: 'image-retouching',
            name: 'Image Retouching',
            domain: 'image retouching',
            keywords: ['image retouching', 'image', 'retouching'],
            model: 'advisor',
            stage: 'prototype',
            parent: 'generic',
          },
        ],
        "created at Prototype on the generic pilot's model",
      );
      await r.chat('Some image editing for this picture');
      assert.equal(asked.at(-1), 'pilot:advisor', 'the next request in that domain goes to the new pilot');
      for (const t of ['Sand the woodworking table', 'Plan a woodworking shelf', 'Glue for woodworking'])
        await r.chat(t);
      await until(async () => (await pending()).length === 1);
      await r.decide((await pending())[0]!.id, 'reject', 'api');
      assert.deepEqual(await marduk(), ['done', 'done'], 'turned down, it closes too');
      for (const t of ['More woodworking', 'Woodworking tools', 'Woodworking finish']) await r.chat(t);
      await new Promise((d) => setTimeout(d, 400));
      assert.equal((await pending()).length, 0, 'turned down: not proposed again for 30 days');
    } finally {
      await r.close();
      await new Promise<void>((d) => {
        s.close(() => d());
        s.closeAllConnections();
      });
      rmSync(home, { recursive: true, force: true });
    }
  },
);

test('B-027: domain overlap uses significant whole words, ignoring case and accents', () => {
  assert.equal(overlappingDomains('File system access', 'file management'), true);
  assert.equal(overlappingDomains('file access', 'file system access'), true);
  assert.equal(overlappingDomains('image editing', 'image processing'), true);
  assert.equal(overlappingDomains('with wood', 'with metal'), false);
  assert.equal(overlappingDomains('file access', 'profile editing'), false);
  assert.equal(overlappingDomains('3D printing', '3d printing'), true);
});

test('F-045-T01: full pilot data, heartbeat offers, and Kaji-style PilotRegistry', () => {
  const validated = validatePilots([
    {
      id: 'coder',
      name: 'Code Pilot',
      role: 'coder',
      domain: 'TypeScript and Node services',
      keywords: ['typescript', 'refactor'],
      skills: ['tdd', 'tdd', 'strict-ts'],
      tools: ['fs.read', 'git.diff'],
      model: 'qwen2.5-coder:14b',
      memoryScope: 'domain',
      evaClass: 'eva-01',
      stage: 'test',
      parent: 'generic',
      pinned: true,
    },
    {
      id: 'old-ops',
      name: 'Old Ops',
      domain: 'Legacy ops',
      keywords: ['legacy'],
      model: 'm',
      retired: true,
    },
  ]);
  assert.deepEqual(validated[0], {
    id: 'coder',
    name: 'Code Pilot',
    role: 'coder',
    domain: 'TypeScript and Node services',
    keywords: ['typescript', 'refactor'],
    skills: ['tdd', 'strict-ts'],
    tools: ['fs.read', 'git.diff'],
    model: 'qwen2.5-coder:14b',
    memoryScope: 'domain',
    evaClass: 'eva-01',
    stage: 'test',
    parent: 'generic',
    pinned: true,
  });

  const offers = toPilotOffers(validated);
  assert.equal(offers.length, 1, 'retired pilots are never offered');
  assert.equal('pinned' in offers[0]!, false);
  assert.equal('retired' in offers[0]!, false);
  assert.deepEqual(sanitizePilotOffers(offers), offers);
  assert.equal(sanitizePilotOffers([{ ...offers[0], pinned: true }]), undefined, 'local flags rejected in peer offers');
  assert.equal(sanitizePilotOffers([{ ...offers[0], evaClass: 'eva-99' }]), undefined);
  assert.equal(sanitizePilotOffers([{ ...offers[0], parent: 'missing' }]), undefined);

  const now = 1_000_000;
  const reg = new PilotRegistry('NERV-01', () => validated);
  assert.equal(reg.offered().length, 1);
  assert.equal(reg.recordPeer('NERV-01', offers, now), undefined, 'ignores self');
  assert.equal(reg.recordPeer('NERV-02', [{ id: 'bad' }], now), undefined, 'ignores malformed offers');
  assert.ok(
    reg.recordPeer(
      'NERV-02',
      [
        {
          id: 'cad-3d',
          name: 'Tabgha 3D',
          role: 'specialist',
          domain: '3D modeling and slicing',
          keywords: ['blender', 'stl'],
          skills: ['mesh-repair'],
          tools: ['blender.render'],
          model: 'gemma4:12b',
          memoryScope: 'cad-3d',
          evaClass: 'eva-00',
          stage: 'prototype',
        },
      ],
      now,
    ),
  );
  const listed = reg.list({ now: now + 10_000, onlineBases: new Set(['NERV-02']) });
  assert.deepEqual(
    listed.map((p) => `${p.baseId}:${p.id}:${p.local}`),
    ['NERV-01:coder:true', 'NERV-02:cad-3d:false'],
  );
  assert.equal(reg.get('NERV-02', 'cad-3d', { now: now + 10_000 })?.evaClass, 'eva-00');
  assert.equal(reg.get('NERV-02', 'cad-3d', { now: now + 100_000 }), undefined, 'expired peer offer');
  reg.clearPeer('NERV-02');
  assert.equal(reg.forBase('NERV-02', { now }).length, 0);
});

test('F-045-T02: add, rename, pin, retire pilots and generic pilot in most restrictive EVA for its stage', () => {
  assert.equal(stageExecutor('prototype'), 'eva-00');
  assert.equal(stageExecutor('test'), 'eva-01');
  assert.equal(stageExecutor('production'), 'eva-02');
  assert.equal(pilotExecutor({ stage: 'production', evaClass: 'eva-00' }), 'eva-00');
  assert.equal(pilotExecutor({ stage: 'prototype', evaClass: 'eva-02' }), 'eva-00');
  assert.equal(pilotExecutor({ stage: 'production', evaClass: 'eva-03' }), 'eva-03');

  const gProto = genericPilot('gemma4:12b');
  assert.equal(gProto.id, 'generic');
  assert.equal(gProto.stage, 'prototype');
  assert.equal(gProto.evaClass, 'eva-00');
  assert.equal(genericPilot('gemma4:12b', 'test').evaClass, 'eva-01');
  assert.equal(genericPilot('gemma4:12b', 'production').evaClass, 'eva-02');

  let roster = addPilot([], {
    id: 'printer',
    name: 'Printer',
    domain: '3D printing',
    keywords: ['filament'],
    model: 'm',
    stage: 'prototype',
  });
  assert.equal(roster[0]?.name, 'Printer');
  roster = updatePilot(roster, 'printer', { name: 'Print Master' });
  assert.equal(roster[0]?.name, 'Print Master');
  roster = setPilotFlag(roster, 'printer', 'pinned', true);
  assert.equal(roster[0]?.pinned, true);
  roster = setPilotFlag(roster, 'printer', 'pinned', false);
  assert.equal(roster[0]?.pinned, undefined);
  roster = setPilotFlag(roster, 'printer', 'retired', true);
  assert.equal(roster[0]?.retired, true);
  roster = setPilotFlag(roster, 'printer', 'retired', false);
  assert.equal(roster[0]?.retired, undefined);
});

test('F-045-T03: F-041 consultant ranking (pin, main base, best record), fallback, and ask-both', () => {
  const remoteBest = {
    pilot: pilot({ id: 'remote-3d', keywords: ['filament'], stage: 'production', model: 'm-remote' }),
    mainBase: false,
    record: { cleanRuns: 20, rejects: 0, edits: 0 },
  };
  const localGood = {
    pilot: pilot({ id: 'local-3d', keywords: ['filament'], stage: 'test', model: 'm-local' }),
    mainBase: true,
    record: { cleanRuns: 5, rejects: 0, edits: 0 },
  };
  const localBetter = {
    pilot: pilot({ id: 'local-better', keywords: ['filament'], stage: 'prototype', model: 'm-better' }),
    mainBase: true,
    record: { cleanRuns: 10, rejects: 1, edits: 0 },
  };
  const ranked = rankPilots('Check filament', [remoteBest, localGood, localBetter]);
  assert.deepEqual(
    ranked.map((r) => r.id),
    ['local-better', 'local-3d', 'remote-3d'],
    'main base comes before remote; better record beats later stage on same base',
  );
  assert.equal(chooseAdvisers('Check filament', [remoteBest, localGood, localBetter]).length, 1);
  assert.deepEqual(
    chooseAdvisers('Check filament', [remoteBest, localGood, localBetter], { askBoth: true }).map((c) => c.id),
    ['local-better', 'local-3d'],
    'askBoth returns at most two advisers',
  );
  const pinnedRemote = { ...remoteBest, pilot: { ...remoteBest.pilot, pinned: true } };
  assert.equal(
    chooseAdvisers('Check filament', [pinnedRemote, localGood, localBetter])[0]?.id,
    'remote-3d',
    'owner pin beats main base preference',
  );
});

test('F-045-T04: execution choice by domain and evidence, suggest-only default, and owner-only promotion', () => {
  const generic = genericPilot('gemma4:12b', 'prototype');
  const weak = {
    pilot: pilot({ id: 'coder-a', keywords: ['typescript'], stage: 'test', evaClass: 'eva-01' }),
    mainBase: true,
    record: { cleanRuns: 2, rejects: 1, edits: 0 },
  };
  const strong = {
    pilot: pilot({ id: 'coder-b', keywords: ['typescript'], stage: 'test', evaClass: 'eva-01' }),
    mainBase: true,
    record: { cleanRuns: 12, rejects: 0, edits: 0 },
  };
  const chosen = chooseExecutionPilot('Refactor typescript module', [weak, strong], generic);
  assert.equal(chosen.pilot.id, 'coder-b');
  assert.equal(chosen.executor, 'eva-01');
  assert.equal(chosen.suggestOnly, true, 'suggest-only by default');
  assert.equal(chosen.why, 'keywords');

  const fallback = chooseExecutionPilot('Unmatched request', [weak, strong], generic);
  assert.equal(fallback.pilot.id, 'generic');
  assert.equal(fallback.executor, 'eva-00');
  assert.equal(fallback.suggestOnly, true);
  assert.equal(fallback.why, 'generic');

  assert.equal(nextStage('prototype'), 'test');
  assert.equal(nextStage('test'), 'production');
  assert.equal(nextStage('production'), undefined);
  assert.equal(promotionEligible({ stage: 'prototype' }, { cleanRuns: 6, daysInStage: 2 }).eligible, false);
  assert.equal(
    promotionEligible({ stage: 'prototype' }, { cleanRuns: 10, daysInStage: 7, rejects: 1 }).eligible,
    false,
  );
  assert.deepEqual(promotionEligible({ stage: 'prototype' }, { cleanRuns: 10, daysInStage: 7 }), {
    eligible: true,
    current: 'prototype',
    next: 'test',
    progress: 'ready to promote',
  });
  const promoteTool = builtinTools.find((t) => t.name === 'pilots.promote');
  assert.equal(promoteTool?.owner, true, 'promotion always requires owner approval');
});

test('F-045-T05: remote pilots chosen, granted, and run through the authenticated worker line', async () => {
  const generic = genericPilot('gemma4:12b', 'prototype');
  const remotePilot = {
    ...pilot({ id: 'notes-helper', keywords: ['notes', 'summary'], tools: ['notes.search'] }),
    baseId: 'MAGI-02',
    local: false,
  };
  assert.equal(canRunRemotePilot(remotePilot, ['notes.search'], 'notes.search').allowed, true);
  assert.equal(canRunRemotePilot({ ...remotePilot, retired: true }, ['notes.search'], 'notes.search').allowed, false);
  assert.equal(canRunRemotePilot(remotePilot, ['kaji.run'], 'kaji.run').allowed, false);
  assert.equal(canRunRemotePilot(remotePilot, ['reminders.list'], 'notes.search').allowed, false);
  assert.equal(canRunRemotePilot(remotePilot, ['notes.search', 'notes.add'], 'notes.add').allowed, false);

  const onlineOffers = new Map<string, readonly string[]>([['MAGI-02', ['notes.search', 'notes.add']]]);
  const allowedChoice = selectRemotePilotRun('summary of notes', [remotePilot], onlineOffers, generic, 'notes.search', {
    localBaseId: 'MAGI-01',
  });
  assert.equal(allowedChoice.remote, true);
  assert.equal(allowedChoice.allowed, true);
  assert.equal(allowedChoice.choice.baseId, 'MAGI-02');
  assert.equal(allowedChoice.choice.pilot.id, 'notes-helper');

  const deniedChoice = selectRemotePilotRun('summary of notes', [remotePilot], onlineOffers, generic, 'notes.add', {
    localBaseId: 'MAGI-01',
  });
  assert.equal(deniedChoice.remote, true);
  assert.equal(deniedChoice.allowed, false);

  const offlineChoice = selectRemotePilotRun('summary of notes', [remotePilot], new Map(), generic, 'notes.search', {
    localBaseId: 'MAGI-01',
  });
  assert.equal(offlineChoice.allowed, false);

  const home = mkdtempSync(join(tmpdir(), 'nerv-remote-pilot-'));
  const dbPath = join(home, 'nerv.sqlite');
  try {
    const store = new Store(dbPath);
    const q = store.queueRemote('sortie-1', 'MAGI-02', 'notes.search', { query: 'hello' }, 'notes-helper');
    const outbox = store.outbox();
    assert.equal(outbox.find((item) => item.id === q.id)?.pilot, 'notes-helper');
    store.close();

    const genKey = () => {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      return {
        publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        privateKey,
      };
    };
    const root = genKey();
    const owner = genKey();
    const self = genKey();
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        base: { id: 'MAGI-02', name: 'Tabgha' },
        kaji: { root: root.publicKey },
        models: { local: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, roles: { misato: { route: 'local' } } },
        pilots: [pilot({ id: 'notes-helper', keywords: ['notes'], tools: ['reminders.list'] })],
      }),
    );
    const rt = new Runtime(dbPath, undefined, home);
    rt.setPilots(() => readConfig(home).pilots ?? []);
    const workerKey = self.publicKey;
    const ownerKey = owner.publicKey;
    const session = '00000000-0000-4000-8000-000000000001';
    try {
      await rt.ready();
      await rt.nervous.call('kaji.add', {
        records: [
          signRecord(root.privateKey, {
            kind: 'enrol',
            serial: 1,
            issued: new Date().toISOString(),
            baseId: 'MAGI-01',
            name: 'Main',
            publicKey: owner.publicKey,
            address: '127.0.0.1:9001',
          }),
          signRecord(root.privateKey, {
            kind: 'enrol',
            serial: 2,
            issued: new Date().toISOString(),
            baseId: 'MAGI-02',
            name: 'Tabgha',
            publicKey: self.publicKey,
            address: '127.0.0.1:9002',
          }),
          signRecord(root.privateKey, {
            kind: 'main',
            serial: 3,
            issued: new Date().toISOString(),
            baseId: 'MAGI-01',
          }),
        ],
      });
      await rt.worker.open('MAGI-01', session, workerKey, ownerKey);

      const ungranted = (await rt.runFromPeer(
        'MAGI-01',
        {
          id: '00000000-0000-4000-8000-000000000011',
          request: 'add reminder',
          tool: 'reminders.add',
          args: { title: 't' },
          pilot: 'notes-helper',
        },
        ['reminders.list', 'reminders.add'],
        { session, epoch: 1, expires: Date.now() + 60_000, ownerKey },
      )) as { refused?: string };
      assert.match(ungranted.refused ?? '', /does not grant tool "reminders.add"/);

      const missingPilot = (await rt.runFromPeer(
        'MAGI-01',
        {
          id: '00000000-0000-4000-8000-000000000012',
          request: 'list reminders',
          tool: 'reminders.list',
          args: {},
          pilot: 'unknown-pilot',
        },
        ['reminders.list'],
        { session, epoch: 1, expires: Date.now() + 60_000, ownerKey },
      )) as { refused?: string };
      assert.match(missingPilot.refused ?? '', /does not have pilot unknown-pilot/);

      const allowedRun = (await rt.runFromPeer(
        'MAGI-01',
        {
          id: '00000000-0000-4000-8000-000000000013',
          request: 'list reminders',
          tool: 'reminders.list',
          args: {},
          pilot: 'notes-helper',
        },
        ['reminders.list'],
        { session, epoch: 1, expires: Date.now() + 60_000, ownerKey },
      )) as { refused?: string };
      assert.equal(allowedRun.refused, undefined);
    } finally {
      await rt.close();
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('F-045-T06: evidence-based placement keeps individual, combination, and placement evidence distinct', () => {
  const generic = genericPilot('gemma4:12b', 'prototype');
  const coder = pilot({ id: 'coder', role: 'coder', keywords: ['typescript', 'refactor'], stage: 'test' });

  const noEvidence = evaluatePilotPlacement({ pilotId: 'coder', role: 'coder', baseId: 'MAGI-02', evidence: [] });
  assert.equal(noEvidence.qualified, false);
  assert.equal(noEvidence.suggestOnly, true);
  assert.deepEqual(noEvidence.missing, ['individual', 'placement']);
  assert.match(noEvidence.reason, /No placement claim without/);

  const indCoder = {
    scope: 'individual' as const,
    id: 'ev-ind-coder',
    pilotId: 'coder',
    role: 'coder' as const,
    model: 'm',
    passed: 5,
    total: 5,
    recordedAt: '2026-11-13T00:00:00Z',
  };
  const indAuditor = {
    scope: 'individual' as const,
    id: 'ev-ind-auditor',
    pilotId: 'auditor',
    role: 'auditor' as const,
    model: 'm',
    passed: 5,
    total: 5,
    recordedAt: '2026-11-13T00:00:00Z',
  };
  const placement = {
    scope: 'placement' as const,
    id: 'ev-place',
    pilotId: 'coder',
    baseId: 'MAGI-02',
    inferenceHost: 'mac-main',
    executionHost: 'mini-pc',
    passed: 3,
    total: 3,
    recordedAt: '2026-11-13T00:00:00Z',
  };

  // Two individual passes never imply a combination pass.
  const twoIndividualsOnly = evaluatePilotPlacement({
    pilotId: 'coder',
    role: 'coder',
    baseId: 'MAGI-02',
    partnerPilotIds: ['auditor'],
    evidence: [indCoder, indAuditor, placement],
  });
  assert.equal(twoIndividualsOnly.individualQualified, true);
  assert.equal(twoIndividualsOnly.combinationQualified, false);
  assert.equal(twoIndividualsOnly.qualified, false);
  assert.deepEqual(twoIndividualsOnly.missing, ['combination']);

  // Combination without independent grader or with escaped defects is rejected.
  const flawedCombo = evaluatePilotPlacement({
    pilotId: 'coder',
    role: 'coder',
    baseId: 'MAGI-02',
    partnerPilotIds: ['auditor'],
    evidence: [
      indCoder,
      indAuditor,
      placement,
      {
        scope: 'combination',
        id: 'ev-combo-bad',
        roles: ['coder', 'auditor'],
        componentEvidenceIds: ['ev-ind-coder', 'ev-ind-auditor'],
        passed: 4,
        total: 4,
        escapedDefects: 1,
        falseRejections: 0,
        independentGrader: true,
        recordedAt: '2026-11-13T00:00:00Z',
      },
    ],
  });
  assert.equal(flawedCombo.combinationQualified, false);
  assert.equal(flawedCombo.qualified, false);

  // Separate passing individual, combination, and placement evidence qualifies while retaining suggestOnly.
  const qualified = chooseQualifiedExecution(
    'Refactor typescript module',
    [coder],
    generic,
    [
      indCoder,
      indAuditor,
      placement,
      {
        scope: 'combination',
        id: 'ev-combo-ok',
        roles: ['coder', 'auditor'],
        componentEvidenceIds: ['ev-ind-coder', 'ev-ind-auditor'],
        passed: 4,
        total: 4,
        escapedDefects: 0,
        falseRejections: 0,
        independentGrader: true,
        recordedAt: '2026-11-13T00:00:00Z',
      },
    ],
    { baseId: 'MAGI-02', partnerPilotIds: ['auditor'], suggestOnly: false },
  );
  assert.equal(qualified.placement.qualified, true);
  assert.equal(qualified.placement.suggestOnly, true);
  assert.equal(qualified.choice.suggestOnly, true);
});
