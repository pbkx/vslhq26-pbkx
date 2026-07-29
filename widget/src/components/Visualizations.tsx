import { useMemo, useState } from "react";
import type { GrantResult, SearchContext, Weights } from "../types";
import {
  awardRange,
  eligibilityKind,
  eligibilityLabel,
  formatDeadline,
  formatMoney,
  SCORE_KEYS,
  SCORE_LABELS,
  sourceLabel,
  type ViewId,
} from "../grantView";

type Props = {
  view: ViewId;
  grants: GrantResult[];
  selectedId: string;
  onSelect: (id: string) => void;
  context?: SearchContext;
};

const MATRIX_PAD = { top: 6, bottom: 12, left: 8, right: 5 };
const AWARD_DOMAIN_MAX = 900_000;
const TARGET_MIN = 100_000;
const TARGET_MAX = 500_000;
const AWARD_TICKS = [0, 200_000, 400_000, 600_000, 800_000];
const DEADLINE_HORIZON = 365;
const DEADLINE_REFERENCE_LINES = [30, 60, 90];
const DEADLINE_TICKS = [0, 60, 120, 180, 240, 300, 360];

function ChartHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="chart-header original-chart-header">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function GrantPopover({
  grant,
  note,
  onClose,
  point,
}: {
  grant: GrantResult;
  note?: string;
  onClose: () => void;
  point?: { x: number; y: number };
}) {
  const kind = eligibilityKind(grant.score.eligibilityStatus);
  const style = point
    ? {
        left: `${Math.max(22, Math.min(78, point.x))}%`,
        top: `${Math.max(38, Math.min(82, point.y))}%`,
      }
    : undefined;
  return (
    <aside className={`grant-chart-popover ${point ? "point-popover" : "floating-popover"}`} style={style}>
      <button type="button" className="popover-close" aria-label="Close grant details" onClick={onClose}>×</button>
      <strong>{grant.opportunity.title}</strong>
      <p>{grant.opportunity.funderName}</p>
      <dl>
        <div><dt>Source</dt><dd>{sourceLabel(grant)}</dd></div>
        <div><dt>Match</dt><dd>{grant.score.overallScore}/100</dd></div>
        <div><dt>Award</dt><dd>{awardRange(grant)}</dd></div>
        <div><dt>Deadline</dt><dd>{formatDeadline(grant)}</dd></div>
      </dl>
      <span className={`popover-eligibility ${kind}`}>{eligibilityLabel(grant.score.eligibilityStatus)}</span>
      {note && <small>{note}</small>}
    </aside>
  );
}

function awardRadius(grant: GrantResult) {
  const value = grant.opportunity.awardMax ?? grant.opportunity.awardMin ?? 20_000;
  const capped = Math.min(value, 800_000);
  const ratio = Math.log10(Math.max(1, capped / 10_000)) / Math.log10(80);
  return 7 + Math.max(0, Math.min(1, ratio)) * 16;
}

