import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSurface } from '../shared/surface.ts';
import { CookingSessions } from '../src/cooking-session.ts';
import { toRecipeSurface } from '../src/documents.ts';
import { execute } from '../src/executors.ts';
import { detectPhotoMime, MAX_PHOTO_BYTES, validatePhotoBuffer } from '../src/photos.ts';
import { makeServer } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { parseRecipePhotoCaption, TelegramApi, TelegramChannel } from '../src/telegram.ts';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP_HEADER = Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1');

function openTempStore() {
  const home = mkdtempSync(join(tmpdir(), 'nerv-photos-test-'));
  const store = new Store(join(home, 'nerv.sqlite'), undefined, { home });
  return {
    home,
    store,
    cleanup: () => {
      store.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

describe('F-083-T10: recipe photos', () => {
  it('validates magic bytes, MIME types, and size limits and stores photos locally with mode 0600', () => {
    assert.equal(detectPhotoMime(PNG_HEADER), 'image/png');
    assert.equal(detectPhotoMime(JPEG_HEADER), 'image/jpeg');
    assert.equal(detectPhotoMime(WEBP_HEADER), 'image/webp');
    assert.equal(validatePhotoBuffer(JPEG_HEADER, 'image/jpg'), 'image/jpeg');

    assert.throws(() => validatePhotoBuffer(Buffer.alloc(0)), /empty/);
    assert.throws(() => validatePhotoBuffer(Buffer.alloc(MAX_PHOTO_BYTES + 1, 0xff)), /exceeds/);
    assert.throws(
      () => validatePhotoBuffer(Buffer.from('<html>not an image</html>'), 'image/png'),
      /Unsupported or invalid/,
    );
    assert.throws(() => validatePhotoBuffer(PNG_HEADER, 'image/jpeg'), /do not match/);

    const { home, store, cleanup } = openTempStore();
    try {
      const doc = store.documents.save({
        title: 'Tiramisu',
        category: 'desserts',
        body: 'Ingredients:\n- 500 g mascarpone\n\nSteps:\n1. Whisk eggs\n2. Layer',
        source: 'owner',
      });
      const saved = store.photos.attach({
        ownerKind: 'recipe',
        ownerId: doc.id,
        stepIndex: null,
        bytes: PNG_HEADER,
        mimeType: 'image/png',
        caption: 'Finished dish',
      });
      const got = store.photos.get(saved.id);
      assert.ok(got);
      assert.deepEqual(got.bytes, PNG_HEADER);
      const mode = statSync(join(home, 'photos', `${saved.id}.png`)).mode & 0o777;
      assert.equal(mode, 0o600);
    } finally {
      cleanup();
    }
  });

  it('includes photos on the recipe card surface and in cooking sessions', async () => {
    const { store, cleanup } = openTempStore();
    try {
      const doc = store.documents.save({
        title: 'Pasta al pesto',
        category: 'pasta',
        body: 'Ingredients:\n- 100 g pasta\n\nSteps:\n1. Boil water\n2. Toss with pesto',
        source: 'owner',
      });
      const whole = store.photos.attach({
        ownerKind: 'recipe',
        ownerId: doc.id,
        stepIndex: null,
        bytes: PNG_HEADER,
        caption: 'Plated',
      });
      const step1 = store.photos.attach({
        ownerKind: 'recipe',
        ownerId: doc.id,
        stepIndex: 0,
        bytes: JPEG_HEADER,
        caption: 'Boiling',
      });

      const surface = toRecipeSurface(doc, undefined, store.photos.list('recipe', doc.id));
      const validated = validateSurface(surface);
      assert.equal(validated.component, 'nerv-recipe-card');
      if (validated.component === 'nerv-recipe-card') {
        assert.equal(validated.props.photos?.length, 2);
        assert.equal(validated.props.photos?.[0]?.url, whole.url);
      }

      assert.throws(
        () =>
          validateSurface({
            version: 1,
            component: 'nerv-recipe-card',
            props: {
              title: 'Bad',
              category: 'pasta',
              body: 'Body',
              photos: [{ id: '1', url: 'https://evil.example/x.png' }],
            },
          }),
        /\/api\/photos\//,
      );

      const shown = execute(store, 'docs.show', { id: doc.id }) as {
        surface: { props: { photos?: unknown[] } };
      };
      assert.equal(shown.surface.props.photos?.length, 2);

      const cooking = new CookingSessions();
      const startReply = cooking.start('conv-1', doc.title, doc.body, false, store.photos.list('recipe', doc.id));
      assert.match(startReply, new RegExp(whole.url));
      assert.doesNotMatch(startReply, new RegExp(step1.url));

      const step1Reply = cooking.move('conv-1', 'first');
      assert.ok(step1Reply);
      assert.match(step1Reply, new RegExp(step1.url));

      const step2Reply = cooking.move('conv-1', 'next');
      assert.ok(step2Reply);
      assert.doesNotMatch(step2Reply, new RegExp(step1.url));
    } finally {
      cleanup();
    }
  });

  it('attaches and serves recipe photos through the dashboard HTTP API', async () => {
    const { store, cleanup } = openTempStore();
    const token = 'test-admin-token-0123456789';
    const doc = store.documents.save({
      title: 'Focaccia',
      category: 'bread',
      body: 'Ingredients:\n- 500 g flour\n\nSteps:\n1. Mix dough',
      source: 'owner',
    });
    const server = makeServer(store as never, token);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    try {
      const upload = await fetch(`${base}/api/recipes/${doc.id}/photos`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          dataBase64: PNG_HEADER.toString('base64'),
          mimeType: 'image/png',
          stepIndex: 0,
          caption: 'Mixed dough',
        }),
      });
      assert.equal(upload.status, 201);
      const saved = (await upload.json()) as { id: string; url: string };

      const listRes = await fetch(`${base}/api/recipes/${doc.id}/photos`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(listRes.status, 200);
      const list = (await listRes.json()) as { id: string }[];
      assert.equal(list.length, 1);
      assert.equal(list[0]?.id, saved.id);

      const imgRes = await fetch(`${base}${saved.url}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(imgRes.status, 200);
      assert.equal(imgRes.headers.get('content-type'), 'image/png');
      assert.equal(imgRes.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await imgRes.arrayBuffer()), PNG_HEADER);

      const badRes = await fetch(`${base}/api/recipes/${doc.id}/photos`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ dataBase64: Buffer.from('not-an-image').toString('base64'), mimeType: 'image/png' }),
      });
      assert.equal(badRes.status, 400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      cleanup();
    }
  });

  it('attaches a photo sent via Telegram with a recipe caption', async () => {
    assert.deepEqual(parseRecipePhotoCaption('recipe: Tiramisu step 2'), {
      recipe: 'Tiramisu',
      stepIndex: 1,
      caption: 'recipe: Tiramisu step 2',
    });
    assert.deepEqual(parseRecipePhotoCaption('ricetta: Pesto'), {
      recipe: 'Pesto',
      stepIndex: null,
      caption: 'ricetta: Pesto',
    });
    assert.equal(parseRecipePhotoCaption('hello world'), null);

    const { home, store, cleanup } = openTempStore();
    const doc = store.documents.save({
      title: 'Tiramisu',
      category: 'desserts',
      body: 'Ingredients:\n- 500 g mascarpone\n\nSteps:\n1. Whisk eggs',
      source: 'owner',
    });
    const sentMessages: string[] = [];
    const fakeTg = createHttpServer((req, res) => {
      const url = req.url ?? '';
      if (url.endsWith('/getFile')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.jpg' } }));
        return;
      }
      if (url.includes('/file/bot')) {
        res.writeHead(200, { 'content-type': 'image/jpeg' });
        res.end(JPEG_HEADER);
        return;
      }
      if (url.endsWith('/sendMessage')) {
        let body = '';
        req.on('data', (c) => {
          body += c;
        });
        req.on('end', () => {
          const parsed = JSON.parse(body) as { text?: string };
          if (parsed.text) sentMessages.push(parsed.text);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => fakeTg.listen(0, '127.0.0.1', resolve));
    const tgPort = (fakeTg.address() as { port: number }).port;
    try {
      const api = new TelegramApi('123456:fake_token_abcdefghijklmnopqrstuvwxyz123456', `http://127.0.0.1:${tgPort}`);
      const bot = new TelegramChannel({
        api,
        store: store as never,
        chatId: 42,
        statePath: join(home, 'tg-state.json'),
      });
      await (bot as unknown as { handle(u: unknown): Promise<void> }).handle({
        update_id: 1,
        message: {
          date: Math.floor(Date.now() / 1000),
          chat: { id: 42, type: 'private' },
          from: { id: 42 },
          caption: 'recipe: Tiramisu step 1',
          photo: [{ file_id: 'f-small', width: 100, height: 100, file_size: 100 }],
        },
      });
      const attached = store.photos.list('recipe', doc.id);
      assert.equal(attached.length, 1);
      assert.equal(attached[0]?.stepIndex, 0);
      assert.equal(attached[0]?.mimeType, 'image/jpeg');
      assert.match(sentMessages[0] ?? '', /Attached photo to "Tiramisu" \(step 1\)/);
    } finally {
      await new Promise<void>((resolve) => fakeTg.close(() => resolve()));
      cleanup();
    }
  });
});
