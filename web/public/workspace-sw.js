/* Workspace service worker (F-004-T09 review): Angular's ngsw-worker.js (offline shell, update prompt, its own
   notification-click focus) plus the reminder push receipt. A tap on a reminder notification posts the push's one-off
   receipt to /api/push/opened (no bearer: the receipt is the credential), so the reminder does not also go to Telegram
   after the fallback deadline. Same rule as the dashboard's worker (web/public/dashboard/sw.js). */
importScripts("ngsw-worker.js");
self.addEventListener("notificationclick", e => {
  const data = e.notification && e.notification.data;
  const receipt = data && data.receipt;
  if (typeof receipt !== "string" || !receipt) return;
  e.waitUntil(fetch("/api/push/opened", { method:"POST", headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ receipt }) }).catch(() => {}));
});
