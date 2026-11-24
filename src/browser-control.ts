export interface AccessibleControl {
  name: string;
  role: string;
  isCredentialOrPayment?: boolean;
  /** Inside an open page dialog (`<dialog open>`, role dialog/alertdialog): NERV never answers dialogs. */
  inDialog?: boolean;
}

export interface BrowserTabSnapshot {
  tabId: string;
  url: string;
  title: string;
  active: boolean;
  controls: AccessibleControl[];
  textSummary: string;
}

export interface BrowserAdapterDriver {
  getActiveTab(): Promise<BrowserTabSnapshot>;
  clickControl(tabId: string, controlName: string): Promise<BrowserTabSnapshot>;
}

export interface ClickNamedControlRequest {
  controlName: string;
  allowedOrigins: readonly string[];
  expectedTabId?: string;
  /** F-089-T06: the origin the owner's card names; the active tab must still be on it. */
  expectedOrigin?: string;
  approved: boolean;
}

export interface ClickNamedControlResult {
  tainted: true;
  trust: 'tainted';
  tabId: string;
  clicked: string;
  before: { url: string; title: string; textSummary: string };
  after: { url: string; title: string; textSummary: string };
}

const SENSITIVE_CONTROL_PATTERN =
  /\b(password|passcode|pin|credit\s*card|cvv|pay\s*now|purchase|authorize\s*payment)\b/i;

function assertAllowedOrigin(rawUrl: string, allowedOrigins: readonly string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid active tab URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Disallowed browser URL protocol: ${parsed.protocol}`);
  }
  if (!allowedOrigins.includes(parsed.origin)) {
    throw new Error(`Origin "${parsed.origin}" is not in browser.allowedOrigins.`);
  }
  return parsed;
}

/**
 * Finds an accessible control by name on the active allowlisted tab, gates click behind owner approval,
 * refuses credential/payment controls, and tags all returned page text `tainted: true` (F-089-T02).
 */
export async function clickNamedControl(
  driver: BrowserAdapterDriver,
  request: ClickNamedControlRequest,
): Promise<ClickNamedControlResult> {
  if (!request.approved) {
    throw new Error('Clicking a browser control is an Orange action and requires explicit owner approval.');
  }
  const targetName = request.controlName.trim();
  if (!targetName) {
    throw new Error('Control name is required.');
  }

  const beforeTab = await driver.getActiveTab();
  if (!beforeTab.active) {
    throw new Error('Refusing to act on a non-active browser tab.');
  }
  if (request.expectedTabId && beforeTab.tabId !== request.expectedTabId) {
    throw new Error(`Active tab "${beforeTab.tabId}" does not match expected tab "${request.expectedTabId}".`);
  }
  const origin = assertAllowedOrigin(beforeTab.url, request.allowedOrigins).origin;
  if (request.expectedOrigin !== undefined && origin !== request.expectedOrigin) {
    throw new Error(
      `The tab moved to another origin ("${origin}", not "${request.expectedOrigin}"); nothing was clicked.`,
    );
  }

  const match = beforeTab.controls.find((c) => c.name.trim().toLowerCase() === targetName.toLowerCase());
  if (!match) {
    throw new Error(`Accessible control "${targetName}" was not found on the active tab.`);
  }
  if (match.isCredentialOrPayment || SENSITIVE_CONTROL_PATTERN.test(match.name)) {
    throw new Error(`Refusing to interact with credential or payment control "${match.name}".`);
  }
  if (match.inDialog) {
    throw new Error(`Refusing to answer a dialog: "${match.name}" is inside an open dialog.`);
  }

  const afterTab = await driver.clickControl(beforeTab.tabId, match.name);
  return {
    tainted: true,
    trust: 'tainted',
    tabId: beforeTab.tabId,
    clicked: match.name,
    before: { url: beforeTab.url, title: beforeTab.title, textSummary: beforeTab.textSummary },
    after: { url: afterTab.url, title: afterTab.title, textSummary: afterTab.textSummary },
  };
}

/** A click bound to the tab it was proposed on: the owner's card shows these, and the grant's argument hash binds them. */
export interface BoundClick {
  control: string;
  tabId: string;
  origin: string;
  /** Origin and path only (no query or fragment), for the card. */
  url: string;
}

/**
 * F-089-T06: binds a proposed click to the active tab when it is proposed. Refuses a non-active tab or an origin
 * outside the allowlist before any card exists; the click itself later runs only on this tab and origin.
 */
export async function bindClickToActiveTab(
  driver: BrowserAdapterDriver,
  control: string,
  allowedOrigins: readonly string[],
): Promise<BoundClick> {
  const tab = await driver.getActiveTab();
  if (!tab.active) throw new Error('Refusing to act on a non-active browser tab.');
  const parsed = assertAllowedOrigin(tab.url, allowedOrigins);
  return { control, tabId: tab.tabId, origin: parsed.origin, url: (parsed.origin + parsed.pathname).slice(0, 300) };
}

/** config.json `browser`: the owner-set origin allowlist and the dedicated profile's local debugging port (F-089-T04). */
export interface BrowserConfig {
  allowedOrigins: string[];
  debugPort: number;
}

const BROWSER_CONFIG_HELP =
  'Invalid browser: {"allowedOrigins": ["https://example.com"], "debugPort": 9222} (http/https origins, at most 20; the port of the dedicated profile on 127.0.0.1).';

export function validateBrowserConfig(value: unknown): BrowserConfig {
  const b = value as Record<string, unknown>;
  if (
    !b ||
    typeof b !== 'object' ||
    Array.isArray(b) ||
    Object.keys(b).some((k) => !['allowedOrigins', 'debugPort'].includes(k))
  )
    throw new Error(BROWSER_CONFIG_HELP);
  const origins = b.allowedOrigins;
  if (!Array.isArray(origins) || origins.length > 20) throw new Error(BROWSER_CONFIG_HELP);
  for (const origin of origins) {
    if (typeof origin !== 'string') throw new Error(BROWSER_CONFIG_HELP);
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(BROWSER_CONFIG_HELP);
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin)
      throw new Error(BROWSER_CONFIG_HELP);
  }
  const port = b.debugPort;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error(BROWSER_CONFIG_HELP);
  return { allowedOrigins: [...(origins as string[])], debugPort: port };
}
