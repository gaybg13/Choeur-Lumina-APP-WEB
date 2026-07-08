import { useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "../lib/firebase";
import { Header } from "../components/Header";
import type { Folder, Song } from "../types/models";

const voices = [
  ["soprano", "Soprano"],
  ["alto", "Alto"],
  ["tenor", "Ténor"],
  ["basse", "Basse"]
] as const;

type SongDraft = {
  id?: string;
  titre: string;
  compositeur: string;
  partitionUrl: string;
  partitionType: string;
  youtubeUrl: string;
  folderId: string;
  appris: boolean;
  audioUrlsByPupitre: Record<string, string>;
  audioFilesByPupitre: Record<string, boolean>;
};

const emptyDraft = (): SongDraft => ({
  titre: "",
  compositeur: "",
  partitionUrl: "",
  partitionType: "link",
  youtubeUrl: "",
  folderId: "",
  appris: false,
  audioUrlsByPupitre: {},
  audioFilesByPupitre: {}
});

function songToDraft(song: Song): SongDraft {
  return {
    id: song.id,
    titre: song.titre,
    compositeur: song.compositeur || "",
    partitionUrl: song.partitionUrl || "",
    partitionType: song.partitionType || "link",
    youtubeUrl: song.youtubeUrl || "",
    folderId: song.folderId || "",
    appris: Boolean(song.appris),
    audioUrlsByPupitre: { ...(song.audioUrlsByPupitre || {}) },
    audioFilesByPupitre: { ...(song.audioFilesByPupitre || {}) }
  };
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function SongsScreen({
  songs,
  folders,
  canEdit,
  uid
}: {
  songs: Song[];
  folders: Folder[];
  canEdit: boolean;
  uid: string;
}) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<SongDraft | null>(null);
  const [viewer, setViewer] = useState<{ url: string; type: string; title: string } | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [busy, setBusy] = useState<string>("");
  const [notice, setNotice] = useState("");
  const [recordingVoice, setRecordingVoice] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);

  const visibleSongs = useMemo(
    () => selectedFolderId ? songs.filter((song) => song.folderId === selectedFolderId) : songs,
    [songs, selectedFolderId]
  );

  async function uploadFile(file: Blob, path: string) {
    const ref = storageRef(storage, path);
    await uploadBytes(ref, file);
    return getDownloadURL(ref);
  }

  async function addFolder() {
    const nom = newFolder.trim();
    if (!nom) return;
    setBusy("folder");
    try {
      await addDoc(collection(db, "folders"), { nom });
      setNewFolder("");
      setShowFolderForm(false);
      setNotice("Dossier ajouté.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'ajouter le dossier.");
    } finally {
      setBusy("");
    }
  }

  async function saveSong() {
    if (!form?.titre.trim()) return;
    setBusy("save");
    const payload = {
      titre: form.titre.trim(),
      compositeur: form.compositeur.trim(),
      partitionUrl: form.partitionUrl.trim(),
      partitionType: form.partitionType || "link",
      audioUrl: "",
      audioIsFile: false,
      youtubeUrl: form.youtubeUrl.trim(),
      folderId: form.folderId,
      appris: form.appris,
      audioUrlsByPupitre: form.audioUrlsByPupitre,
      audioFilesByPupitre: form.audioFilesByPupitre
    };

    try {
      if (form.id) {
        await updateDoc(doc(db, "songs", form.id), payload);
      } else {
        await addDoc(collection(db, "songs"), { ...payload, createdAt: serverTimestamp() });
      }
      setForm(null);
      setNotice(form.id ? "Chant mis à jour." : "Chant ajouté.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'enregistrer le chant.");
    } finally {
      setBusy("");
    }
  }

  async function removeSong(song: Song) {
    if (!window.confirm(`Supprimer « ${song.titre} » ?`)) return;
    setBusy(`delete-${song.id}`);
    try {
      await deleteDoc(doc(db, "songs", song.id));
      setNotice("Chant supprimé.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible de supprimer le chant.");
    } finally {
      setBusy("");
    }
  }

  async function uploadPartition(file: File) {
    if (!form) return;
    setBusy("partition");
    try {
      const url = await uploadFile(
        file,
        `songs/${form.id || uid}_${Date.now()}/partition_${safeName(file.name)}`
      );
      const type = file.type.includes("pdf") ? "pdf" : "image";
      setForm((current) => current ? { ...current, partitionUrl: url, partitionType: type } : current);
      setNotice("Partition importée.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'importer la partition. Vérifie les règles Storage.");
    } finally {
      setBusy("");
    }
  }

  async function uploadVoiceFile(voice: string, file: Blob, filename: string) {
    if (!form) return;
    setBusy(`audio-${voice}`);
    try {
      const url = await uploadFile(
        file,
        `songs/${form.id || uid}_${Date.now()}/${voice}_${safeName(filename)}`
      );
      setForm((current) => current ? {
        ...current,
        audioUrlsByPupitre: { ...current.audioUrlsByPupitre, [voice]: url },
        audioFilesByPupitre: { ...current.audioFilesByPupitre, [voice]: true }
      } : current);
      setNotice(`Audio ${voice} importé.`);
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'importer l'audio. Vérifie les règles Storage.");
    } finally {
      setBusy("");
    }
  }

  async function startRecording(voice: string) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNotice("L'enregistrement audio n'est pas pris en charge par ce navigateur.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderStreamRef.current = stream;
      recorderRef.current = recorder;
      recorderChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recorderChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
        recorderStreamRef.current = null;
        recorderRef.current = null;
        setRecordingVoice(null);
        void uploadVoiceFile(voice, blob, `enregistrement_${Date.now()}.webm`);
      };
      recorder.start();
      setRecordingVoice(voice);
      setNotice("Enregistrement en cours…");
    } catch (error) {
      console.error(error);
      setNotice("Accès au microphone refusé ou indisponible.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  return (
    <>
      <Header title="Bibliothèque" />
      <section className="screen songs-v2-screen">
        <div className="intro-card library-hero">
          <div>
            <span className="section-kicker">RÉPERTOIRE DU CHŒUR</span>
            <h2>Bibliothèque musicale</h2>
            <p>Partitions, vidéos et jusqu'à 4 audios par chant, un pour chaque pupitre.</p>
          </div>
          {canEdit && <button className="primary-action" onClick={() => setForm(emptyDraft())}>+ Ajouter un chant</button>}
        </div>

        <div className="folder-toolbar">
          <button className={!selectedFolderId ? "selected" : ""} onClick={() => setSelectedFolderId("")}>Tous</button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              className={selectedFolderId === folder.id ? "selected" : ""}
              onClick={() => setSelectedFolderId(folder.id)}
            >
              {folder.nom}
            </button>
          ))}
          {canEdit && <button className="folder-add" onClick={() => setShowFolderForm((value) => !value)}>+ Dossier</button>}
        </div>

        {showFolderForm && canEdit && (
          <div className="inline-admin-form">
            <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Nom du dossier" />
            <button disabled={busy === "folder" || !newFolder.trim()} onClick={addFolder}>Créer</button>
          </div>
        )}

        {notice && <p className="notice compact-notice">{notice}</p>}

        <div className="compact-list song-list-v2">
          {visibleSongs.length === 0 && <div className="empty-panel">Aucun chant dans ce dossier.</div>}
          {visibleSongs.map((song) => {
            const audioCount = Object.values(song.audioUrlsByPupitre || {}).filter(Boolean).length;
            const isOpen = openId === song.id;
            return (
              <article className="song-card song-card-v2" key={song.id}>
                <button className="song-summary song-summary-button" onClick={() => setOpenId(isOpen ? null : song.id)}>
                  <div className="song-icon-tile">♫</div>
                  <div className="song-summary-copy">
                    <h3>{song.titre}</h3>
                    <small>{song.compositeur || "Compositeur non renseigné"}</small>
                    <p>{song.partitionUrl ? "Partition disponible" : "Sans partition"} · {audioCount}/4 audio{audioCount > 1 ? "s" : ""}</p>
                  </div>
                  <span className={song.appris ? "status-ok" : "status-work"}>{song.appris ? "Appris" : "À travailler"}</span>
                  <span className="chevron">{isOpen ? "⌃" : "⌄"}</span>
                </button>

                {isOpen && (
                  <div className="song-details song-details-v2">
                    <div className="resource-row resource-row-v2">
                      {song.partitionUrl && (
                        <button onClick={() => setViewer({
                          url: song.partitionUrl!,
                          type: song.partitionType || "link",
                          title: song.titre
                        })}>Voir la partition</button>
                      )}
                      {song.youtubeUrl && <a href={song.youtubeUrl} target="_blank" rel="noreferrer">Voir la vidéo</a>}
                      {canEdit && <button onClick={() => setForm(songToDraft(song))}>Modifier</button>}
                      {canEdit && <button className="danger-text" disabled={busy === `delete-${song.id}`} onClick={() => void removeSong(song)}>Supprimer</button>}
                    </div>
                    <div className="voice-audio-grid">
                      {voices.map(([key, label]) => {
                        const url = song.audioUrlsByPupitre?.[key];
                        return (
                          <div key={key} className={`voice-audio-card ${url ? "has-audio" : ""}`}>
                            <div><strong>{label}</strong><small>{url ? "Audio disponible" : "Pas encore d'audio"}</small></div>
                            {url && <audio controls preload="metadata" src={url} />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {viewer && (
        <div className="modal-backdrop" onClick={() => setViewer(null)}>
          <div className="viewer-modal" onClick={(e) => e.stopPropagation()}>
            <div className="viewer-header"><h2>{viewer.title}</h2><button onClick={() => setViewer(null)}>×</button></div>
            {viewer.type === "image" ? <img src={viewer.url} alt={viewer.title} /> : <iframe src={viewer.url} title={viewer.title} />}
            <a className="secondary-button viewer-open-link" href={viewer.url} target="_blank" rel="noreferrer">Ouvrir dans un nouvel onglet</a>
          </div>
        </div>
      )}

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <div className="admin-modal song-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title-row"><div><span className="section-kicker">BIBLIOTHÈQUE</span><h2>{form.id ? "Modifier le chant" : "Nouveau chant"}</h2></div><button onClick={() => setForm(null)}>×</button></div>
            <div className="song-editor-grid">
              <label>Titre<input value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} /></label>
              <label>Compositeur<input value={form.compositeur} onChange={(e) => setForm({ ...form, compositeur: e.target.value })} /></label>
              <label>Dossier<select value={form.folderId} onChange={(e) => setForm({ ...form, folderId: e.target.value })}><option value="">Sans dossier</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.nom}</option>)}</select></label>
              <label className="toggle-line"><input type="checkbox" checked={form.appris} onChange={(e) => setForm({ ...form, appris: e.target.checked })} /> Chant appris</label>
              <label className="full-span">Vidéo YouTube<input value={form.youtubeUrl} onChange={(e) => setForm({ ...form, youtubeUrl: e.target.value })} placeholder="https://…" /></label>

              <div className="editor-section full-span">
                <div className="editor-section-head"><div><h3>Partition</h3><p>PDF, image ou lien externe.</p></div></div>
                <input value={form.partitionUrl} onChange={(e) => setForm({ ...form, partitionUrl: e.target.value, partitionType: "link" })} placeholder="Coller un lien vers la partition" />
                <label className="file-action">Importer un fichier<input type="file" accept="application/pdf,image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadPartition(file); e.currentTarget.value = ""; }} /></label>
                {form.partitionUrl && <small className="upload-ok">Partition prête ✓</small>}
              </div>

              <div className="editor-section full-span">
                <div className="editor-section-head"><div><h3>Audios par pupitre</h3><p>Ajoute un lien, importe un fichier ou enregistre directement depuis le navigateur.</p></div></div>
                <div className="voice-editor-grid">
                  {voices.map(([key, label]) => (
                    <div className="voice-editor-card" key={key}>
                      <strong>{label}</strong>
                      <input
                        value={form.audioUrlsByPupitre[key] || ""}
                        onChange={(e) => setForm({
                          ...form,
                          audioUrlsByPupitre: { ...form.audioUrlsByPupitre, [key]: e.target.value },
                          audioFilesByPupitre: { ...form.audioFilesByPupitre, [key]: false }
                        })}
                        placeholder="Lien audio"
                      />
                      {form.audioUrlsByPupitre[key] && <audio controls preload="metadata" src={form.audioUrlsByPupitre[key]} />}
                      <div className="voice-editor-actions">
                        <label className="file-action">Importer<input type="file" accept="audio/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadVoiceFile(key, file, file.name); e.currentTarget.value = ""; }} /></label>
                        {recordingVoice === key ? <button className="record-stop" onClick={stopRecording}>■ Arrêter</button> : <button disabled={Boolean(recordingVoice)} onClick={() => void startRecording(key)}>● Enregistrer</button>}
                        {form.audioUrlsByPupitre[key] && <button onClick={() => setForm({
                          ...form,
                          audioUrlsByPupitre: { ...form.audioUrlsByPupitre, [key]: "" },
                          audioFilesByPupitre: { ...form.audioFilesByPupitre, [key]: false }
                        })}>Retirer</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-actions"><button onClick={() => setForm(null)}>Annuler</button><button className="primary" disabled={busy === "save" || !form.titre.trim()} onClick={() => void saveSong()}>{busy === "save" ? "Enregistrement…" : "Enregistrer"}</button></div>
          </div>
        </div>
      )}
    </>
  );
}
