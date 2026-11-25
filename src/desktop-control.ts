import type {
  DesktopInputEvent,
  DesktopReplayDriver,
  DisplayBounds,
  FrontmostAppMetadata,
} from './desktop-recording.ts';

export interface DesktopControlNode {
  name: string;
  role: string;
  isPassword?: boolean;
  isPayment?: boolean;
}

export interface DesktopWindowSnapshot {
  appName: string;
  bundleId?: string;
  windowTitle: string;
  isSystemPermissionDialog?: boolean;
  controls: DesktopControlNode[];
  summaryText: string;
}

export interface DesktopAccessibilityDriver {
  checkAccessibilityPermission(): boolean;
  /** How the owner grants the permission for this driver (which app, which settings pane). */
  accessibilityGrantHint?(): string;
  getWindow(appName: string, windowTitle?: string): Promise<DesktopWindowSnapshot>;
  pressControl(appName: string, windowTitle: string, controlName: string): Promise<DesktopWindowSnapshot>;
}

/**
 * The one desktop path (F-093-T03): a single accessibility driver that serves the click adapter,
 * the editor resume (F-012, `createDesktopEditorResumeDeps`) and the replay preconditions
 * (F-092, `desktopReplayDriver`), so no feature binds a second desktop path.
 */
export interface DesktopDriver extends DesktopAccessibilityDriver {
  getDisplayBounds(): Promise<DisplayBounds>;
  getFrontmostApp(): Promise<FrontmostAppMetadata>;
}

/** Low-level input the replay needs on top of the shared driver (event posting, owner-input watch). */
export interface DesktopInputSource {
  dispatchEvent(event: DesktopInputEvent): Promise<void>;
  hasOwnerInput(): boolean | Promise<boolean>;
}

/**
 * Builds the F-092 replay driver from the shared desktop driver: permission, display and frontmost-window
 * preconditions and the readback all come from the same accessibility path the click adapter uses.
 */
export function desktopReplayDriver(driver: DesktopDriver, input: DesktopInputSource): DesktopReplayDriver {
  return {
    checkAccessibilityPermission: () => driver.checkAccessibilityPermission(),
    getDisplayBounds: () => driver.getDisplayBounds(),
    getFrontmostApp: () => driver.getFrontmostApp(),
    dispatchEvent: (event) => input.dispatchEvent(event),
    hasOwnerInput: () => input.hasOwnerInput(),
    async readBackSummary() {
      const front = await driver.getFrontmostApp();
      const window = await driver.getWindow(front.appName, front.windowTitle);
      return window.summaryText;
    },
  };
}

export interface ClickDesktopControlRequest {
  appName: string;
  windowTitle?: string;
  controlName: string;
  approved: boolean;
}

export interface ClickDesktopControlResult {
  tainted: true;
  trust: 'tainted';
  appName: string;
  windowTitle: string;
  clicked: string;
  beforeSummary: string;
  afterSummary: string;
}

const SYSTEM_DIALOG_BUNDLES = new Set([
  'com.apple.SecurityAgent',
  'com.apple.UserNotificationCenter',
  'com.microsoft.uac',
]);
const PAYMENT_PATTERN = /\b(pay\s*now|purchase|buy\s*now|checkout|authorize\s*payment|confirm\s*transfer)\b/i;
const PASSWORD_PATTERN = /\b(password|passcode|pin|secret|token)\b/i;

/**
 * Finds a control by app, window, and accessible name, checks owner-granted accessibility
 * permission and Orange approval, refuses password/system-permission/payment controls,
 * clicks once, reads the window back, and marks all screen text tainted (F-093-T02).
 */
export async function clickDesktopControl(
  driver: DesktopAccessibilityDriver,
  request: ClickDesktopControlRequest,
): Promise<ClickDesktopControlResult> {
  if (!driver.checkAccessibilityPermission()) {
    const hint =
      driver.accessibilityGrantHint?.() ?? 'Enable it in System Settings > Privacy & Security > Accessibility.';
    throw new Error(`Accessibility permission is not granted. ${hint}`);
  }
  if (!request.approved) {
    throw new Error('Clicking a desktop control is an Orange action and requires explicit owner approval.');
  }

  const before = await driver.getWindow(request.appName, request.windowTitle);
  if (
    before.isSystemPermissionDialog ||
    (before.bundleId !== undefined && SYSTEM_DIALOG_BUNDLES.has(before.bundleId))
  ) {
    throw new Error(`Refusing to interact with system permission dialog in "${before.appName}".`);
  }

  const targetName = request.controlName.trim();
  const match = before.controls.find((c) => c.name.trim().toLowerCase() === targetName.toLowerCase());
  if (!match) {
    throw new Error(`Accessible control "${targetName}" was not found in "${before.appName}" (${before.windowTitle}).`);
  }
  if (match.isPassword || match.role === 'AXSecureTextField' || PASSWORD_PATTERN.test(match.name)) {
    throw new Error(`Refusing to interact with password/credential control "${match.name}".`);
  }
  if (match.isPayment || PAYMENT_PATTERN.test(match.name)) {
    throw new Error(`Refusing to interact with payment/purchase control "${match.name}".`);
  }

  const after = await driver.pressControl(before.appName, before.windowTitle, match.name);
  return {
    tainted: true,
    trust: 'tainted',
    appName: before.appName,
    windowTitle: before.windowTitle,
    clicked: match.name,
    beforeSummary: before.summaryText,
    afterSummary: after.summaryText,
  };
}
