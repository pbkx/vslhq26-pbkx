import{describe,expect,it}from"vitest";import{demoOrganization,demoProject}from"../src/data/demoProfiles.js";import{DEFAULT_WEIGHTS}from"../src/domain/types.js";import{buildRetrievalQueries,inferAwardRange,inferRequestedResultCount,inferResultTypes,prefersMostlyCurrentFederal,rescoreGrants,searchGrants,watchRefreshFilters}from"../src/services/grantSearchService.js";
import{inferProfilesFromQuery}from"../src/services/profileInference.js";
const exactPrompt="Find grants for a Washington nonprofit teaching practical AI skills to low-income adults. We need between $100,000 and $500,000.";
describe("multi-source search",()=>{
 it("combines current opportunities and historical funder prospects",async()=>{const result=await searchGrants({organization:demoOrganization,project:demoProject,limit:20});expect(result.grants.length).toBeGreaterThanOrEqual(10);expect(result.sourceCounts["irs-990pf"]).toBeGreaterThan(0);expect(result.sourceCounts["grants-gov"]).toBeGreaterThan(0);expect(result.grants[0].score.components.missionAlignment.evidence.length).toBeGreaterThan(0);expect(result.grants.filter(item=>item.opportunity.source==="irs-990pf").every(item=>item.opportunity.opportunityStatus==="unknown")).toBe(true)});
 it("expands the demo prompt and preserves only relevant IRS prospects when onlyOpen is requested",async()=>{
  expect(inferAwardRange(exactPrompt)).toEqual({minimumAward:100000,maximumAward:500000});
  const queries=buildRetrievalQueries({query:exactPrompt,organization:demoOrganization,project:demoProject});
  expect(queries).toContain("artificial intelligence");
  expect(queries).toContain("workforce development");
  expect(queries).toContain("low income adults");
  const result=await searchGrants({query:exactPrompt,organization:demoOrganization,project:demoProject,filters:{onlyOpen:true},limit:20,refreshData:true});
  expect(result.resultCount).toBeGreaterThanOrEqual(3);
  expect(result.sourceCounts["irs-990pf"]).toBeGreaterThanOrEqual(1);
  expect(result.grants.every(item=>item.score.components.missionAlignment.score>=45)).toBe(true);
  expect(result.grants.every(item=>(item.opportunity.awardMax??0)>=100000&&(item.opportunity.awardMin??Number.POSITIVE_INFINITY)<=500000)).toBe(true);
  expect(result.grants.filter(item=>item.opportunity.source==="grants-gov").every(item=>item.score.eligibilityStatus!=="likely-ineligible")).toBe(true);
  expect(new Set(result.grants.map(item=>item.chart.applicationEffort)).size).toBeGreaterThanOrEqual(3);
 },30_000);
 it("honors explicit and inferred result types",async()=>{expect(inferResultTypes("Only show current open grants; no historical prospects.")).toEqual(["current-federal"]);expect(inferResultTypes("Show only IRS historical foundation prospects.")).toEqual(["historical-private-prospect"]);const current=await searchGrants({query:`${exactPrompt} Only show current open grants; no historical prospects.`,organization:demoOrganization,project:demoProject,resultTypes:["current-federal"],limit:20});expect(current.grants.length).toBeGreaterThan(0);expect(current.grants.every(item=>item.opportunity.recordCategory==="current-federal-opportunity")).toBe(true);expect(current.sourceCounts["irs-990pf"]).toBe(0);const historical=await searchGrants({query:`${exactPrompt} Show only historical foundation prospects.`,organization:demoOrganization,project:demoProject,resultTypes:["historical-private-prospect"],limit:20});expect(historical.grants.length).toBeGreaterThan(0);expect(historical.grants.every(item=>item.opportunity.recordCategory==="private-funder-prospect")).toBe(true);expect(historical.sourceCounts["grants-gov"]).toBe(0)});
 it("treats mostly-open-federal as federal-first rather than federal-only",async()=>{
  const query="Search for nonprofit grants between $0 and $500,000 toward hunger relief. Target mostly open federal grants.";
  expect(prefersMostlyCurrentFederal(query)).toBe(true);
  expect(inferResultTypes(query)).toEqual([
   "current-federal",
   "forecasted-federal",
   "historical-private-prospect",
  ]);
  const profiles=inferProfilesFromQuery(query);
  const result=await searchGrants({
   query,
   ...profiles,
   resultTypes:["current-federal"],
   filters:{onlyOpen:true},
   limit:80,
  });
  expect(result.grants.length).toBeGreaterThan(0);
  expect(result.grants.some(item=>item.opportunity.recordCategory==="current-federal-opportunity")).toBe(true);
  const categories=result.grants.map(item=>item.opportunity.recordCategory);
  const firstFallback=categories.findIndex(category=>category!=="current-federal-opportunity");
  const lastCurrent=categories.lastIndexOf("current-federal-opportunity");
  expect(firstFallback===-1||lastCurrent<firstFallback).toBe(true);
 },30_000);
 it("returns relevant records for a strict current-open federal hunger search",async()=>{
  const query="Find nonprofit hunger-relief grants between $0 and $500,000. Only current open federal grants.";
  const profiles=inferProfilesFromQuery(query);
  const result=await searchGrants({
   query,
   ...profiles,
   resultTypes:["current-federal"],
   filters:{onlyOpen:true},
   limit:80,
  });
  expect(result.grants.length).toBeGreaterThan(0);
  expect(result.grants.every(item=>item.opportunity.recordCategory==="current-federal-opportunity")).toBe(true);
  expect(result.grants.every(item=>item.opportunity.opportunityStatus==="open")).toBe(true);
  expect(result.grants.every(item=>item.score.components.missionAlignment.score>=45)).toBe(true);
 },30_000);
 it("infers requested result counts without confusing award amounts",()=>{
  expect(inferRequestedResultCount("Show me 40 matching grants for workforce development.")).toBe(40);
  expect(inferRequestedResultCount("List the top 75 grants.")).toBe(75);
  expect(inferRequestedResultCount("Search for like 50")).toBe(50);
  expect(inferRequestedResultCount("Find grants below $500,000.")).toBeUndefined();
  expect(inferRequestedResultCount(exactPrompt)).toBeUndefined();
 });
 it("uses award constraints only when the authoritative request states them",async()=>{
  expect(inferAwardRange("Find grants for a nonprofit food pantry.")).toEqual({});
  expect(inferAwardRange("Find grants for a nonprofit food pantry seeking $250,000.")).toEqual({minimumAward:250000,maximumAward:250000});
  expect(inferAwardRange("Find grants for a food pantry with awards below $500,000.")).toEqual({maximumAward:500000});
  expect(inferAwardRange("Find grants under $250K for hunger relief.")).toEqual({maximumAward:250000});
  const result=await searchGrants({
   query:"Find grants for a Washington nonprofit teaching practical AI skills.",
   organization:demoOrganization,
   project:{...demoProject,estimatedBudget:undefined},
   filters:{minimumAward:100000,maximumAward:500000},
   limit:20,
  });
  expect(result.awardRange).toBeUndefined();
  expect(result.grants.length).toBeGreaterThan(0);
  expect(result.grants.every(item=>item.score.components.programSizeFit.reasons[0]?.includes("No target award size was requested"))).toBe(true);
 });
 it("lets watch sensitivity replace the original search minimum score",()=>{
  const saved={
   searchCriteria:{
    filters:{onlyOpen:true,minimumScore:80,maximumAward:500000},
   },
  }as any;
  expect(watchRefreshFilters(saved)).toEqual({onlyOpen:true,maximumAward:500000});
  expect(saved.searchCriteria.filters.minimumScore).toBe(80);
 });
 it("treats below an amount as a ceiling and returns relevant hunger-relief records",async()=>{
  const query="Find hunger-relief funding opportunities for a Washington nonprofit with awards below $500,000.";
  const result=await searchGrants({
   query,
   organization:demoOrganization,
   project:demoProject,
   resultTypes:["current-federal","forecasted-federal","historical-private-prospect"],
   limit:80,
  });
  expect(result.awardRange).toEqual({minimumAward:undefined,maximumAward:500000});
  expect(result.grants.length).toBeGreaterThan(0);
  expect(result.grants.every(item=>item.score.components.missionAlignment.score>=45)).toBe(true);
  expect(result.grants.every(item=>(item.opportunity.awardMin??Number.POSITIVE_INFINITY)<=500000)).toBe(true);
  expect(result.warnings).toContain(`Only ${result.grants.length} sufficiently relevant records matched.`);
 },30_000);
 it("rescores cached grants without a provider search",async()=>{const result=await searchGrants({organization:demoOrganization,project:demoProject,limit:10});const next=rescoreGrants(result.queryId,result.grants.map(x=>x.opportunity.id),{...DEFAULT_WEIGHTS,missionAlignment:.2,applicantEligibility:.3});expect(next.weights.applicantEligibility).toBe(.3);expect(next.grants).toHaveLength(result.grants.length)});
});
