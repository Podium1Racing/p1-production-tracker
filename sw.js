self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function fetchLatestMessage() {
  try {
    const r = await fetch("/api/push?action=latest-message", { cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.latest || null;
  } catch (_) {
    return null;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const latest = await fetchLatestMessage();
    const title = latest?.user_name ? `${latest.user_name} sent a message` : "New team message";
    const body = latest?.message
      ? String(latest.message).slice(0, 120)
      : "Open Podium 1 Production Tracker to read it.";
    if (self.registration?.showNotification) {
      await self.registration.showNotification(title, {
        body,
        tag: "team-message",
        badge: "/assets/podium1-login-loading.png",
        icon: "/assets/podium1-login-loading.png",
        data: { url: "/#messages" },
      });
    }
    if (self.navigator && "setAppBadge" in self.navigator) {
      try { await self.navigator.setAppBadge(); } catch (_) {}
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = event.notification?.data?.url || "/#messages";
    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if ("focus" in client) {
        client.navigate(url);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_BADGE" && self.navigator && "clearAppBadge" in self.navigator) {
    event.waitUntil?.((async () => {
      try { await self.navigator.clearAppBadge(); } catch (_) {}
    })());
  }
});
