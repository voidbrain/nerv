import { fileURLToPath } from 'node:url';
import type { AppStepReadback, AppWorkflowDriver } from './app-workflow.ts';
import { macHelperCaller, type MacDesktopDriverOptions } from './desktop-macos-driver.ts';

/** The fixed-template JXA helper for scriptable apps (`native/app-workflow.js`). */
export const MAC_APP_WORKFLOW_HELPER = fileURLToPath(new URL('../native/app-workflow.js', import.meta.url));

function asReadback(value: unknown): AppStepReadback {
  const v = value as Partial<AppStepReadback>;
  if (typeof v?.frontmostApp !== 'string') throw new Error('App workflow helper returned an unreadable readback.');
  return {
    frontmostApp: v.frontmostApp,
    ...(typeof v.documentPath === 'string' ? { documentPath: v.documentPath } : {}),
    ...(typeof v.dialog === 'string' && v.dialog ? { dialog: v.dialog } : {}),
  };
}

/**
 * F-094-T02: the scripting tier on macOS (F-094-T01, tier 2). Fixed JXA templates open the app, open
 * the file and save the front document under a new path; the app name and paths travel as JSON data.
 * Each call returns the readback the workflow checks before the next step.
 */
export function createMacAppWorkflowDriver(
  options: Omit<MacDesktopDriverOptions, 'helperPath'> & { helperPath?: string } = {},
): AppWorkflowDriver {
  const call = macHelperCaller('App workflow helper', options.helperPath ?? MAC_APP_WORKFLOW_HELPER, options);
  return {
    openApp: async (app) => asReadback(call('open-app', { app })),
    openFile: async (app, path) => asReadback(call('open-file', { app, path })),
    saveAs: async (app, path) => asReadback(call('save-as', { app, path })),
  };
}
