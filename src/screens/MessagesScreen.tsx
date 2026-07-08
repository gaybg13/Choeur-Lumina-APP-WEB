import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteField,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  where
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "../lib/firebase";
import { Header } from "../components/Header";
import type {
  ConversationSummary,
  DirectMessage,
  GroupMessage,
  Member,
  UserStatus
} from "../types/models";

const stickers = ["👏", "❤️", "😂", "🙏", "🎶", "🔥", "😍", "👍", "🙌", "✨", "🎤", "🎵"];
const reactions = ["❤️", "👍", "👏", "😂", "🙏", "🔥"];

type ReplyDraft = {
  id: string;
  author: string;
  text: string;
};

type AnyMessage = GroupMessage | DirectMessage;

function conversationId(uid1: string, uid2: string) {
  return [uid1, uid2].sort().join("_");
}

function previewFor(type?: string, text?: string) {
  if (type === "voice") return "🎤 Note vocale";
  if (type === "image") return "📷 Image";
  if (type === "sticker") return `✨ ${text || "Sticker"}`;
  return text || "Message";
}

function formatTime(message: AnyMessage) {
  return message.timestamp?.toDate().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) || "";
}

function formatLastSeen(status?: UserStatus) {
  if (status?.online) return "En ligne";
  const date = status?.lastSeen?.toDate();
  if (!date) return "Hors ligne";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `Vu aujourd'hui à ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return `Vu le ${date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`;
}

export function MessagesScreen({
  uid,
  member,
  members
}: {
  uid: string;
  member: Member | null;
  members: Member[];
}) {
  const [mode, setMode] = useState<"group" | "private">("group");
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>([]);
  const [directMessages, setDirectMessages] = useState<DirectMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [statuses, setStatuses] = useState<Record<string, UserStatus>>({});
  const [privateTarget, setPrivateTarget] = useState<Member | null>(null);
  const [groupText, setGroupText] = useState(() => localStorage.getItem("lumina_group_draft") || "");
  const [directDrafts, setDirectDrafts] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("lumina_direct_drafts") || "{}"); } catch { return {}; }
  });
  const [showStickers, setShowStickers] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ReplyDraft | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupTypers, setGroupTypers] = useState<string[]>([]);
  const [directTyping, setDirectTyping] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState(0);
  const [pendingVoice, setPendingVoice] = useState<{ blob: Blob; url: string; durationMs: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);

  const otherMembers = useMemo(
    () => members.filter((m) => m.uid && m.uid !== uid && m.claimed !== false).sort((a, b) => `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, "fr")),
    [members, uid]
  );

  const activeMessages = mode === "group" ? groupMessages : directMessages;
  const visibleMessages = useMemo(
    () => activeMessages.filter((message) => !(message.hiddenFor || []).includes(uid)),
    [activeMessages, uid]
  );
  const activeText = mode === "group" ? groupText : (privateTarget ? directDrafts[privateTarget.uid] || "" : "");

  useEffect(() => {
    const q = query(collection(db, "groupChat"), orderBy("timestamp", "asc"));
    return onSnapshot(q, (snap) => {
      setGroupMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GroupMessage, "id">) })));
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, "conversations"), where("participants", "array-contains", uid));
    return onSnapshot(q, (snap) => {
      setConversations(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as ConversationSummary))
          );
    });
  }, [uid]);

  useEffect(() => onSnapshot(collection(db, "userStatus"), (snap) => {
    const next: Record<string, UserStatus> = {};
    snap.docs.forEach((d) => { next[d.id] = d.data() as UserStatus; });
    setStatuses(next);
  }), []);

  useEffect(() => onSnapshot(collection(db, "groupTyping"), (snap) => {
    const now = Date.now();
    const names = snap.docs.map((d) => {
      if (d.id === uid) return null;
      const data = d.data() as { name?: string; isTyping?: boolean; updatedAt?: { toDate: () => Date } };
      const updated = data.updatedAt?.toDate().getTime() || 0;
      return data.isTyping && now - updated < 6000 ? data.name || null : null;
    }).filter((value): value is string => Boolean(value));
    setGroupTypers(names);
  }), [uid]);

  useEffect(() => {
    if (!privateTarget) {
      setDirectMessages([]);
      setDirectTyping(false);
      return;
    }
    const convId = conversationId(uid, privateTarget.uid);
    const unMessages = onSnapshot(
      query(collection(db, "conversations", convId, "messages"), orderBy("timestamp", "asc")),
      (snap) => setDirectMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DirectMessage)))
    );
    const unTyping = onSnapshot(doc(db, "conversations", convId, "typing", privateTarget.uid), (snap) => {
      const data = snap.data() as { isTyping?: boolean; updatedAt?: { toDate: () => Date } } | undefined;
      const updated = data?.updatedAt?.toDate().getTime() || 0;
      setDirectTyping(Boolean(data?.isTyping && Date.now() - updated < 6000));
    });
    return () => { unMessages(); unTyping(); };
  }, [privateTarget, uid]);

  useEffect(() => {
    localStorage.setItem("lumina_group_draft", groupText);
  }, [groupText]);

  useEffect(() => {
    localStorage.setItem("lumina_direct_drafts", JSON.stringify(directDrafts));
  }, [directDrafts]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (mode === "group") {
        void setDoc(doc(db, "groupTyping", uid), {
          name: member?.prenom || "Choriste",
          isTyping: Boolean(groupText.trim()),
          updatedAt: serverTimestamp()
        }, { merge: true }).catch(() => undefined);
      } else if (privateTarget) {
        const convId = conversationId(uid, privateTarget.uid);
        void setDoc(doc(db, "conversations", convId, "typing", uid), {
          isTyping: Boolean((directDrafts[privateTarget.uid] || "").trim()),
          updatedAt: serverTimestamp()
        }, { merge: true }).catch(() => undefined);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [mode, groupText, directDrafts, privateTarget, uid, member?.prenom]);

  useEffect(() => {
    if (mode !== "group") return;
    const unread = groupMessages.filter((m) => m.authorUid !== uid && !(m.readBy || []).includes(uid));
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach((m) => batch.update(doc(db, "groupChat", m.id), "readBy", arrayUnion(uid)));
    void batch.commit().catch(() => undefined);
  }, [groupMessages, mode, uid]);

  useEffect(() => {
    if (mode !== "private" || !privateTarget || directMessages.length === 0) return;
    const convId = conversationId(uid, privateTarget.uid);
    const unread = directMessages.filter((m) => m.authorUid !== uid && !(m.readBy || []).includes(uid));
    const undelivered = directMessages.filter((m) => m.authorUid !== uid && !(m.deliveredBy || []).includes(uid));
    if (!unread.length && !undelivered.length) return;
    const batch = writeBatch(db);
    new Set([...unread, ...undelivered].map((m) => m.id)).forEach((id) => {
      const ref = doc(db, "conversations", convId, "messages", id);
      batch.update(ref, "deliveredBy", arrayUnion(uid), "readBy", arrayUnion(uid));
    });
    batch.update(doc(db, "conversations", convId), `unreadCounts.${uid}`, 0);
    void batch.commit().catch(() => undefined);
  }, [directMessages, mode, privateTarget, uid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages.length, mode, privateTarget?.uid]);

  function updateText(value: string) {
    if (mode === "group") setGroupText(value);
    else if (privateTarget) setDirectDrafts((drafts) => ({ ...drafts, [privateTarget.uid]: value }));
  }

  async function uploadBlob(blob: Blob, path: string) {
    const ref = storageRef(storage, path);
    await uploadBytes(ref, blob);
    return getDownloadURL(ref);
  }

  async function sendPayload({ type = "text", text = "", mediaUrl = "", durationMs = 0 }: { type?: string; text?: string; mediaUrl?: string; durationMs?: number }) {
    const clean = text.trim();
    if (type === "text" && !clean) return;
    const reply = replyingTo;
    setBusy("send");
    try {
      if (mode === "group") {
        await addDoc(collection(db, "groupChat"), {
          authorUid: uid,
          authorName: member?.prenom || "Choriste",
          texte: clean,
          type,
          mediaUrl,
          durationMs,
          timestamp: serverTimestamp(),
          editedAt: null,
          deleted: false,
          readBy: [uid],
          hiddenFor: [],
          reactions: {},
          replyToId: reply?.id || "",
          replyToText: reply?.text || "",
          replyToAuthor: reply?.author || ""
        });
        if (type === "text") setGroupText("");
      } else if (privateTarget) {
        const convId = conversationId(uid, privateTarget.uid);
        const convRef = doc(db, "conversations", convId);
        await setDoc(convRef, {
          participants: [uid, privateTarget.uid].sort(),
          lastMessage: previewFor(type, clean),
          lastTimestamp: serverTimestamp()
        }, { merge: true });
        await updateDoc(convRef, {
          [`unreadCounts.${privateTarget.uid}`]: increment(1),
          [`unreadCounts.${uid}`]: 0
        });
        await addDoc(collection(db, "conversations", convId, "messages"), {
          authorUid: uid,
          texte: clean,
          type,
          mediaUrl,
          durationMs,
          timestamp: serverTimestamp(),
          editedAt: null,
          deleted: false,
          readBy: [uid],
          deliveredBy: statuses[privateTarget.uid]?.online ? [uid, privateTarget.uid] : [uid],
          hiddenFor: [],
          reactions: {},
          replyToId: reply?.id || "",
          replyToText: reply?.text || "",
          replyToAuthor: reply?.author || ""
        });
        if (type === "text") setDirectDrafts((drafts) => ({ ...drafts, [privateTarget.uid]: "" }));
      }
      setReplyingTo(null);
      setShowStickers(false);
    } catch (error) {
      console.error(error);
      setNotice("Envoi impossible. Vérifie les autorisations Firebase.");
    } finally {
      setBusy("");
    }
  }

  async function handleImage(file: File) {
    setBusy("upload-image");
    try {
      const url = await uploadBlob(file, `chat_images/${uid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      await sendPayload({ type: "image", mediaUrl: url });
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'envoyer l'image. Vérifie les règles Storage.");
      setBusy("");
    }
  }

  async function startRecording() {
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
      recorder.ondataavailable = (event) => { if (event.data.size) recorderChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const durationMs = Date.now() - recordingStartedAt;
        const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        recorderStreamRef.current = null;
        setRecording(false);
        setPendingVoice({ blob, url, durationMs });
      };
      setRecordingStartedAt(Date.now());
      recorder.start();
      setRecording(true);
    } catch (error) {
      console.error(error);
      setNotice("Microphone non disponible ou autorisation refusée.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function sendPendingVoice() {
    if (!pendingVoice) return;
    setBusy("voice");
    try {
      const url = await uploadBlob(pendingVoice.blob, `voice_notes/${uid}/${Date.now()}.webm`);
      await sendPayload({ type: "voice", mediaUrl: url, durationMs: pendingVoice.durationMs });
      URL.revokeObjectURL(pendingVoice.url);
      setPendingVoice(null);
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'envoyer la note vocale. Vérifie les règles Storage.");
      setBusy("");
    }
  }

  function currentMessageRef(messageId: string) {
    if (mode === "group") return doc(db, "groupChat", messageId);
    if (!privateTarget) throw new Error("Aucune conversation sélectionnée");
    return doc(db, "conversations", conversationId(uid, privateTarget.uid), "messages", messageId);
  }

  async function react(messageId: string, emoji: string) {
    const message = activeMessages.find((m) => m.id === messageId);
    const current = message?.reactions?.[uid];
    try {
      await updateDoc(currentMessageRef(messageId), { [`reactions.${uid}`]: current === emoji ? deleteField() : emoji });
      setMenuId(null);
    } catch (error) {
      console.error(error);
      setNotice("Impossible d'ajouter la réaction.");
    }
  }

  async function editMessage(message: AnyMessage) {
    const next = window.prompt("Modifier le message", message.texte || "");
    if (next === null || !next.trim()) return;
    try {
      await updateDoc(currentMessageRef(message.id), { texte: next.trim(), editedAt: serverTimestamp() });
      setMenuId(null);
    } catch (error) {
      console.error(error);
      setNotice("Modification impossible.");
    }
  }

  async function deleteForEveryone(message: AnyMessage) {
    if (!window.confirm("Supprimer ce message pour tout le monde ?")) return;
    try {
      await updateDoc(currentMessageRef(message.id), {
        texte: "",
        mediaUrl: "",
        deleted: true,
        editedAt: serverTimestamp()
      });
      setMenuId(null);
    } catch (error) {
      console.error(error);
      setNotice("Suppression impossible.");
    }
  }

  async function hideForMe(ids: string[]) {
    if (!ids.length) return;
    try {
      const batch = writeBatch(db);
      ids.forEach((id) => batch.update(currentMessageRef(id), "hiddenFor", arrayUnion(uid)));
      await batch.commit();
      setSelectedIds(new Set());
      setMenuId(null);
    } catch (error) {
      console.error(error);
      setNotice("Suppression pour moi impossible.");
    }
  }

  function startReply(message: AnyMessage) {
    const author = message.authorUid === uid ? "Vous" : mode === "group"
      ? (message as GroupMessage).authorName || "Choriste"
      : privateTarget?.prenom || "Choriste";
    setReplyingTo({ id: message.id, author, text: previewFor(message.type, message.texte) });
    setMenuId(null);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setMenuId(null);
  }

  function selectPrivate(target: Member) {
    setPrivateTarget(target);
    setReplyingTo(null);
    setSelectedIds(new Set());
    setMenuId(null);
  }

  const privateUnreadTotal = conversations.reduce((sum, c) => sum + (c.unreadCounts?.[uid] || 0), 0);

  function unreadFor(targetUid: string) {
    const convId = conversationId(uid, targetUid);
    return conversations.find((c) => c.id === convId)?.unreadCounts?.[uid] || 0;
  }

  function conversationPreview(targetUid: string) {
    const convId = conversationId(uid, targetUid);
    return conversations.find((c) => c.id === convId);
  }

  return (
    <>
      <Header title="Messages" />
      <section className="messages-screen messages-v2-screen">
        <div className="message-tabs message-tabs-v2">
          <button className={mode === "group" ? "active" : ""} onClick={() => { setMode("group"); setReplyingTo(null); setSelectedIds(new Set()); }}>Groupe</button>
          <button className={mode === "private" ? "active" : ""} onClick={() => { setMode("private"); setReplyingTo(null); setSelectedIds(new Set()); }}>Privé {privateUnreadTotal > 0 && <b>{privateUnreadTotal}</b>}</button>
        </div>

        {notice && <p className="notice message-notice">{notice}</p>}

        {mode === "private" ? (
          <div className="private-messaging-layout">
            <aside className={`conversation-sidebar ${privateTarget ? "target-open" : ""}`}>
              <div className="conversation-sidebar-head"><span className="section-kicker">CHORISTES</span><h2>Messages privés</h2></div>
              <div className="conversation-search-list">
                {otherMembers.map((target) => {
                  const unread = unreadFor(target.uid);
                  const summary = conversationPreview(target.uid);
                  return (
                    <button key={target.id} className={`conversation-person ${privateTarget?.uid === target.uid ? "selected" : ""}`} onClick={() => selectPrivate(target)}>
                      <div className="message-avatar">{target.photoUrl ? <img src={target.photoUrl} alt="" /> : `${target.prenom?.[0] || ""}${target.nom?.[0] || ""}`}</div>
                      <div><strong>{target.prenom} {target.nom}</strong><small>{summary?.lastMessage || target.pupitre || "Choriste"}</small></div>
                      <span className={`online-dot ${statuses[target.uid]?.online ? "online" : ""}`} />
                      {unread > 0 && <b className="unread-count">{unread}</b>}
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className={`private-chat-panel ${privateTarget ? "open" : ""}`}>
              {privateTarget ? (
                <>
                  <div className="private-chat-head">
                    <button className="mobile-back-chat" onClick={() => setPrivateTarget(null)}>‹</button>
                    <div className="message-avatar">{privateTarget.photoUrl ? <img src={privateTarget.photoUrl} alt="" /> : `${privateTarget.prenom?.[0] || ""}${privateTarget.nom?.[0] || ""}`}</div>
                    <div><strong>{privateTarget.prenom} {privateTarget.nom}</strong><small>{directTyping ? "écrit…" : formatLastSeen(statuses[privateTarget.uid])}</small></div>
                  </div>
                  <MessagePane
                    messages={visibleMessages}
                    uid={uid}
                    mode="private"
                    otherUid={privateTarget.uid}
                    menuId={menuId}
                    selectedIds={selectedIds}
                    setMenuId={setMenuId}
                    onReply={startReply}
                    onReact={react}
                    onEdit={editMessage}
                    onDeleteEveryone={deleteForEveryone}
                    onDeleteMe={(message) => hideForMe([message.id])}
                    onSelect={(message) => toggleSelected(message.id)}
                  />
                  {directTyping && <div className="typing-indicator">{privateTarget.prenom} écrit…</div>}
                  <Composer
                    text={activeText}
                    onTextChange={updateText}
                    onSend={() => void sendPayload({ text: activeText })}
                    onSticker={() => setShowStickers((value) => !value)}
                    onImage={() => fileInputRef.current?.click()}
                    recording={recording}
                    pendingVoice={pendingVoice}
                    onStartRecording={() => void startRecording()}
                    onStopRecording={stopRecording}
                    onSendVoice={() => void sendPendingVoice()}
                    onDeleteVoice={() => { if (pendingVoice) URL.revokeObjectURL(pendingVoice.url); setPendingVoice(null); }}
                    replyingTo={replyingTo}
                    onCancelReply={() => setReplyingTo(null)}
                    busy={Boolean(busy)}
                  />
                </>
              ) : <div className="private-empty-state"><div className="private-empty-icon">✉</div><h2>Choisis un choriste</h2><p>Sélectionne un membre du chœur pour commencer ou reprendre une conversation privée.</p></div>}
            </div>
          </div>
        ) : (
          <div className="group-chat-shell">
            <div className="group-chat-head"><div className="group-avatar">♫</div><div><strong>Groupe Chœur Lumina</strong><small>{groupTypers.length ? `${groupTypers.join(", ")} ${groupTypers.length > 1 ? "écrivent" : "écrit"}…` : `${members.filter((m) => Boolean(m.uid)).length} membre(s)`}</small></div></div>
            <MessagePane
              messages={visibleMessages}
              uid={uid}
              mode="group"
              menuId={menuId}
              selectedIds={selectedIds}
              setMenuId={setMenuId}
              onReply={startReply}
              onReact={react}
              onEdit={editMessage}
              onDeleteEveryone={deleteForEveryone}
              onDeleteMe={(message) => hideForMe([message.id])}
              onSelect={(message) => toggleSelected(message.id)}
            />
            {groupTypers.length > 0 && <div className="typing-indicator">{groupTypers.join(", ")} {groupTypers.length > 1 ? "écrivent" : "écrit"}…</div>}
            <Composer
              text={activeText}
              onTextChange={updateText}
              onSend={() => void sendPayload({ text: activeText })}
              onSticker={() => setShowStickers((value) => !value)}
              onImage={() => fileInputRef.current?.click()}
              recording={recording}
              pendingVoice={pendingVoice}
              onStartRecording={() => void startRecording()}
              onStopRecording={stopRecording}
              onSendVoice={() => void sendPendingVoice()}
              onDeleteVoice={() => { if (pendingVoice) URL.revokeObjectURL(pendingVoice.url); setPendingVoice(null); }}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
              busy={Boolean(busy)}
            />
          </div>
        )}

        {selectedIds.size > 0 && (
          <div className="selection-action-bar"><strong>{selectedIds.size} sélectionné(s)</strong><button onClick={() => void hideForMe([...selectedIds])}>Supprimer pour moi</button><button onClick={() => setSelectedIds(new Set())}>Annuler</button></div>
        )}

        {showStickers && (
          <div className="sticker-tray sticker-tray-v2">
            {stickers.map((sticker) => <button key={sticker} onClick={() => void sendPayload({ type: "sticker", text: sticker })}>{sticker}</button>)}
          </div>
        )}

        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleImage(file); e.currentTarget.value = ""; }} />
        <div ref={bottomRef} />
      </section>
    </>
  );
}

function MessagePane({
  messages,
  uid,
  mode,
  otherUid,
  menuId,
  selectedIds,
  setMenuId,
  onReply,
  onReact,
  onEdit,
  onDeleteEveryone,
  onDeleteMe,
  onSelect
}: {
  messages: AnyMessage[];
  uid: string;
  mode: "group" | "private";
  otherUid?: string;
  menuId: string | null;
  selectedIds: Set<string>;
  setMenuId: (id: string | null) => void;
  onReply: (message: AnyMessage) => void;
  onReact: (id: string, emoji: string) => Promise<void>;
  onEdit: (message: AnyMessage) => Promise<void>;
  onDeleteEveryone: (message: AnyMessage) => Promise<void>;
  onDeleteMe: (message: AnyMessage) => Promise<void>;
  onSelect: (message: AnyMessage) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  return (
    <div className="messages-list messages-list-v2">
      {messages.length === 0 && <div className="chat-empty">Aucun message pour le moment.</div>}
      {messages.map((message) => {
        const mine = message.authorUid === uid;
        const groupMessage = message as GroupMessage;
        const directMessage = message as DirectMessage;
        const groupedReactions = Object.values(message.reactions || {}).reduce<Record<string, number>>((acc, emoji) => {
          acc[emoji] = (acc[emoji] || 0) + 1;
          return acc;
        }, {});
        const selected = selectedIds.has(message.id);
        const receipt = mode === "private" && mine && otherUid
          ? (directMessage.readBy || []).includes(otherUid) ? "Lu"
            : (directMessage.deliveredBy || []).includes(otherUid) ? "✓✓"
              : "✓"
          : "";

        return (
          <div className={`message-line ${mine ? "mine" : ""} ${selected ? "message-selected" : ""}`} key={message.id}>
            <div className={`bubble bubble-v2 ${message.type === "system_cancelled" || message.type === "event_cancelled" ? "alert-bubble" : ""}`}>
              {mode === "group" && !mine && <strong className="message-author">{groupMessage.authorName}</strong>}
              {message.replyToText && <div className="reply-quote"><strong>{message.replyToAuthor || "Message"}</strong><span>{message.replyToText}</span></div>}
              {message.deleted ? <p className="deleted-message">Message supprimé</p> : message.type === "sticker" ? (
                <span className="sticker-message">{message.texte}</span>
              ) : message.type === "image" ? (
                <a href={message.mediaUrl} target="_blank" rel="noreferrer"><img className="chat-image" src={message.mediaUrl} alt="Image envoyée" /></a>
              ) : message.type === "voice" ? (
                <audio className="voice-note-player" controls preload="metadata" src={message.mediaUrl} />
              ) : <p>{message.texte}</p>}

              {Object.keys(groupedReactions).length > 0 && <div className="reaction-summary">{Object.entries(groupedReactions).map(([emoji, count]) => <span key={emoji}>{emoji}{count > 1 ? ` ${count}` : ""}</span>)}</div>}
              <div className="message-meta"><small>{formatTime(message)}{message.editedAt && !message.deleted ? " · modifié" : ""}</small>{receipt && <small className={receipt === "Lu" ? "read-receipt" : ""}>{receipt}</small>}{mode === "group" && mine && <small>{Math.max(0, (message.readBy || []).length - 1)} lu</small>}</div>

              <button className="message-menu-button" onClick={() => setMenuId(menuId === message.id ? null : message.id)}>⋯</button>
              {menuId === message.id && (
                <div className={`message-context-menu ${mine ? "mine-menu" : ""}`}>
                  <div className="reaction-picker">{reactions.map((emoji) => <button key={emoji} onClick={() => void onReact(message.id, emoji)}>{emoji}</button>)}</div>
                  {!message.deleted && <button onClick={() => onReply(message)}>Répondre</button>}
                  {mine && message.type === "text" && !message.deleted && <button onClick={() => void onEdit(message)}>Modifier</button>}
                  {mine && !message.deleted && <button className="danger-text" onClick={() => void onDeleteEveryone(message)}>Supprimer pour tous</button>}
                  <button onClick={() => void onDeleteMe(message)}>Supprimer pour moi</button>
                  <button onClick={() => onSelect(message)}>Sélectionner</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

function Composer({
  text,
  onTextChange,
  onSend,
  onSticker,
  onImage,
  recording,
  pendingVoice,
  onStartRecording,
  onStopRecording,
  onSendVoice,
  onDeleteVoice,
  replyingTo,
  onCancelReply,
  busy
}: {
  text: string;
  onTextChange: (value: string) => void;
  onSend: () => void;
  onSticker: () => void;
  onImage: () => void;
  recording: boolean;
  pendingVoice: { blob: Blob; url: string; durationMs: number } | null;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSendVoice: () => void;
  onDeleteVoice: () => void;
  replyingTo: ReplyDraft | null;
  onCancelReply: () => void;
  busy: boolean;
}) {
  return (
    <div className="composer-shell">
      {replyingTo && <div className="composer-reply"><div><strong>{replyingTo.author}</strong><span>{replyingTo.text}</span></div><button onClick={onCancelReply}>×</button></div>}
      {pendingVoice && <div className="voice-preview"><audio controls src={pendingVoice.url} /><button onClick={onDeleteVoice}>Supprimer</button><button className="send-voice" disabled={busy} onClick={onSendVoice}>Envoyer</button></div>}
      {recording && <div className="recording-banner"><span className="recording-dot" /> Enregistrement en cours… <button onClick={onStopRecording}>■ Arrêter</button></div>}
      <div className="composer composer-v2">
        <button title="Stickers" onClick={onSticker}>☺</button>
        <button title="Image" onClick={onImage} disabled={recording}>▧</button>
        <textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="Écrire un message…"
          rows={1}
          autoCapitalize="sentences"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (text.trim()) onSend();
            }
          }}
        />
        {text.trim() ? <button className="send-button" disabled={busy} onClick={onSend}>➤</button> : recording ? <button className="record-button active" onClick={onStopRecording}>■</button> : <button className="record-button" disabled={busy || Boolean(pendingVoice)} onClick={onStartRecording}>●</button>}
      </div>
    </div>
  );
}
