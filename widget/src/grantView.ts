import type { GrantResult, Weights } from "./types";

export type ViewId = "matrix" | "award" | "heatmap" | "deadlines";
export type SourceFilter = "all" | "grants-gov" | "irs-990pf";
export type EligibilityFilter = "all" | "eligible" | "verify" | "ineligible";
export type AwardFilter = "all" | "under-100k" | "100k-500k" | "over-500k";

export type Filters = {
  source: SourceFilter;
  eligibility: EligibilityFilter;
  minScore: number;
  award: AwardFilter;
};

export const DEFAULT_FILTERS: Filters = {
  source: "all",
  eligibility: "all",
  minScore: 0,
  award: "all",
};

export const SCORE_LABELS: Record<keyof Weights, string> = {
  missionAlignment: "Mission",
  applicantEligibility: "Eligibility",
  geographicFit: "Geography",
  programSizeFit: "Award fit",
  historicalSimilarity: "History",
  deadlineFeasibility: "Deadline",
};

export const SCORE_KEYS = Object.keys(SCORE_LABELS) as (keyof Weights)[];

export function eligibilityKind(value: string): Exclude<EligibilityFilter, "all"> {
  if (value === "likely-ineligible") return "ineligible";
  if (value === "confirmed" || value === "likely") return "eligible";
  return "verify";
}

export function eligibilityLabel(value: string) {
  const kind = eligibilityKind(value);
  return kind === "eligible" ? "Likely eligible" : kind === "ineligible" ? "Likely ineligible" : "Needs verification";
}

export function sourceLabel(grant: GrantResult) {
  if (grant.opportunity.source === "irs-990pf") return "IRS 990-PF";
  return grant.opportunity.recordCategory === "forecasted-federal-opportunity" ? "Grants.gov forecast" : "Grants.gov";
}

export function formatMoney(value?: number) {
  if (value === undefined) return "Not stated";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}

export function awardRange(grant: GrantResult) {
  const { awardMin, awardMax } = grant.opportunity;
  if (awardMin === undefined && awardMax === undefined) return "Award not stated";
  if (awardMin !== undefined && awardMax !== undefined && awardMin !== awardMax) {
    return `${formatMoney(awardMin)}–${formatMoney(awardMax)}`;
  }
  return formatMoney(awardMax ?? awardMin);
}

export function formatDeadline(grant: GrantResult) {
  if (grant.opportunity.source === "irs-990pf") return "Research required";
  if (!grant.opportunity.deadline) return "Deadline not stated";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${grant.opportunity.deadline}T12:00:00Z`),
  );
}

export function confidence(grant: GrantResult) {
  const values = Object.values(grant.score.components);
  return Math.round(values.reduce((sum, component) => sum + component.confidence, 0) / values.length);
}

export function applyFilters(grants: GrantResult[], filters: Filters) {
  return grants
    .filter((grant) => filters.source === "all" || grant.opportunity.source === filters.source)
    .filter((grant) => filters.eligibility === "all" || eligibilityKind(grant.score.eligibilityStatus) === filters.eligibility)
    .filter((grant) => grant.score.overallScore >= filters.minScore)
    .filter((grant) => {
      const amount = grant.opportunity.awardMax ?? grant.opportunity.awardMin;
      if (filters.award === "all") return true;
      if (amount === undefined) return false;
      if (filters.award === "under-100k") return amount < 100_000;
      if (filters.award === "100k-500k") return amount >= 100_000 && amount <= 500_000;
      return amount > 500_000;
    })
    .sort((a, b) => b.score.overallScore - a.score.overallScore);
}

export function scoreTone(value: number) {
  if (value >= 80) return "top";
  if (value >= 65) return "high";
  if (value >= 50) return "mid";
  return "low";
}
