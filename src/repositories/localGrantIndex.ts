import {existsSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {DEFAULT_INDEX_PATH,openIndexDatabase} from "../data/indexDatabase.js";
import type {GrantOpportunity,HistoricalEvidence} from "../domain/types.js";

type FederalRow=Record<string,unknown>;
const jsonList=(value:unknown)=>{try{return JSON.parse(String(value??"[]")) as string[]}catch{return[]}};
const number=(value:unknown)=>typeof value==="number"?value:value===null||value===undefined?undefined:Number(value);
const safeTerms=(query?:string)=>[...new Set((query??"").toLowerCase().match(/[a-z0-9][a-z0-9.-]{1,}/g)??[])].slice(0,12);
const compactText=(value:unknown,maximum=600)=>{const text=String(value??"").replace(/\s+/g," ").trim();return text.length<=maximum?text:`${text.slice(0,maximum-1).trimEnd()}…`};
const compactList=(values:string[],limit=10,maximum=140)=>[...new Set(values.map(value=>compactText(value,maximum)).filter(Boolean))].slice(0,limit);

function mapFederal(row:FederalRow):GrantOpportunity{
 const status=String(row.status) as GrantOpportunity["opportunityStatus"];
  const requirements=compactList(jsonList(row.requirements_json),4,220).map((text,index)=>({id:`source-${index}`,category:"other" as const,text,required:true,machineEvaluable:false}));
 const sourceId=String(row.opportunity_id||row.opportunity_number);
 return{
  id:`grantsgov-${sourceId}`,source:"grants-gov",sourceId,
  recordCategory:status==="forecasted"?"forecasted-federal-opportunity":"current-federal-opportunity",
  title:String(row.title),funderName:String(row.agency_name),funderType:"federal",
  summary:compactText(row.summary),missionTopics:compactList(jsonList(row.mission_topics_json),8,100),populationsServed:[],
  eligibleApplicantTypes:compactList(jsonList(row.eligible_applicants_json),8,140),
  eligibleLocations:[{country:"US",nationwide:true,description:"Review the official eligibility text; federal opportunities may impose geographic restrictions."}],
  awardMin:number(row.award_min),awardMax:number(row.award_max),expectedAwardCount:number(row.expected_award_count),
  requiresCostShare:row.requires_cost_share===null?undefined:Boolean(row.requires_cost_share),
  postedDate:row.posted_date?String(row.posted_date):undefined,deadline:row.close_date?String(row.close_date):undefined,
  lastUpdated:row.last_updated?String(row.last_updated):undefined,lastVerifiedAt:String(row.verified_at),
  fundingOpportunityNumber:String(row.opportunity_number),
  assistanceListingNumbers:compactList(jsonList(row.assistance_listing_numbers_json),12,20),opportunityStatus:status,
  applicationUrl:row.application_url?String(row.application_url):undefined,sourceUrl:String(row.source_url),
  sourceDisclaimer:`Official federal opportunity. Status is from the Grants.gov extract indexed ${String(row.verified_at).slice(0,10)}; confirm current details on Grants.gov.`,
  requirements,rawSourceReference:String(row.raw_source_reference??sourceId),
 };
}

export class LocalGrantIndex{
 readonly path:string;
 constructor(path=DEFAULT_INDEX_PATH){this.path=path}
 isAvailable(){return existsSync(this.path)}
 private open():DatabaseSync{return openIndexDatabase({path:this.path,readOnly:true})}
 hasPrivateProspects(){
  if(!this.isAvailable())return false;
  const db=this.open();
  try{return Boolean((db.prepare("SELECT 1 found FROM private_funder_prospects LIMIT 1").get() as any)?.found)}
  finally{db.close()}
 }
 searchFederal(query:string|undefined,limit:number){
  if(!this.isAvailable())return[];
  const db=this.open();
  try{
   const terms=safeTerms(query);
   const rows=terms.length
    ?db.prepare(`
      SELECT f.* FROM federal_opportunities_fts
      JOIN federal_opportunities f ON f.rowid=federal_opportunities_fts.rowid
      WHERE federal_opportunities_fts MATCH ? AND f.status IN ('open','forecasted')
      ORDER BY bm25(federal_opportunities_fts), COALESCE(f.close_date,'9999-12-31') ASC
      LIMIT ?
     `).all(terms.map(term=>`"${term.replaceAll('"','""')}"*`).join(" OR "),limit)
    :db.prepare(`
      SELECT * FROM federal_opportunities WHERE status IN ('open','forecasted')
      ORDER BY COALESCE(close_date,'9999-12-31') ASC, last_updated DESC LIMIT ?
     `).all(limit);
   return rows.map(row=>mapFederal(row));
  }finally{db.close()}
 }
 getFederal(sourceId:string){
  if(!this.isAvailable())return null;
  const db=this.open();
  try{
   const row=db.prepare("SELECT * FROM federal_opportunities WHERE opportunity_id=? OR opportunity_number=? LIMIT 1").get(sourceId,sourceId);
   return row?mapFederal(row):null;
  }finally{db.close()}
 }
 searchPrivateProspects(query:string|undefined,limit:number){
  if(!this.isAvailable())return[];
  const db=this.open();
  try{
   const terms=safeTerms(query);
   if(!terms.length)return[];
   const rows=db.prepare(`
    SELECT p.* FROM private_funder_prospects_fts
    JOIN private_funder_prospects p ON p.id=private_funder_prospects_fts.rowid
    WHERE private_funder_prospects_fts MATCH ?
    ORDER BY bm25(private_funder_prospects_fts), p.amount DESC
    LIMIT ?
   `).all(terms.map(term=>`"${term.replaceAll('"','""')}"*`).join(" OR "),Math.max(limit*30,100)) as any[];
   const groups=new Map<string,any[]>();
   for(const row of rows){const key=String(row.ein||row.foundation_name);const group=groups.get(key)??[];group.push(row);groups.set(key,group)}
   return[...groups.entries()].slice(0,limit).map(([key,grants]):GrantOpportunity=>{
    const first=grants[0],purposes=[...new Set(grants.map(item=>String(item.purpose)).filter(Boolean))].slice(0,5);
    const topicList=[...new Set(grants.flatMap(item=>jsonList(item.mission_topics_json)))].slice(0,12);
    const amounts=grants.map(item=>number(item.amount)).filter((value):value is number=>value!==undefined);
    const states=[...new Set(grants.map(item=>String(item.recipient_state??"")).filter(Boolean))];
    return{
     id:`irs990pf-${key}`,source:"irs-990pf",sourceId:key,recordCategory:"private-funder-prospect",
     title:`${String(first.foundation_name)} — historical giving pattern`,funderName:String(first.foundation_name),funderType:"foundation",
     summary:`IRS 990-PF filings show historical grants including ${purposes.join("; ")||"purposes requiring review"}. This is a prospect signal, not a current application opportunity.`,
     description:`Matched ${grants.length} historical grant records in the local IRS index.`,missionTopics:topicList,
     populationsServed:[],eligibleApplicantTypes:[],
     eligibleLocations:[{country:"US",states,description:"Historical recipient locations; not a current geographic eligibility rule."}],
     awardMin:amounts.length?Math.min(...amounts):undefined,awardMax:amounts.length?Math.max(...amounts):undefined,
     opportunityStatus:"unknown",lastVerifiedAt:String(first.indexed_at),
     sourceUrl:String(first.source_url),sourceDisclaimer:"Historical private-foundation funding match. The IRS filing does not establish that the foundation currently accepts applications.",
     requirements:[],rawSourceReference:`IRS object IDs: ${[...new Set(grants.map(item=>String(item.object_id)))].slice(0,5).join(", ")}`,
    };
   });
  }finally{db.close()}
 }
 getPrivateProspect(sourceId:string){
  return this.searchPrivateProspects(sourceId,1)[0]??null;
 }
 getHistoricalEvidence(assistanceListingNumbers:string[]):HistoricalEvidence{
  if(!this.isAvailable()||!assistanceListingNumbers.length)return{score:50,confidence:20,reasons:["No cached historical-award statistics are available for this opportunity."],awardCount:0,source:"unavailable"};
  const db=this.open();
  try{
   const placeholders=assistanceListingNumbers.map(()=>"?").join(",");
   const rows=db.prepare(`SELECT * FROM federal_award_statistics WHERE assistance_listing_number IN (${placeholders})`).all(...assistanceListingNumbers) as any[];
   if(!rows.length)return{score:50,confidence:25,reasons:[`No cached USAspending aggregates are available for Assistance Listing ${assistanceListingNumbers.join(", ")}.`],awardCount:0,source:"unavailable"};
   const awardCount=rows.reduce((sum,row)=>sum+Number(row.award_count),0),washingtonAwards=rows.reduce((sum,row)=>sum+Number(row.washington_awards??0),0);
   const medians=rows.map(row=>Number(row.median_award)).filter(Number.isFinite).sort((a,b)=>a-b);
   const newest=rows.map(row=>String(row.refreshed_at)).sort().at(-1);
   return{score:awardCount?Math.min(90,60+Math.log10(awardCount+1)*10):50,confidence:85,reasons:[`${awardCount.toLocaleString()} historical federal awards are cached for matching Assistance Listing numbers.`,`USAspending aggregate last refreshed ${newest?.slice(0,10)}; it does not establish current opportunity status.`],awardCount,washingtonAwards,medianAward:medians[Math.floor(medians.length/2)],source:"usaspending"};
  }finally{db.close()}
 }
 status(){
  if(!this.isAvailable())return{available:false,path:this.path,ingestions:[],federalOpportunities:0,awardStatistics:0,irsFilings:0,privateProspects:0};
  const db=this.open();
  try{return{available:true,path:this.path,ingestions:db.prepare("SELECT * FROM source_ingestions ORDER BY started_at DESC").all(),federalOpportunities:Number((db.prepare("SELECT count(*) count FROM federal_opportunities").get() as any).count),awardStatistics:Number((db.prepare("SELECT count(*) count FROM federal_award_statistics").get() as any).count),irsFilings:Number((db.prepare("SELECT count(*) count FROM irs_filing_index").get() as any).count),privateProspects:Number((db.prepare("SELECT count(*) count FROM private_funder_prospects").get() as any).count)}}
  finally{db.close()}
 }
}

export const localGrantIndex=new LocalGrantIndex();