function MatchMatrix({ grants, selectedId, onSelect }: Omit<Props, "view" | "context">) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const plotWidth = 100 - MATRIX_PAD.left - MATRIX_PAD.right;
  const plotHeight = 100 - MATRIX_PAD.top - MATRIX_PAD.bottom;
  const x = (effort: number) => MATRIX_PAD.left + (effort / 100) * plotWidth;
  const y = (score: number) => MATRIX_PAD.top + (1 - score / 100) * plotHeight;
  const active = grants.find((grant) => grant.opportunity.id === (hoverId ?? pinnedId));

  function choose(id: string) {
    onSelect(id);
    setPinnedId((current) => current === id ? null : id);
  }

  return (
    <section className="visual-card original-visual">
      <ChartHeader title="Match Matrix" subtitle="Match score vs. application effort · bubble size = award amount">
        <div className="legend original-legend">
          <span><i className="federal" />Grants.gov</span>
          <span><i className="private" />IRS prospect</span>
          <span><i className="verify" />Verify</span>
        </div>
      </ChartHeader>
      <div className="original-matrix">
        <div className="matrix-split vertical" />
        <div className="matrix-split horizontal" />
        <span className="matrix-quadrant best">Best bets</span>
        <span className="matrix-quadrant strategic">Strategic investments</span>
        <span className="matrix-quadrant quick">Quick research</span>
        <span className="matrix-quadrant low">Low priority</span>
        <span className="matrix-axis x-axis">Application effort: Low → High</span>
        <span className="matrix-axis y-axis">Match score</span>
        {grants.map((grant) => {
          const radius = awardRadius(grant);
          const privateSource = grant.opportunity.source === "irs-990pf";
          const verify = eligibilityKind(grant.score.eligibilityStatus) === "verify";
          const ineligible = eligibilityKind(grant.score.eligibilityStatus) === "ineligible";
          const selected = grant.opportunity.id === selectedId;
          return (
            <button
              key={grant.opportunity.id}
              type="button"
              className={`original-bubble ${privateSource ? "private" : "federal"} ${verify ? "verify" : ""} ${ineligible ? "ineligible" : ""} ${selected ? "selected" : ""}`}
              style={{
                left: `${x(grant.chart.applicationEffort)}%`,
                top: `${y(grant.score.overallScore)}%`,
                width: radius * 2,
                height: radius * 2,
              }}
              onClick={() => choose(grant.opportunity.id)}
              onMouseEnter={() => setHoverId(grant.opportunity.id)}
              onMouseLeave={() => setHoverId((current) => current === grant.opportunity.id ? null : current)}
              onFocus={() => setHoverId(grant.opportunity.id)}
              onBlur={() => setHoverId((current) => current === grant.opportunity.id ? null : current)}
              aria-label={`${grant.opportunity.title}, ${grant.score.overallScore} match score`}
            >
              <span />
              {ineligible && <i />}
            </button>
          );
        })}
        {active && (
          <GrantPopover
            grant={active}
            point={{ x: x(active.chart.applicationEffort), y: y(active.score.overallScore) }}
            note={active.opportunity.source === "irs-990pf" ? "Historical prospect — not a confirmed open opportunity" : undefined}
            onClose={() => { setPinnedId(null); setHoverId(null); }}
          />
        )}
      </div>
    </section>
  );
}

type AwardSort = "score" | "award" | "title";

function AwardFit({ grants, selectedId, onSelect }: Omit<Props, "view">) {
  const [sort, setSort] = useState<AwardSort>("score");
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const rows = useMemo(() => {
    const copy = [...grants];
    if (sort === "score") copy.sort((a, b) => b.score.overallScore - a.score.overallScore);
    if (sort === "title") copy.sort((a, b) => a.opportunity.title.localeCompare(b.opportunity.title));
    if (sort === "award") copy.sort((a, b) =>
      (b.opportunity.awardMax ?? b.opportunity.awardMin ?? 0) -
      (a.opportunity.awardMax ?? a.opportunity.awardMin ?? 0));
    return copy;
  }, [grants, sort]);
  const active = grants.find((grant) => grant.opportunity.id === pinnedId);
  const pct = (value: number) => Math.min(100, (Math.max(0, value) / AWARD_DOMAIN_MAX) * 100);

  function choose(id: string) {
    onSelect(id);
    setPinnedId((current) => current === id ? null : id);
  }

  return (
    <section className="visual-card original-visual">
      <ChartHeader title="Award Fit" subtitle="Award ranges vs. your $100K–$500K target band">
        <select className="chart-sort" value={sort} onChange={(event) => setSort(event.target.value as AwardSort)}>
          <option value="score">Sort: Match score</option>
          <option value="award">Sort: Award size</option>
          <option value="title">Sort: Title</option>
        </select>
      </ChartHeader>
      <div className="original-award-board">
        <div className="original-award-axis">
          <span className="award-opportunity-label">Opportunity</span>
          <div className="award-axis-track">
            <i className="target-band" style={{ left: `${pct(TARGET_MIN)}%`, width: `${pct(TARGET_MAX) - pct(TARGET_MIN)}%` }} />
            {AWARD_TICKS.map((tick) => <span key={tick} style={{ left: `${pct(tick)}%` }}>{formatMoney(tick)}</span>)}
          </div>
          <b>Score</b>
        </div>
        <div className="original-award-scroll">
          {rows.map((grant) => {
            const minimum = grant.opportunity.awardMin ?? 0;
            const maximum = grant.opportunity.awardMax ?? grant.opportunity.awardMin;
            const unknown = grant.opportunity.awardMin === undefined && grant.opportunity.awardMax === undefined;
            const single = maximum !== undefined && minimum === maximum;
            const left = pct(minimum);
            const right = pct(maximum ?? minimum);
            return (
              <button
                key={grant.opportunity.id}
                type="button"
                className={`original-award-row ${grant.opportunity.id === selectedId ? "selected" : ""}`}
                onClick={() => choose(grant.opportunity.id)}
              >
                <span className="award-row-name"><strong>{grant.opportunity.title}</strong><small>{grant.opportunity.funderName}</small></span>
                <span className="original-award-track">
                  <i className="target-band" style={{ left: `${pct(TARGET_MIN)}%`, width: `${pct(TARGET_MAX) - pct(TARGET_MIN)}%` }} />
                  <i className="range-baseline" />
                  {unknown ? (
                    <em>Unknown</em>
                  ) : single ? (
                    <i className={`single-award ${grant.opportunity.source === "irs-990pf" ? "private" : "federal"}`} style={{ left: `${left}%` }} />
                  ) : (
                    <>
                      <i className={`award-range-bar ${grant.opportunity.source === "irs-990pf" ? "private" : "federal"}`} style={{ left: `${left}%`, width: `${Math.max(right - left, 1)}%` }} />
                      <i className={`award-endpoint ${grant.opportunity.source === "irs-990pf" ? "private" : "federal"}`} style={{ left: `${left}%` }} />
                      <i className={`award-endpoint ${grant.opportunity.source === "irs-990pf" ? "private" : "federal"}`} style={{ left: `${right}%` }} />
                    </>
                  )}
                </span>
                <b className="award-row-score">{grant.score.overallScore}</b>
              </button>
            );
          })}
        </div>
        {active && <GrantPopover grant={active} onClose={() => setPinnedId(null)} />}
      </div>
    </section>
  );
}

