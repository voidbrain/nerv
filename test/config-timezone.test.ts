import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/config.ts';

const withConfig = (value: unknown, run: (home: string) => void) => {
  const home = mkdtempSync(join(tmpdir(), 'nerv-config-tz-'));
  try {
    writeFileSync(join(home, 'config.json'), JSON.stringify(value));
    run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};

test('config.json with an unknown timezone is refused on every read', () => {
  withConfig({ timeZone: 'Mars/Olympus_Mons' }, (home) => {
    for (let i = 0; i < 3; i++) assert.throws(() => readConfig(home), /Invalid IANA timezone/);
  });
});

// B-177: the nervous scheduler reads config.json twice per 250 ms tick, and each read built a new Intl.DateTimeFormat
// to check the timezone. ICU memory is outside the V8 heap, so it piled up: about 36 KB per formatter, measured to a
// ~590 MB nervous process on a Raspberry Pi. A timezone already checked is not checked again.
test('B-177: reading config.json again does not build a new Intl.DateTimeFormat for the same timezone', () => {
  withConfig({ timeZone: 'America/Argentina/Ushuaia' }, (home) => {
    readConfig(home);
    const Original = Intl.DateTimeFormat;
    let built = 0;
    Intl.DateTimeFormat = function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      built++;
      return new Original(...args);
    } as unknown as typeof Intl.DateTimeFormat;
    try {
      for (let i = 0; i < 100; i++) assert.equal(readConfig(home).timeZone, 'America/Argentina/Ushuaia');
    } finally {
      Intl.DateTimeFormat = Original;
    }
    assert.equal(built, 0);
  });
});
