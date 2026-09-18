import { useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import type {
  Announcement,
  AnonymousSuggestion,
  LuminaEvent,
  Member,
  Song
} from "../types/models";

function formatEventDate(event: LuminaEvent) {
  const date = event.date?.toDate();
  if (!date) return "Date à préciser";
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
}

function formatEventTime(event: LuminaEvent) {
  const date = event.date?.toDate();
  if (!date) return "";
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function HomeAccentIcon({ kind }: { kind: "welcome" | "news" }) {
  if (kind === "welcome") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v4M5.6 5.6l2.8 2.8M18.4 5.6l-2.8 2.8M4 12h4M16 12h4" />
        <path d="M8 16c1.2-1.7 2.5-2.5 4-2.5s2.8.8 4 2.5" />
        <circle cx="12" cy="12" r="8.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 13.5V7.8c0-.7.5-1.2 1.2-1.2h2.1L15.5 4v13.4l-8.2-2.6H5.2c-.7 0-1.2-.6-1.2-1.3Z" />
      <path d="M8 15v3.2c0 .5.4.8.9.8h1.8M18 8l2-1M18 13l2 1M18.5 10.5H21" />
    </svg>
  );
}

function HomeShortcutIcon({ kind }: { kind: "songs" | "agenda" | "messages" }) {
  if (kind === "songs") {
    return (
      <svg className="home-shortcut-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 18V5l10-2v13" />
        <circle cx="6.5" cy="18" r="2.5" />
        <circle cx="16.5" cy="16" r="2.5" />
      </svg>
    );
  }
  if (kind === "agenda") {
    return (
      <svg className="home-shortcut-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
        <path d="M7.5 3v5M16.5 3v5M3.5 10h17" />
        <path d="M8 14h3M13 14h3M8 17h3M13 17h3" />
      </svg>
    );
  }
  return (
    <svg className="home-shortcut-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5.5h16v11H9l-5 3v-14Z" />
      <path d="M8 10h8M8 13h5" />
    </svg>
  );
}


export function HomeScreen({
  uid,
  member,
  nextEvent,
  songs,
  announcements,
  suggestions,
  onOpen,
  onOpenSong
}: {
  uid: string;
  member: Member | null;
  nextEvent: LuminaEvent | null;
  songs: Song[];
  announcements: Announcement[];
  suggestions: AnonymousSuggestion[];
  onOpen: (tab: "songs" | "agenda" | "messages") => void;
  onOpenSong: (songId: string) => void;
}) {
  const heroImageSrc = new URL("choeur-lumina-groupe-hero.jpg", document.baseURI).toString();
  const logoSrc = new URL("icons/icon-192.png", document.baseURI).toString();
  const [showNewsManager, setShowNewsManager] = useState(false);
  const [newsText, setNewsText] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const isAdmin = member?.role === "admin" || member?.role === "super_admin";
  const isSuperAdmin = member?.role === "super_admin";

  async function publishNews() {
    const text = newsText.trim();
    if (!text || !member?.uid) return;
    setBusy("publish-news");
    try {
      await addDoc(collection(db, "announcements"), {
        text,
        authorUid: member.uid,
        createdAt: serverTimestamp()
      });
      setNewsText("");
      setNotice("Actualité publiée.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible de publier l'actualité.");
    } finally {
      setBusy("");
    }
  }

  async function removeNews(item: Announcement) {
    if (!window.confirm("Supprimer cette actualité ?")) return;
    setBusy(`news-${item.id}`);
    try {
      await deleteDoc(doc(db, "announcements", item.id));
      setNotice("Actualité supprimée.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible de supprimer l'actualité.");
    } finally {
      setBusy("");
    }
  }


  async function respondToNextEvent(response: "present" | "absent" | "peut-etre") {
    if (!nextEvent || nextEvent.synthetic || nextEvent.cancelled || nextEvent.type === "anniversaire") return;
    setBusy(`presence-${response}`);
    setNotice("");
    try {
      await updateDoc(doc(db, "events", nextEvent.id), { [`reponses.${uid}`]: response });
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'enregistrer ta présence.");
    } finally {
      setBusy("");
    }
  }
  async function removeSuggestion(item: AnonymousSuggestion) {
    if (!window.confirm("Supprimer cette proposition ?")) return;
    setBusy(`suggestion-${item.id}`);
    try {
      await deleteDoc(doc(db, "anonymousSuggestions", item.id));
      setNotice("Proposition supprimée.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible de supprimer la proposition.");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <section className="screen home-screen home-screen-v24 home-community-screen">
        <div className="welcome-row home-welcome-compact">
          <div className="brand-inline">
            <img src={logoSrc} alt="Logo" />
            <div>
              <span>Chœur Lumina</span>
              <h1>Bonjour {member?.prenom || "à toi"}</h1>
              {member?.pupitre && <small className="home-pupitre-subline">{member.pupitre}</small>}
            </div>
          </div>
          <span className="wave home-welcome-wave" aria-hidden="true">👋</span>
        </div>

        <div className="choir-photo-hero">
          <img src={heroImageSrc} alt="Photo du Chœur Lumina" />
          <div className="choir-photo-overlay">
            <span>CHŒUR LUMINA</span>
            <strong>Ensemble, une même voix.</strong>
          </div>
        </div>

        <div className="shortcut-grid home-shortcuts-compact">
          <button onClick={() => onOpen("songs")}><HomeShortcutIcon kind="songs" /><span>Répertoire</span></button>
          <button onClick={() => onOpen("agenda")}><HomeShortcutIcon kind="agenda" /><span>Agenda</span></button>
          <button onClick={() => onOpen("messages")}><HomeShortcutIcon kind="messages" /><span>Messages</span></button>
        </div>

        <article className="card home-news-card">
          <div className="home-news-heading">
            <span className="home-news-icon" aria-hidden="true"><HomeAccentIcon kind="news" /></span>
            <h2>Actualités</h2>
          </div>
          {announcements.length === 0 ? (
            <p>Aucune actualité pour le moment.</p>
          ) : (
            <div className="home-news-list">
              {announcements.slice(0, 2).map((item) => (
                <p key={item.id}>{item.text}</p>
              ))}
            </div>
          )}
        </article>

        {notice && <p className="notice compact-notice">{notice}</p>}

        <article className="card home-event-card">
          <div className="home-card-heading">
            <h2>Prochain événement</h2>
            {nextEvent && (
              <span className={`event-chip ${nextEvent.cancelled ? "cancelled" : ""}`}>
                {nextEvent.cancelled ? "Annulé" : nextEvent.type}
              </span>
            )}
          </div>
          {nextEvent ? (
            <div className="home-event-body">
              <h3>{nextEvent.titre}</h3>
              <p>
                <strong>{formatEventDate(nextEvent)}</strong>
                {formatEventTime(nextEvent) && <span> · {formatEventTime(nextEvent)}</span>}
              </p>
              {nextEvent.lieu && <small>{nextEvent.lieu}</small>}
              {!nextEvent.synthetic && !nextEvent.cancelled && nextEvent.type !== "anniversaire" && (
                <div className="presence-actions home-presence-actions">
                  {([
                    ["present", "Présent"],
                    ["absent", "Absent"],
                    ["peut-etre", "Peut-être"]
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      className={nextEvent.reponses?.[uid] === value ? "selected" : ""}
                      disabled={busy.startsWith("presence-")}
                      onClick={() => void respondToNextEvent(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p>Aucun événement à venir.</p>
          )}
        </article>

        <article className="card home-suggestions-card">
          <h2>Propositions du chœur</h2>
          {suggestions.length === 0 ? (
            <p>Aucune proposition pour le moment.</p>
          ) : (
            <div className="home-suggestion-list">
              {suggestions.slice(0, 3).map((item) => (
                <div className="home-suggestion-row" key={item.id}>
                  <span className="suggestion-bullet" aria-hidden="true" />
                  <p>{item.text}</p>
                  {isSuperAdmin && (
                    <button
                      className="icon-danger-button"
                      aria-label="Supprimer la proposition"
                      disabled={busy === `suggestion-${item.id}`}
                      onClick={() => void removeSuggestion(item)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card home-songs-card">
          <h2>Derniers chants ajoutés</h2>
          <div className="home-song-list">
            {songs.slice(0, 3).map((song) => (
              <div
                className="home-song-row"
                key={song.id}
                role="button"
                tabIndex={0}
                aria-label={`Ouvrir le chant ${song.titre}`}
                onClick={() => onOpenSong(song.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenSong(song.id);
                  }
                }}
              >
                <span className="home-song-icon">♫</span>
                <div>
                  <strong>{song.titre}</strong>
                  {song.compositeur && <small>{song.compositeur}</small>}
                </div>
                <span className={song.appris ? "status-ok" : "status-work"}>
                  {song.appris ? "Appris" : "À travailler"}
                </span>
              </div>
            ))}
            {songs.length === 0 && <p>Aucun chant pour l'instant.</p>}
          </div>
        </article>

        {isAdmin && (
          <button
            className="floating-round-action home-news-fab"
            aria-label="Gérer les actualités"
            onClick={() => setShowNewsManager(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 4.5h9.5a2 2 0 0 1 2 2V9" />
              <path d="M5 4.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8" />
              <path d="M7 9h5M7 12h4" />
              <path d="m13.5 18.5 5.2-5.2a1.4 1.4 0 0 1 2 2l-5.2 5.2-3 .7.7-2.7Z" />
            </svg>
          </button>
        )}
      </section>

      {showNewsManager && (
        <div className="modal-backdrop" onClick={() => setShowNewsManager(false)}>
          <div className="admin-modal news-manager-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title-row">
              <div><span className="section-kicker">COMMUNICATION</span><h2>Gestion des actualités</h2></div>
              <button onClick={() => setShowNewsManager(false)}>×</button>
            </div>

            {announcements.length > 0 && (
              <div className="news-manager-list">
                {announcements.map((item) => (
                  <div key={item.id}>
                    <p>{item.text}</p>
                    <button
                      className="icon-danger-button"
                      aria-label="Supprimer l'actualité"
                      disabled={busy === `news-${item.id}`}
                      onClick={() => void removeNews(item)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className="news-editor-field">
              Nouvelle actualité
              <textarea
                rows={4}
                maxLength={500}
                value={newsText}
                onChange={(event) => setNewsText(event.target.value)}
                placeholder="Saisir l'information à publier…"
              />
              <small>{newsText.length}/500</small>
            </label>
            <div className="modal-actions">
              <button onClick={() => setShowNewsManager(false)}>Fermer</button>
              <button
                className="primary"
                disabled={!newsText.trim() || busy === "publish-news"}
                onClick={() => void publishNews()}
              >
                Publier
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
