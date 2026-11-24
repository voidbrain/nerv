import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reportUpdaterResult, writeUpdaterResult } from '../src/updater-result.ts';

const B = 'b'.repeat(40);

// B-108-T02: the updater runs outside the service and the update restarts it, so the restarted service reports the
// result the updater wrote: once, in the same words as a scheduled apply.
test('B-108-T02: the restarted service reports the updater result once, in the scheduled-apply words', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-b108t02-'));
  try {
    const sent: string[] = [];
    const notify = async (m: string) => {
      sent.push(m);
    };
    assert.equal(await reportUpdaterResult(home, notify, 'en', 'UTC'), false, 'nothing to report yet');
    writeUpdaterResult(home, {
      outcome: 'completed',
      channel: 'main',
      revision: B,
      reasons: [],
      recovery: [],
    });
    assert.equal(await reportUpdaterResult(home, notify, 'en', 'UTC'), true);
    assert.equal(await reportUpdaterResult(home, notify, 'en', 'UTC'), false, 'reported once');
    assert.equal(sent.length, 1);
    assert.match(sent[0]!, /Update bbbbbbb applied/);
    assert.equal(existsSync(join(home, 'updater-result.json')), false);

    writeUpdaterResult(home, {
      outcome: 'refused',
      channel: 'main',
      revision: B,
      reasons: ['This revision is not admitted.'],
      recovery: ['Nothing was stopped.'],
    });
    await reportUpdaterResult(home, notify, 'it', 'UTC');
    assert.match(sent[1]!, /Aggiornamento bbbbbbb rinviato: This revision is not admitted\./);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('B-108-T02: a damaged result file is removed and reported as unreadable, never fatal', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-b108t02-'));
  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(home, 'updater-result.json'), '{not json');
    const sent: string[] = [];
    assert.equal(await reportUpdaterResult(home, async (m) => void sent.push(m), 'en', 'UTC'), true);
    assert.match(sent[0]!, /updater result could not be read/i);
    assert.equal(existsSync(join(home, 'updater-result.json')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
