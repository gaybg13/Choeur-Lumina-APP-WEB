import type { Timestamp } from "firebase/firestore";

export type MemberRole = "membre" | "contributeur" | "admin" | string;

export type Member = {
  id: string;
  uid: string;
  prenom: string;
  nom: string;
  email: string;
  pupitre: string;
  role: MemberRole;
  photoUrl?: string;
  claimed?: boolean;
  inviteCode?: string;
  fcmToken?: string;
  birthdayDay?: number;
  birthdayMonth?: number;
  agendaLastSeenAt?: Timestamp;
};

export type LuminaEvent = {
  id: string;
  titre: string;
  type: string;
  date?: Timestamp;
  lieu?: string;
  description?: string;
  reponses?: Record<string, string>;
  programme?: string[];
  compteRendu?: string;
  createdAt?: Timestamp;
  cancelled?: boolean;
  cancelledAt?: Timestamp;
  synthetic?: boolean;
};

export type Folder = {
  id: string;
  nom: string;
};

export type Song = {
  id: string;
  titre: string;
  compositeur?: string;
  partitionUrl?: string;
  partitionType?: string;
  audioUrl?: string;
  audioIsFile?: boolean;
  youtubeUrl?: string;
  folderId?: string;
  appris?: boolean;
  createdAt?: Timestamp;
  audioUrlsByPupitre?: Record<string, string>;
  audioFilesByPupitre?: Record<string, boolean>;
};

export type GroupMessage = {
  id: string;
  authorUid: string;
  authorName: string;
  texte: string;
  type?: string;
  mediaUrl?: string;
  durationMs?: number;
  timestamp?: Timestamp;
  editedAt?: Timestamp;
  deleted?: boolean;
  readBy?: string[];
  hiddenFor?: string[];
  reactions?: Record<string, string>;
  replyToId?: string;
  replyToText?: string;
  replyToAuthor?: string;
};

export type DirectMessage = {
  id: string;
  authorUid: string;
  texte: string;
  type?: string;
  mediaUrl?: string;
  durationMs?: number;
  timestamp?: Timestamp;
  editedAt?: Timestamp;
  deleted?: boolean;
  readBy?: string[];
  deliveredBy?: string[];
  hiddenFor?: string[];
  reactions?: Record<string, string>;
  replyToId?: string;
  replyToText?: string;
  replyToAuthor?: string;
};

export type ConversationSummary = {
  id: string;
  participants?: string[];
  lastMessage?: string;
  lastTimestamp?: Timestamp;
  unreadCounts?: Record<string, number>;
};

export type UserStatus = {
  online?: boolean;
  lastSeen?: Timestamp;
};
