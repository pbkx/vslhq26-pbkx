import { useState } from "react";
import type {
  GrantResult,
  WatchFrequency,
  WatchMatchQuality,
  WatchNotificationType,
  WatchScope,
  WatchSettings,
} from "../types";
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

function InfoIcon() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5v6" strokeLinecap="round" />
      <circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none" />
    </svg>
  );
}

const WATCH_QUALITY_OPTIONS: Array<{ id: WatchMatchQuality; label: string }> = [
  { id: "worth-reviewing", label: "Worth reviewing or better" },
  { id: "strong", label: "Strong matches only" },
  { id: "top-only", label: "Top matches only" },
];

const WATCH_NOTIFICATION_OPTIONS: Array<{
  id: WatchNotificationType;
  label: string;
}> = [
  { id: "new-match", label: "New matching opportunities" },
  { id: "opportunity-closing", label: "Approaching deadlines" },
  { id: "opportunity-amended", label: "Official record updates" },
  { id: "score-increased", label: "A candidate becomes a stronger fit" },
];

export function SelectedPanel({
  grant,
  detailsLoading,
  inComparison,
  comparisonCount,
  onToggleComparison,
  onCompareSelected,
  onOpenSource,
  onAskCopilot,
  onCreateWatch,
}: {
  grant: GrantResult;
  detailsLoading: boolean;
  inComparison: boolean;
  comparisonCount: number;
  onToggleComparison: () => void;
  onCompareSelected: () => void;
  onOpenSource: () => void;
  onAskCopilot: () => void;
  onCreateWatch: (settings: WatchSettings) => Promise<void>;
}) {
  const [watchOpen, setWatchOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [matchQuality, setMatchQuality] = useState<WatchMatchQuality>("worth-reviewing");
  const [frequency, setFrequency] = useState<WatchFrequency>("daily");
  const [scope, setScope] = useState<WatchScope>("search");
  const [deadlineLeadDays, setDeadlineLeadDays] = useState(14);
  const [notificationTypes, setNotificationTypes] = useState<WatchNotificationType[]>([
    "new-match",
    "opportunity-closing",
  ]);
  const [busy, setBusy] = useState(false);
  const kind = eligibilityKind(grant.score.eligibilityStatus);
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
          {detailsLoading && <span className="detail-status">Loading complete evidence…</span>}
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

      <div className="evidence-disclaimer" role="note">
        <div className="evidence-info-label">
          <InfoIcon />
          <span>Info</span>
        </div>
        <p>
          {historical
            ? "Evidence-backed potential private donor/funder candidate worth researching and possibly contacting."
            : grant.opportunity.sourceDisclaimer}
        </p>
      </div>

      <div className="panel-action-grid">
        <button className="primary-action panel-source-action" onClick={onOpenSource}>
          <ActionIcon name="source" />
          <span>{historical ? "View IRS evidence" : "Open official source"}</span>
        </button>
        <button className={inComparison ? "selected-action" : ""} onClick={onToggleComparison}>
          <ActionIcon name="compare" />
          <span>{inComparison ? "In comparison" : "Add to comparison"}</span>
        </button>
        <button className={watchOpen ? "selected-action" : ""} onClick={() => setWatchOpen((open) => !open)}>
          <ActionIcon name="watch" />
          <span>Create watch</span>
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
            if (!notificationTypes.length) return;
            setBusy(true);
            try {
              await onCreateWatch({
                email,
                matchQuality,
                frequency,
                scope,
                deadlineLeadDays,
                notificationTypes,
              });
              setWatchOpen(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="watch-form-heading">
            <div>
              <h3>Create email watch</h3>
              <p>Get notified when this search changes.</p>
            </div>
          </div>

          <div className="watch-form-grid">
            <label className="watch-email-field">
              Email address
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="name@organization.org"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Frequency
              <select value={frequency} onChange={(event) => setFrequency(event.target.value as WatchFrequency)}>
                <option value="as-detected">As detected</option>
                <option value="daily">Daily digest</option>
                <option value="weekly">Weekly digest</option>
              </select>
            </label>
            <label>
              Watch
              <select value={scope} onChange={(event) => setScope(event.target.value as WatchScope)}>
                <option value="search">This search</option>
                <option value="selected-grant">This grant only</option>
              </select>
            </label>
            <label>
              Match threshold
              <select value={matchQuality} onChange={(event) => setMatchQuality(event.target.value as WatchMatchQuality)}>
                {WATCH_QUALITY_OPTIONS.map((option) => (
                  <option value={option.id} key={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className={!notificationTypes.includes("opportunity-closing") ? "watch-field-disabled" : ""}>
              Deadline reminder
              <select
                disabled={!notificationTypes.includes("opportunity-closing")}
                value={deadlineLeadDays}
                onChange={(event) => setDeadlineLeadDays(Number(event.target.value))}
              >
                <option value={7}>7 days before</option>
                <option value={14}>14 days before</option>
                <option value={30}>30 days before</option>
              </select>
            </label>
          </div>

          <fieldset className="watch-fieldset">
            <legend>Notify me when</legend>
            <div className="watch-notification-list">
              {WATCH_NOTIFICATION_OPTIONS.map((option) => {
                const checked = notificationTypes.includes(option.id);
                return (
                  <label key={option.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setNotificationTypes((current) =>
                        checked ? current.filter((item) => item !== option.id) : [...current, option.id])}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {!notificationTypes.length && <p className="watch-error">Choose at least one alert reason.</p>}
          <div className="watch-form-actions">
            <button type="button" className="watch-cancel" onClick={() => setWatchOpen(false)}>Cancel</button>
            <button type="submit" className="watch-submit" disabled={busy || !notificationTypes.length || !email.trim()}>
              {busy ? "Creating…" : "Create watch"}
            </button>
          </div>
          <small className="watch-footnote">Email alerts are delivered through Azure Communication Services. You can remove the watch at any time.</small>
        </form>
      )}
    </aside>
  );
}
