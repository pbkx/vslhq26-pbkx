import { App } from "@modelcontextprotocol/ext-apps";
import type {
  Component,
  GrantResult,
  GraphGrantWire,
  SearchOutput,
  SearchOutputWire,
  Weights,
} from "./types";

const SCORE_KEYS: (keyof Weights)[] = [
  "missionAlignment",
  "applicantEligibility",
  "geographicFit",
  "programSizeFit",
  "historicalSimilarity",
  "deadlineFeasibility",
];

export const mcpApp = new App(
  { name: "Grant Opportunity Workbench", version: "1.0.0" },
  {},
  { autoResize: true },
);

let listener: (data: SearchOutput) => void = () => {};
let errors: (message: string) => void = () => {};

function isGraphGrant(value: unknown): value is GraphGrantWire {
  const grant = value as GraphGrantWire;
  return Boolean(grant?.id && grant?.title && Array.isArray(grant?.components));
}

function graphGrantToResult(grant: GraphGrantWire, weights: Weights): GrantResult {
  const components = Object.fromEntries(
    SCORE_KEYS.map((key, index) => {
      const score = grant.components[index] ?? 0;
      const weight = weights[key];
      const component: Component = {
        score,
        weight,
        weightedContribution: score * weight,
        confidence: grant.confidence,
        reasons: [],
        missingData: [],
      };
      return [key, component];
    }),
  ) as Record<keyof Weights, Component>;

  const historical = grant.source === "irs-990pf";
  return {
    opportunity: {
      id: grant.id,
      source: grant.source,
      recordCategory: grant.category,
      title: grant.title,
      funderName: grant.funder,
      summary: grant.summary ?? "Loading complete description and decision evidence…",
      awardMin: grant.awardMin,
      awardMax: grant.awardMax,
      deadline: grant.deadline,
      requiresCostShare: grant.costShare,
      sourceUrl: grant.sourceUrl,
      applicationUrl: grant.applicationUrl,
      sourceDisclaimer: historical
        ? "Evidence-backed potential private donor/funder candidate worth researching and possibly contacting."
        : "Verify current requirements at the official source.",
      requirements: [],
    },
    score: {
      overallScore: grant.score,
      eligibilityStatus: grant.eligibility,
      components,
      hardExclusions: [],
      warnings: [],
    },
    chart: {
      applicationEffort: grant.effort,
      matchScore: grant.score,
      awardAmount: grant.awardMax ?? grant.awardMin,
      daysRemaining: grant.days,
    },
    detailsLoaded: false,
  };
}

function extract(value: unknown): SearchOutput | undefined {
  const candidate = value as SearchOutputWire;
  if (!candidate?.queryId || !candidate.weights || !Array.isArray(candidate.grants)) return undefined;
  if (!candidate.grants.length) return candidate as unknown as SearchOutput;
  if (!isGraphGrant(candidate.grants[0])) return candidate as unknown as SearchOutput;
  return {
    ...candidate,
    grants: candidate.grants.map((grant) => graphGrantToResult(grant, candidate.weights)),
  };
}

export function setBridgeListeners(
  onData: (data: SearchOutput) => void,
  onError: (message: string) => void,
) {
  listener = onData;
  errors = onError;
}

export async function connectBridge() {
  const preview = (globalThis as any).__GRANTPILOT_PREVIEW_DATA__ as SearchOutputWire | undefined;
  if (preview) {
    document.documentElement.dataset.theme = "light";
    const data = extract(preview);
    if (data) listener(data);
    return;
  }

  mcpApp.ontoolresult = (result) => {
    const data = extract(result.structuredContent);
    if (data) listener(data);
  };
  mcpApp.onhostcontextchanged = (context) => {
    document.documentElement.dataset.theme = context.theme ?? "light";
  };

  try {
    await mcpApp.connect();
    document.documentElement.dataset.theme = mcpApp.getHostContext()?.theme ?? "light";
  } catch (error) {
    errors(error instanceof Error ? error.message : "Host bridge unavailable");
  }
}

export async function callTool(name: string, args: Record<string, unknown>) {
  if (!mcpApp.getHostCapabilities()?.serverTools) {
    throw new Error("This host does not allow widget tool calls.");
  }
  const result = await mcpApp.callServerTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(
      (result.content.find((item: any) => item.type === "text") as any)?.text ?? "Tool failed",
    );
  }
  const data = extract(result.structuredContent);
  if (data) listener(data);
  return result.structuredContent as any;
}

export async function followUp(prompt: string) {
  if (!mcpApp.getHostCapabilities()?.message) {
    throw new Error("This host cannot send a follow-up message.");
  }
  await mcpApp.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] });
}

export async function openLink(url: string) {
  if (mcpApp.getHostCapabilities()?.openLinks) {
    const result = await mcpApp.openLink({ url });
    if (!result.isError) return;
  }
  await navigator.clipboard?.writeText(url);
  throw new Error("Source link copied because direct navigation is unavailable.");
}

const DEFAULT_COPILOT_URL = "https://m365.cloud.microsoft/chat";
const ALLOWED_COPILOT_HOSTS = new Set([
  "m365.cloud.microsoft",
  "www.microsoft365.com",
  "www.office.com",
  "teams.microsoft.com",
]);

function safeCopilotUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    const allowed = url.protocol === "https:"
      && (ALLOWED_COPILOT_HOSTS.has(url.hostname) || url.hostname.endsWith(".teams.microsoft.com"));
    return allowed ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function getCopilotReturnUrl() {
  const hostContext = (mcpApp.getHostContext() ?? {}) as Record<string, unknown>;
  const microsoftContext = (
    typeof hostContext.microsoft === "object" && hostContext.microsoft
      ? hostContext.microsoft
      : {}
  ) as Record<string, unknown>;
  const candidates = [
    hostContext.conversationUrl,
    hostContext.chatUrl,
    hostContext.returnUrl,
    microsoftContext.conversationUrl,
    microsoftContext.chatUrl,
    document.referrer,
  ];
  for (const candidate of candidates) {
    const url = safeCopilotUrl(candidate);
    if (url) return url;
  }
  return DEFAULT_COPILOT_URL;
}
