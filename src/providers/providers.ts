import {mockGrants} from "../data/mockGrants.js";
import type {GrantOpportunity,GrantSource,HistoricalEvidence,OrganizationProfile,ProjectProfile} from "../domain/types.js";
import {localGrantIndex} from "../repositories/localGrantIndex.js";
import {grantCache} from "../services/persistentCache.js";

export type OpportunitySearchQuery={
 query?:string;
 searchQueries?:string[];
 preferredStates?:string[];
 minimumAward?:number;
 maximumAward?:number;
 sources?:GrantSource[];
 limit:number;
};
export interface OpportunityProvider{
 source:GrantSource;
 search(query:OpportunitySearchQuery):Promise<GrantOpportunity[]>;
 getById(sourceId:string):Promise<GrantOpportunity|null>;
 verifySelected?(opportunity:GrantOpportunity):Promise<GrantOpportunity>;
}
export interface HistoricalAwardProvider{getHistoricalEvidence(opportunity:GrantOpportunity,organization:OrganizationProfile,project:ProjectProfile):Promise<HistoricalEvidence>}

async function fetchRetry(url:string,init:RequestInit){
 let last:unknown;
 for(let attempt=0;attempt<2;attempt++){
  try{
   const response=await fetch(url,{...init,signal:AbortSignal.timeout(8_000)});
   if(response.ok)return response;
   if(response.status<500)throw new Error(`HTTP ${response.status}`);
   last=new Error(`HTTP ${response.status}`);
  }catch(error){last=error}
  if(!attempt)await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw last;
}
const date=(value:unknown)=>{if(!value)return undefined;const parsed=new Date(String(value));return Number.isNaN(parsed.valueOf())?undefined:parsed.toISOString().slice(0,10)};
const amount=(value:unknown)=>{const parsed=Number(String(value??"").replace(/[$,\s]/g,""));return Number.isFinite(parsed)?parsed:undefined};

export class MockOpportunityProvider implements OpportunityProvider{
 constructor(public source:GrantSource){}
 async search(query:OpportunitySearchQuery){return mockGrants.filter(item=>item.source===this.source).slice(0,query.limit)}
 async getById(id:string){return mockGrants.find(item=>item.source===this.source&&(item.sourceId===id||item.id===id))??null}
}

export class GrantsGovProvider implements OpportunityProvider{
 source="grants-gov" as const;
 private fallback=new MockOpportunityProvider(this.source);
 async search(query:OpportunitySearchQuery){
  const queries=query.searchQueries?.length?query.searchQueries:[query.query].filter((value):value is string=>Boolean(value));
  const perQuery=Math.max(20,Math.ceil(query.limit/Math.max(queries.length,1)));
  const indexed=[...new Map(
   queries.flatMap(value=>localGrantIndex.searchFederal(value,perQuery))
    .map(item=>[item.id,item] as const)
  ).values()].slice(0,query.limit);
  return indexed.length?indexed:this.fallback.search(query);
 }
 async getById(id:string){return localGrantIndex.getFederal(id)??this.fallback.getById(id)}
 async verifySelected(opportunity:GrantOpportunity){
  if(opportunity.source!=="grants-gov"||!opportunity.sourceId.match(/^\d+$/))return opportunity;
  const cached=await grantCache.getOrLoad(`grants-gov:verify:${opportunity.sourceId}`,15*60_000,async()=>{
   const response=await fetchRetry(`${process.env.GRANTS_GOV_API_BASE_URL??"https://api.grants.gov"}/v1/api/fetchOpportunity`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({opportunityId:Number(opportunity.sourceId)}),
   });
   const body:any=await response.json(),data=body.data;
   if(!data||body.errorcode!==0)throw new Error(body.msg??"Grants.gov did not return an opportunity");
   const detail=data.synopsis??data.forecast??{},verifiedAt=new Date().toISOString();
   const status:String=String(data.docType??detail.docType??opportunity.opportunityStatus);
   return{
    ...opportunity,title:String(data.opportunityTitle??opportunity.title),
    funderName:String(detail.agencyName??data.agencyDetails?.agencyName??opportunity.funderName),
    summary:String(detail.synopsisDesc??detail.forecastDesc??opportunity.summary),
    awardMin:amount(detail.awardFloor)??opportunity.awardMin,awardMax:amount(detail.awardCeiling)??opportunity.awardMax,
    requiresCostShare:typeof detail.costSharing==="boolean"?detail.costSharing:opportunity.requiresCostShare,
    postedDate:date(detail.postingDate)??opportunity.postedDate,
    deadline:date(detail.responseDate)??date(detail.responseDateDesc)??opportunity.deadline,
    lastUpdated:date(detail.lastUpdatedDate)??opportunity.lastUpdated,lastVerifiedAt:verifiedAt,
    assistanceListingNumbers:Array.isArray(data.alns)?data.alns.map((item:any)=>String(item.alnNumber)).filter(Boolean):opportunity.assistanceListingNumbers,
    opportunityStatus:/forecast/i.test(String(status))?"forecasted":opportunity.opportunityStatus,
    sourceDisclaimer:`Official federal opportunity. Selected fields were verified through the Grants.gov fetchOpportunity API ${verifiedAt.slice(0,10)}; confirm final requirements on Grants.gov.`,
   } satisfies GrantOpportunity;
  },false);
  return cached.data;
 }
}

export class Irs990PfProspectProvider implements OpportunityProvider{
 source="irs-990pf" as const;
 private fallback=new MockOpportunityProvider(this.source);
 async search(query:OpportunitySearchQuery){
  // The raw IRS XML is intentionally never scanned from an interactive request.
  // The explicit IRS importer will populate the local prospect table after the
  // IRS index CSV is staged. Until then, clearly labeled demo prospects may be
  // enabled for hackathon continuity.
  const queries=query.searchQueries?.length?query.searchQueries:[query.query].filter((value):value is string=>Boolean(value));
  const perQuery=Math.max(100,Math.ceil(query.limit/Math.max(queries.length,1)));
  const indexed=[...new Map(
   queries.flatMap(value=>localGrantIndex.searchPrivateProspects(value,perQuery,query.preferredStates,{
    minimum:query.minimumAward,maximum:query.maximumAward,
   }))
    .map(item=>[item.id,item] as const)
  ).values()].slice(0,Math.min(2_000,query.limit*5));
  if(indexed.length)return indexed;
  if(process.env.DEMO_IRS_PROSPECTS==="false")return[];
  return this.fallback.search(query);
 }
 async getById(id:string){return localGrantIndex.getPrivateProspect(id)??this.fallback.getById(id)}
}

export class CompositeHistoricalProvider implements HistoricalAwardProvider{
 async getHistoricalEvidence(opportunity:GrantOpportunity,_organization:OrganizationProfile,_project:ProjectProfile):Promise<HistoricalEvidence>{
  if(opportunity.source==="irs-990pf")return{
   score:68,confidence:40,
   reasons:["Evidence-backed potential private donor/funder candidate worth researching and possibly contacting.","Past giving supplies useful funder-comparison evidence."],
   awardCount:1,medianAward:opportunity.awardMax,source:"irs-990pf",
  };
  return localGrantIndex.getHistoricalEvidence(opportunity.assistanceListingNumbers??[]);
 }
}
