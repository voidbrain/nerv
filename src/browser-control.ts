export interface AccessibleControl {
  name: string;
  role: string;
  isCredentialOrPayment?: boolean;
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

function assertAllowedOrigin(rawUrl: string, allowedOrigins: readonly string[]): void {
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
  assertAllowedOrigin(beforeTab.url, request.allowedOrigins);

  const match = beforeTab.controls.find((c) => c.name.trim().toLowerCase() === targetName.toLowerCase());
  if (!match) {
    throw new Error(`Accessible control "${targetName}" was not found on the active tab.`);
  }
  if (match.isCredentialOrPayment || SENSITIVE_CONTROL_PATTERN.test(match.name)) {
    throw new Error(`Refusing to interact with credential or payment control "${match.name}".`);
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
