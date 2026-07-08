import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where
} from "firebase/firestore";
import { auth, db } from "./lib/firebase";
import type { LuminaEvent, Member, Song } from "./types/models";
import { LoginScreen } from "./screens/LoginScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { AgendaScreen } from "./screens/AgendaScreen";
import { SongsScreen } from "./screens/SongsScreen";
import { MessagesScreen } from "./screens/MessagesScreen";
import { MembersScreen } from "./screens/MembersScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { BottomNav, type Tab } from "./components/BottomNav";

function nextBirthdayEvent(member: Member): LuminaEvent | null {
  const day = member.birthdayDay || 0;
  const month = member.birthdayMonth || 0;
  if (!day || !month) return null;

  const now = new Date();
  let year = now.getFullYear();
  let date = new Date(year, month - 1, day, 9, 0, 0, 0);
  if (date.getTime() < now.getTime()) {
    year += 1;
    date = new Date(year, month - 1, day, 9, 0, 0, 0);
  }

  return {
    id: `birthday_${member.id}_${year}`,
    titre: `Anniversaire de ${member.prenom}`,
    type: "anniversaire",
    date: {
      toDate: () => date
    } as LuminaEvent["date"],
    description: `🎂 Souhaitons un joyeux anniversaire à ${member.prenom} !`
  };
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [events, setEvents] = useState<LuminaEvent[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [tab, setTab] = useState<Tab>("home");

  async function loadCurrentMember(uid: string) {
    const snap = await getDocs(query(collection(db, "members"), where("uid", "==", uid)));
    const first = snap.docs[0];
    setMember(first ? ({ id: first.id, ...first.data() } as Member) : null);
  }

  useEffect(() => onAuthStateChanged(auth, (next) => {
    setUser(next);
    if (next) loadCurrentMember(next.uid);
    else setMember(null);
  }), []);

  useEffect(() => {
    if (!user) return;

    const unMembers = onSnapshot(collection(db, "members"), (snap) => {
      setMembers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Member)));
    });

    const unEvents = onSnapshot(query(collection(db, "events"), orderBy("date", "asc")), (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LuminaEvent)));
    });

    const unSongs = onSnapshot(query(collection(db, "songs"), orderBy("titre", "asc")), (snap) => {
      setSongs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Song)));
    });

    return () => {
      unMembers();
      unEvents();
      unSongs();
    };
  }, [user]);

  const allEvents = useMemo(() => {
    const birthdays = members
      .map(nextBirthdayEvent)
      .filter((e): e is LuminaEvent => Boolean(e));
    return [...events, ...birthdays].sort((a, b) =>
      (a.date?.toDate().getTime() || 0) - (b.date?.toDate().getTime() || 0)
    );
  }, [events, members]);

  const nextEvent = allEvents.find((e) =>
    (e.date?.toDate().getTime() || 0) >= Date.now()
  ) || null;

  if (!user) return <LoginScreen />;

  let content;
  switch (tab) {
    case "songs":
      content = <SongsScreen songs={songs} />;
      break;
    case "agenda":
      content = <AgendaScreen events={allEvents} uid={user.uid} />;
      break;
    case "messages":
      content = <MessagesScreen uid={user.uid} member={member} />;
      break;
    case "members":
      content = <MembersScreen members={members} />;
      break;
    case "profile":
      content = (
        <ProfileScreen
          member={member}
          onRefresh={() => loadCurrentMember(user.uid)}
        />
      );
      break;
    default:
      content = (
        <HomeScreen
          member={member}
          nextEvent={nextEvent}
          songs={songs}
          onOpen={setTab}
        />
      );
  }

  return (
    <div className="app-shell">
      <main className="content">{content}</main>
      <BottomNav
        active={tab}
        onChange={setTab}
        messageUnread={false}
        agendaUnread={false}
      />
    </div>
  );
}