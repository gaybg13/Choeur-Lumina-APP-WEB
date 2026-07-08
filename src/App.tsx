import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where
} from "firebase/firestore";
import { auth, db } from "./lib/firebase";
import type {
  ConversationSummary,
  Folder,
  GroupMessage,
  LuminaEvent,
  Member,
  Song
} from "./types/models";
import { LoginScreen } from "./screens/LoginScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { AgendaScreen } from "./screens/AgendaScreen";
import { SongsScreen } from "./screens/SongsScreen";
import { MessagesScreen } from "./screens/MessagesScreen";
import { MembersScreen } from "./screens/MembersScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { AdminScreen } from "./screens/AdminScreen";
import { BottomNav, type Tab } from "./components/BottomNav";
import { clearDisplayedNotifications } from "./lib/notifications";


function initialTabFromUrl(): Tab {
  const requested = new URLSearchParams(window.location.search).get("tab");
  const allowed: Tab[] = ["home", "songs", "agenda", "messages", "members", "profile", "admin"];
  return allowed.includes(requested as Tab) ? requested as Tab : "home";
}

function parisDayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function startOfTodayInParis(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])
  ) as Record<string, number>;

  const utcGuess = new Date(Date.UTC(values.year, values.month - 1, values.day, 0, 0, 0));
  const parisParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(utcGuess);
  const parisValues = Object.fromEntries(
    parisParts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])
  ) as Record<string, number>;
  const representedAsUtc = Date.UTC(
    parisValues.year, parisValues.month - 1, parisValues.day,
    parisValues.hour, parisValues.minute, parisValues.second
  );
  const offsetMs = representedAsUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offsetMs);
}

