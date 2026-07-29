import type { OrganizationProfile, ProjectProfile } from "../domain/types.js";
import { inferAwardRange } from "./grantSearchService.js";

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
};

const TOPIC_RULES: { pattern: RegExp; topics: string[]; title: string }[] = [
  {
    pattern: /\b(free food|food pantry|food bank|food insecurity|food security|hunger|hungry|meal delivery|community meals?|food rescue|emergency food|nutrition assistance)\b/i,
    topics: ["food security", "hunger relief", "emergency food assistance", "meal distribution", "nutrition access"],
    title: "Food Access and Hunger Relief",
  },
  {
    pattern: /\b(artificial intelligence|ai literacy|machine learning|practical ai|responsible ai)\b/i,
    topics: ["artificial intelligence education", "AI literacy", "digital skills"],
    title: "Practical AI Skills",
  },
  {
    pattern: /\b(workforce|job training|employment|career pathways?|upskill|reskill|economic mobility)\b/i,
    topics: ["workforce development", "job training", "career pathways", "economic mobility"],
    title: "Workforce and Economic Mobility",
  },
  {
    pattern: /\b(housing|homelessness|homeless|shelter|affordable housing)\b/i,
    topics: ["housing stability", "homelessness prevention", "emergency shelter"],
    title: "Housing Stability",
  },
  {
    pattern: /\b(mental health|healthcare|health care|public health|community health)\b/i,
    topics: ["community health", "health access", "public health"],
    title: "Community Health",
  },
  {
    pattern: /\b(arts?|cultural|culture|museum|music|theater|theatre)\b/i,
    topics: ["community arts", "arts education", "cultural preservation"],
    title: "Community Arts and Culture",
  },
  {
    pattern: /\b(environment|conservation|climate|clean water|sustainability)\b/i,
    topics: ["environmental conservation", "climate resilience", "sustainability"],
    title: "Environmental Resilience",
  },
  {
    pattern: /\b(youth|children|child care|afterschool|after-school)\b/i,
    topics: ["youth development", "child and family services", "out-of-school learning"],
    title: "Youth and Family Support",
  },
];

const POPULATION_RULES: [RegExp, string][] = [
  [/\b(low-income|low income|economically disadvantaged)\b/i, "low-income people"],
  [/\b(homeless|unhoused|housing insecure)\b/i, "people experiencing homelessness"],
  [/\b(children|youth|young people)\b/i, "children and youth"],
  [/\b(seniors?|older adults?)\b/i, "older adults"],
  [/\b(veterans?)\b/i, "veterans"],
  [/\b(immigrants?|refugees?)\b/i, "immigrants and refugees"],
  [/\b(rural)\b/i, "rural communities"],
  [/\b(tribal|native american|american indian)\b/i, "Tribal communities"],
];

function inferState(query: string) {
  const lower = query.toLowerCase();
  for (const [name, abbreviation] of Object.entries(US_STATES).sort((a, b) => b[0].length - a[0].length)) {
    if (new RegExp(`\\b${name.replaceAll(" ", "\\s+")}\\b`, "i").test(lower)) {
      return { abbreviation, name: name.replace(/\b\w/g, (letter) => letter.toUpperCase()) };
    }
  }
  const abbreviation = query.match(/\b(?:in|serving|across|throughout)\s+([A-Z]{2})\b/)?.[1];
  if (abbreviation && Object.values(US_STATES).includes(abbreviation)) {
    const name = Object.entries(US_STATES).find(([, value]) => value === abbreviation)?.[0] ?? abbreviation;
    return { abbreviation, name: name.replace(/\b\w/g, (letter) => letter.toUpperCase()) };
  }
  return undefined;
}

function inferTopics(query: string) {
  const matches = TOPIC_RULES.filter((rule) => rule.pattern.test(query));
  if (matches.length) {
    return {
      topics: [...new Set(matches.flatMap((match) => match.topics))],
      title: matches[0]!.title,
    };
  }
  const terms = query.toLowerCase()
    .replace(/\$?\d[\d,]*(?:\.\d+)?/g, " ")
    .replace(/[^a-z -]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 3 && ![
      "find", "possible", "grants", "grant", "nonprofit", "organization", "provides",
      "provide", "which", "between", "need", "needs", "from", "with",
    ].includes(term));
  return { topics: [...new Set(terms)].slice(0, 8), title: "Community Program" };
}

