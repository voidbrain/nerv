import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/config.ts';
import { isTailscaleAddress, MAX_REPLY_BYTES, ModelError, selectRoute, validateModels } from '../src/model.ts';
import { MAX_FRAME_BYTES } from '../src/rpc.ts';

test('models.local retains loopback-only guarantee and refuses Tailscale or remote URLs', () => {
  for (const baseUrl of ['http://127.0.0.1:11434/v1', 'http://localhost:11434/v1', 'http://[::1]:11434/v1']) {
    const m = validateModels({ local: { baseUrl, model: 'gemma' } });
    assert.equal(m.local?.model, 'gemma');
  }
  for (const baseUrl of [
    'http://100.64.0.2:11434/v1',
    'http://[fd7a:115c:a1e0::2]:11434/v1',
    'http://192.168.1.5:11434/v1',
    'https://mac.example.ts.net/v1',
  ]) {
    assert.throws(() => validateModels({ local: { baseUrl, model: 'gemma' } }), /loopback address on this machine/);
  }
});

test('models.remote validates base-ID endpoints, per-base data grants and serving allow list', () => {
  const valid = validateModels({
    remote: {
      endpoints: {
        mac: { baseId: 'NERV-01', model: 'qwen2.5:14b' },
      },
      allowBases: ['NERV-01', 'NERV-01', 'NERV-02'],
      serve: {
        enabled: true,
        bases: ['NERV-02'],
        models: ['qwen2.5:14b', 'gemma4:e2b-it-q4_K_M'],
      },
    },
  });
  assert.deepEqual(valid.remote, {
    endpoints: { mac: { baseId: 'NERV-01', model: 'qwen2.5:14b' } },
    allowBases: ['NERV-01', 'NERV-02'],
    serve: { enabled: true, bases: ['NERV-02'], models: ['qwen2.5:14b', 'gemma4:e2b-it-q4_K_M'] },
  });

  assert.throws(() => validateModels({ remote: {} }), /Invalid models\.remote/);
  assert.throws(
    () =>
      validateModels({
        remote: { endpoints: { mac: { baseId: 'NERV-01', model: 'm', baseUrl: 'http://100.64.0.1:11434' } } },
      }),
    /never a URL/,
  );
  assert.throws(
    () => validateModels({ remote: { endpoints: { mac: { baseId: 'http://100.64.0.1', model: 'm' } } } }),
    /never a URL/,
  );
  assert.throws(
    () => validateModels({ remote: { endpoints: { mac: { baseId: 'nerv-01', model: 'm' } } } }),
    /never a URL/,
  );
  assert.throws(() => validateModels({ remote: { allowBases: ['bad id'] } }), /valid base ID/);
  assert.throws(() => validateModels({ remote: { serve: { bases: ['NERV-02'] } } }), /enabled boolean/);
  assert.throws(
    () => validateModels({ remote: { serve: { enabled: false, bases: ['bad'], models: [] } } }),
    /valid base ID/,
  );
});

test('privacy classes: local-only and owner-bases never route to cloud; casper and consultant stay local-only', () => {
  const cloudOnly = { cloud: { provider: 'anthropic' as const, model: 'claude-opus-5-5', enabled: true } };
  assert.throws(() => selectRoute({ prompt: 'x', privacy: 'local-only', route: 'cloud' }, cloudOnly, true), ModelError);
  assert.throws(
    () => selectRoute({ prompt: 'x', privacy: 'owner-bases', route: 'cloud' }, cloudOnly, true),
    ModelError,
  );
  assert.throws(
    () => selectRoute({ prompt: 'x', privacy: 'owner-bases' }, cloudOnly, true),
    /\(S²\) is not configured/,
  );
  assert.equal(selectRoute({ prompt: 'x', privacy: 'any' }, cloudOnly, true), 'cloud');

  const withPrivacy = validateModels({
    roles: { misato: { route: 'local', model: 'gemma', privacy: 'owner-bases' } },
  });
  assert.equal(withPrivacy.roles?.misato?.privacy, 'owner-bases');
  assert.throws(() => validateModels({ roles: { misato: { route: 'local', privacy: 'public' } } }), /privacy/);
  assert.throws(() => validateModels({ roles: { casper: { model: 'gemma', privacy: 'owner-bases' } } }), /local route/);
  assert.throws(
    () => validateModels({ roles: { consultant: { model: 'gemma', privacy: 'owner-bases' } } }),
    /local model/,
  );
});

test('isTailscaleAddress accepts only 100.64.0.0/10 and fd7a:115c:a1e0::/48', () => {
  for (const addr of [
    '100.64.0.1',
    '100.127.255.254',
    '100.100.100.100:4318',
    'fd7a:115c:a1e0::1',
    '[fd7a:115c:a1e0:1::2]:4318',
  ]) {
    assert.equal(isTailscaleAddress(addr), true, addr);
  }
  for (const addr of [
    '100.63.255.255',
    '100.128.0.0',
    '192.168.1.10',
    '10.0.0.5',
    '127.0.0.1',
    '8.8.8.8',
    'fd7a:115c:a1e1::1',
    'mac.local',
    '',
  ]) {
    assert.equal(isTailscaleAddress(addr), false, addr);
  }
});

test('remote inference bounds fit within MAX_FRAME_BYTES and align with MAX_REPLY_BYTES', () => {
  assert.equal(MAX_REPLY_BYTES, 16384);
  assert.equal(MAX_FRAME_BYTES, 65536);
  assert.ok(32768 + 8192 < MAX_FRAME_BYTES);
  assert.ok(MAX_REPLY_BYTES < MAX_FRAME_BYTES);
});

test('readConfig validates remote inference configuration end-to-end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-remote-cfg-'));
  try {
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        models: {
          local: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'gemma' },
          roles: { misato: { route: 'local', privacy: 'owner-bases' } },
          remote: {
            endpoints: { mac: { baseId: 'NERV-01', model: 'qwen2.5:14b' } },
            allowBases: ['NERV-01'],
          },
        },
      }),
    );
    const cfg = readConfig(dir);
    assert.equal(cfg.models.remote?.endpoints?.mac?.baseId, 'NERV-01');
    assert.equal(cfg.models.roles?.misato?.privacy, 'owner-bases');

    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ models: { local: { baseUrl: 'http://100.64.0.1:11434/v1', model: 'gemma' } } }),
    );
    assert.throws(() => readConfig(dir), /loopback address/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
