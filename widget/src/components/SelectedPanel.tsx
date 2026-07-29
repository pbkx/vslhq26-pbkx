import { useState } from "react";
import type { GrantResult } from "../types";
import { awardRange, confidence, eligibilityKind, eligibilityLabel, formatDeadline, SCORE_KEYS, SCORE_LABELS, sourceLabel } from "../grantView";

function ScoreRing({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 25;
  return (
    <div className="score-ring" aria-label={`${value} percent match`}>
      <svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="25" /><circle className="progress" cx="30" cy="30" r="25" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} /></svg>
      <strong>{value}</strong>
      <small>match</small>
    </div>
  );
}

export function SelectedPanel({
  grant,
  inComparison,
  onToggleComparison,
  onOpenSource,
  onAskCopilot,
  onCreateWatch,
}: {
  grant: GrantResult;
  inComparison: boolean;
  onToggleComparison: () => void;
  onOpenSource: () => void;
  onAskCopilot: () => void;
  onCreateWatch: (email: string) => Promise<void>;
}) {
  const [watchOpen, setWatchOpen] = useState(false);
  const [email, setEmail] = useState("grants@example.org");
  const [busy, setBusy] = useState(false);
  const kind = eligibilityKind(grant.score.eligibilityStatus);
  const warnings = [...grant.score.hardExclusions, ...grant.score.warnings];
  const strongest = [...SCORE_KEYS].sort((a, b) => grant.score.components[b].score - grant.score.components[a].score)[0];
  return (
    <aside className="selected-panel">
      <div className="panel-topline">
        <span className={`source-badge ${grant.opportunity.source === "irs-990pf" ? "private" : "federal"}`}>{sourceLabel(grant)}</span>
        <span className={`eligibility-badge ${kind}`}>{eligibilityLabel(grant.score.eligibilityStatus)}</span>
      </div>
      <div className="selected-title">
        <div>
          <h2>{grant.opportunity.title}</h2>
          <p>{grant.opportunity.funderName}</p>
        </div>
        <ScoreRing value={grant.score.overallScore} />
      </div>
      <div className="selected-facts">
        <div><span>Award</span><strong>{awardRange(grant)}</strong></div>
        <div><span>{grant.opportunity.source === "irs-990pf" ? "Status" : "Deadline"}</span><strong>{formatDeadline(grant)}</strong></div>
        <div><span>Confidence</span><strong>{confidence(grant)}%</strong></div>
        <div><span>Pursuit effort</span><strong>{grant.chart.applicationEffort}/100</strong></div>
      </div>
      <p className="grant-summary">{grant.opportunity.summary}</p>
      <div className="match-callout">
        <span>Why this ranks</span>
        <strong>{grant.score.components[strongest].reasons[0]}</strong>
      </div>
      <div className="score-breakdown">
        <div className="section-heading"><h3>Score evidence</h3><span>Weighted & deterministic</span></div>
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
      <div className={`source-note ${grant.opportunity.source === "irs-990pf" ? "private" : ""}`}>
        <b>{grant.opportunity.source === "irs-990pf" ? "Historical evidence—not an open grant" : "Official-source handoff"}</b>
        <span>{grant.opportunity.sourceDisclaimer}</span>
      </div>
      {warnings.map((warning) => <div className="risk-note" key={warning}>△ {warning}</div>)}
      <div className="panel-actions">
        <button className="primary-action" onClick={onOpenSource}>Open official source ↗</button>
        <button className={inComparison ? "selected-action" : ""} onClick={onToggleComparison}>{inComparison ? "✓ Comparing" : "+ Compare"}</button>
      </div>
      <div className="secondary-actions">
        <button onClick={onAskCopilot}>Ask Copilot about risks</button>
        <button onClick={() => setWatchOpen((open) => !open)}>{watchOpen ? "Close watch" : "Watch this match"}</button>
      </div>
      {watchOpen && (
        <form className="watch-form" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await onCreateWatch(email); setWatchOpen(false); } finally { setBusy(false); } }}>
          <label>Email alerts<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <button disabled={busy}>{busy ? "Creating…" : "Create 80%+ watch"}</button>
          <small>Uses Azure Communication Services Email when configured.</small>
        </form>
      )}
    </aside>
  );
}