type HeatKey = "overall" | keyof Weights;

function heatValue(grant: GrantResult, key: HeatKey) {
  return key === "overall" ? grant.score.overallScore : grant.score.components[key]?.score ?? 0;
}

function heatStyle(value: number) {
  const color = value < 40 ? "var(--warning)" : value < 60 ? "var(--private)" : value < 80 ? "var(--federal)" : "var(--positive)";
  const amount = Math.round(22 + (value / 100) * 68);
  return { background: `color-mix(in srgb, ${color} ${amount}%, var(--surface))` };
}

function ScoreHeatmap({ grants, selectedId, onSelect }: Omit<Props, "view" | "context">) {
  const [sortKey, setSortKey] = useState<HeatKey>("overall");
  const [pinned, setPinned] = useState<{ id: string; key: HeatKey } | null>(null);
  const columns: { key: HeatKey; label: string }[] = [
    { key: "overall", label: "Overall" },
    ...SCORE_KEYS.map((key) => ({ key, label: SCORE_LABELS[key] })),
  ];
  const rows = useMemo(
    () => [...grants].sort((a, b) => heatValue(b, sortKey) - heatValue(a, sortKey)),
    [grants, sortKey],
  );
  const active = grants.find((grant) => grant.opportunity.id === pinned?.id);
  const activeLabel = columns.find((column) => column.key === pinned?.key)?.label;

  return (
    <section className="visual-card original-visual">
      <ChartHeader title="Score Heatmap" subtitle="Click a heading to sort · click a cell for detail">
        <div className="original-heat-scale">
          <span><i className="low" />0–39</span>
          <span><i className="mid" />40–59</span>
          <span><i className="high" />60–79</span>
          <span><i className="top" />80–100</span>
        </div>
      </ChartHeader>
      <div className="original-heatmap-shell">
        <table className="original-heatmap">
          <thead>
            <tr>
              <th className="sticky-name">Opportunity</th>
              {columns.map((column) => (
                <th key={column.key}>
                  <button type="button" className={sortKey === column.key ? "active" : ""} onClick={() => setSortKey(column.key)}>
                    {column.label}{sortKey === column.key && <span>↓</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((grant) => (
              <tr key={grant.opportunity.id} className={grant.opportunity.id === selectedId ? "selected" : ""}>
                <th className="sticky-name">
                  <button type="button" onClick={() => onSelect(grant.opportunity.id)}>
                    <strong>{grant.opportunity.title}</strong>
                    <small className={grant.opportunity.source === "irs-990pf" ? "private" : "federal"}>{sourceLabel(grant)}</small>
                  </button>
                </th>
                {columns.map((column) => {
                  const value = heatValue(grant, column.key);
                  return (
                    <td key={column.key}>
                      <button
                        type="button"
                        style={heatStyle(value)}
                        onClick={() => {
                          onSelect(grant.opportunity.id);
                          setPinned((current) => current?.id === grant.opportunity.id && current.key === column.key ? null : { id: grant.opportunity.id, key: column.key });
                        }}
                      >
                        {Math.round(value)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {active && (
          <GrantPopover
            grant={active}
            note={pinned?.key === "overall" ? "Overall deterministic match score" : `${activeLabel}: ${active.score.components[pinned!.key as keyof Weights]?.reasons[0] ?? "Review the evidence in the selected-grant panel."}`}
            onClose={() => setPinned(null)}
          />
        )}
      </div>
    </section>
  );
}

function deadlineX(days: number) {
  return 4 + (days / DEADLINE_HORIZON) * 92;
}

function markerSize(grant: GrantResult) {
  const value = grant.opportunity.awardMax ?? grant.opportunity.awardMin ?? 20_000;
  return 14 + Math.min(1, value / 800_000) * 16;
}

function monthLabel(days: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

function markerTone(score: number) {
  if (score < 40) return "var(--warning)";
  if (score < 60) return "var(--private)";
  if (score < 80) return "var(--federal)";
  return "var(--positive)";
}

function Deadlines({ grants, selectedId, onSelect }: Omit<Props, "view" | "context">) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const federal = grants
    .filter((grant) => grant.opportunity.source === "grants-gov" && grant.opportunity.deadline)
    .map((grant) => ({ grant, days: grant.chart.daysRemaining ?? 0 }))
    .filter(({ days }) => days >= 0 && days <= DEADLINE_HORIZON);
  const historical = grants.filter((grant) => grant.opportunity.source === "irs-990pf");
  const active = grants.find((grant) => grant.opportunity.id === (hoverId ?? pinnedId));
  const activeDays = active?.chart.daysRemaining ?? 0;

  function choose(id: string) {
    onSelect(id);
    setPinnedId((current) => current === id ? null : id);
  }

  return (
    <section className="visual-card original-visual">
      <ChartHeader title="Deadlines" subtitle="Current federal opportunities over the next 12 months · marker size = award, color = match" />
      <div className="original-deadlines">
        <p className="deadline-lane-label">Open federal opportunities</p>
        <div className="deadline-timeline">
          {DEADLINE_TICKS.map((days) => (
            <div key={days} className="deadline-month-line" style={{ left: `${deadlineX(days)}%` }}>
              <i />
              <span>{monthLabel(days)}</span>
            </div>
          ))}
          {DEADLINE_REFERENCE_LINES.map((days) => (
            <div key={days} className="deadline-reference" style={{ left: `${deadlineX(days)}%` }}>
              <i />
              <span>{days}d</span>
            </div>
          ))}
          <div className="deadline-baseline" />
          {federal.map(({ grant, days }) => {
            const size = markerSize(grant);
            return (
              <button
                key={grant.opportunity.id}
                type="button"
                className={`deadline-marker ${grant.opportunity.id === selectedId ? "selected" : ""}`}
                style={{ left: `${deadlineX(days)}%`, width: size, height: size, background: markerTone(grant.score.overallScore) }}
                onClick={() => choose(grant.opportunity.id)}
                onMouseEnter={() => setHoverId(grant.opportunity.id)}
                onMouseLeave={() => setHoverId((current) => current === grant.opportunity.id ? null : current)}
                onFocus={() => setHoverId(grant.opportunity.id)}
                onBlur={() => setHoverId((current) => current === grant.opportunity.id ? null : current)}
                aria-label={`${grant.opportunity.title}, due in ${days} days`}
              />
            );
          })}
          {active?.opportunity.source === "grants-gov" && (
            <GrantPopover
              grant={active}
              point={{ x: deadlineX(Math.max(0, Math.min(DEADLINE_HORIZON, activeDays))), y: 50 }}
              onClose={() => { setPinnedId(null); setHoverId(null); }}
            />
          )}
          {federal.length === 0 && <span className="timeline-empty">No dated federal opportunities within the next 12 months.</span>}
        </div>
        <div className="historical-heading">
          <span><i />Historical prospects</span>
          <em>No confirmed deadline</em>
        </div>
        <div className="historical-grid">
          {historical.map((grant) => (
            <button
              key={grant.opportunity.id}
              type="button"
              className={grant.opportunity.id === selectedId ? "selected" : ""}
              onClick={() => choose(grant.opportunity.id)}
            >
              <span><strong>{grant.opportunity.funderName}</strong><small>{awardRange(grant)}</small></span>
              <b>{grant.score.overallScore}</b>
            </button>
          ))}
          {historical.length === 0 && <p>No historical prospects match the current filters.</p>}
        </div>
        {active?.opportunity.source === "irs-990pf" && (
          <GrantPopover
            grant={active}
            note="Historical prospect — no confirmed open application or deadline"
            onClose={() => { setPinnedId(null); setHoverId(null); }}
          />
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
