import { useRef, useState } from "react";
import { signOut } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../lib/firebase";
import { enableNotifications } from "../lib/notifications";
import { Header } from "../components/Header";
import type { Member } from "../types/models";

export function ProfileScreen({
  member,
  onRefresh,
  onOpenAdmin
}: {
  member: Member | null;
  onRefresh: () => Promise<void>;
  onOpenAdmin: () => void;
}) {
  const [day, setDay] = useState(String(member?.birthdayDay || ""));
  const [month, setMonth] = useState(String(member?.birthdayMonth || ""));
  const [notice, setNotice] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

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


  async function uploadPhoto(file: File) {
    if (!member?.uid) return;
    setPhotoBusy(true);
    try {
      const fileRef = storageRef(storage, `profile_photos/${member.uid}`);
      await uploadBytes(fileRef, file);
      const photoUrl = await getDownloadURL(fileRef);
      await updateDoc(doc(db, "members", member.id), { photoUrl });
      setNotice("Photo de profil mise à jour.");
      await onRefresh();
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'envoyer la photo. Vérifie les règles Storage.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function notifications() {
    const token = await enableNotifications();
    setNotice(
      token
        ? "Notifications activées sur cet appareil."
        : "Notifications non activées."
    );
  }

  return (
    <>
      <Header title="Profil" />
      <section className="screen">
        <article className="profile-card">
          <button className="big-avatar profile-photo-button" type="button" onClick={() => photoInputRef.current?.click()} aria-label="Modifier la photo de profil">
            {member?.photoUrl
              ? <img src={member.photoUrl} alt="" />
              : member?.prenom?.[0]}
            <span>{photoBusy ? "…" : "✎"}</span>
          </button>
          <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadPhoto(file); e.currentTarget.value = ""; }} />

          <h2>{member?.prenom} {member?.nom}</h2>
          <span>{member?.pupitre}</span>
        </article>

        <article className="card">
          <h2>Informations</h2>
          <p><strong>Email</strong><br />{member?.email}</p>
          <p><strong>Pupitre</strong><br />{member?.pupitre || "Non renseigné"}</p>
        </article>

        {member?.role === "admin" && (
          <article className="card profile-admin-card">
            <div className="profile-admin-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3l7 3v5c0 4.6-2.9 8.6-7 10-4.1-1.4-7-5.4-7-10V6l7-3Z" />
                <path d="M9.5 12.2l1.7 1.7 3.7-4" />
              </svg>
            </div>

            <div className="profile-admin-copy">
              <span className="profile-admin-kicker">ADMINISTRATEUR</span>
              <h2>Administration</h2>
              <p>Gérer les membres, les invitations, les événements, les présences et les chants.</p>
            </div>

            <button
              type="button"
              className="profile-admin-button"
              onClick={onOpenAdmin}
            >
              Accéder à l'administration
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </article>
        )}

        <article className="card">
          <h2>Mon anniversaire</h2>

          <div className="birthday-fields">
            <label>
              Jour
              <input
                inputMode="numeric"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>

            <label>
              Mois
              <input
                inputMode="numeric"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </label>
          </div>

          <button className="secondary-button" onClick={saveBirthday}>
            Enregistrer
          </button>
        </article>

        <article className="card">
          <h2>Notifications</h2>
          <p>
            Sur iPhone, ajoute d'abord l'application à l'écran d'accueil,
            puis active les notifications ici.
          </p>
          <button className="secondary-button" onClick={notifications}>
            Activer les notifications
          </button>
        </article>

        {notice && <p className="notice">{notice}</p>}

        <button
          className="logout-button"
          onClick={() => signOut(auth)}
        >
          Se déconnecter
        </button>
      </section>
    </>
  );
}
