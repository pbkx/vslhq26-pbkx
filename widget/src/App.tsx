import { useEffect, useMemo, useState } from "react";
import { callTool, connectBridge, followUp, openLink, setBridgeListeners } from "./mcpBridge";
import { applyFilters, DEFAULT_FILTERS, type Filters, type ViewId } from "./grantView";
import type { SearchOutput } from "./types";
import GrantPilotMark from "./GrantPilotMark";
import { ControlBar } from "./components/ControlBar";
import { Visualization } from "./components/Visualizations";
import { SelectedPanel } from "./components/SelectedPanel";
import { RankedStrip } from "./components/RankedStrip";
import { ComparisonTray } from "./components/ComparisonTray";

export default function App() {
  const [data, setData] = useState<SearchOutput | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState<ViewId>(() => (globalThis as any).__GRANTPILOT_PREVIEW_VIEW__ ?? "matrix");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [comparison, setComparison] = useState<Set<string>>(new Set());
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setBridgeListeners(
      (next) => {
        setData((current) => {
          if (!next.append || !current) return next;
          const grants = [...current.grants, ...next.grants].filter(
            (item, index, all) => all.findIndex((candidate) => candidate.opportunity.id === item.opportunity.id) === index,
          );
          return {
            ...current,
            ...next,
            append: false,
            resultCount: grants.length,
            totalResultCount: next.totalResultCount ?? current.totalResultCount,
            sourceCounts: {
              "grants-gov": grants.filter((item) => item.opportunity.source === "grants-gov").length,
              "irs-990pf": grants.filter((item) => item.opportunity.source === "irs-990pf").length,
            },
            grants,
            warnings: [...new Set([...current.warnings, ...next.warnings])],
          };
        });
        setSelectedId((current) => current || next.grants.reduce((best, grant) => !best || grant.score.overallScore > best.score.overallScore ? grant : best, next.grants[0])?.opportunity.id || "");
      },
      setNotice,
    );
    connectBridge();
  }, []);

  const filtered = useMemo(() => data ? applyFilters(data.grants, filters) : [], [data, filters]);
  const selected = filtered.find((grant) => grant.opportunity.id === selectedId) ?? filtered[0] ?? data?.grants[0];
  const compared = data?.grants.filter((grant) => comparison.has(grant.opportunity.id)) ?? [];
  const remaining = Math.max(0, (data?.totalResultCount ?? 0) - (data?.grants.length ?? 0));

  function toggleComparison(id: string) {
    setComparison((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      else {
        setNotice("Compare up to three opportunities at a time.");
        return current;
      }
      if (next.size < 2) setComparisonOpen(false);
      return next;
    });
  }

  async function showComparison() {
    if (comparison.size < 2) return;
    setComparisonOpen(true);
    try {
      await callTool("compare_grants", { grantIds: [...comparison] });
      setNotice("Comparison evidence refreshed from GrantPilot.");
    } catch (error) {
      setNotice(error instanceof Error ? `${error.message} Showing the loaded comparison.` : "Showing the loaded comparison.");
    }
  }

  async function loadMore() {
    if (!data?.hasMore || loadingMore) return;
    setLoadingMore(true);
    setNotice("Loading the next cached page…");
    try {
      await callTool("load_more_grants", { queryId: data.queryId, offset: data.nextOffset ?? data.grants.length });
      setNotice("More grants were added without rescanning providers.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load more grants.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function createWatch(email: string) {
    if (!data || !selected) return;
    try {
      const result = await callTool("create_grant_watch", {
        queryId: data.queryId,
        email,
        minimumScore: 80,
        notificationTypes: ["new-match", "opportunity-amended", "opportunity-closing"],
        selectedGrantId: selected.opportunity.id,
      });
      const output = result as { id?: string; emailPreview?: { deliveryStatus?: string } };
      setNotice(`Watch ${output.id ?? "created"} · email ${output.emailPreview?.deliveryStatus ?? "queued"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create the watch.");
      throw error;
    }
  }

  if (!data || !selected) {
    return (
      <main className="loading">
        <GrantPilotMark />
        <h2>Opening GrantPilot</h2>
        <p>Preparing your grant opportunity workbench…</p>
        {notice && <span>{notice}</span>}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <ControlBar data={data} view={view} onViewChange={setView} filters={filters} onFiltersChange={setFilters} />
      <div className="workspace">
        <Visualization view={view} grants={filtered} selectedId={selected.opportunity.id} onSelect={setSelectedId} context={data.context} />
        <SelectedPanel
          grant={selected}
          inComparison={comparison.has(selected.opportunity.id)}
          onToggleComparison={() => toggleComparison(selected.opportunity.id)}
          onOpenSource={() => openLink(selected.opportunity.applicationUrl ?? selected.opportunity.sourceUrl).catch((error) => setNotice(error.message))}
          onAskCopilot={() => followUp(`Explain the largest eligibility risks and next verification steps for ${selected.opportunity.title}. Use only the GrantPilot evidence returned for this grant.`).catch((error) => setNotice(error.message))}
          onCreateWatch={createWatch}
        />
      </div>
      {comparison.size > 0 && (
        <div className="compare-dock">
          <span><b>{comparison.size}</b> selected for comparison</span>
          <button disabled={comparison.size < 2} onClick={showComparison}>Compare side by side</button>
          <button onClick={() => { setComparison(new Set()); setComparisonOpen(false); }}>Clear</button>
        </div>
      )}
      {comparisonOpen && <ComparisonTray grants={compared} onClose={() => setComparisonOpen(false)} />}
      <RankedStrip
        grants={filtered}
        selectedId={selected.opportunity.id}
        onSelect={setSelectedId}
        comparison={comparison}
        onToggleComparison={toggleComparison}
        hasMore={Boolean(data.hasMore)}
        remaining={remaining}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
      />
      <footer>
        <span>GrantPilot ranks evidence; it does not guarantee eligibility or funding.</span>
        <span>{data.warnings[0] ?? "Application requirements must be verified at the original source."}</span>
      </footer>
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
    </main>
  );
}