export function inferProfilesFromQuery(query: string) {
  const state = inferState(query);
  const inferred = inferTopics(query);
  const targetPopulations = POPULATION_RULES
    .filter(([pattern]) => pattern.test(query))
    .map(([, population]) => population);
  const range = inferAwardRange(query);
  const estimatedBudget = range.minimumAward !== undefined && range.maximumAward !== undefined
    ? Math.round((range.minimumAward + range.maximumAward) / 2)
    : range.maximumAward ?? range.minimumAward;
  const geography = state
    ? [{ country: "US", states: [state.abbreviation], description: `${state.name} service area.` }]
    : [{ country: "US", nationwide: true, description: "United States; no state was specified." }];

  const organization: OrganizationProfile = {
    id: "org-from-query",
    name: state ? `${state.name} nonprofit` : "Nonprofit organization",
    organizationType: /\b(small business|company|for-profit)\b/i.test(query) ? "small business" : "nonprofit",
    headquarters: { state: state?.abbreviation, country: "US" },
    serviceAreas: geography,
    missionTopics: inferred.topics,
    populationsServed: targetPopulations,
    applicationCapacity: "medium",
    registrations: { samGov: "unknown", grantsGov: "unknown" },
  };
  const project: ProjectProfile = {
    id: "project-from-query",
    title: inferred.title,
    summary: query.trim(),
    topics: inferred.topics,
    targetPopulations,
    geographicAreas: geography,
    estimatedBudget,
  };
  return { organization, project };
}

export function mergeProfilesFromRequest(
  query: string | undefined,
  organization?: Partial<OrganizationProfile>,
  project?: Partial<ProjectProfile>,
) {
  const inferred = query?.trim()
    ? inferProfilesFromQuery(query)
    : inferProfilesFromQuery("Nonprofit community program in the United States");
  const queryNamesState = Boolean(query?.trim() && inferred.organization.headquarters.state);
  const queryNamesMission = Boolean(query?.trim() && inferred.project.title !== "Community Program");
  const queryAwardRange = inferAwardRange(query);
  const queryNamesBudget = Boolean(query?.trim() &&
    (queryAwardRange.minimumAward !== undefined || queryAwardRange.maximumAward !== undefined));
  const requestOrganization = organization?.id === "org-nwdf" && queryNamesMission
    ? undefined
    : organization;
  const requestProject = project?.id === "project-ai-mobility" && queryNamesMission
    ? undefined
    : project;
  return {
    organization: {
      ...inferred.organization,
      ...requestOrganization,
      headquarters: queryNamesState
        ? inferred.organization.headquarters
        : { ...inferred.organization.headquarters, ...requestOrganization?.headquarters },
      serviceAreas: queryNamesState
        ? inferred.organization.serviceAreas
        : requestOrganization?.serviceAreas?.length ? requestOrganization.serviceAreas : inferred.organization.serviceAreas,
      missionTopics: queryNamesMission
        ? inferred.organization.missionTopics
        : requestOrganization?.missionTopics?.length ? requestOrganization.missionTopics : inferred.organization.missionTopics,
      populationsServed: requestOrganization?.populationsServed?.length
        ? requestOrganization.populationsServed
        : inferred.organization.populationsServed,
    } satisfies OrganizationProfile,
    project: {
      ...inferred.project,
      ...requestProject,
      title: queryNamesMission ? inferred.project.title : requestProject?.title ?? inferred.project.title,
      summary: query?.trim() || requestProject?.summary || inferred.project.summary,
      geographicAreas: queryNamesState
        ? inferred.project.geographicAreas
        : requestProject?.geographicAreas?.length ? requestProject.geographicAreas : inferred.project.geographicAreas,
      topics: queryNamesMission
        ? inferred.project.topics
        : requestProject?.topics?.length ? requestProject.topics : inferred.project.topics,
      targetPopulations: requestProject?.targetPopulations?.length
        ? requestProject.targetPopulations
        : inferred.project.targetPopulations,
      estimatedBudget: queryNamesBudget ? inferred.project.estimatedBudget : requestProject?.estimatedBudget,
    } satisfies ProjectProfile,
  };
}
