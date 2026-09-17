import { getToken, onMessage } from "firebase/messaging";
import { doc, getDocs, query, collection, where, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, messagingIfSupported, vapidKey } from "./firebase";

export async function enableNotifications(): Promise<string | null> {
  if (!("Notification" in window)) return null;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const messaging = await messagingIfSupported();
  if (!messaging) return null;

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
    scope: "/firebase-cloud-messaging-push-scope/"
  });
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration
  });

  const uid = auth.currentUser?.uid;
  if (uid && token) {
    const snap = await getDocs(query(collection(db, "members"), where("uid", "==", uid)));
    const memberDoc = snap.docs[0];
    if (memberDoc) {
      await setDoc(
        doc(db, "members", memberDoc.id, "notificationTokens", token.slice(-24)),
        {
          token,
          platform: "web",
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }
  }
  return token;
}

export async function listenForegroundMessages(callback: (title: string, body: string) => void) {
  const messaging = await messagingIfSupported();
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => {
    callback(
      payload.notification?.title || "Chœur Lumina",
      payload.notification?.body || "Nouvelle activité"
    );
  });
}

export async function clearDisplayedNotifications(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const notificationGroups = await Promise.all(
      registrations.map((registration) => registration.getNotifications())
    );
    notificationGroups.flat().forEach((notification) => notification.close());
  } catch {
    // Le nettoyage des notifications ne doit jamais bloquer l'application.
  }
}
