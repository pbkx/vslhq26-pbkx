import { createHash } from "node:crypto";
import type {
  GrantResult,
  GrantWatch,
  GrantWatchFrequency,
  GrantWatchGrantState,
  GrantWatchMatchQuality,
  GrantWatchNotificationType,
  SearchOutput,
} from "../domain/types.js";
import { grantRepository } from "../repositories/grantRepository.js";
import type { EmailService } from "./emailService.js";
import { emailService } from "./emailService.js";
import { refreshSavedSearch } from "./grantSearchService.js";
import {
  buildWatchAlertEmail,
  buildWatchDigestEmail,
} from "./watchEmailTemplates.js";
import {
  nextWatchCheck,
  qualityFromMinimumScore,
  WATCH_QUALITY,
} from "./watchPreferences.js";

type WatchRepository = Pick<
  typeof grantRepository,
  "getSearch" | "listWatches" | "saveWatch"
>;

type WatchRunnerOptions = {
  repository?: WatchRepository;
  mailer?: EmailService;
  refreshSearch?: (search: SearchOutput) => Promise<SearchOutput>;
  now?: () => number;
};

type DetectedWatchEvent = {
  grant: GrantResult;
  notificationType: GrantWatchNotificationType;
  key: string;
  daysRemaining?: number;
};

const DEFAULT_NOTIFICATIONS: GrantWatchNotificationType[] = [
  "new-match",
  "opportunity-closing",
];

const opportunityFingerprint = (grant: GrantResult) =>
  createHash("sha256")
    .update(JSON.stringify({
      title: grant.opportunity.title,
      funderName: grant.opportunity.funderName,
      summary: grant.opportunity.summary,
      description: grant.opportunity.description,
      awardMin: grant.opportunity.awardMin,
      awardMax: grant.opportunity.awardMax,
      opportunityStatus: grant.opportunity.opportunityStatus,
      lastUpdated: grant.opportunity.lastUpdated,
      requirements: grant.opportunity.requirements,
      applicationUrl: grant.opportunity.applicationUrl,
    }))
    .digest("hex")
    .slice(0, 20);

export function buildWatchGrantState(search: SearchOutput) {
  return Object.fromEntries(
    search.grants.map((grant) => [
      grant.opportunity.id,
      {
        deadline: grant.opportunity.deadline,
        lastUpdated: grant.opportunity.lastUpdated,
        score: Math.round(grant.score.overallScore),
        fingerprint: opportunityFingerprint(grant),
      } satisfies GrantWatchGrantState,
    ]),
  );
}

const daysUntil = (grant: GrantResult, now: number) => {
  if (grant.opportunity.deadline) {
    const deadline = Date.parse(`${grant.opportunity.deadline.slice(0, 10)}T23:59:59Z`);
    if (Number.isFinite(deadline)) return Math.ceil((deadline - now) / 86_400_000);
  }
  return grant.chart.daysRemaining;
};

function detectEvents(
  watch: GrantWatch,
  refreshed: SearchOutput,
  previousState: Record<string, GrantWatchGrantState>,
  notifiedEvents: Set<string>,
  now: number,
) {
  const notificationTypes = watch.notificationTypes?.length
    ? watch.notificationTypes
    : DEFAULT_NOTIFICATIONS;
  const candidates = refreshed.grants
    .filter((grant) =>
      watch.scope !== "selected-grant"
      || grant.opportunity.id === watch.selectedGrantId
    )
    .filter((grant) =>
      watch.scope === "selected-grant"
      || grant.score.overallScore >= watch.minimumScore
    );
  const events: DetectedWatchEvent[] = [];

  for (const grant of candidates) {
    const id = grant.opportunity.id;
    const previous = previousState[id];
    const currentScore = Math.round(grant.score.overallScore);
    const daysRemaining = daysUntil(grant, now);
    const possible: Array<DetectedWatchEvent | undefined> = [
      notificationTypes.includes("new-match") && !previous
        ? {
          grant,
          notificationType: "new-match",
          key: `new-match:${id}`,
          daysRemaining,
        }
        : undefined,
      notificationTypes.includes("deadline-change")
        && previous
        && previous.deadline !== grant.opportunity.deadline
        ? {
          grant,
          notificationType: "deadline-change",
          key: `deadline-change:${id}:${previous.deadline ?? "none"}:${grant.opportunity.deadline ?? "none"}`,
          daysRemaining,
        }
        : undefined,
      notificationTypes.includes("opportunity-amended")
        && previous
        && previous.fingerprint !== opportunityFingerprint(grant)
        ? {
          grant,
          notificationType: "opportunity-amended",
          key: `opportunity-amended:${id}:${opportunityFingerprint(grant)}`,
          daysRemaining,
        }
        : undefined,
      notificationTypes.includes("score-increased")
        && previous
        && currentScore > previous.score
        ? {
          grant,
          notificationType: "score-increased",
          key: `score-increased:${id}:${previous.score}:${currentScore}`,
          daysRemaining,
        }
        : undefined,
      notificationTypes.includes("opportunity-closing")
        && daysRemaining !== undefined
        && daysRemaining >= 0
        && daysRemaining <= watch.deadlineLeadDays
        ? {
          grant,
          notificationType: "opportunity-closing",
          key: `opportunity-closing:${id}:${grant.opportunity.deadline ?? "unknown"}`,
          daysRemaining,
        }
        : undefined,
    ];
    for (const event of possible) {
      if (event && !notifiedEvents.has(event.key)) events.push(event);
    }
  }
  return events;
}

