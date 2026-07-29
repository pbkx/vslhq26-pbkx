import{createHash,randomUUID}from"node:crypto";import type{GrantOpportunity,GrantSource,MatchWeights,OrganizationProfile,ProjectProfile,SearchOutput}from"../domain/types.js";import{DEFAULT_WEIGHTS}from"../domain/types.js";import{CompositeHistoricalProvider,GrantsGovProvider,Irs990PfProspectProvider}from"../providers/providers.js";import{grantRepository}from"../repositories/grantRepository.js";import{localGrantIndex}from"../repositories/localGrantIndex.js";import{scoreGrant,validateWeights}from"../scoring/scoreGrant.js";import{grantCache}from"./persistentCache.js";
export type SearchInput={organization:OrganizationProfile;project:ProjectProfile;query?:string;sources?:GrantSource[];filters?:{deadlineAfter?:string;deadlineBefore?:string;minimumAward?:number;maximumAward?:number;excludeCostShare?:boolean;onlyOpen?:boolean;minimumScore?:number};weights?:MatchWeights;limit?:number;refreshData?:boolean};
const grantsGovProvider=new GrantsGovProvider(),providers=[grantsGovProvider,new Irs990PfProspectProvider()],history=new CompositeHistoricalProvider();
export async function searchGrants(input:SearchInput):Promise<SearchOutput>{
 const weights=input.weights??DEFAULT_WEIGHTS;validateWeights(weights);
 const sources=input.sources??["grants-gov","irs-990pf"],warnings:string[]=[];
 if(!localGrantIndex.isAvailable())warnings.push("The local Grants.gov index is not built; GrantPilot is using clearly labeled demo fallback records.");
 if(sources.includes("irs-990pf")&&!localGrantIndex.hasPrivateProspects()&&process.env.DEMO_IRS_PROSPECTS!=="false")warnings.push("Private-funder results are demo prospects until the IRS index CSV is staged and the 990-PF importer is run.");
 const key=createHash("sha256").update(JSON.stringify({q:input.query,sources,filters:input.filters})).digest("hex");
 const cached=await grantCache.getOrLoad<GrantOpportunity[]>(`search:v3:${key}`,3_600_000,async()=>{
  const settled=await Promise.all(providers.filter(provider=>sources.includes(provider.source)).map(async provider=>{
   try{return await provider.search({query:input.query,sources,limit:input.limit??25})}
   catch{warnings.push(`${provider.source} was unavailable; other sources are still shown.`);return[]}
  }));
  return settled.flat();
 },input.refreshData??false);
 if(cached.state==="stale")warnings.push("A provider was unavailable, so GrantPilot used the last successful normalized search cache.");
 let opportunities=cached.data;
 if(input.refreshData){
  const federal=opportunities.filter(item=>item.source==="grants-gov").slice(0,3);
  const verified=await Promise.all(federal.map(async item=>{
   try{return await grantsGovProvider.verifySelected(item)}
   catch{return item}
  }));
  const byId=new Map(verified.map(item=>[item.id,item]));
  opportunities=opportunities.map(item=>byId.get(item.id)??item);
  if(federal.length)warnings.push(`Targeted live Grants.gov verification was attempted for ${federal.length} selected federal results; the full corpus was not rescanned.`);
 }
 opportunities=opportunities.filter(grant=>
  (!input.filters?.onlyOpen||grant.opportunityStatus==="open")&&
  (!input.filters?.excludeCostShare||!grant.requiresCostShare)&&
  (!input.filters?.minimumAward||(grant.awardMax??0)>=input.filters.minimumAward)&&
  (!input.filters?.maximumAward||(grant.awardMin??Infinity)<=input.filters.maximumAward)&&
  (!input.filters?.deadlineAfter||!grant.deadline||grant.deadline>=input.filters.deadlineAfter)&&
  (!input.filters?.deadlineBefore||!grant.deadline||grant.deadline<=input.filters.deadlineBefore)
 );
 const scored=await Promise.all(opportunities.map(async grant=>scoreGrant(grant,input.organization,input.project,await history.getHistoricalEvidence(grant,input.organization,input.project),weights)));
 const grants=scored.filter(grant=>grant.score.overallScore>=(input.filters?.minimumScore??0)).sort((a,b)=>b.score.overallScore-a.score.overallScore).slice(0,input.limit??25);
 const output:SearchOutput={queryId:`query-${randomUUID().slice(0,8)}`,searchedAt:new Date().toISOString(),resultCount:grants.length,sourceCounts:{"grants-gov":grants.filter(item=>item.opportunity.source==="grants-gov").length,"irs-990pf":grants.filter(item=>item.opportunity.source==="irs-990pf").length},weights,grants,warnings,organization:input.organization,project:input.project};
 return grantRepository.saveSearch(output);
}
export function rescoreGrants(queryId:string,grantIds:string[],weights:MatchWeights){
 validateWeights(weights);const search=grantRepository.getSearch(queryId),selected=search.grants.filter(grant=>grantIds.includes(grant.opportunity.id));
 const grants=selected.map(grant=>scoreGrant(grant.opportunity,search.organization,search.project,{score:grant.score.components.historicalSimilarity.score,confidence:grant.score.components.historicalSimilarity.confidence,reasons:grant.score.components.historicalSimilarity.reasons,awardCount:Number(grant.score.components.historicalSimilarity.evidence[0]?.value??0),source:"unavailable"},weights)).sort((a,b)=>b.score.overallScore-a.score.overallScore);
 return grantRepository.saveSearch({...search,weights,grants,resultCount:grants.length,searchedAt:new Date().toISOString()});
}
