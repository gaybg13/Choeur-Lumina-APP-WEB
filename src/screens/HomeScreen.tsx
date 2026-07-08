import type { Member, LuminaEvent, Song } from "../types/models";

export function HomeScreen({
  member,
  nextEvent,
  songs,
  onOpen
}: {
  member: Member | null;
  nextEvent: LuminaEvent | null;
  songs: Song[];
  onOpen: (tab: "songs" | "agenda" | "messages") => void;
}) {
  return (
    <section className="screen home-screen">
      <div className="welcome-row">
        <div className="brand-inline">
          <img src="/icons/icon-192.png" alt="Logo" />
          <div>
            <span>Chœur Lumina</span>
            <h1>Bonjour {member?.prenom || ""}</h1>
          </div>
        </div>
        <span className="wave">👋</span>
      </div>

      <p className="welcome-copy">
        Retrouve rapidement tes chants, ton agenda et les échanges du chœur.
      </p>

      {member?.pupitre && <span className="gold-chip">Pupitre : {member.pupitre}</span>}

      <div className="shortcut-grid">
        <button onClick={() => onOpen("songs")}>♫<span>Répertoire</span></button>
        <button onClick={() => onOpen("agenda")}>▣<span>Agenda</span></button>
        <button onClick={() => onOpen("messages")}>✉<span>Messages</span></button>
      </div>

      <article className="card">
        <h2>Prochain événement</h2>
        {nextEvent ? (
          <>
            <span className={`event-chip ${nextEvent.cancelled ? "cancelled" : ""}`}>
              {nextEvent.cancelled ? "Annulé" : nextEvent.type}
            </span>
            <h3>{nextEvent.titre}</h3>
            <p>{nextEvent.date?.toDate().toLocaleDateString("fr-FR", {
              weekday: "long",
              day: "numeric",
              month: "long"
            })}</p>
            {nextEvent.lieu && <small>{nextEvent.lieu}</small>}
          </>
        ) : (
          <p>Aucun événement à venir.</p>
        )}
      </article>

      <article className="card">
        <h2>Derniers chants ajoutés</h2>
        {songs.slice(0, 4).map((song) => (
          <div className="list-row" key={song.id}>
            <div>
              <strong>{song.titre}</strong>
              <small>{song.compositeur}</small>
            </div>
            <span className={song.appris ? "status-ok" : "status-work"}>
              {song.appris ? "Appris" : "À travailler"}
            </span>
          </div>
        ))}
      </article>
    </section>
  );
}