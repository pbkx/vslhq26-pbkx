import { createHash, randomUUID } from "node:crypto";
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
import {
  refreshSavedSearch,
  refreshSelectedGrant,
  type SelectedGrantRefreshResult,
} from "./grantSearchService.js";
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
> & Partial<Pick<
  typeof grantRepository,
  "acquireWatchRunLease" | "releaseWatchRunLease"
>>;

type WatchRunnerOptions = {
  repository?: WatchRepository;
  mailer?: EmailService;
  refreshSearch?: (search: SearchOutput) => Promise<SearchOutput>;
  refreshSelected?: (
    search: SearchOutput,
    grantId: string,
  ) => Promise<SelectedGrantRefreshResult>;
  now?: () => number;
  leaseOwner?: string;
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
  "opportunity-closed",
  "opportunity-removed",
  "no-longer-matching",
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
        opportunityStatus: grant.opportunity.opportunityStatus,
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
  previousGrants: Map<string, GrantResult>,
  notifiedEvents: Set<string>,
  now: number,
  selectedRefresh?: SelectedGrantRefreshResult,
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
  const candidateIds = new Set(candidates.map((grant) => grant.opportunity.id));
  const refreshedById = new Map(
    refreshed.grants.map((grant) => [grant.opportunity.id, grant] as const),
  );

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
      notificationTypes.includes("opportunity-closed")
        && previous
        && ["closed", "archived"].includes(grant.opportunity.opportunityStatus)
        && previous.opportunityStatus !== grant.opportunity.opportunityStatus
        ? {
          grant,
          notificationType: "opportunity-closed",
          key: `opportunity-closed:${id}:${grant.opportunity.opportunityStatus}`,
          daysRemaining,
        }
        : undefined,
    ];
    for (const event of possible) {
      if (event && !notifiedEvents.has(event.key)) events.push(event);
    }
  }

  if (
    watch.scope === "selected-grant"
    && selectedRefresh?.status === "removed"
    && notificationTypes.includes("opportunity-removed")
  ) {
    const id = selectedRefresh.previousGrant.opportunity.id;
    const event = {
      grant: selectedRefresh.previousGrant,
      notificationType: "opportunity-removed" as const,
      key: `opportunity-removed:${id}`,
    };
    if (!notifiedEvents.has(event.key)) events.push(event);
  }

  if (
    watch.scope === "search"
    && notificationTypes.includes("no-longer-matching")
  ) {
    for (const [id, previous] of Object.entries(previousState)) {
      if (previous.score < watch.minimumScore || candidateIds.has(id)) continue;
      const oldGrant = previousGrants.get(id);
      if (!oldGrant) continue;
      const current = refreshedById.get(id);
      if (current && ["closed", "archived"].includes(current.opportunity.opportunityStatus)) {
        continue;
      }
      const key = `no-longer-matching:${id}:${previous.fingerprint}`;
      if (!notifiedEvents.has(key)) {
        events.push({
          grant: current ?? oldGrant,
          notificationType: "no-longer-matching",
          key,
          daysRemaining: current ? daysUntil(current, now) : undefined,
        });
      }
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
  const refreshSelected = options.refreshSelected ?? refreshSelectedGrant;
  const now = options.now?.() ?? Date.now();
  const checkedAt = new Date(now).toISOString();
  const results: Array<Record<string, unknown>> = [];
  const leaseOwner = options.leaseOwner ?? `watch-run-${process.pid}-${randomUUID()}`;
  const leaseAcquired = repository.acquireWatchRunLease
    ? await repository.acquireWatchRunLease(leaseOwner)
    : true;
  if (!leaseAcquired) {
    return {
      checkedAt,
      watchCount: 0,
      events: [],
      status: "skipped-overlapping-run",
    };
  }
  try {
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
      unsubscribeToken: storedWatch.unsubscribeToken
        ?? randomUUID().replaceAll("-", ""),
      deadlineLeadDays: storedWatch.deadlineLeadDays ?? 14,
      notificationTypes: storedWatch.notificationTypes?.length
        ? storedWatch.notificationTypes
        : DEFAULT_NOTIFICATIONS,
    };
    const previouslyNotified = new Set(storedWatch.lastNotifiedGrantIds ?? []);
    const notifiedEvents = new Set(storedWatch.lastNotifiedEventKeys ?? []);
    let savedSearch: SearchOutput;
    let refreshed: SearchOutput;
    let selectedRefresh: SelectedGrantRefreshResult | undefined;

    try {
      savedSearch = repository.getSearch(storedWatch.queryId);
      if (scope === "selected-grant") {
        if (!storedWatch.selectedGrantId) throw new Error("Selected grant watch has no grant ID.");
        selectedRefresh = await refreshSelected(savedSearch, storedWatch.selectedGrantId);
        if (selectedRefresh.status === "unavailable") {
          throw new Error(selectedRefresh.error);
        }
        refreshed = {
          ...savedSearch,
          searchedAt: checkedAt,
          grants: selectedRefresh.status === "found" ? [selectedRefresh.grant] : [],
          resultCount: selectedRefresh.status === "found" ? 1 : 0,
        };
      } else {
        refreshed = await refreshSearch(savedSearch);
      }
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
    const previousGrants = new Map(
      savedSearch.grants.map((grant) => [grant.opportunity.id, grant] as const),
    );
    const detected = detectEvents(
      normalizedWatch,
      refreshed,
      previousState,
      previousGrants,
      notifiedEvents,
      now,
      selectedRefresh,
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
      // Failed sends intentionally keep the previous source baseline. The same
      // change remains detectable after email delivery recovers.
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
  } finally {
    if (repository.releaseWatchRunLease) {
      await repository.releaseWatchRunLease(leaseOwner);
    }
  }
}
