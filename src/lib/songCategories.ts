import type { SongCategory } from "../types/models";

export const DEFAULT_SONG_CATEGORIES: SongCategory[] = [
  { id: "entree", nom: "Chant d'entrée", ordre: 10, custom: false },
  { id: "kyrie", nom: "Kyrie", ordre: 20, custom: false },
  { id: "gloria", nom: "Gloria", ordre: 30, custom: false },
  { id: "psaume", nom: "Psaume", ordre: 40, custom: false },
  { id: "acclamation", nom: "Acclamation", ordre: 50, custom: false },
  { id: "pu", nom: "P.U.", ordre: 60, custom: false },
  { id: "sanctus", nom: "Sanctus", ordre: 70, custom: false },
  { id: "anamnese", nom: "Anamnèse", ordre: 80, custom: false },
  { id: "agnus_dei", nom: "Agnus Dei", ordre: 90, custom: false },
  { id: "communion", nom: "Communion", ordre: 100, custom: false },
  { id: "action_grace", nom: "Action de grâce", ordre: 110, custom: false },
  { id: "sortie", nom: "Sortie", ordre: 120, custom: false }
];

export function mergeSongCategories(custom: SongCategory[]): SongCategory[] {
  const customById = new Map(custom.filter((item) => item.id && item.nom).map((item) => [item.id, item]));
  return [
    ...DEFAULT_SONG_CATEGORIES.filter((item) => !customById.has(item.id)),
    ...customById.values()
  ].sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom, "fr"));
}

export function categoryLabel(id: string, categories: SongCategory[]): string {
  return categories.find((item) => item.id === id)?.nom || id;
}

export function slugifyCategory(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base || `categorie_${Date.now()}`;
}
