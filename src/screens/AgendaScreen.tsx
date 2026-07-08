import { doc, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import type { LuminaEvent } from "../types/models";
import { Header } from "../components/Header";

export function AgendaScreen({
  events,
  uid
}: {
  events: LuminaEvent[];
  uid: string;
}) {
  async function respond(event: LuminaEvent, response: string) {
    await updateDoc(doc(db, "events", event.id), {
      [`reponses.${uid}`]: response
    });
  }

  return (
    <>
      <Header title="Agenda" />
      <section className="screen">
        <div className="intro-card">
          <h2>Planning du chœur</h2>
          <p>Répétitions, messes, réunions, concerts et anniversaires.</p>
        </div>

        <div className="compact-list">
          {events.map((event) => {
            const date = event.date?.toDate();
            const myResponse = event.reponses?.[uid];
            return (
              <article className={`event-card ${event.cancelled ? "event-cancelled" : ""}`} key={event.id}>
                <div className="date-tile">
                  <strong>{date?.getDate() ?? "--"}</strong>
                  <span>{date?.toLocaleDateString("fr-FR", { month: "short" }).toUpperCase()}</span>
                </div>
                <div className="event-main">
                  <div className="event-topline">
                    <span className="event-chip">{event.type}</span>
                    {event.cancelled && <span className="danger-chip">ANNULÉ</span>}
                  </div>
                  <h3>{event.titre}</h3>
                  {event.lieu && <small>{event.lieu}</small>}
                  {!event.cancelled && event.type !== "anniversaire" && (
                    <div className="presence-actions">
                      {[
                        ["present", "Présent"],
                        ["absent", "Absent"],
                        ["peut-etre", "Peut-être"]
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          className={myResponse === value ? "selected" : ""}
                          onClick={() => respond(event, value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}