import type { GrantResult } from "../types";
import { awardRange, eligibilityKind, eligibilityLabel, formatDeadline, scoreTone, sourceLabel } from "../grantView";

export function RankedStrip({
  grants,
  selectedId,
  onSelect,
  comparison,
  onToggleComparison,
  hasMore,
  remaining,
  onLoadMore,
  loadingMore,
}: {
  grants: GrantResult[];
  selectedId: string;
  onSelect: (id: string) => void;
  comparison: Set<string>;
  onToggleComparison: (id: string) => void;
  hasMore: boolean;
  remaining: number;
  onLoadMore: () => void;
  loadingMore: boolean;
}) {
  return (
    <section className="ranked-strip">
      <div className="ranked-heading">
        <div><h2>Ranked opportunities</h2><span>{grants.length}</span>{comparison.size > 0 && <em>{comparison.size} selected</em>}</div>
        <p>Select a row to update every view</p>
      </div>
      <div className="ranked-list">
        {grants.map((grant, index) => {
          const kind = eligibilityKind(grant.score.eligibilityStatus);
          return (
            <div className={`ranked-row ${grant.opportunity.id === selectedId ? "selected" : ""}`} key={grant.opportunity.id}>
              <button className="rank-main" onClick={() => onSelect(grant.opportunity.id)}>
                <span className="rank-number">{index + 1}</span>
                <b className={`rank-score ${scoreTone(grant.score.overallScore)}`}>{grant.score.overallScore}</b>
                <span className="rank-title"><strong>{grant.opportunity.title}</strong><small>{grant.opportunity.funderName}</small></span>
                <span className={`source-badge ${grant.opportunity.source === "irs-990pf" ? "private" : "federal"}`}>{sourceLabel(grant)}</span>
                <span className="rank-award">{awardRange(grant)}</span>
                <span className="rank-deadline">{formatDeadline(grant)}</span>
                <span className={`eligibility-badge ${kind}`}>{eligibilityLabel(grant.score.eligibilityStatus)}</span>
              </button>
              <label className="compare-check" title="Add to comparison">
                <input type="checkbox" checked={comparison.has(grant.opportunity.id)} onChange={() => onToggleComparison(grant.opportunity.id)} />
                <span>Compare</span>
              </label>
            </div>
          );
        })}
        {!grants.length && <div className="empty-view"><b>No opportunities match these filters</b><span>Reset one or more filters to restore the ranked list.</span></div>}
      </div>
      {hasMore && (
        <button className="load-more" onClick={onLoadMore} disabled={loadingMore}>
          <b>{loadingMore ? "…" : "+"}</b>
          <span>{loadingMore ? "Loading the next cached page" : "Load more ranked grants"}<small>{remaining} records remain · no provider rescan</small></span>
        </button>
      )}
    </section>
  );
}
