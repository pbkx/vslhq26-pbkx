import { describe, expect, it } from "vitest";
import type { GrantResult, GrantWatch, SearchOutput } from "../src/domain/types.js";
import {
  buildWatchAlertEmail,
  buildWatchConfirmationEmail,
} from "../src/services/watchEmailTemplates.js";
import {
  qualityFromMinimumScore,
  WATCH_QUALITY,
} from "../src/services/watchPreferences.js";

const watch: GrantWatch = {
  id: "watch-test",
  queryId: "query-test",
  email: "grants@example.org",
  matchQuality: "worth-reviewing",
  minimumScore: WATCH_QUALITY["worth-reviewing"].minimumScore,
  frequency: "daily",
  scope: "search",
  deadlineLeadDays: 14,
  notificationTypes: ["new-match", "opportunity-closing"],
  status: "active",
  createdAt: "2026-07-29T00:00:00.000Z",
  nextCheckAt: "2026-07-30T00:00:00.000Z",
  copilotReturnUrl: "https://m365.cloud.microsoft/chat/?conversationId=watch-test",
  lastNotifiedGrantIds: [],
};

const grant = {
  opportunity: {
    id: "grant-test",
    title: "Community Food Access",
    funderName: "Example Agency",
    awardMin: 100_000,
    awardMax: 500_000,
    deadline: "2026-10-01",
    sourceUrl: "https://example.org/grant",
  },
  score: {
    components: {
      missionAlignment: {
        reasons: ["Supports community food access and hunger relief."],
      },
    },
  },
} as unknown as GrantResult;

const search = {
  project: { title: "Food Access and Hunger Relief" },
} as unknown as SearchOutput;

describe("grant watch preferences and email copy", () => {
  it("maps legacy scores to user-facing quality levels", () => {
    expect(qualityFromMinimumScore(60)).toBe("worth-reviewing");
    expect(qualityFromMinimumScore(72)).toBe("strong");
    expect(qualityFromMinimumScore(85)).toBe("top-only");
  });

  it("uses plain-language watch settings instead of an unexplained percentage", () => {
    const confirmation = buildWatchConfirmationEmail(watch, search);
    expect(confirmation.subject).toContain("Food Access and Hunger Relief");
    expect(confirmation.plainText).toContain("Daily digest");
    expect(confirmation.plainText).toContain("Approaching deadlines");
    expect(confirmation.subject).not.toContain("%");
    expect(confirmation.html).not.toContain("60%+");
    expect(confirmation.html).toContain("Open in Copilot");
    expect(confirmation.html).toContain("conversationId=watch-test");
    expect(confirmation.html).toContain("background:#0d0d0c");

    const alert = buildWatchAlertEmail(watch, grant, {
      notificationType: "new-match",
    });
    expect(alert.subject).toBe("New GrantPilot match · Community Food Access");
    expect(alert.plainText).toContain("Supports community food access");
    expect(alert.plainText).not.toContain("% match");
    expect(alert.html).toContain("Open in Copilot");
    expect(alert.html).toContain("View official source");
  });

  it("uses notification-specific subjects and copy", () => {
    const closing = buildWatchAlertEmail(watch, grant, {
      notificationType: "opportunity-closing",
      daysRemaining: 9,
    });
    expect(closing.subject).toBe("Deadline approaching · Community Food Access");
    expect(closing.html).toContain("9 days until deadline");
    expect(closing.plainText).toContain("indexed deadline");

    const amended = buildWatchAlertEmail(watch, grant, {
      notificationType: "opportunity-amended",
    });
    expect(amended.subject).toBe("Opportunity updated · Community Food Access");
    expect(amended.plainText).toContain("official record changed");
  });
});
