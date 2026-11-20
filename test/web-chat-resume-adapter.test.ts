import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { BrowserAdapterDriver, BrowserTabSnapshot } from '../src/browser-control.ts';
import { RESUME_INTENT_SCHEMA, ResumeIntentStore, runResumeEngineTick } from '../src/resume-intent.ts';
import { createWebChatResumeDeps, webChatTabFingerprint } from '../src/web-chat-resume-adapter.ts';

function makeStore() {
  const db = new DatabaseSync(':memory:');
  db.exec(RESUME_INTENT_SCHEMA);
  const store = new ResumeIntentStore(db);
  return {
    store,
    cleanup: () => {
      db.close();
    },
  };
}

function makeIntent(store: ResumeIntentStore, tab: BrowserTabSnapshot, now = 1_000_000) {
  return store.create({
    targetKind: 'web-chat',
    targetId: tab.tabId,
    targetFingerprint: webChatTabFingerprint(tab),
    permissionScope: {
      allowedAction: 'resume-named-job',
      targetId: tab.tabId,
      allowSecurityPrompts: false,
      allowLimitBypass: false,
      modelOverrideBlocked: true,
      grantedBy: 'owner',
    },
    resetAt: now - 1000,
    expiresAt: now + 600_000,
    maxAttempts: 2,
    now: now - 5000,
  });
}

test('F-012-T04: web-chat adapter resumes once via fresh active tab and accessible control lookup', async () => {
  const { store, cleanup } = makeStore();
  const now = 1_000_000;
  let tab: BrowserTabSnapshot = {
    tabId: 'tab-chat-1',
    url: 'https://chat.example.invalid/c/123',
    title: 'Draft report',
    active: true,
    controls: [{ name: 'Continue', role: 'button' }],
    textSummary: 'Paused waiting to continue.',
  };
  const clicked: string[] = [];
  const driver: BrowserAdapterDriver = {
    async getActiveTab() {
      return tab;
    },
    async clickControl(tabId, controlName) {
      clicked.push(`${tabId}:${controlName}`);
      tab = { ...tab, textSummary: 'Generating response...', controls: [{ name: 'Stop generating', role: 'button' }] };
      return tab;
    },
  };
  try {
    makeIntent(store, tab, now);
    const notices: string[] = [];
    const deps = createWebChatResumeDeps({
      driver,
      allowedOrigins: ['https://chat.example.invalid'],
      notifyOutcome: (_i, msg) => {
        notices.push(msg);
      },
    });
    const res = await runResumeEngineTick(store, { ...deps, now });
    assert.equal(res.processed.length, 1);
    assert.equal(res.processed[0]!.status, 'resumed');
    assert.deepEqual(clicked, ['tab-chat-1:Continue']);
    assert.equal(notices.length, 1);
  } finally {
    cleanup();
  }
});

test('F-012-T04: refuses stale clicks after sleep when tab content changes, session expires, control disappears, or job already runs', async () => {
  const now = 1_000_000;
  const baseTab: BrowserTabSnapshot = {
    tabId: 'tab-chat-2',
    url: 'https://chat.example.invalid/c/456',
    title: 'Build helper',
    active: true,
    controls: [{ name: 'Continue', role: 'button' }],
    textSummary: 'Waiting to resume.',
  };

  // 1. Expired session -> deferred/not clicked
  {
    const { store, cleanup } = makeStore();
    let clicked = 0;
    const expiredTab: BrowserTabSnapshot = { ...baseTab, textSummary: 'Session expired. Please sign in.' };
    try {
      const intent = makeIntent(store, baseTab, now);
      const deps = createWebChatResumeDeps({
        driver: {
          getActiveTab: async () => expiredTab,
          clickControl: async () => {
            clicked++;
            return expiredTab;
          },
        },
        allowedOrigins: ['https://chat.example.invalid'],
      });
      await runResumeEngineTick(store, { ...deps, now });
      assert.equal(clicked, 0);
      assert.equal(store.get(intent.id)!.status, 'pending');
    } finally {
      cleanup();
    }
  }

  // 2. Changed target content after sleep -> rejected without clicking
  {
    const { store, cleanup } = makeStore();
    let clicked = 0;
    const changedTab: BrowserTabSnapshot = { ...baseTab, textSummary: 'Completely different conversation.' };
    try {
      const intent = makeIntent(store, baseTab, now);
      const deps = createWebChatResumeDeps({
        driver: {
          getActiveTab: async () => changedTab,
          clickControl: async () => {
            clicked++;
            return changedTab;
          },
        },
        allowedOrigins: ['https://chat.example.invalid'],
      });
      await runResumeEngineTick(store, { ...deps, now });
      assert.equal(clicked, 0);
      assert.equal(store.get(intent.id)!.status, 'failed');
    } finally {
      cleanup();
    }
  }

  // 3. Missing Continue control -> not clicked
  {
    const { store, cleanup } = makeStore();
    let clicked = 0;
    const missingBtnTab: BrowserTabSnapshot = { ...baseTab, controls: [{ name: 'Regenerate', role: 'button' }] };
    try {
      makeIntent(store, baseTab, now);
      const deps = createWebChatResumeDeps({
        driver: {
          getActiveTab: async () => missingBtnTab,
          clickControl: async () => {
            clicked++;
            return missingBtnTab;
          },
        },
        allowedOrigins: ['https://chat.example.invalid'],
      });
      await runResumeEngineTick(store, { ...deps, now });
      assert.equal(clicked, 0);
    } finally {
      cleanup();
    }
  }

  // 4. Already running -> not clicked
  {
    const { store, cleanup } = makeStore();
    let clicked = 0;
    const runningTab: BrowserTabSnapshot = {
      ...baseTab,
      textSummary: 'Generating...',
      controls: [{ name: 'Stop generating', role: 'button' }],
    };
    try {
      makeIntent(store, baseTab, now);
      const deps = createWebChatResumeDeps({
        driver: {
          getActiveTab: async () => runningTab,
          clickControl: async () => {
            clicked++;
            return runningTab;
          },
        },
        allowedOrigins: ['https://chat.example.invalid'],
      });
      await runResumeEngineTick(store, { ...deps, now });
      assert.equal(clicked, 0);
    } finally {
      cleanup();
    }
  }

  // 5. Uncertain click acknowledgement (page unchanged after click) -> failed without retry
  {
    const { store, cleanup } = makeStore();
    try {
      const intent = makeIntent(store, baseTab, now);
      const deps = createWebChatResumeDeps({
        driver: {
          getActiveTab: async () => baseTab,
          clickControl: async () => baseTab,
        },
        allowedOrigins: ['https://chat.example.invalid'],
      });
      await runResumeEngineTick(store, { ...deps, now });
      const final = store.get(intent.id)!;
      assert.equal(final.status, 'failed');
      assert.match(final.lastError ?? '', /uncertain-click-acknowledgement/);
    } finally {
      cleanup();
    }
  }
});
