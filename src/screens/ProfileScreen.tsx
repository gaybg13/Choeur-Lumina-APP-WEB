import { useEffect, useRef, useState } from "react";
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
  const [cropSource, setCropSource] = useState<string | null>(null);
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


  async function uploadPhoto(blob: Blob) {
    if (!member?.uid) return;
    setPhotoBusy(true);
    try {
      const fileRef = storageRef(storage, `profile_photos/${member.uid}`);
      await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
      const downloadUrl = await getDownloadURL(fileRef);
      const photoUrl = `${downloadUrl}${downloadUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
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

  function preparePhoto(file: File) {
    const url = URL.createObjectURL(file);
    setCropSource(url);
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
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) preparePhoto(file);
              e.currentTarget.value = "";
            }}
          />

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

      {cropSource && (
        <PhotoCropModal
          src={cropSource}
          onCancel={() => {
            URL.revokeObjectURL(cropSource);
            setCropSource(null);
          }}
          onConfirm={async (blob) => {
            URL.revokeObjectURL(cropSource);
            setCropSource(null);
            await uploadPhoto(blob);
          }}
        />
      )}
    </>
  );
}

function PhotoCropModal({
  src,
  onCancel,
  onConfirm
}: {
  src: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => Promise<void>;
}) {
  const STAGE = 240;
  const [natural, setNatural] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const baseScale = Math.max(STAGE / natural.width, STAGE / natural.height);
  const displayWidth = natural.width * baseScale * zoom;
  const displayHeight = natural.height * baseScale * zoom;

  function clamp(next: { x: number; y: number }, zoomValue = zoom) {
    const w = natural.width * baseScale * zoomValue;
    const h = natural.height * baseScale * zoomValue;
    const maxX = Math.max(0, (w - STAGE) / 2);
    const maxY = Math.max(0, (h - STAGE) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y))
    };
  }

  useEffect(() => {
    setOffset((value) => clamp(value, zoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, natural.width, natural.height]);

  async function createCrop() {
    const img = new Image();
    img.src = src;
    await img.decode();

    const totalScale = baseScale * zoom;
    const sourceSize = Math.min(STAGE / totalScale, img.naturalWidth, img.naturalHeight);
    const sx = Math.max(0, Math.min(img.naturalWidth - sourceSize, (img.naturalWidth - sourceSize) / 2 - offset.x / totalScale));
    const sy = Math.max(0, Math.min(img.naturalHeight - sourceSize, (img.naturalHeight - sourceSize) / 2 - offset.y / totalScale));

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponible");
    ctx.drawImage(img, sx, sy, sourceSize, sourceSize, 0, 0, 512, 512);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Recadrage impossible")), "image/jpeg", 0.92);
    });
    return blob;
  }

  return (
    <div className="crop-modal-backdrop" role="dialog" aria-modal="true" aria-label="Cadrer la photo de profil">
      <div className="crop-modal-card">
        <div className="crop-modal-heading">
          <div>
            <span>PHOTO DE PROFIL</span>
            <h2>Cadrer la photo</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="Fermer">×</button>
        </div>

        <p>Déplace la photo et ajuste le zoom pour remplir correctement le cercle.</p>

        <div
          className="crop-stage"
          style={{ width: STAGE, height: STAGE }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
          }}
          onPointerMove={(event) => {
            if (!dragRef.current) return;
            const next = {
              x: dragRef.current.ox + event.clientX - dragRef.current.x,
              y: dragRef.current.oy + event.clientY - dragRef.current.y
            };
            setOffset(clamp(next));
          }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
        >
          <img
            src={src}
            alt="Aperçu du cadrage"
            draggable={false}
            onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            style={{
              width: displayWidth,
              height: displayHeight,
              left: (STAGE - displayWidth) / 2 + offset.x,
              top: (STAGE - displayHeight) / 2 + offset.y
            }}
          />
        </div>

        <label className="crop-zoom-control">
          <span>Zoom</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>

        <div className="crop-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Annuler</button>
          <button
            type="button"
            className="primary-button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onConfirm(await createCrop());
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Enregistrement…" : "Utiliser cette photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
