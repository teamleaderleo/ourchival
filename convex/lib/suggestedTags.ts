import { slugifyTagName } from "./tags";

export type SuggestedTagInput = {
  title?: string;
  notes?: string;
  postText?: string;
  altText?: string;
  selectedText?: string;
  description?: string;
  siteName?: string;
  authorName?: string;
  authorHandle?: string;
  existingSlugs?: string[];
};

export type SuggestedTagCandidate = {
  value: string;
  normalizedValue: string;
};

const conceptRules: Array<{ value: string; terms: string[] }> = [
  {
    value: "lighting",
    terms: [
      "light",
      "lighting",
      "rim light",
      "backlight",
      "shadow",
      "sunset",
      "sunrise",
      "blue hour",
      "golden hour",
      "chiaroscuro",
      "nocturne",
    ],
  },
  {
    value: "composition",
    terms: [
      "composition",
      "framing",
      "layout",
      "staging",
      "camera angle",
      "perspective",
      "rule of thirds",
      "silhouette",
    ],
  },
  {
    value: "pose",
    terms: [
      "pose",
      "gesture",
      "stance",
      "body language",
      "movement",
      "action line",
      "contrapposto",
    ],
  },
  {
    value: "anatomy",
    terms: [
      "anatomy",
      "muscle",
      "skeleton",
      "hands",
      "feet",
      "proportion",
      "torso",
      "shoulder",
    ],
  },
  {
    value: "color",
    terms: [
      "color",
      "colour",
      "palette",
      "hue",
      "saturation",
      "value grouping",
      "temperature",
      "complementary",
    ],
  },
  {
    value: "clothing",
    terms: [
      "clothing",
      "costume",
      "outfit",
      "fabric",
      "folds",
      "drapery",
      "jacket",
      "dress",
      "uniform",
    ],
  },
  {
    value: "environment",
    terms: [
      "environment",
      "background",
      "landscape",
      "cityscape",
      "interior",
      "architecture",
      "room",
      "street",
      "forest",
    ],
  },
  {
    value: "brushwork",
    terms: [
      "brushwork",
      "brush stroke",
      "texture",
      "paint handling",
      "mark making",
      "line quality",
      "inking",
    ],
  },
  {
    value: "expression",
    terms: [
      "expression",
      "emotion",
      "facial",
      "smile",
      "anger",
      "fear",
      "sadness",
      "eyes",
    ],
  },
  {
    value: "artist study",
    terms: [
      "artist study",
      "master study",
      "style study",
      "technique study",
      "process study",
    ],
  },
];

const stopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "another",
  "before",
  "being",
  "between",
  "could",
  "every",
  "first",
  "from",
  "great",
  "have",
  "into",
  "just",
  "keep",
  "like",
  "more",
  "most",
  "much",
  "only",
  "other",
  "over",
  "reference",
  "save",
  "saved",
  "should",
  "source",
  "study",
  "than",
  "that",
  "their",
  "there",
  "these",
  "thing",
  "this",
  "through",
  "under",
  "very",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your",
]);

export function deriveSuggestedTags(
  input: SuggestedTagInput,
  limit = 10,
): SuggestedTagCandidate[] {
  const existing = new Set((input.existingSlugs ?? []).map(slugifyTagName));
  const weightedText = [
    [input.title, 4],
    [input.notes, 4],
    [input.selectedText, 3],
    [input.postText, 2],
    [input.altText, 2],
    [input.description, 2],
    [input.siteName, 1],
    [input.authorName, 1],
    [input.authorHandle, 1],
  ] as const;
  const combined = weightedText
    .map(([value]) => normalizeText(value ?? ""))
    .filter(Boolean)
    .join(" ");
  const candidates: SuggestedTagCandidate[] = [];
  const seen = new Set(existing);

  for (const rule of conceptRules) {
    if (!rule.terms.some((term) => combined.includes(normalizeText(term)))) continue;
    addCandidate(candidates, seen, rule.value, limit);
  }

  const scores = new Map<string, { value: string; score: number }>();
  for (const [value, weight] of weightedText) {
    for (const token of tokenize(value ?? "")) {
      const normalizedValue = slugifyTagName(token);
      if (
        !normalizedValue ||
        existing.has(normalizedValue) ||
        stopWords.has(token) ||
        token.length < 4 ||
        /^\d+$/.test(token)
      ) {
        continue;
      }
      const current = scores.get(normalizedValue);
      scores.set(normalizedValue, {
        value: displayToken(token),
        score: (current?.score ?? 0) + weight,
      });
    }
  }

  for (const [normalizedValue, entry] of Array.from(scores.entries()).sort(
    (left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]),
  )) {
    if (entry.score < 2 && candidates.length >= 4) continue;
    addCandidate(candidates, seen, entry.value, limit, normalizedValue);
    if (candidates.length >= limit) break;
  }

  return candidates;
}

function addCandidate(
  candidates: SuggestedTagCandidate[],
  seen: Set<string>,
  value: string,
  limit: number,
  knownSlug?: string,
) {
  const cleanedValue = value.trim().replace(/\s+/g, " ").slice(0, 48);
  const normalizedValue = knownSlug ?? slugifyTagName(cleanedValue);
  if (!cleanedValue || !normalizedValue || seen.has(normalizedValue)) return;
  seen.add(normalizedValue);
  candidates.push({ value: cleanedValue, normalizedValue });
  if (candidates.length > limit) candidates.length = limit;
}

function tokenize(value: string) {
  return normalizeText(value)
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#][a-z0-9_]+/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayToken(value: string) {
  return value.replace(/[-_]+/g, " ").slice(0, 48);
}