function nextBirthdayEvent(member: Member): LuminaEvent | null {
  const day = member.birthdayDay || 0;
  const month = member.birthdayMonth || 0;
  if (!day || !month) return null;

  const now = new Date();
  const todayStart = startOfTodayInParis(now);
  let year = Number(parisDayKey(now).slice(0, 4));
  let date = new Date(year, month - 1, day, 9, 0, 0, 0);
  if (date.getTime() < todayStart.getTime()) {
    year += 1;
    date = new Date(year, month - 1, day, 9, 0, 0, 0);
  }

  return {
    id: `birthday_${member.id}_${year}`,
    titre: `Anniversaire de ${member.prenom}`,
    type: "anniversaire",
    date: { toDate: () => date } as LuminaEvent["date"],
    description: `Souhaitons un joyeux anniversaire à ${member.prenom} !`,
    synthetic: true
  };
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [events, setEvents] = useState<LuminaEvent[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [tab, setTab] = useState<Tab>(initialTabFromUrl);
  const [calendarDayKey, setCalendarDayKey] = useState(() => parisDayKey());

  async function loadCurrentMember(uid: string) {
    const snap = await getDocs(query(collection(db, "members"), where("uid", "==", uid)));
    const first = snap.docs[0];
    setMember(first ? ({ id: first.id, ...first.data() } as Member) : null);
  }

  useEffect(() => onAuthStateChanged(auth, (next) => {
    setUser(next);
    if (next) void loadCurrentMember(next.uid);
    else {
      setMember(null);
      setMembers([]);
      setEvents([]);
      setSongs([]);
      setFolders([]);
      setGroupMessages([]);
      setConversations([]);
    }
  }), []);

  useEffect(() => {
    const clearWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void clearDisplayedNotifications();
      }
    };
    clearWhenVisible();
    document.addEventListener("visibilitychange", clearWhenVisible);
    window.addEventListener("focus", clearWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", clearWhenVisible);
      window.removeEventListener("focus", clearWhenVisible);
    };
  }, []);


  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextKey = parisDayKey();
      setCalendarDayKey((current) => current === nextKey ? current : nextKey);
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!user) return;

    const statusRef = doc(db, "userStatus", user.uid);
    const publishStatus = (online: boolean) => setDoc(statusRef, {
      online,
      lastSeen: serverTimestamp()
    }, { merge: true }).catch(() => undefined);

    void publishStatus(true);
    const onVisibility = () => void publishStatus(document.visibilityState === "visible");
    const onPageHide = () => void publishStatus(false);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      void publishStatus(false);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const unMembers = onSnapshot(collection(db, "members"), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Member));
      setMembers(list);
      const me = list.find((m) => m.uid === user.uid);
      if (me) setMember(me);
    });

    const todayCutoff = Timestamp.fromDate(startOfTodayInParis());
    const unEvents = onSnapshot(
      query(
        collection(db, "events"),
        where("date", ">=", todayCutoff),
        orderBy("date", "asc")
      ),
      (snap) => {
        setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LuminaEvent)));
      }
    );

    const unSongs = onSnapshot(query(collection(db, "songs"), orderBy("titre", "asc")), (snap) => {
      setSongs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Song)));
    });

    const unFolders = onSnapshot(collection(db, "folders"), (snap) => {
      setFolders(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Folder))
          .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
      );
    });

    const unGroup = onSnapshot(query(collection(db, "groupChat"), orderBy("timestamp", "asc")), (snap) => {
      setGroupMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as GroupMessage)));
    });

    const unConversations = onSnapshot(
      query(collection(db, "conversations"), where("participants", "array-contains", user.uid)),
      (snap) => setConversations(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ConversationSummary)))
    );

    return () => {
      unMembers();
      unEvents();
      unSongs();
      unFolders();
      unGroup();
      unConversations();
    };
  }, [user, calendarDayKey]);

  // Les événements passés ne sont jamais chargés dans l'agenda actif.
  // Pour le staff, on supprime aussi physiquement les anciens documents,
  // ce qui supprime en même temps leur map `reponses`.
  useEffect(() => {
    const role = member?.role;
    if (!user || (role !== "admin" && role !== "contributeur")) return;

    const cutoff = Timestamp.fromDate(startOfTodayInParis());
    void getDocs(query(collection(db, "events"), where("date", "<", cutoff)))
      .then((snap) => Promise.allSettled(
        snap.docs.map((eventDoc) => deleteDoc(eventDoc.ref))
      ))
      .catch(() => undefined);
  }, [calendarDayKey, member?.role, user]);

  const activeEvents = useMemo(() => {
    const cutoffMs = startOfTodayInParis().getTime();
    return events.filter((event) => {
      const eventDate = event.date?.toDate?.();
      return eventDate instanceof Date && eventDate.getTime() >= cutoffMs;
    });
  }, [events, calendarDayKey]);

  const allEvents = useMemo(() => {
    const birthdays = members.map(nextBirthdayEvent).filter((e): e is LuminaEvent => Boolean(e));
    return [...activeEvents, ...birthdays].sort(
      (a, b) => (a.date?.toDate().getTime() || 0) - (b.date?.toDate().getTime() || 0)
    );
  }, [activeEvents, members]);

  const nextEvent = allEvents.find((e) => (e.date?.toDate().getTime() || 0) >= Date.now()) || null;
  const canEditContent = member?.role === "admin" || member?.role === "contributeur";

  const messageUnread = Boolean(user && (
    groupMessages.some((message) =>
      message.authorUid !== user.uid && !(message.readBy || []).includes(user.uid)
    ) || conversations.some((conversation) => (conversation.unreadCounts?.[user.uid] || 0) > 0)
  ));

  const agendaUnread = Boolean(member && activeEvents.some((event) => {
    const created = event.createdAt?.toDate().getTime() || 0;
    const seen = member.agendaLastSeenAt?.toDate().getTime() || 0;
    return created > seen;
  }));

  async function openTab(nextTab: Tab) {
    setTab(nextTab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    window.history.replaceState({}, "", url);
    void clearDisplayedNotifications();
    if (nextTab === "agenda" && member) {
      try {
        await updateDoc(doc(db, "members", member.id), { agendaLastSeenAt: serverTimestamp() });
      } catch {
        // L'agenda reste utilisable même si le marqueur de lecture n'est pas autorisé.
      }
    }
  }

  if (!user) return <LoginScreen />;

  let content;
  switch (tab) {
    case "songs":
      content = (
        <SongsScreen
          songs={songs}
          folders={folders}
          canEdit={canEditContent}
          uid={user.uid}
        />
      );
      break;
    case "agenda":
      content = (
        <AgendaScreen
          events={allEvents}
          uid={user.uid}
          songs={songs}
          canEdit={canEditContent}
        />
      );
      break;
    case "messages":
      content = <MessagesScreen uid={user.uid} member={member} members={members} />;
      break;
    case "members":
      content = <MembersScreen members={members} />;
      break;
    case "admin":
      content = member?.role === "admin"
        ? <AdminScreen members={members} events={activeEvents} onBack={() => void openTab("profile")} />
        : <HomeScreen member={member} nextEvent={nextEvent} songs={songs} onOpen={(value) => void openTab(value)} />;
      break;
    case "profile":
      content = (
        <ProfileScreen
          member={member}
          onRefresh={() => loadCurrentMember(user.uid)}
          onOpenAdmin={() => void openTab("admin")}
        />
      );
      break;
    default:
      content = (
        <HomeScreen
          member={member}
          nextEvent={nextEvent}
          songs={songs}
          onOpen={(value) => void openTab(value)}
        />
      );
  }

  return (
    <div className="app-shell">
      <main className="content">{content}</main>
      <BottomNav
        active={tab}
        onChange={(value) => void openTab(value)}
        messageUnread={messageUnread}
        agendaUnread={agendaUnread}
      />
    </div>
  );
}
