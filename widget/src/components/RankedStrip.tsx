import { useMemo, useState } from "react";
import type { GrantResult } from "../types";
import { awardRange, eligibilityKind, formatDeadline } from "../grantView";

function RowIcon({ name }: { name: "federal" | "private" | "eligible" | "verify" | "ineligible" | "chevron" }) {
  const common = {
    "aria-hidden": true,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
  };

  if (name === "chevron") {
    return <svg {...common}><path d="m7 14 5-5 5 5" /></svg>;
  }
  if (name === "federal") {
    return (
      <svg {...common}>
        <path d="m3 9 9-5 9 5" />
        <path d="M5 10h14M6 19h12M4 22h16" />
        <path d="M7 10v9M12 10v9M17 10v9" />
      </svg>
    );
  }
  if (name === "private") {
    return (
      <svg {...common}>
        <path d="M4 21h16M6 21V7.5L12 4v17M12 9h6v12" />
        <path d="M8.5 10h1M8.5 13h1M8.5 16h1M15 12h1M15 15h1M15 18h1" />
      </svg>
    );
  }
  if (name === "eligible") {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.3 2.3 4.8-5" /></svg>;
  }
  if (name === "ineligible") {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.8 9.5a2.4 2.4 0 1 1 3 2.3c-.7.3-.8.8-.8 1.5M12 17h.01" /></svg>;
}

function rankedSource(grant: GrantResult) {
  if (grant.opportunity.source === "irs-990pf") return "IRS prospect";
  return grant.opportunity.recordCategory === "forecasted-federal-opportunity" ? "Grants.gov forecast" : "Grants.gov";
}

function rankedEligibility(kind: ReturnType<typeof eligibilityKind>) {
  if (kind === "eligible") return "Likely eligible";
  if (kind === "ineligible") return "Likely ineligible";
  return "Verify eligibility";
}

function rankedDeadline(grant: GrantResult) {
  return grant.opportunity.source === "irs-990pf" ? "No deadline" : formatDeadline(grant);
}

export function RankedStrip({
  grants,
  selectedId,
  onSelect,
  comparison,
  onToggleComparison,
}: {
  grants: GrantResult[];
  selectedId: string;
  onSelect: (id: string) => void;
  comparison: Set<string>;
  onToggleComparison: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const ranked = useMemo(
    () => [...grants].sort((a, b) => b.score.overallScore - a.score.overallScore),
    [grants],
  );

  return (
    <section className={`ranked-strip ${open ? "open" : ""}`}>
      <button
        type="button"
        className="ranked-heading"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <div>
          <h2>Ranked opportunities</h2>
          <span>{ranked.length}</span>
          {comparison.size > 0 && <em>{comparison.size} in comparison</em>}
        </div>
        <RowIcon name="chevron" />
      </button>

      {open && (
        <>
          <div className="ranked-table-scroll">
            <div className="ranked-table">
              <div className="ranked-columns" aria-hidden="true">
                <span>#</span>
                <span>Score</span>
                <span>Opportunity</span>
                <span>Source</span>
                <span>Award</span>
                <span>Deadline</span>
                <span>Eligibility</span>
                <span>Add</span>
              </div>

              <div className="ranked-list">
                {ranked.map((grant, index) => {
                  const kind = eligibilityKind(grant.score.eligibilityStatus);
                  const privateSource = grant.opportunity.source === "irs-990pf";
                  return (
                    <div
                      className={`ranked-row ${grant.opportunity.id === selectedId ? "selected" : ""}`}
                      key={grant.opportunity.id}
                      role="button"
                      tabIndex={0}
                      aria-selected={grant.opportunity.id === selectedId}
                      onClick={() => onSelect(grant.opportunity.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(grant.opportunity.id);
                        }
                      }}
                    >
                      <span className="rank-number">{index + 1}</span>
                      <b className="rank-score">{grant.score.overallScore}</b>
                      <span className="rank-title">
                        <strong>{grant.opportunity.title}</strong>
                        <small>{grant.opportunity.funderName}</small>
                      </span>
                      <span
                        className={`rank-row-icon rank-source-icon ${privateSource ? "private" : "federal"} ${
                          grant.opportunity.recordCategory === "forecasted-federal-opportunity" ? "forecast" : ""
                        }`}
                        title={rankedSource(grant)}
                        role="img"
                        aria-label={rankedSource(grant)}
                      >
                        <RowIcon name={privateSource ? "private" : "federal"} />
                      </span>
                      <span className="rank-award">{awardRange(grant)}</span>
                      <span className={`rank-deadline ${privateSource ? "muted" : ""}`}>{rankedDeadline(grant)}</span>
                      <span
                        className={`rank-row-icon rank-eligibility-icon ${kind}`}
                        title={rankedEligibility(kind)}
                        role="img"
                        aria-label={rankedEligibility(kind)}
                      >
                        <RowIcon name={kind} />
                      </span>
                      <label
                        className="compare-check"
                        title={`Add ${grant.opportunity.title} to comparison`}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={comparison.has(grant.opportunity.id)}
                          onChange={() => onToggleComparison(grant.opportunity.id)}
                          aria-label={`Add ${grant.opportunity.title} to comparison`}
                        />
                      </label>
                    </div>
                  );
                })}
                {!ranked.length && (
                  <div className="empty-view">
                    <b>No opportunities match these filters</b>
                    <span>Reset one or more filters to restore the ranked list.</span>
                  </div>
                )}
              </div>
            </div>
          </div>

        </>
      )}
    </section>
  );
}
