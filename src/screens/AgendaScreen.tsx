import { useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { DEFAULT_SONG_CATEGORIES, categoryLabel } from "../lib/songCategories";
import type { LuminaEvent, Song, SongCategory } from "../types/models";
import { Header } from "../components/Header";

type EventDraft = {
  id?: string;
  titre: string;
  type: string;
  dateLocal: string;
  lieu: string;
  description: string;
  dressCode: string;
};

type ProgrammeDraft = Record<string, string[]>;

function parisDayKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

const eventTypes = [
  ["repetition", "Répétition"],
  ["messe", "Messe"],
  ["reunion", "Réunion"],
  ["concert", "Concert"],
  ["autre", "Autre"]
] as const;

function eventTypeLabel(type: string) {
  if (type === "anniversaire") return "Anniversaire";
  return eventTypes.find(([value]) => value === type)?.[1] || type;
}

function monthLabel(date: Date) {
  const value = date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toDateTimeLocal(event?: LuminaEvent) {
  const date = event?.date?.toDate();
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function emptyDraft(): EventDraft {
  return { titre: "", type: "repetition", dateLocal: "", lieu: "", description: "", dressCode: "" };
}

function eventDraft(event: LuminaEvent): EventDraft {
  return {
    id: event.id,
    titre: event.titre,
    type: event.type,
    dateLocal: toDateTimeLocal(event),
    lieu: event.lieu || "",
    description: event.description || "",
    dressCode: event.dressCode || ""
  };
}

function programmeFromEvent(event: LuminaEvent, songs: Song[]): ProgrammeDraft {
  if (event.programmeParCategorie && Object.keys(event.programmeParCategorie).length) {
    return Object.fromEntries(Object.entries(event.programmeParCategorie).map(([key, ids]) => [key, [...ids]]));
  }
  const result: ProgrammeDraft = {};
  for (const songId of event.programme || []) {
    const song = songs.find((item) => item.id === songId);
    const categoryId = song?.categoryIds?.[0] || "autres";
    result[categoryId] = [...(result[categoryId] || []), songId];
  }
  return result;
}

export function AgendaScreen({
  events,
  uid,
  songs,
  categories,
  canEdit
}: {
  events: LuminaEvent[];
  uid: string;
  songs: Song[];
  categories: SongCategory[];
  canEdit: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState<EventDraft | null>(null);
  const [programmeEvent, setProgrammeEvent] = useState<LuminaEvent | null>(null);
  const [programme, setProgramme] = useState<ProgrammeDraft>({});
  const [programmeOrder, setProgrammeOrder] = useState<string[]>([]);
  const [customPartId, setCustomPartId] = useState("");
  const [reportEvent, setReportEvent] = useState<LuminaEvent | null>(null);
  const [reportText, setReportText] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const songMap = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const defaultOrder = DEFAULT_SONG_CATEGORIES.map((category) => category.id);
  const visibleEvents = useMemo(() => {
    const todayKey = parisDayKey();
    return events.filter((event) => {
      const date = event.date?.toDate?.();
      return date instanceof Date && parisDayKey(date) >= todayKey;
    });
  }, [events]);

  const groupedVisibleEvents = useMemo(() => {
    const groups = new Map<string, { label: string; events: LuminaEvent[] }>();
    for (const event of visibleEvents) {
      const date = event.date?.toDate?.();
      if (!(date instanceof Date)) continue;
      const key = monthKey(date);
      if (!groups.has(key)) groups.set(key, { label: monthLabel(date), events: [] });
      groups.get(key)!.events.push(event);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, group]) => group);
  }, [visibleEvents]);

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
    const date = Timestamp.fromDate(new Date(form.dateLocal));
    const payload = {
      titre: form.titre.trim(),
      type: form.type,
      date,
      lieu: form.lieu.trim(),
      description: form.description.trim(),
      dressCode: form.type === "messe" ? form.dressCode.trim() : ""
    };
    try {
      if (form.id) {
        const previous = events.find((event) => event.id === form.id);
        const batch = writeBatch(db);
        batch.update(doc(db, "events", form.id), payload);
        const hasProgramme = Boolean(previous?.programme?.length || previous?.programmeFolderId || Object.keys(previous?.programmeParCategorie || {}).length);
        if (form.type !== "messe" && hasProgramme) {
          batch.update(doc(db, "events", form.id), {
            programme: [], programmeParCategorie: {}, programmeCategories: [], programmeFolderId: ""
          });
          batch.delete(doc(db, "folders", `event_${form.id}`));
        } else if (hasProgramme) {
          batch.set(doc(db, "folders", `event_${form.id}`), {
            nom: `Programme · ${form.titre.trim()} · ${new Date(form.dateLocal).toLocaleDateString("fr-FR")}`,
            expiresAt: date
          }, { merge: true });
        }
        await batch.commit();
      } else {
        await addDoc(collection(db, "events"), {
          ...payload,
          reponses: {},
          programme: [],
          programmeParCategorie: {},
          programmeCategories: [],
          programmeFolderId: "",
          compteRendu: "",
          createdAt: serverTimestamp(),
          createdBy: uid,
          cancelled: false,
          cancelledAt: null,
          cancelledBy: ""
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
        cancelledAt: serverTimestamp(),
        cancelledBy: uid
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
      setNotice("Événement annulé.");
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
      const batch = writeBatch(db);
      batch.delete(doc(db, "events", event.id));
      batch.delete(doc(db, "folders", `event_${event.id}`));
      await batch.commit();
      setNotice("Événement supprimé.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible de supprimer l'événement.");
    } finally {
      setBusy("");
    }
  }

  function openProgramme(event: LuminaEvent) {
    const grouped = programmeFromEvent(event, songs);
    const customOrder = (event.programmeCategories || []).filter((id) => !defaultOrder.includes(id));
    setProgrammeEvent(event);
    setProgramme(grouped);
    setProgrammeOrder([...defaultOrder, ...customOrder.filter((id) => categories.some((category) => category.id === id))]);
    setCustomPartId("");
  }

  async function saveProgramme() {
    if (!programmeEvent) return;
    setBusy("programme");
    try {
      const order = programmeOrder.filter((id) => (programme[id] || []).length > 0);
      const cleaned = Object.fromEntries(order.map((id) => [id, [...new Set(programme[id] || [])]]).filter(([, ids]) => ids.length > 0));
      const flattened = order.flatMap((id) => cleaned[id] || []);
      const folderId = `event_${programmeEvent.id}`;
      const batch = writeBatch(db);
      batch.update(doc(db, "events", programmeEvent.id), {
        programme: flattened,
        programmeParCategorie: cleaned,
        programmeCategories: order,
        programmeFolderId: flattened.length ? folderId : ""
      });
      if (flattened.length) {
        batch.set(doc(db, "folders", folderId), {
          nom: `Programme · ${programmeEvent.titre || "Messe"}${programmeEvent.date?.toDate ? ` · ${programmeEvent.date.toDate().toLocaleDateString("fr-FR")}` : ""}`,
          temporary: true,
          eventId: programmeEvent.id,
          expiresAt: programmeEvent.date || null,
          songIds: flattened,
          categoryIds: order,
          createdAt: serverTimestamp()
        }, { merge: true });
      } else {
        batch.delete(doc(db, "folders", folderId));
      }
      await batch.commit();
      setProgrammeEvent(null);
      setNotice("Programme de messe enregistré.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'enregistrer le programme.");
    } finally {
      setBusy("");
    }
  }

  function toggleProgrammeSong(categoryId: string, songId: string) {
    setProgramme((current) => {
      const ids = current[categoryId] || [];
      return { ...current, [categoryId]: ids.includes(songId) ? ids.filter((id) => id !== songId) : [...ids, songId] };
    });
  }

  function addCustomPart() {
    if (!customPartId || programmeOrder.includes(customPartId)) return;
    setProgrammeOrder((current) => [...current, customPartId]);
    setCustomPartId("");
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
        <div className="agenda-intro-card">
          <span className="agenda-intro-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
              <path d="M7.5 3v5M16.5 3v5M3.5 10h17" />
              <path d="M8 14h3M13 14h3M8 17h3" />
            </svg>
          </span>
          <div className="agenda-intro-copy">
            <h3>Planning du chœur</h3>
            <p>Retrouve ici les prochains rendez-vous et indique rapidement ta présence.</p>
          </div>
          {canEdit && (
            <button className="agenda-intro-add" aria-label="Nouvel événement" onClick={() => setForm(emptyDraft())}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          )}
        </div>

        {notice && <p className="notice compact-notice">{notice}</p>}

        <div className="agenda-month-groups">
          {groupedVisibleEvents.map((group) => (
            <section className="agenda-month-section" key={group.label}>
              <h3 className="agenda-month-title">{group.label}</h3>
              <div className="compact-list timeline-list">
          {group.events.map((event) => {
            const date = event.date?.toDate();
            const myResponse = uid ? event.reponses?.[uid] : undefined;
            const isOpen = expanded === event.id;
            const attendance = Object.values(event.reponses || {});
            const attendanceLabel = attendance.length
              ? `${attendance.filter((r) => r === "present").length} présent(s) · ${attendance.filter((r) => r === "absent").length} absent(s)`
              : "Aucune réponse pour le moment";
            const programmeMap = event.programmeParCategorie || {};
            const programmeOrder = event.programmeCategories?.length ? event.programmeCategories : defaultOrder.filter((id) => programmeMap[id]?.length);
            const hasProgramme = Boolean(event.programme?.length || Object.values(programmeMap).some((ids) => ids.length));

            return (
              <article className={`event-card event-card-v2 ${event.cancelled ? "event-cancelled" : ""}`} key={event.id}>
                <div className="date-tile date-tile-v2">
                  <strong>{date?.getDate() ?? "--"}</strong>
                  <span>{date?.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "").toUpperCase()}</span>
                </div>

                <div className="event-main event-main-v2">
                  <div className="event-topline">
                    <span className="event-type-label">{eventTypeLabel(event.type)}</span>
                    {event.cancelled && <span className="danger-chip">ANNULÉ</span>}
                  </div>
                  <h3>{event.titre}</h3>
                  <div className="event-meta-line">
                    {date && <span className="event-time-label">{date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>}
                    {event.lieu && <small className="event-location">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-11A6 6 0 0 0 6 10c0 5.8 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></svg>
                      {event.lieu}
                    </small>}
                  </div>

                  {!event.cancelled && !event.synthetic && event.type !== "anniversaire" && (
                    <div className="presence-actions">
                      {[["present", "Présent"], ["absent", "Absent"], ["peut-etre", "Peut-être"]].map(([value, label]) => (
                        <button
                          key={value}
                          className={`${myResponse === value ? "selected" : ""} presence-${value}`}
                          onClick={() => void respond(event, value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  <button className="details-toggle" onClick={() => setExpanded(isOpen ? null : event.id)}>{isOpen ? "Masquer les détails" : "Voir les détails"}</button>

                  {isOpen && (
                    <div className="event-details-panel">
                      {event.description && <div className="event-detail-block"><h4>Description</h4><p>{event.description}</p></div>}
                      {!event.synthetic && <div className="event-detail-block"><h4>Présences</h4><p>{attendanceLabel}</p></div>}
                      {event.type === "messe" && event.dressCode && <div className="event-detail-block"><h4>Dress code</h4><p>{event.dressCode}</p></div>}

                      {event.type === "messe" && (
                        <div className="event-detail-block mass-programme-block">
                          {hasProgramme ? (
                            <>
                              <div className="detail-title-row"><h4>Programme de messe</h4>{canEdit && <button onClick={() => openProgramme(event)}>Modifier</button>}</div>
                              <div className="programme-category-display">
                                {programmeOrder.map((categoryId) => {
                                  const ids = programmeMap[categoryId] || [];
                                  if (!ids.length) return null;
                                  return <div key={categoryId}><strong>{categoryLabel(categoryId, categories)}</strong><ul>{ids.map((id) => <li key={id}>{songMap.get(id)?.titre || "Chant introuvable"}</li>)}</ul></div>;
                                })}
                              </div>
                            </>
                          ) : canEdit ? (
                            <button className="compose-programme-button" onClick={() => openProgramme(event)}>Composer le programme</button>
                          ) : (
                            <p>Programme non renseigné.</p>
                          )}
                        </div>
                      )}

                      {event.type === "reunion" && (
                        <div className="event-detail-block">
                          <div className="detail-title-row"><h4>Compte rendu</h4>{canEdit && <button onClick={() => openReport(event)}>Modifier</button>}</div>
                          <p className="pre-line">{event.compteRendu || "Pas encore de compte rendu."}</p>
                        </div>
                      )}

                      {canEdit && !event.synthetic && (
                        <div className="event-admin-actions optimized-event-actions">
                          <button onClick={() => setForm(eventDraft(event))}>Modifier</button>
                          {!event.cancelled && <button className="warning-action" disabled={busy === `cancel-${event.id}`} onClick={() => void cancelEvent(event)}>Annuler</button>}
                          <button className="icon-danger-button event-delete-icon" aria-label="Supprimer l'événement" disabled={busy === `delete-${event.id}`} onClick={() => void removeEvent(event)}><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg></button>
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
          ))}
          {groupedVisibleEvents.length === 0 && (
            <div className="agenda-empty-state">Aucun événement à venir pour le moment.</div>
          )}
        </div>
      </section>

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <div className="admin-modal event-editor-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title-row"><div><span className="section-kicker">AGENDA</span><h2>{form.id ? "Modifier l'événement" : "Nouvel événement"}</h2></div><button onClick={() => setForm(null)}>×</button></div>
            <div className="admin-dialog-form two-column-form">
              <label>Titre<input value={form.titre} onChange={(event) => setForm({ ...form, titre: event.target.value })} /></label>
              <label>Type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{eventTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Date et heure<input type="datetime-local" value={form.dateLocal} onChange={(event) => setForm({ ...form, dateLocal: event.target.value })} /></label>
              <label>Lieu<input value={form.lieu} onChange={(event) => setForm({ ...form, lieu: event.target.value })} /></label>
              {form.type === "messe" && <label className="full-span">Dress code<input value={form.dressCode} onChange={(event) => setForm({ ...form, dressCode: event.target.value })} placeholder="Ex. Haut blanc, bas noir" /></label>}
              <label className="full-span">Description<textarea rows={5} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            </div>
            <div className="modal-actions"><button onClick={() => setForm(null)}>Annuler</button><button className="primary" disabled={busy === "save-event" || !form.titre.trim() || !form.dateLocal} onClick={() => void saveEvent()}>Enregistrer</button></div>
          </div>
        </div>
      )}

      {programmeEvent && (
        <div className="modal-backdrop" onClick={() => setProgrammeEvent(null)}>
          <div className="admin-modal programme-modal category-programme-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title-row"><div><span className="section-kicker">PROGRAMME DE MESSE</span><h2>{programmeEvent.titre}</h2></div><button onClick={() => setProgrammeEvent(null)}>×</button></div>
            <div className="category-programme-editor">
              {programmeOrder.map((categoryId) => {
                const categorySongs = songs.filter((song) => (song.categoryIds || []).includes(categoryId)).sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
                const isCustomPart = !defaultOrder.includes(categoryId);
                return (
                  <section key={categoryId} className="programme-category-section">
                    <div className="programme-category-head"><h3>{categoryLabel(categoryId, categories)}</h3>{isCustomPart && <button onClick={() => { setProgrammeOrder((current) => current.filter((id) => id !== categoryId)); setProgramme((current) => { const next = { ...current }; delete next[categoryId]; return next; }); }}>Retirer</button>}</div>
                    {categorySongs.length === 0 ? <p>Aucun chant dans cette catégorie.</p> : <div className="programme-song-choice-list">{categorySongs.map((song) => <label key={song.id}><input type="checkbox" checked={(programme[categoryId] || []).includes(song.id)} onChange={() => toggleProgrammeSong(categoryId, song.id)} /><span>{song.titre}</span></label>)}</div>}
                  </section>
                );
              })}

              <div className="add-mass-part-row">
                <select value={customPartId} onChange={(event) => setCustomPartId(event.target.value)}>
                  <option value="">Ajouter une partie de la messe…</option>
                  {categories.filter((category) => category.custom && !programmeOrder.includes(category.id)).map((category) => <option key={category.id} value={category.id}>{category.nom}</option>)}
                </select>
                <button disabled={!customPartId} onClick={addCustomPart}>Ajouter</button>
              </div>
            </div>
            <div className="modal-actions"><button onClick={() => setProgrammeEvent(null)}>Annuler</button><button className="primary" disabled={busy === "programme"} onClick={() => void saveProgramme()}>Enregistrer</button></div>
          </div>
        </div>
      )}

      {reportEvent && (
        <div className="modal-backdrop" onClick={() => setReportEvent(null)}>
          <div className="admin-modal report-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title-row"><div><span className="section-kicker">RÉUNION</span><h2>Compte rendu</h2></div><button onClick={() => setReportEvent(null)}>×</button></div>
            <textarea rows={14} value={reportText} onChange={(event) => setReportText(event.target.value)} placeholder="Saisir le compte rendu de la réunion…" />
            <div className="modal-actions"><button onClick={() => setReportEvent(null)}>Annuler</button><button className="primary" disabled={busy === "report"} onClick={() => void saveReport()}>Enregistrer</button></div>
          </div>
        </div>
      )}
    </>
  );
}
