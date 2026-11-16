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
  getWindow(appName: string, windowTitle?: string): Promise<DesktopWindowSnapshot>;
  pressControl(appName: string, windowTitle: string, controlName: string): Promise<DesktopWindowSnapshot>;
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
    throw new Error(
      'Accessibility permission is not granted. Enable it in System Settings > Privacy & Security > Accessibility.',
    );
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
