export interface Category {
  id: string;
  label: string;
  /** Keyword passed to meetup.com's `?keywords=` filter. */
  keyword: string;
}

/**
 * Curated subset of meetup.com's top-level categories. The `keyword` is the
 * search term we forward to meetup.com — they don't expose a typed category
 * filter so we lean on their text search instead.
 */
export const CATEGORIES: Category[] = [
  { id: "technology", label: "Technology", keyword: "technology" },
  { id: "business", label: "Career & Business", keyword: "business" },
  { id: "health", label: "Health & Wellbeing", keyword: "health" },
  { id: "sports", label: "Sports & Fitness", keyword: "sports" },
  { id: "outdoors", label: "Outdoors & Adventure", keyword: "outdoors" },
  { id: "arts", label: "Arts & Culture", keyword: "arts" },
  { id: "music", label: "Music", keyword: "music" },
  { id: "food", label: "Food & Drink", keyword: "food" },
  { id: "social", label: "Social", keyword: "social" },
  { id: "hobbies", label: "Hobbies & Crafts", keyword: "hobbies" },
  { id: "games", label: "Games", keyword: "games" },
  { id: "science", label: "Science & Education", keyword: "science" },
  { id: "travel", label: "Travel", keyword: "travel" },
  { id: "pets", label: "Pets & Animals", keyword: "pets" },
  { id: "language", label: "Identity & Language", keyword: "language" },
  { id: "spirituality", label: "Spirituality", keyword: "spirituality" },
  { id: "movements", label: "Movements & Politics", keyword: "politics" },
  { id: "dance", label: "Dance", keyword: "dance" },
];

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): Category | undefined {
  return CATEGORY_BY_ID.get(id);
}

/**
 * Reads the `categories` query param. Returns `null` if the key isn't
 * present at all (caller should apply default); returns `[]` if the key is
 * present but empty / the explicit-clear sentinel (`none`), meaning the user
 * deliberately chose no categories.
 */
export function parseCategoryIds(
  raw: string | string[] | undefined,
): string[] | null {
  if (raw === undefined) return null;
  const flat = Array.isArray(raw) ? raw.join(",") : raw;
  const cleaned = flat.trim();
  if (cleaned === "" || cleaned === "none") return [];
  const ids = cleaned
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!CATEGORY_BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export const DEFAULT_CATEGORY_IDS: readonly string[] = ["technology"];
