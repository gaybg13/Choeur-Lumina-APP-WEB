import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const APP_VERSION = "2.9.1";
const APP_SW_URL = "/sw.js";
const APP_SW_SCOPE = "/";
const UPDATE_INTERVAL_MS = 60_000;

function isFirebaseMessagingRegistration(registration: ServiceWorkerRegistration) {
  return registration.scope.includes("firebase-cloud-messaging-push-scope");
}

async function registerAndUpdateAppWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    // Évite d'interférer avec le service worker Firebase Messaging.
    const registrations = await navigator.serviceWorker.getRegistrations();
    const duplicateAppWorkers = registrations.filter(
      (registration) =>
        !isFirebaseMessagingRegistration(registration) &&
        registration.scope !== new URL(APP_SW_SCOPE, window.location.origin).href
    );
    await Promise.all(duplicateAppWorkers.map((registration) => registration.unregister()));

    const registration = await navigator.serviceWorker.register(APP_SW_URL, {
      scope: APP_SW_SCOPE,
      updateViaCache: "none"
    });
    await registration.update();
  } catch (error) {
    console.warn("Mise à jour du service worker impossible :", error);
  }
}

async function checkDeployedVersion() {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store"
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { version?: string };
    if (payload.version && payload.version !== APP_VERSION) {
      await registerAndUpdateAppWorker();
      window.location.reload();
    }
  } catch {
    // L'application reste utilisable hors connexion momentanée ; on retentera plus tard.
  }
}

if ("serviceWorker" in navigator) {
  let reloadingForNewWorker = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForNewWorker) return;
    reloadingForNewWorker = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    void registerAndUpdateAppWorker();
    void checkDeployedVersion();

    window.setInterval(() => {
      void registerAndUpdateAppWorker();
      void checkDeployedVersion();
    }, UPDATE_INTERVAL_MS);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void registerAndUpdateAppWorker();
      void checkDeployedVersion();
    }
  });

  window.addEventListener("focus", () => {
    void registerAndUpdateAppWorker();
    void checkDeployedVersion();
  });

  window.addEventListener("online", () => {
    void registerAndUpdateAppWorker();
    void checkDeployedVersion();
  });
}

// Retire le paramètre technique ajouté par le SW de migration après le premier chargement propre.
if (new URL(window.location.href).searchParams.has("lumina-sw")) {
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("lumina-sw");
  window.history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
}
