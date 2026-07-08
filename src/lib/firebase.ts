import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported } from "firebase/messaging";

declare global {
  interface Window {
    __FIREBASE_CONFIG__: {
      apiKey: string;
      authDomain: string;
      projectId: string;
      storageBucket: string;
      messagingSenderId: string;
      appId: string;
    };
    __FIREBASE_VAPID_KEY__: string;
  }
}

const config = window.__FIREBASE_CONFIG__;

if (!config || config.apiKey.startsWith("REMPLACER")) {
  console.warn("Configuration Firebase Web à compléter dans public/firebase-config.js");
}

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export async function messagingIfSupported() {
  return (await isSupported()) ? getMessaging(app) : null;
}

export const vapidKey = window.__FIREBASE_VAPID_KEY__;