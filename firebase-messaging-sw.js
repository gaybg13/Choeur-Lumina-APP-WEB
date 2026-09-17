importScripts("/firebase-config.js");
importScripts("https://www.gstatic.com/firebasejs/11.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.7.1/firebase-messaging-compat.js");

firebase.initializeApp(self.__FIREBASE_CONFIG__);
const messaging = firebase.messaging();

function notificationTag(payload) {
  const type = payload.data?.type || "general";
  if (type === "group_message") return "group_chat";
  if (type === "direct_message") return `direct_${payload.data?.conversationId || "private"}`;
  if (type.startsWith("event_")) return `event_${payload.data?.eventId || "agenda"}`;
  return "lumina_general";
}

function notificationActions(payload) {
  const type = payload.data?.type || "";
  if (type === "group_message" || type === "direct_message") {
    return [
      { action: "reply", title: "Répondre" },
      { action: "mark_read", title: "Marquer comme lu" }
    ];
  }
  if (type === "event_created") {
    return [
      { action: "presence_present", title: "Présent" },
      { action: "presence_maybe", title: "Peut-être" },
      { action: "presence_absent", title: "Absent" }
    ];
  }
  return [];
}

messaging.onBackgroundMessage((payload) => {
  const title = payload.data?.title || payload.notification?.title || "Chœur Lumina";
  const body = payload.data?.body || payload.notification?.body || "Nouvelle activité";
  const link = payload.data?.link || payload.fcmOptions?.link || "/";

  self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: notificationTag(payload),
    renotify: true,
    actions: notificationActions(payload),
    data: { link, ...(payload.data || {}) }
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const baseLink = data.link || "/";
  const url = new URL(baseLink, self.location.origin);

  if (event.action === "mark_read") {
    url.searchParams.set("notificationAction", "mark_read");
    url.searchParams.set("notificationType", data.type || "");
    if (data.messageId) url.searchParams.set("messageId", data.messageId);
    if (data.conversationId) url.searchParams.set("conversationId", data.conversationId);
  }

  if (event.action === "reply") {
    url.searchParams.set("focusComposer", "1");
  }

  if (event.action === "presence_present" || event.action === "presence_maybe" || event.action === "presence_absent") {
    const value = event.action === "presence_present"
      ? "present"
      : event.action === "presence_maybe"
        ? "peut-etre"
        : "absent";
    url.searchParams.set("tab", "agenda");
    url.searchParams.set("notificationAction", `presence_${value}`);
    if (data.eventId) url.searchParams.set("eventId", data.eventId);
  }

  const target = `${url.pathname}${url.search}`;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
      for (const client of windowClients) {
        if ("navigate" in client) await client.navigate(target);
        if ("focus" in client) return client.focus();
      }
      return clients.openWindow(target);
    })
  );
});
