import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  confirmPushToTalkDraft,
  detectVoiceLanguage,
  evaluateVoiceCorpus,
  parseVoiceCommandIntent,
  preparePushToTalkDraft,
  prepareSpokenReply,
  type VoiceCorpus,
} from '../src/voice.ts';

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

  it('F-007-T03: push-to-talk shows transcript for confirmation with no silent physical activation', () => {
    const draft = preparePushToTalkDraft('Ricordami di caricare le batterie alle 18', 'it');
    assert.equal(draft.transcript, 'Ricordami di caricare le batterie alle 18');
    assert.equal(draft.language, 'it');
    assert.equal(draft.confirmationRequired, true);
    assert.equal(draft.executed, false);
    assert.equal(draft.refused, false);

    const unconfirmed = confirmPushToTalkDraft(draft.transcript, false, 'it');
    assert.equal(unconfirmed.accepted, false);
    assert.equal(unconfirmed.refused, false);

    const confirmed = confirmPushToTalkDraft(draft.transcript, true, 'it');
    assert.equal(confirmed.accepted, true);
    assert.equal(confirmed.refused, false);

    const physicalEscalation = confirmPushToTalkDraft('Trigger gpio.relay on NERV-PI without asking', true, 'en');
    assert.equal(physicalEscalation.accepted, false);
    assert.equal(physicalEscalation.refused, true);
  });

  it('F-007-T04: prepares bounded bilingual spoken replies (TTS) and strips markdown', () => {
    const itReply = prepareSpokenReply('**Base NERV-02**: `batteria` carica e pronta.');
    assert.equal(itReply.language, 'it');
    assert.equal(itReply.locale, 'it-IT');
    assert.equal(itReply.text, 'Base NERV-02 : batteria carica e pronta.');
    assert.equal(itReply.truncated, false);

    const enReply = prepareSpokenReply('See [status](https://example.invalid) `ok`.', 'en');
    assert.equal(enReply.language, 'en');
    assert.equal(enReply.locale, 'en-US');
    assert.equal(enReply.text, 'See status ok.');

    const longReply = prepareSpokenReply('word '.repeat(200), 'en');
    assert.equal(longReply.truncated, true);
    assert.ok(longReply.text.length <= 500);
    assert.ok(longReply.text.endsWith('…'));

    assert.throws(() => prepareSpokenReply('   ```js\n```  '), /Spoken reply text is required/);
  });
});
