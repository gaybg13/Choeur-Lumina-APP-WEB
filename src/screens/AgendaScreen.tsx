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
import type { LuminaEvent, Song } from "../types/models";
import { Header } from "../components/Header";

type EventDraft = {
  id?: string;
  titre: string;
  type: string;
  dateLocal: string;
  lieu: string;
  description: string;
};

const eventTypes = [
  ["repetition", "Répétition"],
  ["messe", "Messe"],
  ["reunion", "Réunion"],
  ["concert", "Concert"],
  ["autre", "Autre"]
] as const;

function toDateTimeLocal(event?: LuminaEvent) {
  const date = event?.date?.toDate();
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function emptyDraft(): EventDraft {
  return { titre: "", type: "repetition", dateLocal: "", lieu: "", description: "" };
}

function eventDraft(event: LuminaEvent): EventDraft {
  return {
    id: event.id,
    titre: event.titre,
    type: event.type,
    dateLocal: toDateTimeLocal(event),
    lieu: event.lieu || "",
    description: event.description || ""
  };
}

export function AgendaScreen({
  events,
  uid,
  songs,
  canEdit
}: {
  events: LuminaEvent[];
  uid: string;
  songs: Song[];
  canEdit: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState<EventDraft | null>(null);
  const [programmeEvent, setProgrammeEvent] = useState<LuminaEvent | null>(null);
  const [programme, setProgramme] = useState<string[]>([]);
  const [reportEvent, setReportEvent] = useState<LuminaEvent | null>(null);
  const [reportText, setReportText] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const songMap = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);

  async function respond(event: LuminaEvent, response: string) {
    if (!uid || event.synthetic || event.type === "anniversaire") return;
    try {
      await updateDoc(doc(db, "events", event.id), { [`reponses.${uid}`]: response });
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'enregistrer la réponse.");
    }
  }

  async function saveEvent() {
    if (!form?.titre.trim() || !form.dateLocal) return;
    setBusy("save-event");
    const payload = {
      titre: form.titre.trim(),
      type: form.type,
      date: Timestamp.fromDate(new Date(form.dateLocal)),
      lieu: form.lieu.trim(),
      description: form.description.trim()
    };
    try {
      if (form.id) {
        await updateDoc(doc(db, "events", form.id), payload);
      } else {
        await addDoc(collection(db, "events"), {
          ...payload,
          reponses: {},
          programme: [],
          compteRendu: "",
          createdAt: serverTimestamp(),
          cancelled: false,
          cancelledAt: null
        });
      }
      setNotice(form.id ? "Événement mis à jour." : "Événement créé.");
      setForm(null);
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'enregistrer l'événement.");
    } finally {
      setBusy("");
    }
  }

  async function cancelEvent(event: LuminaEvent) {
    if (!window.confirm(`Annuler « ${event.titre} » ? L'événement restera visible.`)) return;
    setBusy(`cancel-${event.id}`);
    try {
      await updateDoc(doc(db, "events", event.id), {
        cancelled: true,
        cancelledAt: serverTimestamp()
      });
      const dateLabel = event.date?.toDate().toLocaleDateString("fr-FR") || "";
      await addDoc(collection(db, "groupChat"), {
        authorUid: uid,
        authorName: "Chœur Lumina",
        texte: `ÉVÉNEMENT ANNULÉ : ${event.titre}${dateLabel ? ` · ${dateLabel}` : ""}`,
        type: "system_cancelled",
        mediaUrl: "",
        durationMs: 0,
        timestamp: serverTimestamp(),
        editedAt: null,
        deleted: false,
        readBy: [uid],
        hiddenFor: [],
        reactions: {},
        replyToId: "",
        replyToText: "",
        replyToAuthor: ""
      });
      setNotice("Événement annulé et message publié dans le groupe.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'annuler l'événement.");
    } finally {
      setBusy("");
    }
  }

  async function removeEvent(event: LuminaEvent) {
    if (!window.confirm(`Supprimer définitivement « ${event.titre} » ?`)) return;
    setBusy(`delete-${event.id}`);
    try {
      await deleteDoc(doc(db, "events", event.id));
      setNotice("Événement supprimé.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible de supprimer l'événement.");
    } finally {
      setBusy("");
    }
  }

  function openProgramme(event: LuminaEvent) {
    setProgrammeEvent(event);
    setProgramme([...(event.programme || [])]);
  }

  async function saveProgramme() {
    if (!programmeEvent) return;
    setBusy("programme");
    try {
      await updateDoc(doc(db, "events", programmeEvent.id), { programme });
      setProgrammeEvent(null);
      setNotice("Programme de messe enregistré.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'enregistrer le programme.");
    } finally {
      setBusy("");
    }
  }

  function moveProgramme(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= programme.length) return;
    const next = [...programme];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setProgramme(next);
  }

  function openReport(event: LuminaEvent) {
    setReportEvent(event);
    setReportText(event.compteRendu || "");
  }

  async function saveReport() {
    if (!reportEvent) return;
    setBusy("report");
    try {
      await updateDoc(doc(db, "events", reportEvent.id), { compteRendu: reportText.trim() });
      setReportEvent(null);
      setNotice("Compte rendu enregistré.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'enregistrer le compte rendu.");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <Header title="Agenda" />
      <section className="screen agenda-v2-screen">
        <div className="intro-card agenda-hero">
          <div>
            <span className="section-kicker">VIE DU CHŒUR</span>
            <h2>Agenda Lumina</h2>
            <p>Répétitions, messes, réunions, concerts et anniversaires.</p>
          </div>
          {canEdit && <button className="primary-action" onClick={() => setForm(emptyDraft())}>+ Nouvel événement</button>}
        </div>

        {notice && <p className="notice compact-notice">{notice}</p>}

        <div className="compact-list timeline-list">
          {events.map((event) => {
            const date = event.date?.toDate();
            const myResponse = uid ? event.reponses?.[uid] : undefined;
            const isOpen = expanded === event.id;
            const programmeSongs = (event.programme || []).map((id) => songMap.get(id)).filter(Boolean) as Song[];
            const attendance = Object.values(event.reponses || {});
            const attendanceLabel = attendance.length
              ? `${attendance.filter((r) => r === "present").length} présent(s) · ${attendance.filter((r) => r === "absent").length} absent(s)`
              : "Aucune réponse pour le moment";

            return (
              <article className={`event-card event-card-v2 ${event.cancelled ? "event-cancelled" : ""}`} key={event.id}>
                <div className="date-tile date-tile-v2">
                  <strong>{date?.getDate() ?? "--"}</strong>
                  <span>{date?.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "").toUpperCase()}</span>
                  <small>{date?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small>
                </div>

                <div className="event-main event-main-v2">
                  <div className="event-topline">
                    <span className="event-chip">{event.type}</span>
                    {event.cancelled && <span className="danger-chip">ANNULÉ</span>}
                  </div>
                  <h3>{event.titre}</h3>
                  {event.lieu && <small className="event-location">⌖ {event.lieu}</small>}

                  {!event.cancelled && !event.synthetic && event.type !== "anniversaire" && (
                    <div className="presence-actions">
                      {[["present", "Présent"], ["absent", "Absent"], ["peut-etre", "Peut-être"]].map(([value, label]) => (
                        <button key={value} className={myResponse === value ? "selected" : ""} onClick={() => void respond(event, value)}>{label}</button>
                      ))}
                    </div>
                  )}

                  <button className="details-toggle" onClick={() => setExpanded(isOpen ? null : event.id)}>{isOpen ? "Masquer les détails" : "Voir les détails"}</button>

                  {isOpen && (
                    <div className="event-details-panel">
                      {event.description && <div className="event-detail-block"><h4>Description</h4><p>{event.description}</p></div>}
                      {!event.synthetic && <div className="event-detail-block"><h4>Présences</h4><p>{attendanceLabel}</p></div>}

                      {event.type === "messe" && (
                        <div className="event-detail-block">
                          <div className="detail-title-row"><h4>Programme de messe</h4>{canEdit && <button onClick={() => openProgramme(event)}>Modifier</button>}</div>
                          {programmeSongs.length ? <ol>{programmeSongs.map((song) => <li key={song.id}>{song.titre}</li>)}</ol> : <p>Aucun chant sélectionné.</p>}
                        </div>
                      )}

                      {event.type === "reunion" && (
                        <div className="event-detail-block">
                          <div className="detail-title-row"><h4>Compte rendu</h4>{canEdit && <button onClick={() => openReport(event)}>Modifier</button>}</div>
                          <p className="pre-line">{event.compteRendu || "Pas encore de compte rendu."}</p>
                        </div>
                      )}

                      {canEdit && !event.synthetic && (
                        <div className="event-admin-actions">
                          <button onClick={() => setForm(eventDraft(event))}>Modifier</button>
                          {!event.cancelled && <button className="warning-action" disabled={busy === `cancel-${event.id}`} onClick={() => void cancelEvent(event)}>Annuler</button>}
                          <button className="danger-text" disabled={busy === `delete-${event.id}`} onClick={() => void removeEvent(event)}>Supprimer</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <div className="admin-modal event-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title-row"><div><span className="section-kicker">AGENDA</span><h2>{form.id ? "Modifier l'événement" : "Nouvel événement"}</h2></div><button onClick={() => setForm(null)}>×</button></div>
            <div className="admin-dialog-form two-column-form">
              <label>Titre<input value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} /></label>
              <label>Type<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{eventTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Date et heure<input type="datetime-local" value={form.dateLocal} onChange={(e) => setForm({ ...form, dateLocal: e.target.value })} /></label>
              <label>Lieu<input value={form.lieu} onChange={(e) => setForm({ ...form, lieu: e.target.value })} /></label>
              <label className="full-span">Description<textarea rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            </div>
            <div className="modal-actions"><button onClick={() => setForm(null)}>Annuler</button><button className="primary" disabled={busy === "save-event" || !form.titre.trim() || !form.dateLocal} onClick={() => void saveEvent()}>Enregistrer</button></div>
          </div>
        </div>
      )}

      {programmeEvent && (
        <div className="modal-backdrop" onClick={() => setProgrammeEvent(null)}>
          <div className="admin-modal programme-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title-row"><div><span className="section-kicker">PROGRAMME</span><h2>{programmeEvent.titre}</h2></div><button onClick={() => setProgrammeEvent(null)}>×</button></div>
            <div className="programme-editor">
              <h3>Ordre des chants</h3>
              {programme.length === 0 && <p>Aucun chant sélectionné.</p>}
              {programme.map((id, index) => (
                <div className="programme-row" key={`${id}-${index}`}><span>{index + 1}</span><strong>{songMap.get(id)?.titre || "Chant introuvable"}</strong><button disabled={index === 0} onClick={() => moveProgramme(index, -1)}>↑</button><button disabled={index === programme.length - 1} onClick={() => moveProgramme(index, 1)}>↓</button><button onClick={() => setProgramme(programme.filter((_, i) => i !== index))}>×</button></div>
              ))}
              <h3>Ajouter un chant</h3>
              <div className="available-song-list">{songs.filter((song) => !programme.includes(song.id)).map((song) => <button key={song.id} onClick={() => setProgramme([...programme, song.id])}>+ {song.titre}</button>)}</div>
            </div>
            <div className="modal-actions"><button onClick={() => setProgrammeEvent(null)}>Annuler</button><button className="primary" disabled={busy === "programme"} onClick={() => void saveProgramme()}>Enregistrer</button></div>
          </div>
        </div>
      )}

      {reportEvent && (
        <div className="modal-backdrop" onClick={() => setReportEvent(null)}>
          <div className="admin-modal report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title-row"><div><span className="section-kicker">RÉUNION</span><h2>Compte rendu</h2></div><button onClick={() => setReportEvent(null)}>×</button></div>
            <textarea rows={14} value={reportText} onChange={(e) => setReportText(e.target.value)} placeholder="Saisir le compte rendu de la réunion…" />
            <div className="modal-actions"><button onClick={() => setReportEvent(null)}>Annuler</button><button className="primary" disabled={busy === "report"} onClick={() => void saveReport()}>Enregistrer</button></div>
          </div>
        </div>
      )}
    </>
  );
}
