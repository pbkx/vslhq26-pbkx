export type Weights = {
  missionAlignment: number;
  applicantEligibility: number;
  geographicFit: number;
  programSizeFit: number;
  historicalSimilarity: number;
  deadlineFeasibility: number;
};

export type Component = {
  score: number;
  weight: number;
  weightedContribution: number;
  confidence: number;
  reasons: string[];
  missingData: string[];
};

export type GrantResult = {
  opportunity: {
    id: string;
    source: "irs-990pf" | "grants-gov";
    recordCategory:
      | "current-federal-opportunity"
      | "forecasted-federal-opportunity"
      | "private-funder-prospect";
    title: string;
    funderName: string;
    summary: string;
    awardMin?: number;
    awardMax?: number;
    deadline?: string;
    requiresCostShare?: boolean;
    sourceUrl: string;
    applicationUrl?: string;
    sourceDisclaimer: string;
    lastVerifiedAt?: string;
    requirements: { text: string }[];
  };
  score: {
    overallScore: number;
    eligibilityStatus: string;
    components: Record<keyof Weights, Component>;
    hardExclusions: string[];
    warnings: string[];
  };
  chart: {
    applicationEffort: number;
    matchScore: number;
    awardAmount?: number;
    daysRemaining?: number;
  };
  detailsLoaded?: boolean;
};

export type GraphGrantWire = {
  id: string;
  title: string;
  funder: string;
  source: "irs-990pf" | "grants-gov";
  category: GrantResult["opportunity"]["recordCategory"];
  summary?: string;
  awardMin?: number;
  awardMax?: number;
  deadline?: string;
  costShare?: boolean;
  sourceUrl: string;
  applicationUrl?: string;
  score: number;
  eligibility: string;
  effort: number;
  days?: number;
  components: number[];
  confidence: number;
};

export type SearchContext = {
  organizationName?: string;
  organizationLocation?: string;
  projectTitle?: string;
  projectSummary?: string;
  projectBudget?: number;
  minimumAward?: number;
  maximumAward?: number;
  targetPopulations?: string[];
};

export type SearchOutput = {
  queryId: string;
  searchedAt?: string;
  resultCount: number;
  totalResultCount?: number;
  offset?: number;
  nextOffset?: number;
  hasMore?: boolean;
  append?: boolean;
  allRecordsLoaded?: boolean;
  compactGraphPayload?: boolean;
  sourceCounts: Record<string, number>;
  weights: Weights;
  grants: GrantResult[];
  warnings: string[];
  context?: SearchContext;
};

export type SearchOutputWire = Omit<SearchOutput, "grants"> & {
  grants: GraphGrantWire[];
};
