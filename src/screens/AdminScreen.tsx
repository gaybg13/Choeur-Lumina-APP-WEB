import { useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc
} from "firebase/firestore";
import { db } from "../lib/firebase";
import type { LuminaEvent, Member } from "../types/models";
import { Header } from "../components/Header";

const roleLabels = [
  ["membre", "Membre"],
  ["contributeur", "Contributeur"],
  ["admin", "Admin"]
] as const;

function makeInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "LUM-";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

type MemberForm = {
  id?: string;
  prenom: string;
  nom: string;
  pupitre: string;
  role: string;
  uid?: string;
  claimed?: boolean;
};

export function AdminScreen({
  members,
  events,
  onBack
}: {
  members: Member[];
  events: LuminaEvent[];
  onBack: () => void;
}) {
  const [showPresence, setShowPresence] = useState(false);
  const [form, setForm] = useState<MemberForm | null>(null);
  const [deleting, setDeleting] = useState<Member | null>(null);
  const [revealedCode, setRevealedCode] = useState<{ title: string; code: string } | null>(null);
  const [notice, setNotice] = useState("");

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) =>
      `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, "fr")
    ),
    [members]
  );

  function openNewMember() {
    setForm({
      prenom: "",
      nom: "",
      pupitre: "",
      role: "membre"
    });
  }

  function openEditMember(member: Member) {
    setForm({
      id: member.id,
      prenom: member.prenom,
      nom: member.nom,
      pupitre: member.pupitre || "",
      role: member.role || "membre",
      uid: member.uid,
      claimed: member.claimed
    });
  }

  async function saveMember() {
    if (!form || !form.prenom.trim() || !form.nom.trim()) return;

    setNotice("");

    if (!form.id) {
      const inviteCode = makeInviteCode();

      await addDoc(collection(db, "members"), {
        prenom: form.prenom.trim(),
        nom: form.nom.trim(),
        pupitre: form.pupitre.trim(),
        role: form.role,
        inviteCode,
        claimed: false,
        uid: "",
        email: "",
        createdAt: serverTimestamp()
      });

      setForm(null);
      setRevealedCode({
        title: "Choriste ajouté !",
        code: inviteCode
      });
      return;
    }

    await updateDoc(doc(db, "members", form.id), {
      prenom: form.prenom.trim(),
      nom: form.nom.trim(),
      pupitre: form.pupitre.trim(),
      role: form.role
    });

    if (form.uid) {
      await setDoc(doc(db, "userRoles", form.uid), {
        role: form.role
      });
    }

    setForm(null);
    setNotice("Choriste modifié.");
  }

  async function regenerateCode(memberId: string) {
    const code = makeInviteCode();

    await updateDoc(doc(db, "members", memberId), {
      inviteCode: code,
      claimed: false
    });

    setRevealedCode({
      title: "Nouveau code généré",
      code
    });
  }

  async function removeMember() {
    if (!deleting) return;

    await deleteDoc(doc(db, "members", deleting.id));

    if (deleting.uid) {
      await deleteDoc(doc(db, "userRoles", deleting.uid));
    }

    setDeleting(null);
    setNotice("Choriste supprimé.");
  }

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code);
    setNotice("Code copié.");
  }

  return (
    <>
      <Header title="Administration" />

      <section className="screen android-admin-screen">
        <button type="button" className="android-admin-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Retour
        </button>

        <button
          type="button"
          className="presence-overview-button"
          onClick={() => setShowPresence(true)}
        >
          Voir les réponses aux présences
        </button>

        <p className="member-count">
          {sortedMembers.length} choriste(s) enregistré(s)
        </p>

        {notice && <p className="admin-notice">{notice}</p>}

        <div className="android-member-list">
          {sortedMembers.length === 0 ? (
            <p className="admin-empty">Aucun choriste pour l'instant.</p>
          ) : (
            sortedMembers.map((member) => {
              const roleLabel =
                roleLabels.find(([value]) => value === member.role)?.[1] ||
                member.role ||
                "Membre";

              return (
                <article className="android-member-card" key={member.id}>
                  <div className="member-card-top">
                    <div>
                      <h3>{member.prenom} {member.nom}</h3>
                      <p>{member.pupitre || "-"} · {roleLabel}</p>
                    </div>

                    <div className="member-card-actions">
                      <button
                        type="button"
                        aria-label="Modifier"
                        onClick={() => openEditMember(member)}
                      >
                        <svg viewBox="0 0 24 24">
                          <path d="M4 20h4l11-11-4-4L4 16v4Z" />
                          <path d="m13.5 6.5 4 4" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        aria-label="Supprimer"
                        onClick={() => setDeleting(member)}
                      >
                        <svg viewBox="0 0 24 24">
                          <path d="M4 7h16" />
                          <path d="M9 7V4h6v3" />
                          <path d="M7 7l1 13h8l1-13" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {member.claimed ? (
                    <span className="member-account-active">✓ Compte actif</span>
                  ) : (
                    <div className="pending-code-row">
                      <span>En attente · Code : {member.inviteCode || "—"}</span>
                      {member.inviteCode && (
                        <button
                          type="button"
                          aria-label="Copier le code"
                          onClick={() => copyCode(member.inviteCode || "")}
                        >
                          <svg viewBox="0 0 24 24">
                            <rect x="9" y="9" width="10" height="10" rx="2" />
                            <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        <button
          type="button"
          className="admin-fab"
          aria-label="Ajouter un choriste"
          onClick={openNewMember}
        >
          +
        </button>
      </section>

      {showPresence && (
        <div className="modal-backdrop" onClick={() => setShowPresence(false)}>
          <div className="admin-modal presence-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Réponses aux présences</h2>

            <div className="presence-events-list">
              {events.map((event) => (
                <article className="presence-event-card" key={event.id}>
                  <h3>{event.titre}</h3>
                  <p>
                    {event.date?.toDate
                      ? event.date.toDate().toLocaleDateString("fr-FR")
                      : "Date à préciser"}
                  </p>

                  <div className="presence-member-lines">
                    {sortedMembers
                      .filter((member) => Boolean(member.uid))
                      .map((member) => {
                        const response = event.reponses?.[member.uid];
                        const label =
                          response === "present"
                            ? "Présent"
                            : response === "absent"
                              ? "Absent"
                              : response === "peut-etre"
                                ? "Peut-être"
                                : "Pas de réponse";

                        return (
                          <div key={member.id}>
                            <span>{member.prenom} {member.nom}</span>
                            <strong className={`presence-label ${response || "none"}`}>
                              {label}
                            </strong>
                          </div>
                        );
                      })}
                  </div>
                </article>
              ))}
            </div>

            <button
              type="button"
              className="modal-close-button"
              onClick={() => setShowPresence(false)}
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{form.id ? "Modifier le choriste" : "Nouveau choriste"}</h2>

            <div className="admin-dialog-form">
              <label>
                Prénom
                <input
                  value={form.prenom}
                  onChange={(e) => setForm({ ...form, prenom: e.target.value })}
                />
              </label>

              <label>
                Nom
                <input
                  value={form.nom}
                  onChange={(e) => setForm({ ...form, nom: e.target.value })}
                />
              </label>

              <label>
                Pupitre (ex : Ténor)
                <input
                  value={form.pupitre}
                  onChange={(e) => setForm({ ...form, pupitre: e.target.value })}
                />
              </label>

              <label>
                Rôle
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  {roleLabels.map(([value, label]) => (
                    <option value={value} key={value}>{label}</option>
                  ))}
                </select>
              </label>

              {!form.id ? (
                <p className="dialog-helper">
                  Un code d'invitation sera généré automatiquement.
                </p>
              ) : !form.claimed ? (
                <button
                  type="button"
                  className="regenerate-code-button"
                  onClick={() => regenerateCode(form.id!)}
                >
                  Régénérer le code d'invitation
                </button>
              ) : null}
            </div>

            <div className="modal-actions">
              <button type="button" onClick={() => setForm(null)}>
                Annuler
              </button>
              <button
                type="button"
                className="primary"
                disabled={!form.prenom.trim() || !form.nom.trim()}
                onClick={saveMember}
              >
                {form.id ? "Enregistrer" : "Créer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <div className="modal-backdrop" onClick={() => setDeleting(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Supprimer ce choriste ?</h2>
            <p>
              La fiche de « {deleting.prenom} {deleting.nom} » sera supprimée.
              Si son compte était déjà actif, cela ne supprime pas son compte de connexion,
              seulement ses informations dans l'application.
            </p>

            <div className="modal-actions">
              <button type="button" onClick={() => setDeleting(null)}>
                Annuler
              </button>
              <button type="button" className="danger" onClick={removeMember}>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {revealedCode && (
        <div className="modal-backdrop" onClick={() => setRevealedCode(null)}>
          <div className="admin-modal code-reveal-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{revealedCode.title}</h2>
            <p>Transmets ce code au choriste pour qu'il crée son compte :</p>
            <code>{revealedCode.code}</code>

            <div className="modal-actions">
              <button type="button" onClick={() => setRevealedCode(null)}>
                Fermer
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => copyCode(revealedCode.code)}
              >
                Copier
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
