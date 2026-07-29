import {existsSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {DEFAULT_INDEX_PATH,openIndexDatabase} from "../data/indexDatabase.js";
import type {GrantOpportunity,HistoricalEvidence} from "../domain/types.js";

type FederalRow=Record<string,unknown>;
const jsonList=(value:unknown)=>{try{return JSON.parse(String(value??"[]")) as string[]}catch{return[]}};
const number=(value:unknown)=>typeof value==="number"?value:value===null||value===undefined?undefined:Number(value);
const safeTerms=(query?:string)=>[...new Set((query??"").toLowerCase().match(/[a-z0-9][a-z0-9.-]{1,}/g)??[])].slice(0,12);
const ftsExpression=(terms:string[])=>{
 const escaped=terms.map(term=>`"${term.replaceAll('"','""')}"*`);
 return escaped.join(terms.length<=3?" AND ":" OR ");
};
const compactText=(value:unknown,maximum=600)=>{const text=String(value??"").replace(/\s+/g," ").trim();return text.length<=maximum?text:`${text.slice(0,maximum-1).trimEnd()}…`};
const compactList=(values:string[],limit=10,maximum=140)=>[...new Set(values.map(value=>compactText(value,maximum)).filter(Boolean))].slice(0,limit);
const decodeEntities=(value:unknown)=>String(value??"")
 .replace(/&#(\d+);/g,(_match,code)=>String.fromCodePoint(Number(code)))
 .replaceAll("&amp;","&").replaceAll("&quot;",'"').replaceAll("&#39;","'");
const topicRules:[RegExp,string][]=[
 [/\b(artificial intelligence|ai|machine learning|responsible ai|ai literacy)\b/i,"artificial intelligence"],
 [/\b(digital skills?|digital literacy|computer skills?|technology skills?)\b/i,"digital skills"],
 [/\b(workforce development|workforce training|job training|employment training|career pathways?|upskilling|reskilling)\b/i,"workforce development"],
 [/\b(adult education|adult learning|continuing education)\b/i,"adult education"],
 [/\b(digital inclusion|digital equity|digital divide|technology access)\b/i,"digital inclusion"],
 [/\b(economic mobility|economic opportunity|career advancement|job placement)\b/i,"economic mobility"],
 [/\b(apprenticeship|credential|certification)\b/i,"career pathways"],
 [/\b(entrepreneurship|small business)\b/i,"entrepreneurship"],
 [/\b(science|technology|engineering|mathematics|stem)\b/i,"STEM education"],
 [/\b(food security(?! act)|food insecurity|hunger relief|hunger|food pantry|food cupboard|food bank|emergency food|food distribution|food programs? support|free meals?|hot meals?|thanksgiving meals?|community meals?|groceries|food rescue|food waste)\b/i,"food security"],
 [/\b(nutrition assistance|nutrition access|healthy food|food access)\b/i,"nutrition access"],
 [/\b(homelessness|homeless|housing stability|emergency shelter|affordable housing)\b/i,"housing stability"],
 [/\b(community health|health access|public health|mental health)\b/i,"community health"],
 [/\b(community arts|arts education|cultural preservation)\b/i,"community arts"],
 [/\b(environmental conservation|climate resilience|sustainability)\b/i,"environmental conservation"],
 [/\b(youth development|afterschool|after-school|child and family services)\b/i,"youth development"],
];
const populationRules:[RegExp,string][]=[
 [/\b(low-income|low income|economically disadvantaged)\b/i,"low-income people"],
 [/\b(underserved|underrepresented|disadvantaged)\b/i,"underserved communities"],
 [/\b(adult learners?|adults?|workers?|job seekers?)\b/i,"adults and workers"],
 [/\b(unemployed|displaced workers?)\b/i,"unemployed workers"],
 [/\b(disab(?:led|ilities)|people with disabilities)\b/i,"people with disabilities"],
 [/\b(women|girls)\b/i,"women and girls"],
 [/\b(youth|young adults?)\b/i,"youth and young adults"],
 [/\b(rural|tribal|native american|american indian)\b/i,"rural or Tribal communities"],
 [/\b(hungry|food insecure|food-insecure)\b/i,"people experiencing food insecurity"],
 [/\b(homeless|unhoused|housing insecure)\b/i,"people experiencing homelessness"],
 [/\b(seniors?|older adults?)\b/i,"older adults"],
 [/\b(immigrants?|refugees?)\b/i,"immigrants and refugees"],
];
const inferred=(text:string,rules:[RegExp,string][])=>rules.filter(([pattern])=>pattern.test(text)).map(([,label])=>label);
const eligibilityCodes:Record<string,string>={
 "00":"State governments","01":"County governments","02":"City or township governments",
 "04":"Special district governments","05":"Independent school districts",
 "06":"Public and state-controlled institutions of higher education",
 "07":"Federally recognized Native American tribal governments",
 "08":"Public housing authorities or Indian housing authorities",
 "11":"Native American tribal organizations",
 "12":"501(c)(3) nonprofits other than institutions of higher education",
 "13":"Nonprofits without 501(c)(3) status other than institutions of higher education",
 "20":"Private institutions of higher education","21":"Individuals",
 "22":"For-profit organizations other than small businesses","23":"Small businesses",
 "25":"Other applicants; review the additional eligibility text",
 "99":"Unrestricted, subject to the additional eligibility text",
};
const fundingCodes:Record<string,string>={
 AG:"Agriculture",AR:"Arts",BC:"Business and commerce",CD:"Community development",
 ED:"Education",ELT:"Employment, labor and training",HL:"Health",HO:"Housing",
 ISS:"Income security and social services",O:"Other",RD:"Regional development",
 ST:"Science and technology research",OZ:"Opportunity Zone benefits",
};
const expandCodes=(values:string[],codes:Record<string,string>)=>values.map(value=>codes[value]??value);

function mapFederal(row:FederalRow):GrantOpportunity{
 const status=String(row.status) as GrantOpportunity["opportunityStatus"];
 const title=decodeEntities(row.title),summary=decodeEntities(row.summary);
 const searchableText=`${title} ${summary}`;
 const requirements=compactList(jsonList(row.requirements_json),4,220).map((text,index)=>({id:`source-${index}`,category:"other" as const,text,required:true,machineEvaluable:false}));
 const sourceId=String(row.opportunity_id||row.opportunity_number);
 return{
  id:`grantsgov-${sourceId}`,source:"grants-gov",sourceId,
  recordCategory:status==="forecasted"?"forecasted-federal-opportunity":"current-federal-opportunity",
  title,funderName:decodeEntities(row.agency_name),funderType:"federal",
  summary:compactText(summary),
  missionTopics:compactList([...inferred(searchableText,topicRules),...expandCodes(jsonList(row.mission_topics_json),fundingCodes)],12,100),
  populationsServed:compactList(inferred(searchableText,populationRules),8,100),
  eligibleApplicantTypes:compactList(expandCodes(jsonList(row.eligible_applicants_json),eligibilityCodes),8,180),
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
     `).all(ftsExpression(terms),limit)
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
 searchPrivateProspects(
  query:string|undefined,
  limit:number,
  preferredStates:string[]=[],
  awardRange:{minimum?:number;maximum?:number}={},
 ){
  if(!this.isAvailable())return[];
  const db=this.open();
  try{
   const terms=safeTerms(query);
   if(!terms.length)return[];
   const normalizedStates=[...new Set(preferredStates.map(state=>state.toUpperCase()))];
   const awardClauses=[
    awardRange.minimum!==undefined?"p.amount >= ?":"",
    awardRange.maximum!==undefined?"p.amount <= ?":"",
   ].filter(Boolean);
   const awardWhere=awardClauses.length?` AND ${awardClauses.join(" AND ")}`:"";
   const awardParams=[
    ...(awardRange.minimum!==undefined?[awardRange.minimum]:[]),
    ...(awardRange.maximum!==undefined?[awardRange.maximum]:[]),
   ];
   const stateOrder=normalizedStates.length
    ?`CASE WHEN UPPER(COALESCE(p.recipient_state,'')) IN (${normalizedStates.map(()=>"?").join(",")}) THEN 0 ELSE 1 END,`
    :"";
   const rows=db.prepare(`
    SELECT p.* FROM private_funder_prospects_fts
    JOIN private_funder_prospects p ON p.id=private_funder_prospects_fts.rowid
    WHERE private_funder_prospects_fts MATCH ?${awardWhere}
    ORDER BY ${stateOrder} bm25(private_funder_prospects_fts), p.amount DESC
    LIMIT ?
   `).all(
    ftsExpression(terms),
    ...awardParams,
    ...normalizedStates,Math.max(limit*100,500)
   ) as any[];
   const candidateGroups=new Map<string,any[]>();
   for(const row of rows){const key=String(row.ein||row.foundation_name);const group=candidateGroups.get(key)??[];group.push(row);candidateGroups.set(key,group)}
   const selectedKeys=[...candidateGroups.keys()].slice(0,limit);
   const expandedRows=selectedKeys.length?db.prepare(`
    SELECT p.* FROM private_funder_prospects_fts
    JOIN private_funder_prospects p ON p.id=private_funder_prospects_fts.rowid
    WHERE private_funder_prospects_fts MATCH ?${awardWhere}
      AND COALESCE(NULLIF(p.ein,''),p.foundation_name) IN (${selectedKeys.map(()=>"?").join(",")})
    ORDER BY bm25(private_funder_prospects_fts), p.amount DESC
    LIMIT ?
   `).all(ftsExpression(terms),...awardParams,...selectedKeys,Math.max(limit*250,2_500)) as any[]:[];
   const groups=new Map<string,any[]>(selectedKeys.map(key=>[key,[]]));
   for(const row of expandedRows){const key=String(row.ein||row.foundation_name);groups.get(key)?.push(row)}
   return selectedKeys.map((key):[string,any[]]=>[key,groups.get(key)?.length?groups.get(key)!:candidateGroups.get(key)!]).map(([key,grants]):GrantOpportunity=>{
    const first=grants[0],purposes=[...new Set(grants.map(item=>decodeEntities(item.purpose)).filter(Boolean))].slice(0,5);
    const searchableText=purposes.join(" ");
    const topicList=[...new Set([
     ...inferred(searchableText,topicRules),
     ...grants.flatMap(item=>jsonList(item.mission_topics_json)),
    ])].slice(0,12);
    const populations=compactList(inferred(searchableText,populationRules),8,100);
    const amounts=grants.map(item=>number(item.amount)).filter((value):value is number=>value!==undefined);
    const states=[...new Set(grants.map(item=>String(item.recipient_state??"")).filter(Boolean))];
    return{
     id:`irs990pf-${key}`,source:"irs-990pf",sourceId:key,recordCategory:"private-funder-prospect",
     title:`${decodeEntities(first.foundation_name)} — historical giving pattern`,funderName:decodeEntities(first.foundation_name),funderType:"foundation",
     summary:`IRS 990-PF filings show historical grants including ${purposes.join("; ")||"purposes requiring review"}. Evidence-backed potential private donor/funder candidate worth researching and possibly contacting.`,
     description:`Matched ${grants.length} historical grant records in the local IRS index.`,missionTopics:topicList,
     populationsServed:populations,eligibleApplicantTypes:[],
     eligibleLocations:[{country:"US",states,description:"Historical recipient locations provide geographic prospect evidence."}],
     awardMin:amounts.length?Math.min(...amounts):undefined,awardMax:amounts.length?Math.max(...amounts):undefined,
     opportunityStatus:"unknown",lastVerifiedAt:String(first.indexed_at),
     sourceUrl:String(first.source_url),sourceDisclaimer:"Evidence-backed potential private donor/funder candidate worth researching and possibly contacting.",
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
