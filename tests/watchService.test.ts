import { describe, expect, it } from "vitest";
import type {
  GrantResult,
  GrantWatch,
  GrantWatchGrantState,
  SearchOutput,
} from "../src/domain/types.js";
import type {
  EmailDelivery,
  EmailMessage,
  EmailService,
} from "../src/services/emailService.js";
import {
  buildWatchGrantState,
  runGrantWatchChecks,
} from "../src/services/watchService.js";

const component = (score: number, reason: string) => ({
  score,
  weight: 1 / 6,
  weightedContribution: score / 6,
  confidence: 80,
  reasons: [reason],
  evidence: [],
  missingData: [],
});

function grant({
  id,
  title = id,
  score = 75,
  deadline = "2026-10-01",
  lastUpdated = "2026-07-20",
  summary = `Summary for ${id}`,
}: {
  id: string;
  title?: string;
  score?: number;
  deadline?: string;
  lastUpdated?: string;
  summary?: string;
}) {
  return {
    opportunity: {
      id,
      source: "grants-gov",
      sourceId: id,
      recordCategory: "current-federal-opportunity",
      title,
      funderName: "Example Federal Agency",
      funderType: "federal",
      summary,
      missionTopics: ["food access"],
      populationsServed: ["low-income adults"],
      eligibleApplicantTypes: ["nonprofit"],
      eligibleLocations: [{ country: "US", nationwide: true }],
      awardMin: 100_000,
      awardMax: 500_000,
      deadline,
      lastUpdated,
      opportunityStatus: "open",
      sourceUrl: `https://example.org/${id}`,
      sourceDisclaimer: "Verify at the official source.",
      requirements: [],
    },
    score: {
      grantId: id,
      overallScore: score,
      components: {
        missionAlignment: component(score, "Supports food access."),
        applicantEligibility: component(80, "Nonprofits are supported."),
        geographicFit: component(80, "Nationwide opportunity."),
        programSizeFit: component(75, "Award range fits."),
        historicalSimilarity: component(50, "Limited history."),
        deadlineFeasibility: component(80, "Deadline is feasible."),
      },
      eligibilityStatus: "likely",
      hardExclusions: [],
      warnings: [],
      scoredAt: "2026-07-20T00:00:00.000Z",
    },
    chart: {
      applicationEffort: 55,
      matchScore: score,
      awardAmount: 500_000,
      daysRemaining: 64,
    },
  } as GrantResult;
}

function search(grants: GrantResult[]) {
  return {
    queryId: "query-watch",
    searchedAt: "2026-07-20T00:00:00.000Z",
    resultCount: grants.length,
    sourceCounts: {
      "grants-gov": grants.length,
      "irs-990pf": 0,
    },
    weights: {
      missionAlignment: 0.3,
      applicantEligibility: 0.2,
      geographicFit: 0.15,
      programSizeFit: 0.15,
      historicalSimilarity: 0.1,
      deadlineFeasibility: 0.1,
    },
    grants,
    warnings: [],
    organization: {
      id: "org",
      name: "Food Access Network",
      organizationType: "nonprofit",
      headquarters: { state: "WA", country: "US" },
      serviceAreas: [{ country: "US", states: ["WA"] }],
      missionTopics: ["food access"],
      populationsServed: ["low-income adults"],
    },
    project: {
      id: "project",
      title: "Food Access",
      summary: "Community hunger relief.",
      topics: ["food access"],
      targetPopulations: ["low-income adults"],
      geographicAreas: [{ country: "US", states: ["WA"] }],
    },
    searchCriteria: {
      query: "Find food access grants in Washington",
      sources: ["grants-gov"],
      resultTypes: ["current-federal"],
      filters: { onlyOpen: true },
      limit: 80,
    },
  } as SearchOutput;
}

function watch(
  original: SearchOutput,
  overrides: Partial<GrantWatch> = {},
): GrantWatch {
  return {
    id: "watch-test",
    queryId: original.queryId,
    email: "test@example.org",
    matchQuality: "strong",
    minimumScore: 70,
    frequency: "daily",
    scope: "search",
    deadlineLeadDays: 14,
    notificationTypes: [
      "new-match",
      "deadline-change",
      "opportunity-amended",
      "score-increased",
    ],
    status: "active",
    createdAt: "2026-07-20T00:00:00.000Z",
    nextCheckAt: "2026-07-21T00:00:00.000Z",
    lastNotifiedGrantIds: [],
    lastNotifiedEventKeys: [],
    lastSeenGrantState: buildWatchGrantState(original),
    ...overrides,
  };
}

class FakeRepository {
  constructor(
    public currentSearch: SearchOutput,
    public currentWatch: GrantWatch,
  ) {}

