/* Dashboard service worker (F-004-T08): shows the reminder pushes the service sends to this installed app and opens the
   dashboard on a tap. It caches nothing and has no fetch handler, so the dashboard always reads the live service. The
   payload is the one the workspace's Angular worker reads ({ notification: { title, body, icon, data } }). */
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
  e.waitUntil(self.clients.matchAll({ type:"window", includeUncontrolled:true }).then(list => {
    const open = list.find(c => new URL(c.url).pathname.startsWith("/dashboard/"));
    return open ? open.focus() : self.clients.openWindow("/dashboard/");
  }));
});
