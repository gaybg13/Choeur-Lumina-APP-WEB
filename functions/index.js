const {onDocumentCreated, onDocumentUpdated} = require("firebase-functions/v2/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, Timestamp} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");

initializeApp();


function eventTypeMeta(type) {
  const types = {
    repetition: {label: "répétition", article: "une", title: "Nouvelle répétition", definite: "La répétition", scheduled: "prévue", cancelled: "annulée"},
    messe: {label: "messe", article: "une", title: "Nouvelle messe", definite: "La messe", scheduled: "prévue", cancelled: "annulée"},
    reunion: {label: "réunion", article: "une", title: "Nouvelle réunion", definite: "La réunion", scheduled: "prévue", cancelled: "annulée"},
    concert: {label: "concert", article: "un", title: "Nouveau concert", definite: "Le concert", scheduled: "prévu", cancelled: "annulé"},
    autre: {label: "événement", article: "un", title: "Nouvel événement", definite: "L'événement", scheduled: "prévu", cancelled: "annulé"},
  };
  return types[type] || types.autre;
}

function eventDateLabel(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") return "";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp.toDate());
}

function messagePreview(data) {
  if (data.type === "voice") return "🎤 Note vocale";
  if (data.type === "image") return "📷 Image";
  if (data.type === "sticker") return data.texte || "✨ Sticker";
  return data.texte || "Nouveau message";
}

async function tokensForMemberDoc(memberDoc) {
  const member = memberDoc.data();
  const tokens = [];

  if (member.fcmToken) tokens.push(member.fcmToken);

  const webTokens = await memberDoc.ref.collection("notificationTokens").get();
  webTokens.forEach((tokenDoc) => {
    const token = tokenDoc.data().token;
    if (token) tokens.push(token);
  });

  return tokens;
}

async function allMemberTokensExcept(excludedUid = "") {
  const db = getFirestore();
  const membersSnap = await db.collection("members").get();
  const eligible = membersSnap.docs.filter((doc) => doc.data().uid !== excludedUid);
  const tokenGroups = await Promise.all(eligible.map(tokensForMemberDoc));
  return [...new Set(tokenGroups.flat())];
}

async function tokensForUid(uid) {
  const db = getFirestore();
  const membersSnap = await db.collection("members")
      .where("uid", "==", uid)
      .limit(1)
      .get();
  if (membersSnap.empty) return [];
  return [...new Set(await tokensForMemberDoc(membersSnap.docs[0]))];
}

async function sendPush(tokens, {title, body, data}) {
  if (!tokens.length) return;

  await getMessaging().sendEachForMulticast({
    tokens,
    data: {
      title,
      body,
      ...data,
    },
    android: {
      priority: "high",
    },
    webpush: {
      headers: {
        Urgency: "high",
      },
    },
  });
}

// Nouveau message dans le groupe. Les messages système d'annulation sont
// ignorés ici car l'annulation possède sa propre notification événement.
exports.onNewGroupMessage = onDocumentCreated("groupChat/{messageId}", async (event) => {
  const data = event.data.data();
  if (["system_cancelled", "event_cancelled"].includes(data.type)) return;

  const tokens = await allMemberTokensExcept(data.authorUid || "");
  await sendPush(tokens, {
    title: `Message de ${data.authorName || "un choriste"}`,
    body: messagePreview(data),
    data: {
      type: "group_message",
      messageId: event.params.messageId,
      senderUid: data.authorUid || "",
      link: "/?tab=messages&mode=group",
    },
  });
});

// Nouveau message privé.
exports.onNewDirectMessage = onDocumentCreated(
    "conversations/{convId}/messages/{messageId}",
    async (event) => {
      const data = event.data.data();
      const convId = event.params.convId;
      const db = getFirestore();

      const convDoc = await db.collection("conversations").doc(convId).get();
      if (!convDoc.exists) return;

      const participants = convDoc.data().participants || [];
      const recipientUid = participants.find((uid) => uid !== data.authorUid);
      if (!recipientUid || recipientUid === data.authorUid) return;

      const authorSnap = await db.collection("members")
          .where("uid", "==", data.authorUid)
          .limit(1)
          .get();
      const authorName = authorSnap.empty ?
        "un choriste" :
        authorSnap.docs[0].data().prenom;

      const tokens = await tokensForUid(recipientUid);
      await sendPush(tokens, {
        title: `Message privé de ${authorName}`,
        body: messagePreview(data),
        data: {
          type: "direct_message",
          conversationId: convId,
          messageId: event.params.messageId,
          senderUid: data.authorUid,
          recipientUid,
          link: `/?tab=messages&mode=private&targetUid=${encodeURIComponent(data.authorUid)}`,
        },
      });
    },
);

