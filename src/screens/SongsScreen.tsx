import { useState } from "react";
import { Header } from "../components/Header";
import type { Song } from "../types/models";

const voices = [
  ["soprano", "Soprano"],
  ["alto", "Alto"],
  ["tenor", "Ténor"],
  ["basse", "Basse"]
];

export function SongsScreen({ songs }: { songs: Song[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <Header title="Bibliothèque" />
      <section className="screen">
        <div className="intro-card">
          <h2>Bibliothèque musicale</h2>
          <p>Partitions, vidéos et audios par pupitre.</p>
        </div>

        <div className="compact-list">
          {songs.map((song) => {
            const audioCount = Object.values(song.audioUrlsByPupitre || {}).filter(Boolean).length;
            const isOpen = openId === song.id;
            return (
              <article className="song-card" key={song.id}>
                <div className="song-summary" onClick={() => setOpenId(isOpen ? null : song.id)}>
                  <div>
                    <h3>{song.titre}</h3>
                    <small>{song.compositeur}</small>
                    <p>
                      {song.partitionUrl ? "Partition ✓" : "Sans partition"} · {audioCount} audio{audioCount > 1 ? "s" : ""}
                    </p>
                  </div>
                  <span className={song.appris ? "status-ok" : "status-work"}>
                    {song.appris ? "Appris" : "À travailler"}
                  </span>
                </div>

                {isOpen && (
                  <div className="song-details">
                    <div className="resource-row">
                      {song.partitionUrl && (
                        <a href={song.partitionUrl} target="_blank" rel="noreferrer">Partition</a>
                      )}
                      {song.youtubeUrl && (
                        <a href={song.youtubeUrl} target="_blank" rel="noreferrer">Vidéo</a>
                      )}
                    </div>
                    {voices.map(([key, label]) => {
                      const url = song.audioUrlsByPupitre?.[key];
                      return url ? (
                        <div key={key} className="audio-row">
                          <span>{label}</span>
                          <audio controls preload="metadata" src={url} />
                        </div>
                      ) : null;
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}