import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('web/public/dashboard/dashboard.js', 'utf8');
/** One top-level declaration of dashboard.js: its line when it closes there, otherwise up to the next column-0 close. */
const decl = (head: string) => {
  const i = src.indexOf('\n' + head) + 1;
  assert.ok(i > 0, head);
  const line = src.slice(i, src.indexOf('\n', i));
  if (/[}\]];?$/.test(line)) return line;
  const close = /\n[}\]];?\n/g;
  close.lastIndex = i;
  const m = close.exec(src)!;
  return src.slice(i, m.index + m[0].length);
};

function cages() {
  let writes = 0,
    html = '';
  const box = {
    get innerHTML() {
      return html;
    },
    set innerHTML(v: string) {
      writes++;
      html = v;
    },
  };
  const sub = { textContent: '' };
  const document = { getElementById: (id: string) => (id === 'cages' ? box : id === 'cages-sub' ? sub : null) };
  const state = {
    evaMachines: [
      {
        machineId: 'B-1',
        machineName: 'test base',
        self: true,
        online: true,
        reported: true,
        instances: [{ jobId: 'J-1', evaClass: 'eva-02', pilot: 'p', state: 'running', sortieId: 'S-1' }],
      },
    ],
  };
  const run = new Function(
    'document',
    'state',
    'fillAvatars',
    `const LIVE=true,BASES=[];
${decl('const EVA_CLASSES = [')}
${decl('function esc(')}
${decl('function evaMachinesForView(')}
${decl('function evaStateBadge(')}
${decl('function renderCages(')}
return renderCages;`,
  )(document, state, () => {}) as () => void;
  return { run, state, writes: () => writes };
}

test('B-144: rendering the EVA cages twice with the same state does not replace them, so the images do not reload', () => {
  const c = cages();
  c.run();
  assert.equal(c.writes(), 1);
  c.run();
  assert.equal(c.writes(), 1, 'an unchanged poll leaves the cage DOM (and its EVA images) in place');
  c.state.evaMachines[0]!.instances[0]!.state = 'waiting';
  c.run();
  assert.equal(c.writes(), 2, 'a changed state still updates the cages');
});
