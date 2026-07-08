import type { Timestamp } from "firebase/firestore";

export type Member = {
  id: string;
  uid: string;
  prenom: string;
  nom: string;
  email: string;
  pupitre: string;
  role: string;
  photoUrl?: string;
  claimed?: boolean;
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
};

export type Song = {
  id: string;
  titre: string;
  compositeur?: string;
  partitionUrl?: string;
  partitionType?: string;
  youtubeUrl?: string;
  folderId?: string;
  appris?: boolean;
  audioUrlsByPupitre?: Record<string, string>;
};

export type GroupMessage = {
  id: string;
  authorUid: string;
  authorName: string;
  texte: string;
  type?: string;
  mediaUrl?: string;
  timestamp?: Timestamp;
  deleted?: boolean;
  readBy?: string[];
  hiddenFor?: string[];
  reactions?: Record<string, string>;
  replyToText?: string;
  replyToAuthor?: string;
};