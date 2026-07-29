import type {
  GrantWatchFrequency,
  GrantWatchMatchQuality,
  GrantWatchNotificationType,
} from "../domain/types.js";

export const WATCH_QUALITY = {
  "worth-reviewing": {
    label: "Worth reviewing",
    minimumScore: 60,
    description: "Balanced candidates with enough evidence to merit a closer look.",
  },
  strong: {
    label: "Strong matches",
    minimumScore: 70,
    description: "Fewer candidates with stronger evidence across key criteria.",
  },
  "top-only": {
    label: "Top matches only",
    minimumScore: 80,
    description: "Rare standout candidates; you may receive fewer alerts.",
  },
} as const satisfies Record<
  GrantWatchMatchQuality,
  { label: string; minimumScore: number; description: string }
>;

export const WATCH_FREQUENCY = {
  "as-detected": { label: "As detected", intervalMs: 60 * 60 * 1000 },
  daily: { label: "Daily digest", intervalMs: 24 * 60 * 60 * 1000 },
  weekly: { label: "Weekly digest", intervalMs: 7 * 24 * 60 * 60 * 1000 },
} as const satisfies Record<GrantWatchFrequency, { label: string; intervalMs: number }>;

export const WATCH_NOTIFICATION_LABELS = {
  "new-match": "New matching opportunities",
  "deadline-change": "Deadline changes",
  "opportunity-amended": "Official record updates",
  "opportunity-closing": "Approaching deadlines",
  "score-increased": "A candidate becomes a stronger fit",
} as const satisfies Record<GrantWatchNotificationType, string>;

export function qualityFromMinimumScore(score?: number): GrantWatchMatchQuality {
  if ((score ?? 0) >= WATCH_QUALITY["top-only"].minimumScore) return "top-only";
  if ((score ?? 0) >= WATCH_QUALITY.strong.minimumScore) return "strong";
  return "worth-reviewing";
}

export function nextWatchCheck(frequency: GrantWatchFrequency, from = Date.now()) {
  return new Date(from + WATCH_FREQUENCY[frequency].intervalMs).toISOString();
}