const groupDigestItems = (events: DetectedWatchEvent[]) => {
  const grouped = new Map<string, {
    grant: GrantResult;
    notificationTypes: GrantWatchNotificationType[];
  }>();
  for (const event of events) {
    const existing = grouped.get(event.grant.opportunity.id);
    if (existing) {
      if (!existing.notificationTypes.includes(event.notificationType)) {
        existing.notificationTypes.push(event.notificationType);
      }
    } else {
      grouped.set(event.grant.opportunity.id, {
        grant: event.grant,
        notificationTypes: [event.notificationType],
      });
    }
  }
  return [...grouped.values()];
};

export async function runGrantWatchChecks(options: WatchRunnerOptions = {}) {
  const repository = options.repository ?? grantRepository;
  const mailer = options.mailer ?? emailService;
  const refreshSearch = options.refreshSearch ?? refreshSavedSearch;
  const now = options.now?.() ?? Date.now();
  const checkedAt = new Date(now).toISOString();
  const results: Array<Record<string, unknown>> = [];
  const activeWatches = repository
    .listWatches()
    .filter((item) => item.status === "active");

  for (const storedWatch of activeWatches) {
    if (storedWatch.nextCheckAt && Date.parse(storedWatch.nextCheckAt) > now) continue;
    const matchQuality = (storedWatch.matchQuality
      ?? qualityFromMinimumScore(storedWatch.minimumScore)) as GrantWatchMatchQuality;
    const frequency = (storedWatch.frequency ?? "daily") as GrantWatchFrequency;
    const scope = storedWatch.scope
      ?? (storedWatch.selectedGrantId ? "selected-grant" : "search");
    const minimumScore = storedWatch.minimumScore
      ?? WATCH_QUALITY[matchQuality].minimumScore;
    const normalizedWatch: GrantWatch = {
      ...storedWatch,
      matchQuality,
      frequency,
      scope,
      minimumScore,
      deadlineLeadDays: storedWatch.deadlineLeadDays ?? 14,
      notificationTypes: storedWatch.notificationTypes?.length
        ? storedWatch.notificationTypes
        : DEFAULT_NOTIFICATIONS,
    };
    const previouslyNotified = new Set(storedWatch.lastNotifiedGrantIds ?? []);
    const notifiedEvents = new Set(storedWatch.lastNotifiedEventKeys ?? []);
    let savedSearch: SearchOutput;
    let refreshed: SearchOutput;

    try {
      savedSearch = repository.getSearch(storedWatch.queryId);
      refreshed = await refreshSearch(savedSearch);
    } catch (error) {
      await repository.saveWatch({
        ...normalizedWatch,
        nextCheckAt: nextWatchCheck(frequency, now),
        lastCheckedAt: checkedAt,
      });
      results.push({
        watchId: storedWatch.id,
        status: "refresh-failed",
        error: error instanceof Error ? error.message : "Unknown refresh failure",
      });
      continue;
    }

    const previousState = storedWatch.lastSeenGrantState
      ?? buildWatchGrantState(savedSearch);
    const refreshedState = buildWatchGrantState(refreshed);
    const detected = detectEvents(
      normalizedWatch,
      refreshed,
      previousState,
      notifiedEvents,
      now,
    );

    if (!detected.length) {
      await repository.saveWatch({
        ...normalizedWatch,
        nextCheckAt: nextWatchCheck(frequency, now),
        lastCheckedAt: checkedAt,
        lastSeenGrantState: refreshedState,
      });
      continue;
    }

    let allDelivered = true;
    if (frequency === "daily" || frequency === "weekly") {
      const message = buildWatchDigestEmail(
        normalizedWatch,
        groupDigestItems(detected),
      );
      try {
        const delivery = await mailer.send({
          to: normalizedWatch.email,
          ...message,
        });
        allDelivered = delivery.status === "sent";
        results.push({
          watchId: storedWatch.id,
          notificationType: "digest",
          eventCount: detected.length,
          grantCount: groupDigestItems(detected).length,
          delivery: delivery.status,
        });
        if (delivery.status === "sent") {
          detected.forEach((event) => {
            notifiedEvents.add(event.key);
            previouslyNotified.add(event.grant.opportunity.id);
          });
        }
      } catch (error) {
        allDelivered = false;
        results.push({
          watchId: storedWatch.id,
          notificationType: "digest",
          delivery: "failed",
          error: error instanceof Error ? error.message : "Unknown email failure",
        });
      }
    } else {
      for (const event of detected) {
        const message = buildWatchAlertEmail(normalizedWatch, event.grant, {
          notificationType: event.notificationType,
          daysRemaining: event.daysRemaining,
        });
        try {
          const delivery = await mailer.send({
            to: normalizedWatch.email,
            ...message,
          });
          results.push({
            watchId: storedWatch.id,
            grantId: event.grant.opportunity.id,
            notificationType: event.notificationType,
            delivery: delivery.status,
          });
          if (delivery.status === "sent") {
            notifiedEvents.add(event.key);
            previouslyNotified.add(event.grant.opportunity.id);
          } else {
            allDelivered = false;
          }
        } catch (error) {
          allDelivered = false;
          results.push({
            watchId: storedWatch.id,
            grantId: event.grant.opportunity.id,
            notificationType: event.notificationType,
            delivery: "failed",
            error: error instanceof Error ? error.message : "Unknown email failure",
          });
        }
      }
    }

    await repository.saveWatch({
      ...normalizedWatch,
      nextCheckAt: nextWatchCheck(frequency, now),
      lastCheckedAt: checkedAt,
      // Preview-only and failed sends intentionally keep the previous source
      // baseline. The same change remains detectable after credentials recover.
      lastSeenGrantState: allDelivered ? refreshedState : previousState,
      lastNotifiedGrantIds: [...previouslyNotified],
      lastNotifiedEventKeys: [...notifiedEvents],
    });
  }

  return {
    checkedAt,
    watchCount: activeWatches.length,
    events: results,
  };
}
