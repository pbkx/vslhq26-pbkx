import {createHash,randomUUID} from "node:crypto";
import type {
 GrantOpportunity,GrantResult,GrantSource,MatchWeights,OrganizationProfile,
 ProjectProfile,SearchOutput,
} from "../domain/types.js";
import {DEFAULT_WEIGHTS} from "../domain/types.js";
import {
 CompositeHistoricalProvider,GrantsGovProvider,Irs990PfProspectProvider,
} from "../providers/providers.js";
import {grantRepository} from "../repositories/grantRepository.js";
import {localGrantIndex} from "../repositories/localGrantIndex.js";
import {scoreGrant,validateWeights} from "../scoring/scoreGrant.js";
import {grantCache} from "./persistentCache.js";

export type SearchInput={
 organization:OrganizationProfile;
 project:ProjectProfile;
 query?:string;
 sources?:GrantSource[];
 resultTypes?:GrantResultType[];
 filters?:{
  deadlineAfter?:string;
  deadlineBefore?:string;
  minimumAward?:number;
  maximumAward?:number;
  excludeCostShare?:boolean;
  onlyOpen?:boolean;
  minimumScore?:number;
 };
 weights?:MatchWeights;
 limit?:number;
 refreshData?:boolean;
};
export type GrantResultType="current-federal"|"forecasted-federal"|"historical-private-prospect";
export const MAX_SEARCH_RESULTS=100;

const grantsGovProvider=new GrantsGovProvider();
const providers=[grantsGovProvider,new Irs990PfProspectProvider()];
const history=new CompositeHistoricalProvider();
const STOP_WORDS=new Set([
 "find","grant","grants","funding","for","a","an","the","and","or","of","to","we",
 "our","need","needs","want","between","from","with","in","is","are","nonprofit",
 "washington","state","organization","company","teaching","practical",
]);

const normalize=(value:string)=>value.toLowerCase().replace(/[^a-z0-9$ -]/g," ").replace(/\s+/g," ").trim();
const includesAny=(text:string,values:string[])=>values.some(value=>text.includes(value));
const unique=(values:string[])=>[...new Set(values.map(normalize).filter(Boolean))];

/**
 * Produces several focused FTS queries instead of one long natural-language
 * OR query. Each query retrieves a bounded candidate set which is then scored.
 */
export function buildRetrievalQueries(input:Pick<SearchInput,"query"|"organization"|"project">){
 const profileText=normalize([
  input.query??"",input.project.title,input.project.summary,...input.project.topics,
  ...input.project.targetPopulations,...input.organization.missionTopics,
  ...input.organization.populationsServed,
 ].join(" "));
 const queries:string[]=[];
 const add=(...values:string[])=>queries.push(...values);

 if(includesAny(profileText,["artificial intelligence"," ai ","ai literacy","machine learning"]))
  add("artificial intelligence","digital skills");
 if(includesAny(profileText,["workforce","job training","employment","career","upskill","economic mobility"]))
  add("workforce development","employment training","economic mobility","job training","career development","career readiness","job placement");
 if(includesAny(profileText,["digital inclusion","digital equity","digital skills","technology training"]))
  add("digital inclusion","technology training","technology education","computer education");
 if(includesAny(profileText,["adult education","adult learning","adults"]))
  add("adult education");
 if(includesAny(profileText,["low income","low-income","underserved","economic mobility"]))
  add("low income adults","underserved workers","economic opportunity","employment services","adult workforce");

 add(...input.project.topics,...input.organization.missionTopics);
 const usefulQueryTerms=normalize(input.query??"").split(" ")
  .filter(term=>term.length>2&&!STOP_WORDS.has(term)&&!/\d/.test(term))
  .slice(0,8).join(" ");
 if(usefulQueryTerms)add(usefulQueryTerms);
 return unique(queries).slice(0,20);
}

