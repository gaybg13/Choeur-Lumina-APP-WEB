import { useState } from "react";
import { signOut } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { enableNotifications } from "../lib/notifications";
import { Header } from "../components/Header";
import type { Member } from "../types/models";

export function ProfileScreen({
  member,
  onRefresh
}: {
  member: Member | null;
  onRefresh: () => Promise<void>;
}) {
  const [day, setDay] = useState(String(member?.birthdayDay || ""));
  const [month, setMonth] = useState(String(member?.birthdayMonth || ""));
  const [notice, setNotice] = useState("");

  async function saveBirthday() {
    if (!member) return;
    const d = Number(day);
    const m = Number(month);
    if (d < 1 || d > 31 || m < 1 || m > 12) {
      setNotice("Jour ou mois invalide.");
      return;
    }
    await updateDoc(doc(db, "members", member.id), {
      birthdayDay: d,
      birthdayMonth: m
    });
    setNotice("Date d'anniversaire enregistrée.");
    await onRefresh();
  }

  async function notifications() {
    const token = await enableNotifications();
    setNotice(token ? "Notifications activées sur cet appareil." : "Notifications non activées.");
  }

  return (
    <>
      <Header title="Profil" />
      <section className="screen">
        <article className="profile-card">
          <div className="big-avatar">
            {member?.photoUrl ? <img src={member.photoUrl} alt="" /> : member?.prenom?.[0]}
          </div>
          <h2>{member?.prenom} {member?.nom}</h2>
          <span>{member?.pupitre}</span>
        </article>

        <article className="card">
          <h2>Mes informations</h2>
          <p><strong>E-mail</strong><br />{member?.email}</p>
          <p><strong>Rôle</strong><br />{member?.role}</p>
        </article>

        <article className="card">
          <h2>Mon anniversaire</h2>
          <div className="birthday-fields">
            <label>Jour<input inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} /></label>
            <label>Mois<input inputMode="numeric" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          </div>
          <button className="secondary-button" onClick={saveBirthday}>Enregistrer</button>
        </article>

        <article className="card">
          <h2>Notifications</h2>
          <p>Sur iPhone, ajoute d'abord l'application à l'écran d'accueil, puis active les notifications ici.</p>
          <button className="secondary-button" onClick={notifications}>Activer les notifications</button>
        </article>

        {notice && <p className="notice">{notice}</p>}
        <button className="logout-button" onClick={() => signOut(auth)}>Se déconnecter</button>
      </section>
    </>
  );
}