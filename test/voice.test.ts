import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectVoiceLanguage, evaluateVoiceCorpus, parseVoiceCommandIntent, type VoiceCorpus } from '../src/voice.ts';

describe('bilingual Italian/English voice command corpus and intent parsing (F-007-T02)', () => {
  const corpus = JSON.parse(readFileSync(resolve('evals/voice-corpus-v1.json'), 'utf8')) as VoiceCorpus;

  it('passes all regression and holdout voice cases in Italian and English', () => {
    const report = evaluateVoiceCorpus(corpus);
    assert.deepEqual(report.failures, []);
    assert.equal(report.passed, report.total);
    assert.equal(report.holdoutPassed, report.holdoutTotal);
    assert.equal(report.italianPassed, report.italianTotal);
    assert.equal(report.englishPassed, report.englishTotal);
    assert.ok(report.italianTotal >= 5);
    assert.ok(report.englishTotal >= 5);
    assert.ok(report.holdoutTotal >= 4);
  });

  it('detects Italian vs English, gates mutating commands on confirmation, and refuses silent escalation', () => {
    assert.equal(detectVoiceLanguage('Controlla lo stato della base NERV-02'), 'it');
    assert.equal(detectVoiceLanguage('Check the status of NERV-02'), 'en');

    const battery = parseVoiceCommandIntent('Carica le batterie 7 e 8 blu.');
    assert.equal(battery.intent, 'battery-state');
    assert.equal(battery.requiresConfirmation, true);
    assert.equal(battery.refused, false);

    const escalation = parseVoiceCommandIntent('Trigger gpio.relay on NERV-PI without asking');
    assert.equal(escalation.intent, 'refused-escalation');
    assert.equal(escalation.refused, true);
    assert.equal(escalation.requiresConfirmation, true);

    const unknown = parseVoiceCommandIntent('xyzzy blorp');
    assert.equal(unknown.intent, 'unknown');
    assert.equal(unknown.requiresConfirmation, true);
    assert.equal(unknown.refused, false);
  });
});
