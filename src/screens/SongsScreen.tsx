import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
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

const MUSIC_RECORDING_BITRATE = 192_000;

function highQualityAudioConstraints(): MediaStreamConstraints {
  return {
    audio: {
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48_000 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  };
}

function createHighQualityRecorder(stream: MediaStream, bitrate = MUSIC_RECORDING_BITRATE) {
  const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
  try {
    return new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: bitrate
    });
  } catch {
    return new MediaRecorder(stream);
  }
}

function recordedAudioExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
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


type CachedSongAudio = {
  url: string;
  blob: Blob;
  cachedAt: number;
};

const SONG_AUDIO_CACHE_DB = "lumina-song-audio-cache-v1";
const SONG_AUDIO_CACHE_STORE = "audios";
const SONG_AUDIO_CACHE_MAX_FILES = 40;
let songAudioDbPromise: Promise<IDBDatabase | null> | null = null;

function openSongAudioCache(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  if (songAudioDbPromise) return songAudioDbPromise;

  songAudioDbPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(SONG_AUDIO_CACHE_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SONG_AUDIO_CACHE_STORE)) {
        const store = db.createObjectStore(SONG_AUDIO_CACHE_STORE, { keyPath: "url" });
        store.createIndex("cachedAt", "cachedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return songAudioDbPromise;
}

async function readCachedSongAudio(url: string): Promise<Blob | null> {
  const db = await openSongAudioCache();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SONG_AUDIO_CACHE_STORE, "readonly");
      const request = tx.objectStore(SONG_AUDIO_CACHE_STORE).get(url);
      request.onsuccess = () => {
        const record = request.result as CachedSongAudio | undefined;
        resolve(record?.blob instanceof Blob ? record.blob : null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function trimSongAudioCache(db: IDBDatabase) {
  try {
    const count = await new Promise<number>((resolve) => {
      const tx = db.transaction(SONG_AUDIO_CACHE_STORE, "readonly");
      const request = tx.objectStore(SONG_AUDIO_CACHE_STORE).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });

    const excess = count - SONG_AUDIO_CACHE_MAX_FILES;
    if (excess <= 0) return;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(SONG_AUDIO_CACHE_STORE, "readwrite");
      const index = tx.objectStore(SONG_AUDIO_CACHE_STORE).index("cachedAt");
      const cursorRequest = index.openKeyCursor();
      let remaining = excess;

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || remaining <= 0) return;
        tx.objectStore(SONG_AUDIO_CACHE_STORE).delete(cursor.primaryKey);
        remaining -= 1;
        cursor.continue();
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Le cache est une optimisation : une erreur ne doit jamais gêner la lecture.
  }
}

async function cacheSongAudioInBackground(url: string) {
  try {
    const db = await openSongAudioCache();
    if (!db) return;

    const alreadyCached = await readCachedSongAudio(url);
    if (alreadyCached) return;

    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return;

    const blob = await response.blob();
    if (!blob.size) return;

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(SONG_AUDIO_CACHE_STORE, "readwrite");
        tx.objectStore(SONG_AUDIO_CACHE_STORE).put({
          url,
          blob,
          cachedAt: Date.now()
        } satisfies CachedSongAudio);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });

    await trimSongAudioCache(db);
  } catch {
    // Firebase/CORS/quota : on garde simplement la lecture en streaming.
  }
}

let activeSongVoiceElement: HTMLAudioElement | null = null;

function formatSongVoiceTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const total = Math.floor(safe);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function SongVoicePlayer({ src, label }: { src: string; label: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const localObjectUrlRef = useRef<string | null>(null);
  const userStartedRef = useRef(false);
  const cacheStartedRef = useRef(false);

  const [activated, setActivated] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const [cached, setCached] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let cancelled = false;
    userStartedRef.current = false;
    cacheStartedRef.current = false;
    setActivated(false);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    setSpeed(1);
    setFailed(false);
    setCached(false);

    if (localObjectUrlRef.current) {
      URL.revokeObjectURL(localObjectUrlRef.current);
      localObjectUrlRef.current = null;
    }

    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    const syncDuration = () => {
      setPosition(audio.currentTime || 0);
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      setFailed(false);
    };

    const syncPosition = () => setPosition(audio.currentTime || 0);

    const onPlay = () => {
      if (activeSongVoiceElement && activeSongVoiceElement !== audio) {
        activeSongVoiceElement.pause();
      }
      activeSongVoiceElement = audio;
      setPlaying(true);
    };

    const onPause = () => setPlaying(false);

    const onEnded = () => {
      setPlaying(false);
      setPosition(0);
      audio.currentTime = 0;
      if (activeSongVoiceElement === audio) activeSongVoiceElement = null;
    };

    const onError = () => {
      setFailed(true);
      setPlaying(false);
      if (activeSongVoiceElement === audio) activeSongVoiceElement = null;
    };

    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("durationchange", syncDuration);
    audio.addEventListener("timeupdate", syncPosition);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    // WhatsApp-like : si cet audio a déjà été écouté, on récupère sa copie
    // locale dès l'ouverture de la fiche. Aucun son ne démarre automatiquement.
    void readCachedSongAudio(src).then((blob) => {
      if (cancelled || userStartedRef.current || !blob || !audioRef.current) return;

      const objectUrl = URL.createObjectURL(blob);
      localObjectUrlRef.current = objectUrl;
      audio.src = objectUrl;
      audio.preload = "metadata";
      audio.load();
      setActivated(true);
      setCached(true);
    });

    return () => {
      cancelled = true;
      audio.pause();
      if (activeSongVoiceElement === audio) activeSongVoiceElement = null;
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("durationchange", syncDuration);
      audio.removeEventListener("timeupdate", syncPosition);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeAttribute("src");
      audio.load();

      if (localObjectUrlRef.current) {
        URL.revokeObjectURL(localObjectUrlRef.current);
        localObjectUrlRef.current = null;
      }
    };
  }, [src]);

  function startFromUserAction() {
    const audio = audioRef.current;
    if (!audio) return;

    userStartedRef.current = true;

    if (!activated || failed || !audio.getAttribute("src")) {
      setActivated(true);
      setFailed(false);
      setPosition(0);
      setDuration(0);
      audio.src = src;
      audio.preload = "metadata";
      audio.load();
    }

    // La première lecture part tout de suite en streaming. En parallèle seulement,
    // on sauvegarde le fichier pour rendre les lectures suivantes quasi instantanées.
    if (!cached && !cacheStartedRef.current) {
      cacheStartedRef.current = true;
      void cacheSongAudioInBackground(src).then(() => setCached(true));
    }

    audio.playbackRate = speed;
    void audio.play().catch(() => {
      setFailed(true);
      setPlaying(false);
    });
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (!activated || failed || audio.paused) {
      startFromUserAction();
    } else {
      audio.pause();
    }
  }

  function cycleSpeed() {
    const audio = audioRef.current;
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audio && activated) audio.playbackRate = next;
  }

  const progressPercent = duration > 0
    ? Math.max(0, Math.min(100, (position / duration) * 100))
    : 0;

  return (
    <div className={`song-voice-player${failed ? " failed" : ""}`}>
      <audio ref={audioRef} preload="none" />

      <button
        className="song-voice-play"
        type="button"
        onClick={togglePlayback}
        aria-label={playing ? "Pause" : `Lire ${label}`}
      >
        {failed ? "↻" : playing ? "❚❚" : "▶"}
      </button>

      <div className="song-voice-main">
        <div className="song-voice-title-row">
          <strong>{label}</strong>
          <small>
            {failed
              ? "Réessayer"
              : `${formatSongVoiceTime(activated ? position : 0)} / ${activated && duration > 0 ? formatSongVoiceTime(duration) : "--:--"}`}
          </small>
        </div>

        <input
          className="song-voice-range"
          type="range"
          min={0}
          max={Math.max(duration, 1)}
          step={0.1}
          value={activated && duration > 0 ? Math.min(position, duration) : 0}
          disabled={!activated || failed || duration <= 0}
          style={{ "--progress": `${progressPercent}%` } as CSSProperties}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            setPosition(next);
            if (audioRef.current) audioRef.current.currentTime = next;
          }}
          aria-label={`Position de lecture de ${label}`}
        />
      </div>

      <button
        className="song-voice-speed"
        type="button"
        onClick={cycleSpeed}
        disabled={failed}
        aria-label={`Vitesse de lecture ${label}`}
      >
        {speed === 1.5 ? "1,5×" : `${speed}×`}
      </button>
    </div>
  );
}

