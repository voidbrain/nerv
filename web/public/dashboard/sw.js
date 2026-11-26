/* Dashboard service worker (F-004-T08): shows the reminder and brief pushes (F-133) the service sends to this installed app and opens the
   dashboard on a tap. It caches nothing and has no fetch handler, so the dashboard always reads the live service. The
   payload is the one the workspace's Angular worker reads ({ notification: { title, body, icon, data } }).
   F-004-T09: a tap is the phone's delivery confirmation. The worker posts the push's one-off receipt to
   /api/push/opened (no bearer: the receipt is the credential), so the reminder does not also go to Telegram after the
   fallback deadline. Showing the notification is not a confirmation: the owner may never see it. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let n = {};
  try { n = (e.data && e.data.json().notification) || {}; } catch { n = { body:e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(typeof n.title === "string" && n.title ? n.title : "NERV Agency",
    { body:typeof n.body === "string" ? n.body : "", icon:"/icons/icon-192.png", data:n.data || null }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const receipt = e.notification.data && e.notification.data.receipt;
  const opened = typeof receipt === "string" && receipt
    ? fetch("/api/push/opened", { method:"POST", headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ receipt }) }).catch(() => {})
    : Promise.resolve();
  e.waitUntil(Promise.all([opened, self.clients.matchAll({ type:"window", includeUncontrolled:true }).then(list => {
    const open = list.find(c => new URL(c.url).pathname.startsWith("/dashboard/"));
    return open ? open.focus() : self.clients.openWindow("/dashboard/");
  })]));
});
