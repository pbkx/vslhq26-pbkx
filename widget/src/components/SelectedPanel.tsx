import { useState } from "react";
import type { GrantResult } from "../types";
import {
  awardRange,
  confidence,
  eligibilityKind,
  eligibilityLabel,
  formatDeadline,
  SCORE_KEYS,
  SCORE_LABELS,
  sourceLabel,
} from "../grantView";

function ScoreRing({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 25;
  return (
    <div className="score-ring" aria-label={`${value} percent match`}>
      <svg viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="25" />
        <circle
          className="progress"
          cx="30"
          cy="30"
          r="25"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
        />
      </svg>
      <strong>{value}</strong>
      <small>match</small>
    </div>
  );
}

function EvidenceSection({ label, children }: { label: string; children: string }) {
  return (
    <section className="analysis-section">
      <h3>{label}</h3>
      <p>{children}</p>
    </section>
  );
}

function firstText(values: Array<string | undefined>, fallback: string) {
  return values.find((value): value is string => Boolean(value?.trim())) ?? fallback;
}

function ActionIcon({ name }: { name: "source" | "compare" | "watch" | "copilot" }) {
  const common = {
    "aria-hidden": true,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
  };

  if (name === "source") {
    return (
      <svg {...common}>
        <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" />
        <path d="M14 3.5V8h4" />
        <circle cx="8.25" cy="14.25" r="2.25" />
        <path d="m9.9 15.9 1.8 1.8" />
      </svg>
    );
  }

  if (name === "compare") {
    return (
      <svg {...common}>
        <circle cx="6" cy="5" r="1.75" />
        <circle cx="18" cy="7" r="1.75" />
        <circle cx="18" cy="18" r="1.75" />
        <path d="M6 6.75v7.5A3.75 3.75 0 0 0 9.75 18H16.2" />
        <path d="m14.6 15.7 2.3 2.3-2.3 2.3" />
        <path d="M7.75 5h4.5A3.75 3.75 0 0 1 16 8.75v.5" />
        <path d="m13.7 7.7 2.3 2.3 2.3-2.3" />
      </svg>
    );
  }

  if (name === "watch") {
    return (
      <svg {...common}>
        <path d="M15.5 18.5h-11c1.4-1.6 2-3.45 2-5.55V10a5.5 5.5 0 0 1 8.9-4.35" />
        <path d="M9.25 21a2.25 2.25 0 0 0 4.1 0" />
        <path d="M19 5v6M16 8h6" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="m9 3 .75 2.25A4.8 4.8 0 0 0 12.8 8.3L15 9l-2.2.7a4.8 4.8 0 0 0-3.05 3.05L9 15l-.75-2.25A4.8 4.8 0 0 0 5.2 9.7L3 9l2.2-.7a4.8 4.8 0 0 0 3.05-3.05L9 3Z" />
      <path d="m17.5 12 .45 1.3a3.25 3.25 0 0 0 2.05 2.05l1.25.4-1.25.4a3.25 3.25 0 0 0-2.05 2.05l-.45 1.3-.45-1.3A3.25 3.25 0 0 0 15 16.15l-1.25-.4 1.25-.4a3.25 3.25 0 0 0 2.05-2.05l.45-1.3Z" />
    </svg>
  );
}

export function SelectedPanel({
  grant,
  inComparison,
  comparisonCount,
  onToggleComparison,
  onCompareSelected,
  onOpenSource,
  onAskCopilot,
  onCreateWatch,
}: {
  grant: GrantResult;
  inComparison: boolean;
  comparisonCount: number;
  onToggleComparison: () => void;
  onCompareSelected: () => void;
  onOpenSource: () => void;
  onAskCopilot: () => void;
  onCreateWatch: (email: string) => Promise<void>;
}) {
  const [watchOpen, setWatchOpen] = useState(false);
  const [email, setEmail] = useState("grants@example.org");
  const [busy, setBusy] = useState(false);
  const kind = eligibilityKind(grant.score.eligibilityStatus);
  const warnings = [...grant.score.hardExclusions, ...grant.score.warnings];
  const eligibility = grant.score.components.applicantEligibility;
  const geography = grant.score.components.geographicFit;
  const mission = grant.score.components.missionAlignment;
  const historicalSimilarity = grant.score.components.historicalSimilarity;
  const whyMatches = firstText(
    [
      mission.reasons[0],
      grant.score.components.programSizeFit.reasons[0],
      historicalSimilarity.reasons[0],
    ],
    "GrantPilot found overlapping mission, applicant, geography, and award evidence.",
  );
  const eligibilityConcern = firstText(
    [
      grant.score.hardExclusions[0],
      grant.score.warnings[0],
      eligibility.missingData[0],
    ],
    kind === "eligible"
      ? "No major eligibility exclusion was found in the indexed record; confirm the official notice before applying."
      : "Applicant eligibility could not be fully confirmed from the indexed source data.",
  );
  const geographicEvidence = firstText(
    [geography.reasons[0], geography.missingData[0]],
    "The indexed record does not provide enough geographic detail; verify the official funding area.",
  );
  const comparisonReady = comparisonCount >= 2;
  const historical = grant.opportunity.source === "irs-990pf";

  return (
    <aside className="selected-panel">
      <div className="panel-topline">
        <div className="panel-badges">
          <span className={`source-badge ${historical ? "private" : "federal"}`}>{sourceLabel(grant)}</span>
          <span className={`eligibility-badge ${kind}`}>{eligibilityLabel(grant.score.eligibilityStatus)}</span>
        </div>
        <ScoreRing value={grant.score.overallScore} />
      </div>

      <div className="selected-title">
        <div>
          <h2>{grant.opportunity.title}</h2>
          <p>{grant.opportunity.funderName}</p>
        </div>
      </div>

      <div className="selected-facts">
        <div><span>Award range</span><strong>{awardRange(grant)}</strong></div>
        <div><span>{historical ? "Status" : "Deadline"}</span><strong>{formatDeadline(grant)}</strong></div>
        <div><span>Confidence</span><strong>{confidence(grant)}%</strong></div>
        <div><span>Pursuit effort</span><strong>{grant.chart.applicationEffort}/100</strong></div>
      </div>

      <div className="panel-divider" />

      <div className="selected-analysis-grid">
        <EvidenceSection label="Description">{grant.opportunity.summary}</EvidenceSection>
        <EvidenceSection label="Why it matches">{whyMatches}</EvidenceSection>
        <EvidenceSection label="Main eligibility concern">{eligibilityConcern}</EvidenceSection>
        <EvidenceSection label="Geographic evidence">{geographicEvidence}</EvidenceSection>
      </div>

      <div className="score-breakdown selected-score-breakdown">
        <div className="section-heading">
          <h3>Score breakdown</h3>
          <span>Weighted and deterministic</span>
        </div>
        {SCORE_KEYS.map((key) => {
          const component = grant.score.components[key];
          return (
            <div className="score-row" key={key} title={component.reasons[0]}>
              <span>{SCORE_LABELS[key]}</span>
              <i><b style={{ width: `${component.score}%` }} /></i>
              <strong>{Math.round(component.score)}</strong>
            </div>
          );
        })}
      </div>

      <div className="evidence-disclaimer">
        {!historical && <p>{grant.opportunity.sourceDisclaimer}</p>}
        {historical && <strong>Evidence-backed potential private donor/funder candidate worth researching and possibly contacting.</strong>}
      </div>

      {warnings.map((warning) => <div className="risk-note" key={warning}>△ {warning}</div>)}

      <div className="panel-action-grid">
        <button className="primary-action panel-source-action" onClick={onOpenSource}>
          <ActionIcon name="source" />
          <span>{historical ? "View IRS evidence" : "Open official source"}</span>
        </button>
        <button className={inComparison ? "selected-action" : ""} onClick={onToggleComparison}>
          <ActionIcon name="compare" />
          <span>{inComparison ? "In comparison" : "Add to comparison"}</span>
        </button>
        <button onClick={() => setWatchOpen((open) => !open)}>
          <ActionIcon name="watch" />
          <span>{watchOpen ? "Close watch" : "Create watch"}</span>
        </button>
        <button
          className={`panel-copilot-action ${comparisonReady ? "compare-ready-action" : "copilot-action"}`}
          onClick={comparisonReady ? onCompareSelected : onAskCopilot}
        >
          <ActionIcon name={comparisonReady ? "compare" : "copilot"} />
          <span>{comparisonReady ? `Compare ${comparisonCount} selected grants` : "Ask Copilot about this grant"}</span>
        </button>
      </div>

      {watchOpen && (
        <form
          className="watch-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await onCreateWatch(email);
              setWatchOpen(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>Email alerts<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <button disabled={busy}>{busy ? "Creating…" : "Create 80%+ watch"}</button>
          <small>Uses Azure Communication Services Email when configured.</small>
        </form>
      )}
    </aside>
  );
}
