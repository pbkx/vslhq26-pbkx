import { useEffect, useMemo, useRef, useState } from "react";
import { callTool, connectBridge, followUp, openLink, setBridgeListeners } from "./mcpBridge";
import { applyFilters, DEFAULT_FILTERS, type Filters, type ViewId } from "./grantView";
import type { GrantResult, SearchOutput } from "./types";
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
  const [detailsLoading, setDetailsLoading] = useState("");
  const detailRequests = useRef(new Set<string>());

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
        setSelectedId((current) => {
          if (next.grants.some((grant) => grant.opportunity.id === current)) return current;
          return next.grants.reduce(
            (best, grant) => !best || grant.score.overallScore > best.score.overallScore ? grant : best,
            next.grants[0],
          )?.opportunity.id ?? "";
        });
      },
      setNotice,
    );
    connectBridge();
  }, []);

  useEffect(() => {
    detailRequests.current.clear();
  }, [data?.queryId]);

  useEffect(() => {
    if (!data || !selectedId) return;
    const grant = data.grants.find((item) => item.opportunity.id === selectedId);
    if (!grant || grant.detailsLoaded || detailRequests.current.has(selectedId)) return;

    detailRequests.current.add(selectedId);
    setDetailsLoading(selectedId);
    callTool("get_grant_details", { grantId: selectedId })
      .then((detail: GrantResult) => {
        if (!detail?.opportunity?.id || !detail?.score?.components) {
          throw new Error("GrantPilot returned incomplete grant evidence.");
        }
        setData((current) => current ? {
          ...current,
          grants: current.grants.map((item) =>
            item.opportunity.id === selectedId ? { ...detail, detailsLoaded: true } : item),
        } : current);
      })
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : "Unable to load complete grant evidence.");
      })
      .finally(() => {
        detailRequests.current.delete(selectedId);
        setDetailsLoading((current) => current === selectedId ? "" : current);
      });
  }, [data?.queryId, selectedId]);

  const filtered = useMemo(() => data ? applyFilters(data.grants, filters) : [], [data, filters]);
  const selected = filtered.find((grant) => grant.opportunity.id === selectedId) ?? filtered[0] ?? data?.grants[0];
  const compared = data?.grants.filter((grant) => comparison.has(grant.opportunity.id)) ?? [];

  useEffect(() => {
    if (filtered.length && !filtered.some((grant) => grant.opportunity.id === selectedId)) {
      setSelectedId(filtered[0]!.opportunity.id);
    }
  }, [filtered, selectedId]);

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
    const titles = compared.map((grant) => `"${grant.opportunity.title}"`);
    const prompt = `Compare these selected grants: ${titles.length === 2 ? titles.join(" and ") : `${titles.slice(0, -1).join(", ")}, and ${titles.at(-1)}`}.`;
    let comparisonLoaded = false;
    try {
      await callTool("compare_grants", { grantIds: [...comparison] });
      comparisonLoaded = true;
    } catch (error) {
      setNotice(error instanceof Error ? `${error.message} Showing the loaded comparison.` : "Showing the loaded comparison.");
    }
    try {
      await followUp(prompt);
      setNotice(comparisonLoaded ? "Comparison evidence sent to Copilot." : "Comparison request sent to Copilot.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to send the comparison request to Copilot.");
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

  if (!data) {
    return (
      <main className="loading">
        <GrantPilotMark />
        <h2>Opening GrantPilot</h2>
        <p>Preparing your grant opportunity workbench…</p>
        {notice && <span>{notice}</span>}
      </main>
    );
  }

  if (!data.grants.length || !selected) {
    return (
      <main className="loading empty-results">
        <GrantPilotMark />
        <h2>No matching records</h2>
        <p>GrantPilot completed the search, but no sufficiently relevant opportunities passed the requested mission, geography, eligibility, and award filters.</p>
        <span>{data.warnings[0] ?? "Broaden one constraint or try a related mission phrase."}</span>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <ControlBar
        data={data}
        view={view}
        onViewChange={setView}
        filters={filters}
        onFiltersChange={setFilters}
        visibleGrants={filtered}
      />
      <div className="workspace">
        <Visualization view={view} grants={filtered} selectedId={selected.opportunity.id} onSelect={setSelectedId} context={data.context} />
        <SelectedPanel
          grant={selected}
          detailsLoading={detailsLoading === selected.opportunity.id}
          inComparison={comparison.has(selected.opportunity.id)}
          comparisonCount={comparison.size}
          onToggleComparison={() => toggleComparison(selected.opportunity.id)}
          onCompareSelected={showComparison}
          onOpenSource={() => openLink(selected.opportunity.applicationUrl ?? selected.opportunity.sourceUrl).catch((error) => setNotice(error.message))}
          onAskCopilot={() => followUp(`Tell me more about ${selected.opportunity.title}.`).catch((error) => setNotice(error.message))}
          onCreateWatch={createWatch}
        />
      </div>
      {comparisonOpen && <ComparisonTray grants={compared} onClose={() => setComparisonOpen(false)} />}
      <RankedStrip
        grants={filtered}
        selectedId={selected.opportunity.id}
        onSelect={setSelectedId}
        comparison={comparison}
        onToggleComparison={toggleComparison}
      />
      <footer>
        <span>GrantPilot ranks evidence; it does not guarantee eligibility or funding.</span>
        <span>{data.warnings[0] ?? "Application requirements must be verified at the original source."}</span>
      </footer>
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
    </main>
  );
}