// Nouvel événement : notification claire selon le type de rendez-vous.
exports.onNewEvent = onDocumentCreated("events/{eventId}", async (event) => {
  const data = event.data.data();
  const typeMeta = eventTypeMeta(data.type);
  const dateLabel = eventDateLabel(data.date);
  const tokens = await allMemberTokensExcept(data.createdBy || "");

  await sendPush(tokens, {
    title: typeMeta.title,
    body: `Nous avons ${typeMeta.article} ${typeMeta.label}${dateLabel ? ` le ${dateLabel}` : ""}. Viens indiquer ta présence dans l'agenda.`,
    data: {
      type: "event_created",
      eventId: event.params.eventId,
      link: "/?tab=agenda",
    },
  });
});

// Annulation : notification push en plus du message rouge du groupe.
exports.onEventCancelled = onDocumentUpdated("events/{eventId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();

  if (before.cancelled === true || after.cancelled !== true) return;

  const typeMeta = eventTypeMeta(after.type);
  const dateLabel = eventDateLabel(after.date);
  const tokens = await allMemberTokensExcept(after.cancelledBy || "");

  await sendPush(tokens, {
    title: "Événement annulé",
    body: `${typeMeta.definite} « ${after.titre || "Sans titre"} »${dateLabel ? ` ${typeMeta.scheduled} le ${dateLabel}` : ""} a été ${typeMeta.cancelled}.`,
    data: {
      type: "event_cancelled",
      eventId: event.params.eventId,
      link: "/?tab=agenda",
    },
  });
});


// Renvoie le début de la journée courante à Paris sous forme d'instant UTC.
// Cela évite les décalages liés à l'heure d'été ou d'hiver.
function startOfTodayInParis(now = new Date()) {
  const timeZone = "Europe/Paris";
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = Object.fromEntries(
      dateParts.filter((part) => part.type !== "literal")
          .map((part) => [part.type, Number(part.value)]),
  );

  const utcGuess = new Date(Date.UTC(values.year, values.month - 1, values.day, 0, 0, 0));
  const parisParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(utcGuess);

  const parisValues = Object.fromEntries(
      parisParts.filter((part) => part.type !== "literal")
          .map((part) => [part.type, Number(part.value)]),
  );
  const representedAsUtc = Date.UTC(
      parisValues.year,
      parisValues.month - 1,
      parisValues.day,
      parisValues.hour,
      parisValues.minute,
      parisValues.second,
  );
  const offsetMs = representedAsUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offsetMs);
}

// Toutes les heures, supprime définitivement les événements des jours précédents.
// Le champ `reponses` étant inclus dans le document événement, les présences
// liées à la date sont supprimées en même temps.
exports.cleanupExpiredEvents = onSchedule({
  schedule: "5 * * * *",
  timeZone: "Europe/Paris",
}, async () => {
  const db = getFirestore();
  const cutoff = Timestamp.fromDate(startOfTodayInParis());
  let deleted = 0;

  while (true) {
    const snapshot = await db.collection("events")
        .where("date", "<", cutoff)
        .limit(450)
        .get();

    if (snapshot.empty) break;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
      batch.delete(db.collection("folders").doc(`event_${doc.id}`));
    });
    await batch.commit();
    deleted += snapshot.size;

    if (snapshot.size < 450) break;
  }

  let deletedFolders = 0;
  while (true) {
    const foldersSnapshot = await db.collection("folders")
        .where("expiresAt", "<", cutoff)
        .limit(450)
        .get();

    if (foldersSnapshot.empty) break;

    const expiredTemporaryFolders = foldersSnapshot.docs
        .filter((doc) => doc.data().temporary === true);
    if (expiredTemporaryFolders.length) {
      const folderBatch = db.batch();
      expiredTemporaryFolders.forEach((doc) => folderBatch.delete(doc.ref));
      await folderBatch.commit();
      deletedFolders += expiredTemporaryFolders.length;
    }

    if (foldersSnapshot.size < 450) break;
    // Les dossiers permanents n'ont normalement pas de champ expiresAt.
    // Si des documents non temporaires en possèdent un, on évite une boucle infinie.
    if (!expiredTemporaryFolders.length) break;
  }

  console.log(
      `Nettoyage agenda terminé : ${deleted} événement(s) et ${deletedFolders} dossier(s) temporaire(s) supprimé(s).`,
  );
});