function normalizeFolderName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("fr")
    .replace(/\s+/g, " ");
}

export function SongsScreen({
  songs,
  folders,
  categories,
  canEdit,
  uid,
  initialSongId,
  onInitialSongOpened
}: {
  songs: Song[];
  folders: Folder[];
  categories: SongCategory[];
  canEdit: boolean;
  uid: string;
  initialSongId?: string | null;
  onInitialSongOpened?: () => void;
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
  const [folderToRename, setFolderToRename] = useState<Folder | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState("");
  const folderRepairRunningRef = useRef(false);
  const [newCategory, setNewCategory] = useState("");
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [recordingVoice, setRecordingVoice] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!initialSongId || !songs.some((song) => song.id === initialSongId)) return;
    setSelectedFolderId("");
    setSelectedCategoryId("");
    setSearch("");
    setOpenId(initialSongId);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById(`song-${initialSongId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    onInitialSongOpened?.();
  }, [initialSongId, songs, onInitialSongOpened]);


  useEffect(() => {
    if (!canEdit || folderRepairRunningRef.current) return;

    const permanent = folders.filter((folder) => !folder.temporary);
    const groupedFolders = new Map<string, Folder[]>();
    for (const folder of permanent) {
      const key = normalizeFolderName(folder.nom);
      groupedFolders.set(key, [...(groupedFolders.get(key) || []), folder]);
    }
    const duplicateGroups = [...groupedFolders.values()].filter((group) => group.length > 1);

    if (!duplicateGroups.length) return;

    folderRepairRunningRef.current = true;
    void (async () => {
      try {
        for (const group of duplicateGroups) {
          const ordered = [...group].sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || Number.MAX_SAFE_INTEGER;
            const bTime = b.createdAt?.toMillis?.() || Number.MAX_SAFE_INTEGER;
            return aTime - bTime || a.id.localeCompare(b.id);
          });
          const primary = ordered[0];
          const duplicates = ordered.slice(1);
          const mergedSongIds = new Set(primary.songIds || []);

          for (const duplicate of duplicates) {
            (duplicate.songIds || []).forEach((id) => mergedSongIds.add(id));
            const batch = writeBatch(db);
            songs
              .filter((song) => song.folderId === duplicate.id)
              .forEach((song) => batch.update(doc(db, "songs", song.id), { folderId: primary.id }));
            batch.delete(doc(db, "folders", duplicate.id));
            batch.set(doc(db, "folders", primary.id), { songIds: [...mergedSongIds] }, { merge: true });
            await batch.commit();
          }

          if (selectedFolderId && duplicates.some((folder) => folder.id === selectedFolderId)) {
            setSelectedFolderId(primary.id);
          }
        }
      } catch (error) {
        console.error("Réparation des dossiers en double impossible", error);
      } finally {
        folderRepairRunningRef.current = false;
      }
    })();
  }, [canEdit, folders, songs, selectedFolderId]);

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId);
  const visibleSongs = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("fr");

    const folderSongs = !selectedFolderId
      ? [...songs]
      : selectedFolder?.temporary
        ? (selectedFolder.songIds || [])
            .map((songId) => songs.find((song) => song.id === songId))
            .filter((song): song is Song => Boolean(song))
        : songs.filter((song) =>
            song.folderId === selectedFolderId || (selectedFolder?.songIds || []).includes(song.id)
          );

    const filtered = folderSongs
      .filter((song) => !selectedCategoryId || (song.categoryIds || []).includes(selectedCategoryId))
      .filter((song) => !normalized || `${song.titre} ${song.compositeur || ""}`.toLocaleLowerCase("fr").includes(normalized));

    return selectedFolder?.temporary
      ? filtered
      : filtered.sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
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
    if (folders.some((folder) => !folder.temporary && normalizeFolderName(folder.nom) === normalizeFolderName(nom))) {
      setNotice("Un dossier porte déjà ce nom.");
      return;
    }
    setBusy("folder");
    try {
      const ref = await addDoc(collection(db, "folders"), {
        nom,
        temporary: false,
        eventId: "",
        songIds: [],
        categoryIds: [],
        createdAt: serverTimestamp()
      });
      setSelectedFolderId(ref.id);
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

  async function renameFolder() {
    if (!folderToRename || folderToRename.temporary) return;
    const nom = folderRenameValue.trim();
    if (!nom) return;
    if (folders.some((folder) =>
      !folder.temporary &&
      folder.id !== folderToRename.id &&
      normalizeFolderName(folder.nom) === normalizeFolderName(nom)
    )) {
      setNotice("Un dossier porte déjà ce nom.");
      return;
    }

    setBusy(`folder-rename-${folderToRename.id}`);
    try {
      await updateDoc(doc(db, "folders", folderToRename.id), { nom });
      setFolderToRename(null);
      setFolderRenameValue("");
      setNotice("Dossier renommé.");
    } catch (error) {
      console.error(error);
      setNotice("Impossible de renommer le dossier.");
    } finally {
      setBusy("");
    }
  }

  async function duplicateFolder(folder: Folder) {
    if (folder.temporary) return;
    setBusy(`folder-copy-${folder.id}`);
    try {
      const usedNames = new Set(
        folders.filter((item) => !item.temporary).map((item) => normalizeFolderName(item.nom))
      );
      const base = `${folder.nom.trim()} - copie`;
      let nom = base;
      let suffix = 2;
      while (usedNames.has(normalizeFolderName(nom))) {
        nom = `${base} ${suffix}`;
        suffix += 1;
      }

      const linkedSongIds = [...new Set([
        ...(folder.songIds || []),
        ...songs.filter((song) => song.folderId === folder.id).map((song) => song.id)
      ])];

      const ref = await addDoc(collection(db, "folders"), {
        nom,
        temporary: false,
        eventId: "",
        songIds: linkedSongIds,
        categoryIds: [],
        createdAt: serverTimestamp()
      });
      setSelectedFolderId(ref.id);
      setNotice(`Dossier dupliqué : ${nom}`);
    } catch (error) {
      console.error(error);
      setNotice("Impossible de dupliquer le dossier.");
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
      const stream = await navigator.mediaDevices.getUserMedia(highQualityAudioConstraints());
      const recorder = createHighQualityRecorder(stream);
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
        void uploadVoiceFile(voice, blob, `enregistrement_${Date.now()}.${recordedAudioExtension(blob.type)}`);
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
            <>
              <button
                className="library-icon-action"
                aria-label="Renommer le dossier"
                title="Renommer"
                onClick={() => {
                  setFolderToRename(selectedFolder);
                  setFolderRenameValue(selectedFolder.nom);
                }}
              >
                ✎
              </button>
              <button
                className="library-icon-action"
                aria-label="Dupliquer le dossier"
                title="Dupliquer"
                disabled={busy === `folder-copy-${selectedFolder.id}`}
                onClick={() => void duplicateFolder(selectedFolder)}
              >
                ⧉
              </button>
              <button className="library-icon-danger" aria-label="Supprimer le dossier" disabled={busy === `folder-${selectedFolder.id}`} onClick={() => void removeFolder(selectedFolder)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>
              </button>
            </>
          )}
        </div>

        {selectedCategoryId && <div className="active-library-filter">Catégorie : <strong>{categoryLabel(selectedCategoryId, categories)}</strong><button onClick={() => setSelectedCategoryId("")}>×</button></div>}

        {showFolderForm && canEdit && (
          <div className="inline-admin-form compact-inline-form">
            <input value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="Nom du dossier" />
            <button disabled={busy === "folder" || !newFolder.trim()} onClick={() => void addFolder()}>Créer</button>
          </div>
        )}

        {folderToRename && canEdit && (
          <div className="modal-backdrop" onClick={() => setFolderToRename(null)}>
            <div className="admin-modal compact-dialog" onClick={(event) => event.stopPropagation()}>
              <div className="modal-title-row">
                <h2>Renommer le dossier</h2>
                <button onClick={() => setFolderToRename(null)}>×</button>
              </div>
              <input
                value={folderRenameValue}
                onChange={(event) => setFolderRenameValue(event.target.value)}
                placeholder="Nom du dossier"
                autoFocus
              />
              <div className="modal-actions">
                <button onClick={() => setFolderToRename(null)}>Annuler</button>
                <button
                  className="primary"
                  disabled={
                    !folderRenameValue.trim() ||
                    folderRenameValue.trim() === folderToRename.nom.trim() ||
                    busy === `folder-rename-${folderToRename.id}`
                  }
                  onClick={() => void renameFolder()}
                >
                  Renommer
                </button>
              </div>
            </div>
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
              <article className="song-card song-card-compact" key={song.id} id={`song-${song.id}`}>
                <button className="song-summary song-summary-button" onClick={() => setOpenId(isOpen ? null : song.id)}>
                  <div className="song-icon-tile" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M10 17V5l9-2v12" />
                      <circle cx="7" cy="17" r="2.5" />
                      <circle cx="16" cy="15" r="2.5" />
                      <path d="M10 8l9-2" />
                    </svg>
                  </div>
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
                          <SongVoicePlayer src={legacyGeneralAudio} label="Audio général" />
                        </div>
                      )}
                      {voices.map(([key, label]) => {
                        const url = song.audioUrlsByPupitre?.[key];
                        return (
                          <div key={key} className={`voice-audio-card ${url ? "has-audio" : ""}`}>
                            <div className="voice-audio-heading"><div><strong>{label}</strong><small>{url ? "Audio disponible" : "Pas d'audio"}</small></div>
                              {url && <button className="audio-download-icon" aria-label={`Télécharger ${label}`} title={`Télécharger ${label}`} onClick={() => void saveUrlAsFile(url, `${safeName(song.titre)}_${key}.${extensionFromUrl(url)}`)}><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14" /></svg></button>}
                            </div>
                            {url && <SongVoicePlayer src={url} label={label} />}
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
                  {voices.map(([key, label]) => {
                    const currentAudio = form.audioUrlsByPupitre[key] || "";
                    const isRecordingThisVoice = recordingVoice === key;
                    return (
                      <div className="voice-editor-card voice-editor-card-v2" key={key}>
                        <div className="voice-editor-heading">
                          <strong>{label}</strong>
                          {currentAudio && (
                            <button
                              type="button"
                              className="voice-remove-button"
                              onClick={() => setForm({
                                ...form,
                                audioUrlsByPupitre: { ...form.audioUrlsByPupitre, [key]: "" },
                                audioFilesByPupitre: { ...form.audioFilesByPupitre, [key]: false }
                              })}
                            >
                              Retirer
                            </button>
                          )}
                        </div>

                        {currentAudio && <SongVoicePlayer src={currentAudio} label={label} />}

                        {isRecordingThisVoice ? (
                          <div className="song-recording-bar">
                            <span className="recording-dot" aria-hidden="true" />
                            <span>Enregistrement en cours…</span>
                            <button type="button" onClick={stopRecording} aria-label={`Arrêter l'enregistrement ${label}`}>■</button>
                          </div>
                        ) : (
                          <div className="song-record-actions">
                            <button
                              type="button"
                              className="song-mic-button"
                              disabled={Boolean(recordingVoice)}
                              onClick={() => void startRecording(key)}
                            >
                              <span aria-hidden="true">🎤</span>
                              <span>Enregistrer</span>
                            </button>
                            <label className="song-import-button">
                              Importer
                              <input
                                type="file"
                                accept="audio/*"
                                hidden
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  if (file) void uploadVoiceFile(key, file, file.name);
                                  event.currentTarget.value = "";
                                }}
                              />
                            </label>
                          </div>
                        )}

                        <details className="song-audio-link">
                          <summary>Ajouter ou modifier un lien audio</summary>
                          <input
                            value={form.audioFilesByPupitre[key] ? "" : currentAudio}
                            onChange={(event) => setForm({
                              ...form,
                              audioUrlsByPupitre: { ...form.audioUrlsByPupitre, [key]: event.target.value },
                              audioFilesByPupitre: { ...form.audioFilesByPupitre, [key]: false }
                            })}
                            placeholder="https://…"
                          />
                        </details>
                      </div>
                    );
                  })}
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
