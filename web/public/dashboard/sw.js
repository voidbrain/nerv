/* Dashboard service worker (F-004-T08): shows the reminder and brief pushes (F-133) the service sends to this installed app and opens the
   dashboard on a tap. It caches nothing and has no fetch handler, so the dashboard always reads the live service. The
   payload is the one the workspace's Angular worker reads ({ notification: { title, body, icon, data } }).
   F-004-T09: a tap is the phone's delivery confirmation. The worker posts the push's one-off receipt to
   /api/push/opened (no bearer: the receipt is the credential), so the reminder does not also go to Telegram after the
   fallback deadline. Showing the notification is not a confirmation: the owner may never see it.
   B-170: iOS may drop that request, the notification's data or the click event itself, so the receipt also rides in
   the notification's tag, the tap opens /dashboard/?opened=<receipt>, and each shown receipt is kept in Cache Storage
   (nerv-push-pending, an empty entry per receipt, not a page cache) for the page to report once its notification is
   gone (live.js). */
const RECEIPT = /^[A-Za-z0-9_-]{24}$/, TAG = "nerv-push-", KEPT = "nerv-push-pending", keptUrl = r => "/dashboard/push-pending/" + r;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let n = {};
  try { n = (e.data && e.data.json().notification) || {}; } catch { n = { body:e.data ? e.data.text() : "" }; }
  const receipt = n.data && typeof n.data.receipt === "string" && RECEIPT.test(n.data.receipt) ? n.data.receipt : "";
  e.waitUntil(self.registration.showNotification(typeof n.title === "string" && n.title ? n.title : "NERV Agency",
    { body:typeof n.body === "string" ? n.body : "", icon:"/icons/icon-192.png", data:n.data || null, ...(receipt ? { tag:TAG + receipt } : {}) })
    .then(() => receipt && self.caches && self.caches.open(KEPT).then(c => c.put(keptUrl(receipt), new Response(""))).catch(() => {})));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const data = e.notification.data, tag = e.notification.tag || "";
  const receipt = data && typeof data.receipt === "string" && RECEIPT.test(data.receipt) ? data.receipt
    : tag.startsWith(TAG) && RECEIPT.test(tag.slice(TAG.length)) ? tag.slice(TAG.length) : "";
  const opened = receipt
    ? fetch("/api/push/opened", { method:"POST", headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ receipt, via:"worker" }) })
        .then(r => (r.ok || r.status === 404) && self.caches && self.caches.open(KEPT).then(c => c.delete(keptUrl(receipt)))).catch(() => {})
    : Promise.resolve();
  e.waitUntil(Promise.all([opened, self.clients.matchAll({ type:"window", includeUncontrolled:true }).then(list => {
    const open = list.find(c => new URL(c.url).pathname.startsWith("/dashboard/"));
    return open ? open.focus() : self.clients.openWindow(receipt ? "/dashboard/?opened=" + receipt : "/dashboard/");
  })]));
});
