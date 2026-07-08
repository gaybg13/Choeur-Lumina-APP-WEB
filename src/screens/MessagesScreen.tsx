import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { Header } from "../components/Header";
import type { GroupMessage, Member } from "../types/models";

const stickers = ["👏", "❤️", "😂", "🙏", "🎶", "🔥", "😍", "👍", "🙌", "✨", "🎤", "🎵"];

export function MessagesScreen({
  uid,
  member
}: {
  uid: string;
  member: Member | null;
}) {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [text, setText] = useState(() => localStorage.getItem("lumina_group_draft") || "");
  const [showStickers, setShowStickers] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, "groupChat"), orderBy("timestamp", "asc"));
    return onSnapshot(q, (snap) => {
      setMessages(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GroupMessage, "id">) }))
      );
    });
  }, []);

  useEffect(() => {
    localStorage.setItem("lumina_group_draft", text);
  }, [text]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function sendMessage(type = "text", content = text) {
    const clean = content.trim();
    if (!clean) return;

    await addDoc(collection(db, "groupChat"), {
      authorUid: uid,
      authorName: member?.prenom || "Choriste",
      texte: clean,
      type,
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

    if (type === "text") {
      setText("");
      localStorage.removeItem("lumina_group_draft");
    }
  }

  const visibleMessages = useMemo(
    () => messages.filter((m) => !(m.hiddenFor || []).includes(uid)),
    [messages, uid]
  );

  return (
    <>
      <Header title="Messages" />
      <section className="messages-screen">
        <div className="message-tabs">
          <button className="active">Groupe</button>
          <button disabled>Privé <small>à compléter</small></button>
        </div>

        <div className="messages-list">
          {visibleMessages.map((message) => {
            const mine = message.authorUid === uid;
            return (
              <div className={`message-line ${mine ? "mine" : ""}`} key={message.id}>
                <div className={`bubble ${message.type === "event_cancelled" ? "alert-bubble" : ""}`}>
                  {!mine && <strong>{message.authorName}</strong>}
                  {message.type === "sticker" ? (
                    <span className="sticker-message">{message.texte}</span>
                  ) : (
                    <p>{message.deleted ? "Message supprimé" : message.texte}</p>
                  )}
                  <small>
                    {message.timestamp?.toDate().toLocaleTimeString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </small>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {showStickers && (
          <div className="sticker-tray">
            {stickers.map((sticker) => (
              <button key={sticker} onClick={() => sendMessage("sticker", sticker)}>{sticker}</button>
            ))}
          </div>
        )}

        <div className="composer">
          <button onClick={() => setShowStickers((v) => !v)}>☺</button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message"
            rows={1}
            autoCapitalize="sentences"
          />
          <button className="send-button" onClick={() => sendMessage()}>➤</button>
        </div>
      </section>
    </>
  );
}