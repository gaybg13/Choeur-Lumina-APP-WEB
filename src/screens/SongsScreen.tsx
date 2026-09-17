import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { db, storage } from "../lib/firebase";
import { Header } from "../components/Header";
import { categoryLabel, slugifyCategory } from "../lib/songCategories";
import type { Folder, Song, SongCategory } from "../types/models";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

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
  categoryIds: string[];
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
  categoryIds: [],
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
    categoryIds: [...(song.categoryIds || [])],
    appris: Boolean(song.appris),
    audioUrlsByPupitre: {
      ...(song.audioUrlsByPupitre || {}),
      ...((!Object.keys(song.audioUrlsByPupitre || {}).length && song.audioUrl) ? { general: song.audioUrl } : {})
    },
    audioFilesByPupitre: {
      ...(song.audioFilesByPupitre || {}),
      ...((!Object.keys(song.audioUrlsByPupitre || {}).length && song.audioUrl) ? { general: Boolean(song.audioIsFile) } : {})
    }
  };
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extensionFromUrl(url: string) {
  const clean = decodeURIComponent(url.split("?")[0] || "");
  const match = clean.match(/\.([a-z0-9]{2,5})$/i);
  return match?.[1] || "mp3";
}

async function saveUrlAsFile(url: string, filename: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function SongsScreen({
  songs,
  folders,
  categories,
  canEdit,
  uid
}: {
  songs: Song[];
  folders: Folder[];
  categories: SongCategory[];
  canEdit: boolean;
  uid: string;
}) {
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<SongDraft | null>(null);
  const [viewer, setViewer] = useState<{ url: string; type: string; title: string } | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [recordingVoice, setRecordingVoice] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId);
  const visibleSongs = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("fr");
    return songs
      .filter((song) => {
        if (!selectedFolderId) return true;
        if (selectedFolder?.temporary) return (selectedFolder.songIds || []).includes(song.id);
        return song.folderId === selectedFolderId;
      })
      .filter((song) => !selectedCategoryId || (song.categoryIds || []).includes(selectedCategoryId))
      .filter((song) => !normalized || `${song.titre} ${song.compositeur || ""}`.toLocaleLowerCase("fr").includes(normalized))
      .sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
  }, [songs, search, selectedCategoryId, selectedFolder, selectedFolderId]);

  const permanentFolders = folders.filter((folder) => !folder.temporary);
  const selectedCustomCategory = categories.find((item) => item.id === selectedCategoryId && item.custom);

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
      await addDoc(collection(db, "folders"), { nom, temporary: false, createdAt: serverTimestamp() });
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

  async function removeFolder(folder: Folder) {
    if (folder.temporary || !window.confirm(`Supprimer le dossier « ${folder.nom} » ? Les chants resteront dans la bibliothèque.`)) return;
    setBusy(`folder-${folder.id}`);
    try {
      const batch = writeBatch(db);
      songs.filter((song) => song.folderId === folder.id).forEach((song) => batch.update(doc(db, "songs", song.id), { folderId: "" }));
      batch.delete(doc(db, "folders", folder.id));
      await batch.commit();
      setSelectedFolderId("");
      setNotice("Dossier supprimé. Les chants ont été conservés.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible de supprimer le dossier.");
    } finally {
      setBusy("");
    }
  }

  async function addCategory() {
    const nom = newCategory.trim();
    if (!nom) return;
    setBusy("category");
    try {
      let id = slugifyCategory(nom);
      if (categories.some((item) => item.id === id)) id = `${id}_${Date.now().toString().slice(-5)}`;
      await setDoc(doc(db, "songCategories", id), {
        nom,
        ordre: 1000 + Date.now() % 100000,
        custom: true,
        createdAt: serverTimestamp(),
        createdBy: uid
      });
      setNewCategory("");
      setShowCategoryForm(false);
      setSelectedCategoryId(id);
      setNotice("Catégorie ajoutée.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'ajouter la catégorie.");
    } finally {
      setBusy("");
    }
  }

  async function removeCategory(category: SongCategory) {
    if (!category.custom || !window.confirm(`Supprimer la catégorie « ${category.nom} » ? Les chants ne seront pas supprimés.`)) return;
    setBusy(`category-${category.id}`);
    try {
      const batch = writeBatch(db);
      songs.filter((song) => (song.categoryIds || []).includes(category.id)).forEach((song) => {
        batch.update(doc(db, "songs", song.id), {
          categoryIds: (song.categoryIds || []).filter((id) => id !== category.id)
        });
      });
      batch.delete(doc(db, "songCategories", category.id));
      await batch.commit();
      setSelectedCategoryId("");
      setNotice("Catégorie supprimée.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible de supprimer la catégorie.");
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
      audioUrl: form.audioUrlsByPupitre.general || "",
      audioIsFile: Boolean(form.audioFilesByPupitre.general),
      youtubeUrl: form.youtubeUrl.trim(),
      folderId: form.folderId,
      categoryIds: [...new Set(form.categoryIds)],
      appris: form.appris,
      audioUrlsByPupitre: form.audioUrlsByPupitre,
      audioFilesByPupitre: form.audioFilesByPupitre
    };

    try {
      if (form.id) await updateDoc(doc(db, "songs", form.id), payload);
      else await addDoc(collection(db, "songs"), { ...payload, createdAt: serverTimestamp() });
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
      const url = await uploadFile(file, `songs/${form.id || uid}_${Date.now()}/partition_${safeName(file.name)}`);
      const type = file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
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
      const url = await uploadFile(file, `songs/${form.id || uid}_${Date.now()}/${voice}_${safeName(filename)}`);
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
      recorder.ondataavailable = (event) => { if (event.data.size > 0) recorderChunksRef.current.push(event.data); };
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
      <section className="screen library-compact-screen">
        <div className="library-title-row">
          <h2>Bibliothèque musicale</h2>
          <span>{visibleSongs.length} chant{visibleSongs.length > 1 ? "s" : ""}</span>
        </div>

        <div className="library-search-row">
          <div className="library-search-box">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></svg>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un chant" />
            {search && <button aria-label="Effacer" onClick={() => setSearch("")}>×</button>}
            <button className={selectedCategoryId ? "active-filter" : ""} aria-label="Filtrer par catégorie" onClick={() => setShowFilters((value) => !value)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
            </button>
          </div>
          {showFilters && (
            <div className="category-filter-menu">
              <button className={!selectedCategoryId ? "selected" : ""} onClick={() => { setSelectedCategoryId(""); setShowFilters(false); }}>Toutes les catégories</button>
              {categories.map((category) => (
                <button key={category.id} className={selectedCategoryId === category.id ? "selected" : ""} onClick={() => { setSelectedCategoryId(category.id); setShowFilters(false); }}>{category.nom}</button>
              ))}
              {canEdit && <button className="menu-create-action" onClick={() => { setShowFilters(false); setShowCategoryForm(true); }}>+ Ajouter une catégorie</button>}
              {canEdit && selectedCustomCategory && <button className="menu-danger-action" onClick={() => { setShowFilters(false); void removeCategory(selectedCustomCategory); }}>Supprimer cette catégorie</button>}
            </div>
          )}
        </div>

        <div className="library-folder-row">
          <select value={selectedFolderId} onChange={(event) => setSelectedFolderId(event.target.value)}>
            <option value="">Tous les chants</option>
            {folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.nom}</option>)}
          </select>
          {canEdit && <button className="library-mini-action" onClick={() => setShowFolderForm((value) => !value)}>+ Dossier</button>}
          {canEdit && selectedFolder && !selectedFolder.temporary && (
            <button className="library-icon-danger" aria-label="Supprimer le dossier" disabled={busy === `folder-${selectedFolder.id}`} onClick={() => void removeFolder(selectedFolder)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>
            </button>
          )}
        </div>

        {selectedCategoryId && <div className="active-library-filter">Catégorie : <strong>{categoryLabel(selectedCategoryId, categories)}</strong><button onClick={() => setSelectedCategoryId("")}>×</button></div>}

        {showFolderForm && canEdit && (
          <div className="inline-admin-form compact-inline-form">
            <input value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="Nom du dossier" />
            <button disabled={busy === "folder" || !newFolder.trim()} onClick={() => void addFolder()}>Créer</button>
          </div>
        )}

        {showCategoryForm && canEdit && (
          <div className="modal-backdrop" onClick={() => setShowCategoryForm(false)}>
            <div className="admin-modal compact-dialog" onClick={(event) => event.stopPropagation()}>
              <div className="modal-title-row"><h2>Nouvelle catégorie</h2><button onClick={() => setShowCategoryForm(false)}>×</button></div>
              <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="Ex. Concert, Mariage…" />
              <div className="modal-actions"><button onClick={() => setShowCategoryForm(false)}>Annuler</button><button className="primary" disabled={!newCategory.trim() || busy === "category"} onClick={() => void addCategory()}>Créer</button></div>
            </div>
          </div>
        )}

        {notice && <p className="notice compact-notice">{notice}</p>}

        <div className="compact-list song-list-ultra-compact">
          {visibleSongs.length === 0 && <div className="empty-panel">Aucun chant ne correspond à ces critères.</div>}
          {visibleSongs.map((song) => {
            const voiceAudioCount = Object.values(song.audioUrlsByPupitre || {}).filter(Boolean).length;
            const legacyGeneralAudio = voiceAudioCount === 0 ? song.audioUrl || "" : "";
            const audioCount = voiceAudioCount || (legacyGeneralAudio ? 1 : 0);
            const isOpen = openId === song.id;
            const labels = (song.categoryIds || []).map((id) => categoryLabel(id, categories));
            return (
              <article className="song-card song-card-compact" key={song.id}>
                <button className="song-summary song-summary-button" onClick={() => setOpenId(isOpen ? null : song.id)}>
                  <div className="song-icon-tile">♫</div>
                  <div className="song-summary-copy">
                    <h3>{song.titre}</h3>
                    <small>{song.compositeur || "Compositeur non renseigné"}</small>
                    {labels.length > 0 && <p className="song-category-line">{labels.join(" · ")}</p>}
                  </div>
                  <span className="song-resource-count">{song.partitionUrl ? "PDF" : "—"} · {audioCount}/4</span>
                  <span className="chevron">{isOpen ? "⌃" : "⌄"}</span>
                </button>

                {isOpen && (
                  <div className="song-details song-details-compact">
                    <div className="resource-row resource-row-v2">
                      {song.partitionUrl && <button onClick={() => setViewer({ url: song.partitionUrl!, type: song.partitionType || "link", title: song.titre })}>Voir la partition</button>}
                      {song.youtubeUrl && <a href={song.youtubeUrl} target="_blank" rel="noreferrer">Voir la vidéo</a>}
                      {canEdit && <button onClick={() => setForm(songToDraft(song))}>Modifier</button>}
                      {canEdit && <button className="danger-text" disabled={busy === `delete-${song.id}`} onClick={() => void removeSong(song)}>Supprimer</button>}
                    </div>
                    <div className="voice-audio-grid compact-audio-grid">
                      {legacyGeneralAudio && (
                        <div className="voice-audio-card has-audio">
                          <div className="voice-audio-heading"><div><strong>Audio général</strong><small>Audio disponible</small></div>
                            <button className="audio-download-icon" aria-label="Télécharger l'audio général" title="Télécharger l'audio général" onClick={() => void saveUrlAsFile(legacyGeneralAudio, `${safeName(song.titre)}_general.${extensionFromUrl(legacyGeneralAudio)}`)}><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14" /></svg></button>
                          </div>
                          <audio controls preload="metadata" src={legacyGeneralAudio} />
                        </div>
                      )}
                      {voices.map(([key, label]) => {
                        const url = song.audioUrlsByPupitre?.[key];
                        return (
                          <div key={key} className={`voice-audio-card ${url ? "has-audio" : ""}`}>
                            <div className="voice-audio-heading"><div><strong>{label}</strong><small>{url ? "Audio disponible" : "Pas d'audio"}</small></div>
                              {url && <button className="audio-download-icon" aria-label={`Télécharger ${label}`} title={`Télécharger ${label}`} onClick={() => void saveUrlAsFile(url, `${safeName(song.titre)}_${key}.${extensionFromUrl(url)}`)}><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14" /></svg></button>}
                            </div>
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

        {canEdit && <button className="floating-round-action library-add-fab" aria-label="Ajouter un chant" onClick={() => setForm(emptyDraft())}>+</button>}
      </section>

      {viewer && <UniversalPartitionViewer resource={viewer} onClose={() => setViewer(null)} />}

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <div className="admin-modal song-editor-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title-row"><div><span className="section-kicker">BIBLIOTHÈQUE</span><h2>{form.id ? "Modifier le chant" : "Nouveau chant"}</h2></div><button onClick={() => setForm(null)}>×</button></div>
            <div className="song-editor-grid">
              <label>Titre<input value={form.titre} onChange={(event) => setForm({ ...form, titre: event.target.value })} /></label>
              <label>Compositeur<input value={form.compositeur} onChange={(event) => setForm({ ...form, compositeur: event.target.value })} /></label>
              <label>Dossier<select value={form.folderId} onChange={(event) => setForm({ ...form, folderId: event.target.value })}><option value="">Sans dossier</option>{permanentFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.nom}</option>)}</select></label>
              <label className="toggle-line"><input type="checkbox" checked={form.appris} onChange={(event) => setForm({ ...form, appris: event.target.checked })} /> Chant appris</label>

              <fieldset className="category-checkbox-field full-span">
                <legend>Catégories</legend>
                <div>{categories.map((category) => <label key={category.id}><input type="checkbox" checked={form.categoryIds.includes(category.id)} onChange={() => setForm({ ...form, categoryIds: form.categoryIds.includes(category.id) ? form.categoryIds.filter((id) => id !== category.id) : [...form.categoryIds, category.id] })} />{category.nom}</label>)}</div>
              </fieldset>

              <label className="full-span">Vidéo YouTube<input value={form.youtubeUrl} onChange={(event) => setForm({ ...form, youtubeUrl: event.target.value })} placeholder="https://…" /></label>

              <div className="editor-section full-span">
                <div className="editor-section-head"><div><h3>Partition</h3><p>PDF, image ou lien externe.</p></div></div>
                <input value={form.partitionUrl} onChange={(event) => setForm({ ...form, partitionUrl: event.target.value, partitionType: "link" })} placeholder="Coller un lien vers la partition" />
                <label className="file-action">Importer un fichier<input type="file" accept="application/pdf,image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPartition(file); event.currentTarget.value = ""; }} /></label>
                {form.partitionUrl && <small className="upload-ok">Partition prête ✓</small>}
              </div>

              <div className="editor-section full-span">
                <div className="editor-section-head"><div><h3>Audios par pupitre</h3><p>Ajoute un lien, importe un fichier ou enregistre directement.</p></div></div>
                <div className="voice-editor-grid">
                  {voices.map(([key, label]) => (
                    <div className="voice-editor-card" key={key}>
                      <strong>{label}</strong>
                      <input value={form.audioUrlsByPupitre[key] || ""} onChange={(event) => setForm({ ...form, audioUrlsByPupitre: { ...form.audioUrlsByPupitre, [key]: event.target.value }, audioFilesByPupitre: { ...form.audioFilesByPupitre, [key]: false } })} placeholder="Lien audio" />
                      {form.audioUrlsByPupitre[key] && <audio controls preload="metadata" src={form.audioUrlsByPupitre[key]} />}
                      <div className="voice-editor-actions">
                        <label className="file-action">Importer<input type="file" accept="audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadVoiceFile(key, file, file.name); event.currentTarget.value = ""; }} /></label>
                        {recordingVoice === key ? <button className="record-stop" onClick={stopRecording}>■ Arrêter</button> : <button disabled={Boolean(recordingVoice)} onClick={() => void startRecording(key)}>● Enregistrer</button>}
                        {form.audioUrlsByPupitre[key] && <button onClick={() => setForm({ ...form, audioUrlsByPupitre: { ...form.audioUrlsByPupitre, [key]: "" }, audioFilesByPupitre: { ...form.audioFilesByPupitre, [key]: false } })}>Retirer</button>}
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

function UniversalPartitionViewer({
  resource,
  onClose
}: {
  resource: { url: string; type: string; title: string };
  onClose: () => void;
}) {
  const [state, setState] = useState<{ kind: "loading" | "pdf" | "image" | "external" | "error"; data?: ArrayBuffer; imageUrl?: string }>({ kind: "loading" });
  const [scale, setScale] = useState(1);
  const gestureRef = useRef<{ pointers: Map<number, { x: number; y: number }>; distance: number; startScale: number }>({ pointers: new Map(), distance: 0, startScale: 1 });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setState({ kind: "loading" });
    setScale(1);
    void fetch(resource.url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer.slice(0, 5));
        const signature = String.fromCharCode(...bytes);
        const cleanUrl = decodeURIComponent(resource.url.split("?")[0] || "").toLowerCase();
        const isPdf = signature.startsWith("%PDF") || resource.type.toLowerCase() === "pdf" || cleanUrl.endsWith(".pdf");
        if (cancelled) return;
        if (isPdf) setState({ kind: "pdf", data: buffer });
        else {
          const blob = new Blob([buffer]);
          objectUrl = URL.createObjectURL(blob);
          setState({ kind: "image", imageUrl: objectUrl });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "external" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resource.type, resource.url]);

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    gestureRef.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (gestureRef.current.pointers.size === 2) {
      const [a, b] = [...gestureRef.current.pointers.values()];
      gestureRef.current.distance = Math.hypot(a.x - b.x, a.y - b.y);
      gestureRef.current.startScale = scale;
    }
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!gestureRef.current.pointers.has(event.pointerId)) return;
    gestureRef.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gestureRef.current.pointers.size === 2 && gestureRef.current.distance > 0) {
      const [a, b] = [...gestureRef.current.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      setScale(Math.max(0.7, Math.min(3.5, gestureRef.current.startScale * distance / gestureRef.current.distance)));
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    gestureRef.current.pointers.delete(event.pointerId);
    if (gestureRef.current.pointers.size < 2) gestureRef.current.distance = 0;
  }

  return (
    <div className="modal-backdrop partition-modal-backdrop" onClick={onClose}>
      <div className="viewer-modal zoom-viewer-modal" onClick={(event) => event.stopPropagation()}>
        <div className="viewer-header"><h2>{resource.title}</h2><button onClick={onClose}>×</button></div>
        <div className="zoom-toolbar">
          <button onClick={() => setScale((value) => Math.max(0.7, value - 0.2))}>−</button>
          <button onClick={() => setScale(1)}>{Math.round(scale * 100)} %</button>
          <button onClick={() => setScale((value) => Math.min(3.5, value + 0.2))}>+</button>
        </div>
        <div className="partition-scroll-stage" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
          {state.kind === "loading" && <p className="viewer-status">Chargement de la partition…</p>}
          {state.kind === "pdf" && state.data && <PdfPages data={state.data} scale={scale} />}
          {state.kind === "image" && state.imageUrl && <img className="zoomable-partition-image" style={{ width: `${scale * 100}%` }} src={state.imageUrl} alt={resource.title} draggable={false} />}
          {state.kind === "external" && <iframe src={resource.url} title={resource.title} style={{ width: `${Math.max(100, scale * 100)}%`, height: `${Math.max(100, scale * 100)}%` }} />}
        </div>
        <a className="secondary-button viewer-open-link" href={resource.url} target="_blank" rel="noreferrer">Ouvrir dans un nouvel onglet</a>
      </div>
    </div>
  );
}

function PdfPages({ data, scale }: { data: ArrayBuffer; scale: number }) {
  const [documentProxy, setDocumentProxy] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const task = pdfjsLib.getDocument({ data: data.slice(0) });
    void task.promise.then((pdf) => { if (!cancelled) setDocumentProxy(pdf); }).catch(() => { if (!cancelled) setError("Impossible d'afficher ce PDF dans le lecteur intégré."); });
    return () => { cancelled = true; void task.destroy(); };
  }, [data]);

  if (error) return <p className="viewer-status">{error}</p>;
  if (!documentProxy) return <p className="viewer-status">Préparation du PDF…</p>;
  return <div className="pdf-page-stack">{Array.from({ length: documentProxy.numPages }, (_, index) => <PdfPage key={index + 1} pdf={documentProxy} pageNumber={index + 1} scale={scale} />)}</div>;
}

function PdfPage({ pdf, pageNumber, scale }: { pdf: pdfjsLib.PDFDocumentProxy; pageNumber: number; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let renderTask: pdfjsLib.RenderTask | null = null;
    let cancelled = false;
    void pdf.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: Math.max(0.7, scale) * 1.25 });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      renderTask = page.render({ canvasContext: context, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      return renderTask.promise;
    }).catch(() => undefined);
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pageNumber, pdf, scale]);
  return <canvas ref={canvasRef} className="pdf-page-canvas" />;
}