function parseMoney(value:string){
 const match=value.toLowerCase().replace(/\s+/g,"").match(/(\d[\d,]*(?:\.\d+)?)(k|m|thousand|million)?/);
 if(!match)return undefined;
 const number=Number(match[1]!.replaceAll(",",""));
 if(!Number.isFinite(number))return undefined;
 const unit=match[2];
 return number*(unit==="k"||unit==="thousand"?1_000:unit==="m"||unit==="million"?1_000_000:1);
}

export function inferAwardRange(query?:string){
 if(!query)return{};
 const values=[...query.matchAll(/\$?\s*\d[\d,]*(?:\.\d+)?\s*(?:k|m|thousand|million)?/gi)]
  .map(match=>parseMoney(match[0])).filter((value):value is number=>value!==undefined&&value>=1_000);
 if(values.length>=2&&/(between|from|range|through|–|—|-)/i.test(query))
  return{minimumAward:Math.min(values[0]!,values[1]!),maximumAward:Math.max(values[0]!,values[1]!)};
 const one=values[0];
 if(one!==undefined&&/(up to|maximum|ceiling|no more than)/i.test(query))return{maximumAward:one};
 if(one!==undefined&&/(at least|minimum|floor|more than)/i.test(query))return{minimumAward:one};
 return{};
}

export function inferResultTypes(query?:string):GrantResultType[]|undefined{
 if(!query)return undefined;
 const text=normalize(query);
 const current=/\b(current|currently open|active|open grants? only)\b/.test(text);
 const forecast=/\b(forecasted|forecast|upcoming federal)\b/.test(text);
 const historical=/\b(historical|irs|990-pf|foundation prospects?|private funder prospects?)\b/.test(text);
 const only=/\b(only|exclusively|just)\b/.test(text);
 const excludeHistorical=/\b(no|not|without|exclude|excluding|do not want|dont want)\b.{0,24}\b(historical|irs|990-pf|prospects?)\b/.test(text);
 const excludeForecast=/\b(no|not|without|exclude|excluding)\b.{0,20}\b(forecast|forecasted)\b/.test(text);
 const federalOnly=/\b(federal only|only federal|federal grants? only)\b/.test(text);
 const historicalOnly=(historical&&only)||/\b(only|just)\b.{0,20}\b(foundations?|private funders?|irs|990-pf)\b/.test(text);

 if(historicalOnly&&!current&&!forecast)return["historical-private-prospect"];
 if(current&&only)return["current-federal"];
 if(forecast&&only&&!current)return["forecasted-federal"];
 if(excludeHistorical||federalOnly){
  if(current&&!forecast)return["current-federal"];
  if(forecast&&!current)return["forecasted-federal"];
  return excludeForecast?["current-federal"]:["current-federal","forecasted-federal"];
 }
 if(excludeForecast)return historical?["current-federal","historical-private-prospect"]:["current-federal"];
 if(current&&!forecast&&!historical)return["current-federal"];
 if(forecast&&!current&&!historical)return["forecasted-federal"];
 if(historical&&!current&&!forecast)return["historical-private-prospect"];
 return undefined;
}

export function inferRequestedResultCount(query?:string){
 if(!query)return undefined;
 const text=query.replace(/,/g," ");
 const match=text.match(/\b(?:find|show|list|return|give\s+me|top)\s+(?:the\s+)?(\d{1,4})\s+(?:matching\s+|best\s+|ranked\s+)?grants?\b/i)
  ??text.match(/\b(\d{1,4})\s+(?:matching\s+|best\s+|ranked\s+)?grants?\b/i);
 if(!match)return undefined;
 const count=Number(match[1]);
 return Number.isInteger(count)?count:undefined;
}

const recordMatches=(opportunity:GrantOpportunity,types:GrantResultType[])=>types.some(type=>
 type==="current-federal"?opportunity.recordCategory==="current-federal-opportunity":
 type==="forecasted-federal"?opportunity.recordCategory==="forecasted-federal-opportunity":
 opportunity.recordCategory==="private-funder-prospect"
);