  getSearch() {
    return this.currentSearch;
  }

  listWatches() {
    return [this.currentWatch];
  }

  async saveWatch(next: GrantWatch) {
    this.currentWatch = next;
    return next;
  }
}

class FakeMailer implements EmailService {
  messages: EmailMessage[] = [];

  constructor(public status: EmailDelivery["status"]) {}

  async send(message: EmailMessage): Promise<EmailDelivery> {
    this.messages.push(message);
    return {
      provider: "azure-communication-services",
      status: this.status,
      messageId: this.status === "sent" ? "message-test" : undefined,
    };
  }
}

const now = Date.parse("2026-07-29T12:00:00.000Z");

describe("grant watch refresh and delivery", () => {
  it("refreshes the saved search and sends one real daily digest for all changes", async () => {
    const initial = search([
      grant({ id: "existing", score: 72, deadline: "2026-10-01" }),
    ]);
    const refreshed = search([
      grant({
        id: "existing",
        score: 78,
        deadline: "2026-10-15",
        lastUpdated: "2026-07-28",
        summary: "Updated source summary.",
      }),
      grant({ id: "new-grant", title: "New Food Access Grant", score: 81 }),
    ]);
    const repository = new FakeRepository(initial, watch(initial));
    const mailer = new FakeMailer("sent");
    let refreshCalls = 0;

    const result = await runGrantWatchChecks({
      repository,
      mailer,
      now: () => now,
      refreshSearch: async (saved) => {
        refreshCalls += 1;
        expect(saved.queryId).toBe(initial.queryId);
        return refreshed;
      },
    });

    expect(refreshCalls).toBe(1);
    expect(mailer.messages).toHaveLength(1);
    expect(mailer.messages[0]?.subject).toContain("2 GrantPilot updates");
    expect(mailer.messages[0]?.html).toContain("New Food Access Grant");
    expect(mailer.messages[0]?.html).toContain("Deadline changes");
    expect(repository.currentWatch.lastSeenGrantState).toEqual(
      buildWatchGrantState(refreshed),
    );
    expect(repository.currentWatch.lastNotifiedEventKeys).toEqual(
      expect.arrayContaining([
        "new-match:new-grant",
        expect.stringContaining("deadline-change:existing"),
        expect.stringContaining("opportunity-amended:existing"),
        "score-increased:existing:72:78",
      ]),
    );
    expect(result.events).toEqual([
      expect.objectContaining({
        notificationType: "digest",
        delivery: "sent",
        grantCount: 2,
      }),
    ]);
  });

  it("does not consume events or advance the source baseline in preview-only mode", async () => {
    const initial = search([grant({ id: "existing" })]);
    const refreshed = search([
      grant({ id: "existing" }),
      grant({ id: "new-grant", score: 84 }),
    ]);
    const originalState = buildWatchGrantState(initial);
    const repository = new FakeRepository(initial, watch(initial));
    const previewMailer = new FakeMailer("preview-only");

    await runGrantWatchChecks({
      repository,
      mailer: previewMailer,
      now: () => now,
      refreshSearch: async () => refreshed,
    });

    expect(previewMailer.messages).toHaveLength(1);
    expect(repository.currentWatch.lastNotifiedEventKeys).toEqual([]);
    expect(repository.currentWatch.lastNotifiedGrantIds).toEqual([]);
    expect(repository.currentWatch.lastSeenGrantState).toEqual(originalState);

    repository.currentWatch.nextCheckAt = new Date(now - 1).toISOString();
    const sentMailer = new FakeMailer("sent");
    await runGrantWatchChecks({
      repository,
      mailer: sentMailer,
      now: () => now,
      refreshSearch: async () => refreshed,
    });

    expect(sentMailer.messages).toHaveLength(1);
    expect(repository.currentWatch.lastNotifiedEventKeys).toContain(
      "new-match:new-grant",
    );
    expect(repository.currentWatch.lastSeenGrantState).toEqual(
      buildWatchGrantState(refreshed),
    );
  });

  it("advances the baseline without sending when refreshed data did not change", async () => {
    const initial = search([grant({ id: "existing" })]);
    const repository = new FakeRepository(
      initial,
      watch(initial, { lastSeenGrantState: undefined }),
    );
    const mailer = new FakeMailer("sent");

    await runGrantWatchChecks({
      repository,
      mailer,
      now: () => now,
      refreshSearch: async () => initial,
    });

    expect(mailer.messages).toHaveLength(0);
    expect(repository.currentWatch.lastSeenGrantState).toEqual(
      buildWatchGrantState(initial),
    );
    expect(repository.currentWatch.lastCheckedAt).toBe(
      "2026-07-29T12:00:00.000Z",
    );
  });
});
