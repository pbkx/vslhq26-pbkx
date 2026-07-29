import type { AwardFilter, EligibilityFilter, Filters, SourceFilter, ViewId } from "../grantView";
import { DEFAULT_FILTERS } from "../grantView";
import type { SearchOutput } from "../types";

const VIEWS: { id: ViewId; label: string; icon: "matrix" | "award" | "heatmap" | "deadline" }[] = [
  { id: "matrix", label: "Match Matrix", icon: "matrix" },
  { id: "award", label: "Award Fit", icon: "award" },
  { id: "heatmap", label: "Score Heatmap", icon: "heatmap" },
  { id: "deadlines", label: "Deadlines", icon: "deadline" },
];

function ViewIcon({ name }: { name: (typeof VIEWS)[number]["icon"] }) {
  if (name === "matrix") return <svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>;
  if (name === "award") return <svg viewBox="0 0 16 16"><path d="M2 12h12M3 10V6m3 4V3m3 7V5m3 5V2" /></svg>;
  if (name === "heatmap") return <svg viewBox="0 0 16 16"><path d="M2 2h5v5H2zm7 0h5v5H9zM2 9h5v5H2zm7 0h5v5H9z" /></svg>;
  return <svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M5 1v4m6-4v4M2 7h12m-9 3h2m2 0h2" /></svg>;
}

export function ControlBar({
  data,
  view,
  onViewChange,
  filters,
  onFiltersChange,
}: {
  data: SearchOutput;
  view: ViewId;
  onViewChange: (view: ViewId) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onFiltersChange({ ...filters, [key]: value });
  const activeFilters = Number(filters.source !== "all") + Number(filters.eligibility !== "all") + Number(filters.minScore > 0) + Number(filters.award !== "all");
  const federal = data.grants.filter((grant) => grant.opportunity.source === "grants-gov").length;
  const prospects = data.grants.filter((grant) => grant.opportunity.source === "irs-990pf").length;
  const total = data.totalResultCount ?? data.resultCount;

  return (
    <section className="control-bar">
      <div className="control-top">
        <div className="view-tabs" aria-label="Visualization">
          {VIEWS.map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} aria-pressed={view === item.id} onClick={() => onViewChange(item.id)}>
              <ViewIcon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="control-stats" aria-label="Search result counts">
          <div>
            <strong>{data.grants.length}/{total}</strong>
            <span>loaded</span>
          </div>
          <i />
          <div>
            <strong>{federal}</strong>
            <span>federal</span>
          </div>
          <div>
            <strong>{prospects}</strong>
            <span>prospects</span>
          </div>
        </div>
      </div>
      <div className="filter-row">
        <label>
          <span>Source</span>
          <select value={filters.source} onChange={(event) => set("source", event.target.value as SourceFilter)}>
            <option value="all">All sources</option>
            <option value="grants-gov">Grants.gov</option>
            <option value="irs-990pf">IRS prospects</option>
          </select>
        </label>
        <label>
          <span>Eligibility</span>
          <select value={filters.eligibility} onChange={(event) => set("eligibility", event.target.value as EligibilityFilter)}>
            <option value="all">All eligibility</option>
            <option value="eligible">Likely eligible</option>
            <option value="verify">Needs verification</option>
            <option value="ineligible">Likely ineligible</option>
          </select>
        </label>
        <label>
          <span>Minimum score</span>
          <select value={filters.minScore} onChange={(event) => set("minScore", Number(event.target.value))}>
            <option value="0">Any score</option>
            <option value="60">60+</option>
            <option value="70">70+</option>
            <option value="80">80+</option>
          </select>
        </label>
        <label>
          <span>Award size</span>
          <select value={filters.award} onChange={(event) => set("award", event.target.value as AwardFilter)}>
            <option value="all">Any award</option>
            <option value="under-100k">Under $100K</option>
            <option value="100k-500k">$100K–$500K</option>
            <option value="over-500k">Over $500K</option>
          </select>
        </label>
        <button className="reset-button" disabled={!activeFilters} onClick={() => onFiltersChange(DEFAULT_FILTERS)}>
          Reset {activeFilters ? `(${activeFilters})` : ""}
        </button>
      </div>
    </section>
  );
}
