import { useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  updateDoc
} from "firebase/firestore";
import { db } from "../lib/firebase";
import type { LuminaEvent, Member, Song } from "../types/models";
import { Header } from "../components/Header";

type AdminSection = "dashboard" | "members" | "events" | "songs";

function makeInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "LUM-";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function AdminScreen({
  members,
  events,
  songs
}: {
  members: Member[];
  events: LuminaEvent[];
  songs: Song[];
}) {
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [notice, setNotice] = useState("");

  const [memberForm, setMemberForm] = useState({
    prenom: "",
    nom: "",
    pupitre: "Soprano",
    role: "membre",
    inviteCode: makeInviteCode()
  });

  const [eventForm, setEventForm] = useState({
    titre: "",
    type: "répétition",
    date: "",
    time: "15:00",
    lieu: "",
    description: ""
  });

  const [songForm, setSongForm] = useState({
    titre: "",
    compositeur: "",
    partitionUrl: "",
    youtubeUrl: "",
    soprano: "",
    alto: "",
    tenor: "",
    basse: "",
    appris: false
  });

  const upcomingEvents = useMemo(
    () =>
      events
        .filter((e) => e.date?.toDate && e.date.toDate().getTime() >= Date.now())
        .slice(0, 8),
    [events]
  );

  async function createMember(e: React.FormEvent) {
    e.preventDefault();
    setNotice("");
    await addDoc(collection(db, "members"), {
      prenom: memberForm.prenom.trim(),
      nom: memberForm.nom.trim(),
      pupitre: memberForm.pupitre,
      role: memberForm.role,
      inviteCode: memberForm.inviteCode.trim().toUpperCase(),
      claimed: false,
      uid: "",
      email: "",
      createdAt: serverTimestamp()
    });
    setNotice(`Membre ajouté. Code d'invitation : ${memberForm.inviteCode}`);
    setMemberForm({
      prenom: "",
      nom: "",
      pupitre: "Soprano",
      role: "membre",
      inviteCode: makeInviteCode()
    });
  }

  async function createEvent(e: React.FormEvent) {
    e.preventDefault();
    setNotice("");
    const localDate = new Date(`${eventForm.date}T${eventForm.time}`);
    if (Number.isNaN(localDate.getTime())) {
      setNotice("Date ou heure invalide.");
      return;
    }

    await addDoc(collection(db, "events"), {
      titre: eventForm.titre.trim(),
      type: eventForm.type,
      date: Timestamp.fromDate(localDate),
      lieu: eventForm.lieu.trim(),
      description: eventForm.description.trim(),
      reponses: {},
      cancelled: false,
      createdAt: serverTimestamp()
    });

    setNotice("Événement créé.");
    setEventForm({
      titre: "",
      type: "répétition",
      date: "",
      time: "15:00",
      lieu: "",
      description: ""
    });
  }

  async function toggleEventCancelled(event: LuminaEvent) {
    await updateDoc(doc(db, "events", event.id), {
      cancelled: !event.cancelled
    });
    setNotice(event.cancelled ? "Événement réactivé." : "Événement annulé.");
  }

  async function removeEvent(event: LuminaEvent) {
    if (!window.confirm(`Supprimer définitivement « ${event.titre} » ?`)) return;
    await deleteDoc(doc(db, "events", event.id));
    setNotice("Événement supprimé.");
  }

  async function createSong(e: React.FormEvent) {
    e.preventDefault();
    setNotice("");

    const audioUrlsByPupitre: Record<string, string> = {};
    if (songForm.soprano.trim()) audioUrlsByPupitre.soprano = songForm.soprano.trim();
    if (songForm.alto.trim()) audioUrlsByPupitre.alto = songForm.alto.trim();
    if (songForm.tenor.trim()) audioUrlsByPupitre.tenor = songForm.tenor.trim();
    if (songForm.basse.trim()) audioUrlsByPupitre.basse = songForm.basse.trim();

    await addDoc(collection(db, "songs"), {
      titre: songForm.titre.trim(),
      compositeur: songForm.compositeur.trim(),
      partitionUrl: songForm.partitionUrl.trim(),
      youtubeUrl: songForm.youtubeUrl.trim(),
      audioUrlsByPupitre,
      appris: songForm.appris,
      createdAt: serverTimestamp()
    });

    setNotice("Chant ajouté à la bibliothèque.");
    setSongForm({
      titre: "",
      compositeur: "",
      partitionUrl: "",
      youtubeUrl: "",
      soprano: "",
      alto: "",
      tenor: "",
      basse: "",
      appris: false
    });
  }

  async function removeSong(song: Song) {
    if (!window.confirm(`Supprimer définitivement « ${song.titre} » ?`)) return;
    await deleteDoc(doc(db, "songs", song.id));
    setNotice("Chant supprimé.");
  }

  return (
    <>
      <Header title="Administration" />
      <section className="screen admin-screen">
        <div className="admin-hero">
          <div>
            <span className="admin-kicker">ESPACE ADMINISTRATEUR</span>
            <h1>Pilotage du Chœur</h1>
            <p>Membres, invitations, agenda et bibliothèque musicale.</p>
          </div>
          <span className="admin-shield">✦</span>
        </div>

        <div className="admin-section-tabs">
          {[
            ["dashboard", "Vue d'ensemble"],
            ["members", "Membres"],
            ["events", "Agenda"],
            ["songs", "Chants"]
          ].map(([id, label]) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              onClick={() => {
                setSection(id as AdminSection);
                setNotice("");
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {notice && <p className="admin-notice">{notice}</p>}

        {section === "dashboard" && (
          <>
            <div className="admin-stats">
              <article>
                <strong>{members.length}</strong>
                <span>Membres</span>
              </article>
              <article>
                <strong>{members.filter((m) => m.claimed).length}</strong>
                <span>Comptes activés</span>
              </article>
              <article>
                <strong>{upcomingEvents.length}</strong>
                <span>Événements à venir</span>
              </article>
              <article>
                <strong>{songs.length}</strong>
                <span>Chants</span>
              </article>
            </div>

            <article className="card admin-card">
              <h2>Invitations en attente</h2>
              {members.filter((m) => !m.claimed).length === 0 ? (
                <p>Aucune invitation en attente.</p>
              ) : (
                <div className="admin-list">
                  {members
                    .filter((m) => !m.claimed)
                    .map((m) => (
                      <div className="admin-list-row" key={m.id}>
                        <div>
                          <strong>{m.prenom} {m.nom}</strong>
                          <small>{m.pupitre}</small>
                        </div>
                        <code>{(m as Member & { inviteCode?: string }).inviteCode || "—"}</code>
                      </div>
                    ))}
                </div>
              )}
            </article>
          </>
        )}

        {section === "members" && (
          <>
            <article className="card admin-card">
              <h2>Ajouter un choriste</h2>
              <form className="admin-form" onSubmit={createMember}>
                <div className="admin-two-cols">
                  <input
                    placeholder="Prénom"
                    value={memberForm.prenom}
                    onChange={(e) => setMemberForm({ ...memberForm, prenom: e.target.value })}
                    required
                  />
                  <input
                    placeholder="Nom"
                    value={memberForm.nom}
                    onChange={(e) => setMemberForm({ ...memberForm, nom: e.target.value })}
                    required
                  />
                </div>

                <div className="admin-two-cols">
                  <select
                    value={memberForm.pupitre}
                    onChange={(e) => setMemberForm({ ...memberForm, pupitre: e.target.value })}
                  >
                    <option>Soprano</option>
                    <option>Alto</option>
                    <option>Ténor</option>
                    <option>Basse</option>
                  </select>
                  <select
                    value={memberForm.role}
                    onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })}
                  >
                    <option value="membre">Membre</option>
                    <option value="contributeur">Contributeur</option>
                    <option value="admin">Administrateur</option>
                  </select>
                </div>

                <label className="admin-code-field">
                  Code d'invitation
                  <div>
                    <input
                      value={memberForm.inviteCode}
                      onChange={(e) =>
                        setMemberForm({
                          ...memberForm,
                          inviteCode: e.target.value.toUpperCase()
                        })
                      }
                      required
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setMemberForm({ ...memberForm, inviteCode: makeInviteCode() })
                      }
                    >
                      Générer
                    </button>
                  </div>
                </label>

                <button className="admin-primary" type="submit">
                  Ajouter le choriste
                </button>
              </form>
            </article>

            <article className="card admin-card">
              <h2>Liste des membres</h2>
              <div className="admin-list">
                {members.map((m) => (
                  <div className="admin-list-row" key={m.id}>
                    <div>
                      <strong>{m.prenom} {m.nom}</strong>
                      <small>{m.pupitre} · {m.role || "membre"}</small>
                    </div>
                    <span className={m.claimed ? "admin-status ok" : "admin-status pending"}>
                      {m.claimed ? "Actif" : "Invitation"}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          </>
        )}

        {section === "events" && (
          <>
            <article className="card admin-card">
              <h2>Créer un événement</h2>
              <form className="admin-form" onSubmit={createEvent}>
                <input
                  placeholder="Titre de l'événement"
                  value={eventForm.titre}
                  onChange={(e) => setEventForm({ ...eventForm, titre: e.target.value })}
                  required
                />

                <select
                  value={eventForm.type}
                  onChange={(e) => setEventForm({ ...eventForm, type: e.target.value })}
                >
                  <option value="répétition">Répétition</option>
                  <option value="messe">Messe</option>
                  <option value="concert">Concert</option>
                  <option value="réunion">Réunion</option>
                  <option value="autre">Autre</option>
                </select>

                <div className="admin-two-cols">
                  <input
                    type="date"
                    value={eventForm.date}
                    onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
                    required
                  />
                  <input
                    type="time"
                    value={eventForm.time}
                    onChange={(e) => setEventForm({ ...eventForm, time: e.target.value })}
                    required
                  />
                </div>

                <input
                  placeholder="Lieu"
                  value={eventForm.lieu}
                  onChange={(e) => setEventForm({ ...eventForm, lieu: e.target.value })}
                />

                <textarea
                  placeholder="Description"
                  rows={3}
                  value={eventForm.description}
                  onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                />

                <button className="admin-primary" type="submit">
                  Créer l'événement
                </button>
              </form>
            </article>

            <article className="card admin-card">
              <h2>Gérer l'agenda</h2>
              <div className="admin-list">
                {events.map((event) => (
                  <div className="admin-event-row" key={event.id}>
                    <div>
                      <strong>{event.titre}</strong>
                      <small>
                        {event.date?.toDate
                          ? event.date.toDate().toLocaleString("fr-FR", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            })
                          : "Date non renseignée"}
                      </small>
                    </div>
                    <div className="admin-actions">
                      <button onClick={() => toggleEventCancelled(event)}>
                        {event.cancelled ? "Réactiver" : "Annuler"}
                      </button>
                      <button className="danger" onClick={() => removeEvent(event)}>
                        Supprimer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </>
        )}

        {section === "songs" && (
          <>
            <article className="card admin-card">
              <h2>Ajouter un chant</h2>
              <form className="admin-form" onSubmit={createSong}>
                <input
                  placeholder="Titre du chant"
                  value={songForm.titre}
                  onChange={(e) => setSongForm({ ...songForm, titre: e.target.value })}
                  required
                />
                <input
                  placeholder="Compositeur / auteur"
                  value={songForm.compositeur}
                  onChange={(e) => setSongForm({ ...songForm, compositeur: e.target.value })}
                />
                <input
                  placeholder="Lien de la partition"
                  type="url"
                  value={songForm.partitionUrl}
                  onChange={(e) => setSongForm({ ...songForm, partitionUrl: e.target.value })}
                />
                <input
                  placeholder="Lien YouTube"
                  type="url"
                  value={songForm.youtubeUrl}
                  onChange={(e) => setSongForm({ ...songForm, youtubeUrl: e.target.value })}
                />

                <h3>Audios par pupitre</h3>
                <input
                  placeholder="Lien audio Soprano"
                  type="url"
                  value={songForm.soprano}
                  onChange={(e) => setSongForm({ ...songForm, soprano: e.target.value })}
                />
                <input
                  placeholder="Lien audio Alto"
                  type="url"
                  value={songForm.alto}
                  onChange={(e) => setSongForm({ ...songForm, alto: e.target.value })}
                />
                <input
                  placeholder="Lien audio Ténor"
                  type="url"
                  value={songForm.tenor}
                  onChange={(e) => setSongForm({ ...songForm, tenor: e.target.value })}
                />
                <input
                  placeholder="Lien audio Basse"
                  type="url"
                  value={songForm.basse}
                  onChange={(e) => setSongForm({ ...songForm, basse: e.target.value })}
                />

                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    checked={songForm.appris}
                    onChange={(e) => setSongForm({ ...songForm, appris: e.target.checked })}
                  />
                  Chant déjà appris
                </label>

                <button className="admin-primary" type="submit">
                  Ajouter le chant
                </button>
              </form>
            </article>

            <article className="card admin-card">
              <h2>Bibliothèque</h2>
              <div className="admin-list">
                {songs.map((song) => (
                  <div className="admin-list-row" key={song.id}>
                    <div>
                      <strong>{song.titre}</strong>
                      <small>{song.compositeur || "Sans auteur renseigné"}</small>
                    </div>
                    <button className="admin-delete-small" onClick={() => removeSong(song)}>
                      Supprimer
                    </button>
                  </div>
                ))}
              </div>
            </article>
          </>
        )}
      </section>
    </>
  );
}
