import type {
  GrantWatchFrequency,
  GrantWatchMatchQuality,
} from "../domain/types.js";
import { grantRepository } from "../repositories/grantRepository.js";
import { emailService } from "./emailService.js";
import { buildWatchAlertEmail } from "./watchEmailTemplates.js";
import {
  nextWatchCheck,
  qualityFromMinimumScore,
  WATCH_NOTIFICATION_LABELS,
  WATCH_QUALITY,
} from "./watchPreferences.js";

export async function runGrantWatchChecks() {
  const events = [];
  for (const storedWatch of grantRepository.listWatches().filter((item) => item.status === "active")) {
    if (storedWatch.nextCheckAt && Date.parse(storedWatch.nextCheckAt) > Date.now()) continue;
    const matchQuality = (storedWatch.matchQuality
      ?? qualityFromMinimumScore(storedWatch.minimumScore)) as GrantWatchMatchQuality;
    const frequency = (storedWatch.frequency ?? "daily") as GrantWatchFrequency;
    const scope = storedWatch.scope ?? (storedWatch.selectedGrantId ? "selected-grant" : "search");
    const minimumScore = storedWatch.minimumScore ?? WATCH_QUALITY[matchQuality].minimumScore;
    const previouslyNotified = new Set(storedWatch.lastNotifiedGrantIds ?? []);
    const notifiedEvents = new Set(storedWatch.lastNotifiedEventKeys ?? []);
    const search = grantRepository.getSearch(storedWatch.queryId);
    const candidates = search.grants
      .filter((grant) => scope !== "selected-grant" || grant.opportunity.id === storedWatch.selectedGrantId)
      .filter((grant) => scope === "selected-grant" || grant.score.overallScore >= minimumScore);
    const alert = candidates.map((grant) => {
      const daysRemaining = grant.chart.daysRemaining
        ?? (grant.opportunity.deadline
          ? Math.ceil((Date.parse(grant.opportunity.deadline) - Date.now()) / 86_400_000)
          : undefined);
      const events = [
        storedWatch.notificationTypes.includes("opportunity-closing")
          && daysRemaining !== undefined
          && daysRemaining >= 0
          && daysRemaining <= (storedWatch.deadlineLeadDays ?? 14)
          ? {
            key: `opportunity-closing:${grant.opportunity.id}:${grant.opportunity.deadline}`,
            label: WATCH_NOTIFICATION_LABELS["opportunity-closing"],
          }
          : undefined,
        storedWatch.notificationTypes.includes("deadline-change")
          && grant.opportunity.lastUpdated
          && Date.parse(grant.opportunity.lastUpdated) > Date.parse(storedWatch.createdAt)
          ? {
            key: `deadline-change:${grant.opportunity.id}:${grant.opportunity.deadline}:${grant.opportunity.lastUpdated}`,
            label: WATCH_NOTIFICATION_LABELS["deadline-change"],
          }
          : undefined,
        storedWatch.notificationTypes.includes("opportunity-amended")
          && grant.opportunity.lastUpdated
          && Date.parse(grant.opportunity.lastUpdated) > Date.parse(storedWatch.createdAt)
          ? {
            key: `opportunity-amended:${grant.opportunity.id}:${grant.opportunity.lastUpdated}`,
            label: WATCH_NOTIFICATION_LABELS["opportunity-amended"],
          }
          : undefined,
        storedWatch.notificationTypes.includes("score-increased")
          && grant.score.overallScore > minimumScore
          ? {
            key: `score-increased:${grant.opportunity.id}:${grant.score.overallScore}`,
            label: WATCH_NOTIFICATION_LABELS["score-increased"],
          }
          : undefined,
        storedWatch.notificationTypes.includes("new-match")
          && !previouslyNotified.has(grant.opportunity.id)
          ? {
            key: `new-match:${grant.opportunity.id}`,
            label: WATCH_NOTIFICATION_LABELS["new-match"],
          }
          : undefined,
      ].find((event) => event && !notifiedEvents.has(event.key));
      return events ? { grant, event: events } : undefined;
    }).find((candidate) => candidate !== undefined);

    if (!alert) {
      await grantRepository.saveWatch({
        ...storedWatch,
        matchQuality,
        frequency,
        scope,
        minimumScore,
        deadlineLeadDays: storedWatch.deadlineLeadDays ?? 14,
        nextCheckAt: nextWatchCheck(frequency),
      });
      continue;
    }

    const notificationType = alert.event.key.split(":")[0] as
      | "new-match"
      | "deadline-change"
      | "opportunity-amended"
      | "opportunity-closing"
      | "score-increased";
    const message = buildWatchAlertEmail({
      ...storedWatch,
      matchQuality,
      frequency,
      scope,
      minimumScore,
      deadlineLeadDays: storedWatch.deadlineLeadDays ?? 14,
    }, alert.grant, {
      notificationType,
      daysRemaining: alert.grant.chart.daysRemaining
        ?? (alert.grant.opportunity.deadline
          ? Math.ceil((Date.parse(alert.grant.opportunity.deadline) - Date.now()) / 86_400_000)
          : undefined),
    });
    const delivery = await emailService.send({ to: storedWatch.email, ...message });
    previouslyNotified.add(alert.grant.opportunity.id);
    notifiedEvents.add(alert.event.key);
    await grantRepository.saveWatch({
      ...storedWatch,
      matchQuality,
      frequency,
      scope,
      minimumScore,
      deadlineLeadDays: storedWatch.deadlineLeadDays ?? 14,
      nextCheckAt: nextWatchCheck(frequency),
      lastNotifiedGrantIds: [...previouslyNotified],
      lastNotifiedEventKeys: [...notifiedEvents],
    });
    events.push({
      watchId: storedWatch.id,
      grantId: alert.grant.opportunity.id,
      notificationType,
      matchQuality,
      delivery: delivery.status,
    });
  }
  return {
    checkedAt: new Date().toISOString(),
    watchCount: grantRepository.listWatches().length,
    events,
  };
}
