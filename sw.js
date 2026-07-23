const PUSH_USER_CACHE = "pt-push-meta";
const PUSH_USER_KEY = "/__push_user__";

async function setStoredPushUser(userName) {
  const cache = await caches.open(PUSH_USER_CACHE);
  await cache.put(PUSH_USER_KEY, new Response(JSON.stringify({ userName: String(userName || "") }), {
    headers: { "Content-Type": "application/json" },
  }));
}

async function getStoredPushUser() {
  try {
    const cache = await caches.open(PUSH_USER_CACHE);
    const res = await cache.match(PUSH_USER_KEY);
    if (!res) return "";
    const data = await res.json();
    return String(data?.userName || "");
  } catch (_) {
    return "";
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function fetchLatestAlert(userName) {
  try {
    if (!userName) return null;
    const r = await fetch(`/api/push?action=latest-alert&userName=${encodeURIComponent(userName)}`, { cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.latest || null;
  } catch (_) {
    return null;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const userName = await getStoredPushUser();
    const latest = await fetchLatestAlert(userName);
    const title = latest?.title || "Podium 1 alert";
    const body = latest?.body
      ? String(latest.body).slice(0, 160)
      : "Open Podium 1 Production Tracker to review it.";
    if (self.registration?.showNotification) {
      await self.registration.showNotification(title, {
        body,
        tag: latest?.tag || "pt-alert",
        badge: "/assets/podium1-login-loading.png",
        icon: "/assets/podium1-login-loading.png",
        data: { url: latest?.url || "/#messages" },
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
  if (event.data?.type === "SET_PUSH_USER") {
    event.waitUntil?.(setStoredPushUser(event.data?.userName || ""));
    return;
  }
  if (event.data?.type === "CLEAR_PUSH_USER") {
    event.waitUntil?.(setStoredPushUser(""));
    return;
  }
  if (event.data?.type === "CLEAR_BADGE" && self.navigator && "clearAppBadge" in self.navigator) {
    event.waitUntil?.((async () => {
      try { await self.navigator.clearAppBadge(); } catch (_) {}
    })());
  }
});
