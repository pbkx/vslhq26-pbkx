import { useMemo } from "react";
import type { GrantResult, SearchContext } from "../types";
import { awardRange, formatDeadline, formatMoney, SCORE_KEYS, SCORE_LABELS, scoreTone, sourceLabel, type ViewId } from "../grantView";

type Props = {
  view: ViewId;
  grants: GrantResult[];
  selectedId: string;
  onSelect: (id: string) => void;
  context?: SearchContext;
};

const plot = { left: 58, right: 708, top: 32, bottom: 338 };
const px = (effort: number) => plot.left + (effort / 100) * (plot.right - plot.left);
const py = (score: number) => plot.top + (1 - score / 100) * (plot.bottom - plot.top);

function bubbleRadius(grant: GrantResult) {
  const amount = Math.max(10_000, Math.min(grant.chart.awardAmount ?? 40_000, 1_500_000));
  return 6 + (Math.log10(amount) - 4) * 5;
}

function ChartHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="chart-header">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function MatchMatrix({ grants, selectedId, onSelect }: Omit<Props, "view" | "context">) {
  return (
    <section className="visual-card">
      <ChartHeader title="Match Matrix" subtitle="Match score vs. evidence-based pursuit effort · bubble size reflects award amount">
        <div className="legend">
          <span><i className="federal" />Grants.gov</span>
          <span><i className="private" />IRS prospect</span>
          <span><i className="verify" />Verify</span>
        </div>
      </ChartHeader>
      <div className="matrix-wrap">
        <svg className="matrix-chart" viewBox="0 0 740 385" role="img" aria-label="Grant match score by application effort">
          <rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} rx="14" className="chart-bg" />
          {[25, 50, 75, 100].map((value) => (
            <g key={value} className="grid-line">
              <line x1={plot.left} x2={plot.right} y1={py(value)} y2={py(value)} />
              <text x={plot.left - 12} y={py(value) + 4}>{value}</text>
            </g>
          ))}
          <line className="quadrant-line" x1={px(50)} x2={px(50)} y1={plot.top} y2={plot.bottom} />
          <line className="quadrant-line" x1={plot.left} x2={plot.right} y1={py(50)} y2={py(50)} />
          <text className="quadrant-label" x={plot.left + 12} y={plot.top + 20}>BEST BETS</text>
          <text className="quadrant-label" textAnchor="end" x={plot.right - 12} y={plot.top + 20}>STRATEGIC INVESTMENTS</text>
          <text className="quadrant-label" x={plot.left + 12} y={plot.bottom - 12}>QUICK RESEARCH</text>
          <text className="quadrant-label" textAnchor="end" x={plot.right - 12} y={plot.bottom - 12}>LOW PRIORITY</text>
          {grants.map((grant) => {
            const radius = bubbleRadius(grant);
            const point = { x: px(grant.chart.applicationEffort), y: py(grant.score.overallScore) };
            const selected = grant.opportunity.id === selectedId;
            const privateSource = grant.opportunity.source === "irs-990pf";
            const verify = grant.score.eligibilityStatus === "needs-verification" || grant.score.eligibilityStatus === "possible";
            return (
              <g
                key={grant.opportunity.id}
                className={`matrix-point ${privateSource ? "private" : "federal"} ${verify ? "verify" : ""} ${selected ? "selected" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(grant.opportunity.id)}
                onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && onSelect(grant.opportunity.id)}
                aria-label={`${grant.opportunity.title}, ${grant.score.overallScore} match score`}
              >
                <circle cx={point.x} cy={point.y} r={radius} />
                {grant.opportunity.id === selectedId && (
                  <text x={point.x + radius + 5} y={point.y + 4}>
                    {grant.opportunity.title.slice(0, 23)}
                  </text>
                )}
                <title>{grant.opportunity.title} · {grant.score.overallScore}% match · {awardRange(grant)}</title>
              </g>
            );
          })}
          <text className="axis-title" x={(plot.left + plot.right) / 2} y="374">Pursuit effort: low → high</text>
          <text className="axis-title vertical" transform="translate(14 240) rotate(-90)">Match score</text>
        </svg>
      </div>
    </section>
  );
}

function AwardFit({ grants, selectedId, onSelect, context }: Omit<Props, "view">) {
  const largest = Math.max(500_000, ...grants.map((grant) => grant.opportunity.awardMax ?? grant.opportunity.awardMin ?? 0));
  const domain = Math.ceil(largest / 250_000) * 250_000;
  const target = context?.projectBudget;
  const pct = (value: number) => `${Math.min(100, (value / domain) * 100)}%`;
  return (
    <section className="visual-card">
      <ChartHeader
        title="Award Fit"
        subtitle={target ? `Award ranges compared with the ${formatMoney(target)} project budget` : "Known award ranges across the ranked set"}
      >
        <span className="target-key"><i />Target budget</span>
      </ChartHeader>
      <div className="award-list">
        <div className="award-axis">
          <span>$0</span><span>{formatMoney(domain / 2)}</span><span>{formatMoney(domain)}</span>
        </div>
        {grants.slice(0, 14).map((grant) => {
          const min = grant.opportunity.awardMin ?? 0;
          const max = grant.opportunity.awardMax ?? grant.opportunity.awardMin;
          return (
            <button key={grant.opportunity.id} className={`award-row ${grant.opportunity.id === selectedId ? "selected" : ""}`} onClick={() => onSelect(grant.opportunity.id)}>
              <span className="award-name"><strong>{grant.opportunity.title}</strong><small>{grant.opportunity.funderName}</small></span>
              <span className="award-track">
                {target && <i className="target-marker" style={{ left: pct(target) }} />}
                {max === undefined ? <em>Unknown</em> : <i className={`award-range ${grant.opportunity.source === "irs-990pf" ? "private" : "federal"}`} style={{ left: pct(min), width: `max(4px, calc(${pct(max)} - ${pct(min)}))` }} />}
              </span>
              <span className="award-value">{awardRange(grant)}</span>
              <b className={`mini-score ${scoreTone(grant.score.overallScore)}`}>{grant.score.overallScore}</b>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ScoreHeatmap({ grants, selectedId, onSelect }: Omit<Props, "view" | "context">) {
  const rows = grants.slice(0, 16);
  return (
    <section className="visual-card">
      <ChartHeader title="Score Heatmap" subtitle="Transparent component scores · select any row to inspect its evidence">
        <div className="heat-scale"><span>Low</span><i /><i /><i /><i /><span>High</span></div>
      </ChartHeader>
      <div className="heatmap-scroll">
        <table className="heatmap">
          <thead><tr><th>Opportunity</th><th>Overall</th>{SCORE_KEYS.map((key) => <th key={key}>{SCORE_LABELS[key]}</th>)}</tr></thead>
          <tbody>
            {rows.map((grant) => (
              <tr key={grant.opportunity.id} className={grant.opportunity.id === selectedId ? "selected" : ""} onClick={() => onSelect(grant.opportunity.id)}>
                <th><strong>{grant.opportunity.title}</strong><small>{sourceLabel(grant)}</small></th>
                <td><span className={`heat ${scoreTone(grant.score.overallScore)}`}>{grant.score.overallScore}</span></td>
                {SCORE_KEYS.map((key) => {
                  const value = grant.score.components[key].score;
                  return <td key={key}><span className={`heat ${scoreTone(value)}`} title={grant.score.components[key].reasons[0]}>{Math.round(value)}</span></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Deadlines({ grants, selectedId, onSelect }: Omit<Props, "view" | "context">) {
  const dated = useMemo(
    () => grants.filter((grant) => grant.opportunity.deadline).sort((a, b) => (a.chart.daysRemaining ?? 9999) - (b.chart.daysRemaining ?? 9999)),
    [grants],
  );
  const undated = grants.filter((grant) => !grant.opportunity.deadline).slice(0, 5);
  const maxDays = Math.max(90, ...dated.map((grant) => Math.max(0, grant.chart.daysRemaining ?? 0)));
  return (
    <section className="visual-card">
      <ChartHeader title="Deadlines" subtitle="Prioritize verified federal deadlines; undated prospects stay in the research queue">
        <span className="deadline-count">{dated.length} dated</span>
      </ChartHeader>
      <div className="deadline-list">
        {dated.length ? dated.slice(0, 12).map((grant) => {
          const days = Math.max(0, grant.chart.daysRemaining ?? 0);
          return (
            <button key={grant.opportunity.id} className={`deadline-row ${grant.opportunity.id === selectedId ? "selected" : ""}`} onClick={() => onSelect(grant.opportunity.id)}>
              <span className={`days ${days <= 30 ? "urgent" : days <= 60 ? "soon" : ""}`}><b>{days}</b><small>days</small></span>
              <span className="deadline-name"><strong>{grant.opportunity.title}</strong><small>{formatDeadline(grant)}</small></span>
              <span className="deadline-track"><i style={{ width: `${Math.max(3, 100 - (days / maxDays) * 100)}%` }} /></span>
              <b className={`mini-score ${scoreTone(grant.score.overallScore)}`}>{grant.score.overallScore}</b>
            </button>
          );
        }) : <div className="empty-view"><b>No confirmed deadlines in this result set</b><span>Try including current or forecasted federal opportunities.</span></div>}
        {undated.length > 0 && (
          <div className="research-queue">
            <h3>Undated research queue</h3>
            <div>{undated.map((grant) => <button key={grant.opportunity.id} onClick={() => onSelect(grant.opportunity.id)}>{grant.opportunity.title}<span>{sourceLabel(grant)}</span></button>)}</div>
          </div>
        )}
      </div>
    </section>
  );
}

export function Visualization(props: Props) {
  if (props.view === "award") return <AwardFit {...props} />;
  if (props.view === "heatmap") return <ScoreHeatmap {...props} />;
  if (props.view === "deadlines") return <Deadlines {...props} />;
  return <MatchMatrix {...props} />;
}