function balancedResults(ranked:GrantResult[],limit:number,sources:GrantSource[]){
 if(sources.length<2)return ranked.slice(0,limit);
 const rankIndex=new Map(ranked.map((item,index)=>[item.opportunity.id,index]));
 const federal=ranked.filter(item=>item.opportunity.source==="grants-gov");
 const privateProspects=ranked.filter(item=>item.opportunity.source==="irs-990pf");
 const selected:GrantResult[]=[];
 const add=(item:GrantResult)=>{if(!selected.some(value=>value.opportunity.id===item.opportunity.id))selected.push(item)};
 const privateFloor=Math.min(privateProspects.length,Math.max(2,Math.floor(limit*.4)));
 const federalFloor=Math.min(federal.length,Math.max(2,Math.floor(limit*.4)));
 privateProspects.slice(0,privateFloor).forEach(add);
 federal.slice(0,federalFloor).forEach(add);
 ranked.forEach(item=>{if(selected.length<limit)add(item)});
 return selected.sort((a,b)=>(rankIndex.get(a.opportunity.id)??0)-(rankIndex.get(b.opportunity.id)??0)).slice(0,limit);
}

export async function searchGrants(input:SearchInput):Promise<SearchOutput>{
 const weights=input.weights??DEFAULT_WEIGHTS;
 validateWeights(weights);
 const resultTypes=input.resultTypes??inferResultTypes(input.query);
 const inferredSources:GrantSource[]|undefined=resultTypes?[...new Set(resultTypes.map(type=>type==="historical-private-prospect"?"irs-990pf" as const:"grants-gov" as const))]:undefined;
 const sources=input.sources??inferredSources??["grants-gov","irs-990pf"];
 const warnings:string[]=[];
 const limit=Math.max(1,Math.min(MAX_SEARCH_RESULTS,input.limit??80));
 const inferredRange=inferAwardRange(input.query);
 const filters={...inferredRange,...input.filters};
 const searchQueries=buildRetrievalQueries(input);
 const preferredStates=[
  ...input.project.geographicAreas.flatMap(area=>area.states??[]),
  ...input.organization.serviceAreas.flatMap(area=>area.states??[]),
 ].map(state=>state.toUpperCase());

 if(!localGrantIndex.isAvailable())
  warnings.push("The local Grants.gov index is not built; GrantPilot is using clearly labeled demo fallback records.");
 if(sources.includes("irs-990pf")&&!localGrantIndex.hasPrivateProspects()&&process.env.DEMO_IRS_PROSPECTS!=="false")
  warnings.push("Private-funder results are demo prospects until the IRS index CSV is staged and the 990-PF importer is run.");

 const key=createHash("sha256").update(JSON.stringify({
  q:input.query,searchQueries,sources,resultTypes,filters,preferredStates,
  topics:input.project.topics,mission:input.organization.missionTopics,
 })).digest("hex");
 const candidateLimit=Math.min(420,Math.max(300,limit*30));
 const cached=await grantCache.getOrLoad<GrantOpportunity[]>(`search:v5:${key}`,3_600_000,async()=>{
  const settled=await Promise.all(providers.filter(provider=>sources.includes(provider.source)).map(async provider=>{
   try{return await provider.search({
    query:input.query,searchQueries,preferredStates,limit:candidateLimit,
   })}
   catch{
    warnings.push(`${provider.source} was unavailable; other sources are still shown.`);
    return[];
   }
  }));
  return settled.flat();
 },input.refreshData??false);

 if(cached.state==="stale")
  warnings.push("A provider was unavailable, so GrantPilot used the last successful normalized search cache.");
 let opportunities=cached.data;

 if(input.refreshData){
  const federal=opportunities.filter(item=>item.source==="grants-gov").slice(0,3);
  const verified=await Promise.all(federal.map(async item=>{
   try{return await grantsGovProvider.verifySelected(item)}
   catch{return item}
  }));
  const byId=new Map(verified.map(item=>[item.id,item]));
  opportunities=opportunities.map(item=>byId.get(item.id)??item);
  if(federal.length)
   warnings.push(`Targeted live Grants.gov verification was attempted for ${federal.length} selected federal results; the full corpus was not rescanned.`);
 }

 opportunities=opportunities.filter(grant=>
  (!resultTypes||recordMatches(grant,resultTypes))&&
  // "Open" is a current-opportunity status and therefore applies only to
  // Grants.gov. IRS records remain eligible as clearly labeled prospects.
  (!filters.onlyOpen||grant.source==="irs-990pf"||grant.opportunityStatus==="open")&&
  (!filters.excludeCostShare||!grant.requiresCostShare)&&
  (!filters.minimumAward||(grant.awardMax??0)>=filters.minimumAward)&&
  (!filters.maximumAward||(grant.awardMin??Number.POSITIVE_INFINITY)<=filters.maximumAward)&&
  (!filters.deadlineAfter||!grant.deadline||grant.deadline>=filters.deadlineAfter)&&
  (!filters.deadlineBefore||!grant.deadline||grant.deadline<=filters.deadlineBefore)
 );

 const scored=await Promise.all(opportunities.map(async grant=>
  scoreGrant(grant,input.organization,input.project,await history.getHistoricalEvidence(grant,input.organization,input.project),weights)
 ));
 const ranked=scored
 .filter(grant=>grant.score.overallScore>=(filters.minimumScore??0))
  // A good budget/geography score must not allow an unrelated program to lead.
  .filter(grant=>grant.score.components.missionAlignment.score>=(grant.opportunity.source==="irs-990pf"?10:20))
  // Explicit applicant conflicts are evidence, but not actionable primary
  // recommendations for this organization.
  .filter(grant=>grant.opportunity.source==="irs-990pf"||grant.score.eligibilityStatus!=="likely-ineligible")
  .sort((a,b)=>{
   const tier=(grant:GrantResult)=>grant.score.components.missionAlignment.score>=(grant.opportunity.source==="irs-990pf"?25:45)?1:0;
   return tier(b)-tier(a)||b.score.overallScore-a.score.overallScore;
  });
 const grants=balancedResults(ranked,limit,sources);

 const federalCount=grants.filter(item=>item.opportunity.source==="grants-gov").length;
 const privateCount=grants.filter(item=>item.opportunity.source==="irs-990pf").length;
 if(!federalCount&&sources.includes("grants-gov"))
  warnings.push("No sufficiently mission-aligned current federal opportunity was found in the requested award range.");
 if(privateCount){
  warnings.push(`${privateCount} result${privateCount===1?" is":"s are"} historical IRS 990-PF prospect evidence, not confirmed open applications.`);
  const privateWithPreferredHistory=grants.filter(item=>item.opportunity.source==="irs-990pf"&&
   item.opportunity.eligibleLocations.some(area=>area.states?.some(state=>preferredStates.includes(state.toUpperCase())))
  ).length;
  if(preferredStates.length&&!privateWithPreferredHistory)
   warnings.push(`The selected IRS prospect records do not show matched historical giving in ${preferredStates.join("/")}; geographic fit requires direct foundation research.`);
 }

 const output:SearchOutput={
  queryId:`query-${randomUUID().slice(0,8)}`,searchedAt:new Date().toISOString(),
  resultCount:grants.length,
  sourceCounts:{"grants-gov":federalCount,"irs-990pf":privateCount},
  weights,grants,warnings,organization:input.organization,project:input.project,
 };
 return grantRepository.saveSearch(output);
}

export function rescoreGrants(queryId:string,grantIds:string[],weights:MatchWeights){
 validateWeights(weights);
 const search=grantRepository.getSearch(queryId);
 const selected=search.grants.filter(grant=>grantIds.includes(grant.opportunity.id));
 const grants=selected.map(grant=>scoreGrant(
  grant.opportunity,search.organization,search.project,
  {
   score:grant.score.components.historicalSimilarity.score,
   confidence:grant.score.components.historicalSimilarity.confidence,
   reasons:grant.score.components.historicalSimilarity.reasons,
   awardCount:Number(grant.score.components.historicalSimilarity.evidence[0]?.value??0),
   source:"unavailable",
  },weights
 )).sort((a,b)=>b.score.overallScore-a.score.overallScore);
 return grantRepository.saveSearch({...search,weights,grants,resultCount:grants.length,searchedAt:new Date().toISOString()});
}
