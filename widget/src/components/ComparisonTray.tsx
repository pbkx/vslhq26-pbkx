import type { GrantResult } from "../types";
import { awardRange, eligibilityLabel, formatDeadline, SCORE_KEYS, SCORE_LABELS } from "../grantView";

export function ComparisonTray({ grants, onClose }: { grants: GrantResult[]; onClose: () => void }) {
  if (grants.length < 2) return null;
  return (
    <section className="comparison-tray">
      <div className="comparison-heading"><div><h2>Side-by-side comparison</h2><span>Decision evidence for {grants.length} opportunities</span></div><button onClick={onClose}>Close ×</button></div>
      <div className="comparison-grid" style={{ gridTemplateColumns: `repeat(${grants.length}, minmax(210px, 1fr))` }}>
        {grants.map((grant) => (
          <article key={grant.opportunity.id}>
            <span>{grant.score.overallScore}% match</span>
            <h3>{grant.opportunity.title}</h3>
            <p>{grant.opportunity.funderName}</p>
            <dl>
              <div><dt>Award</dt><dd>{awardRange(grant)}</dd></div>
              <div><dt>Deadline</dt><dd>{formatDeadline(grant)}</dd></div>
              <div><dt>Eligibility</dt><dd>{eligibilityLabel(grant.score.eligibilityStatus)}</dd></div>
              {SCORE_KEYS.slice(0, 4).map((key) => <div key={key}><dt>{SCORE_LABELS[key]}</dt><dd>{Math.round(grant.score.components[key].score)}</dd></div>)}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
