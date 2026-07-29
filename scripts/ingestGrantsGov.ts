import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {open,stat} from "node:fs/promises";
import {resolve} from "node:path";
import {SaxesParser} from "saxes";
import {openIndexDatabase} from "../src/data/indexDatabase.js";

type Fields=Record<string,string[]>;
type ParsedOpportunity={
 opportunityNumber:string;opportunityId:string;title:string;agencyName:string;agencyCode?:string;
 summary:string;description?:string;missionTopics:string[];eligibleApplicants:string[];
 assistanceListingNumbers:string[];awardMin?:number;awardMax?:number;expectedAwardCount?:number;
 requiresCostShare?:boolean;postedDate?:string;closeDate?:string;archiveDate?:string;
 lastUpdated?:string;status:"open"|"forecasted"|"closed"|"archived";sourceUrl:string;
 applicationUrl?:string;requirements:string[];rawSourceReference:string;
};

const sourcePath=resolve(process.env.GRANTS_GOV_XML_PATH??"data/raw/grants-gov/GrantsDBExtract20260728v2.xml");
const force=process.argv.includes("--force");
const unique=(values:string[])=>[...new Set(values.map(value=>value.replace(/\s+/g," ").trim()).filter(Boolean))];
const first=(fields:Fields,...keys:string[])=>keys.flatMap(key=>fields[key]??[]).map(value=>value.trim()).find(Boolean);
const many=(fields:Fields,...keys:string[])=>unique(keys.flatMap(key=>fields[key]??[]));
const numeric=(value?:string)=>{if(!value)return undefined;const parsed=Number(value.replace(/[$,\s]/g,""));return Number.isFinite(parsed)?parsed:undefined};
const boolean=(value?:string)=>value===undefined?undefined:/^(yes|true|1|y)$/i.test(value.trim());
const isoDate=(value?:string)=>{
 if(!value)return undefined;
 const clean=value.trim();
 if(/^\d{8}$/.test(clean)){const month=clean.slice(0,2),day=clean.slice(2,4),year=clean.slice(4);return `${year}-${month}-${day}`}
 if(/^\d{4}-\d{2}-\d{2}/.test(clean))return clean.slice(0,10);
 const date=new Date(clean);return Number.isNaN(date.valueOf())?undefined:date.toISOString().slice(0,10);
};
const statusFor=(kind:string,closeDate?:string,archiveDate?:string):ParsedOpportunity["status"]=>{
 if(/forecast/i.test(kind))return"forecasted";
 const today=new Date().toISOString().slice(0,10);
 if(closeDate&&closeDate>=today)return"open";
 if(!closeDate&&archiveDate&&archiveDate>=today)return"open";
 if(archiveDate&&archiveDate>=today)return"closed";
 return"archived";
};

async function fingerprint(path:string){
 const details=await stat(path),handle=await open(path,"r"),sampleSize=Math.min(1024*1024,details.size);
 try{
  const firstBytes=Buffer.alloc(sampleSize),lastBytes=Buffer.alloc(sampleSize);
  await handle.read(firstBytes,0,sampleSize,0);
  await handle.read(lastBytes,0,sampleSize,Math.max(0,details.size-sampleSize));
  return{details,fingerprint:createHash("sha256").update(String(details.size)).update(String(details.mtimeMs)).update(firstBytes).update(lastBytes).digest("hex")};
 }finally{await handle.close()}
}

function normalize(fields:Fields,kind:string):ParsedOpportunity|null{
 const opportunityId=first(fields,"OpportunityID","OpportunityId")??"";
 const opportunityNumber=first(fields,"OpportunityNumber")??opportunityId;
 const title=first(fields,"OpportunityTitle","FundingOpportunityTitle");
 if(!opportunityNumber||!title)return null;
 const description=first(fields,"Description","FundingOpportunityDescription");
 const summary=description??first(fields,"CategoryExplanation","AdditionalInformationOnEligibility")??title;
 const postedDate=isoDate(first(fields,"PostDate","EstimatedPostDate"));
 const closeDate=isoDate(first(fields,"CloseDate","EstimatedApplicationDueDate"));
 const archiveDate=isoDate(first(fields,"ArchiveDate"));
 const lastUpdated=isoDate(first(fields,"LastUpdatedDate","ModificationDate"));
 const missionTopics=many(fields,"CategoryOfFundingActivity","CategoryExplanation");
 const eligibleApplicants=many(fields,"EligibleApplicants","AdditionalInformationOnEligibility");
 const assistanceListingNumbers=many(fields,"CFDANumbers","AssistanceListingNumber","CFDANumber");
 const extraUrl=first(fields,"AdditionalInformationURL","AdditionalInformationUrl");
 const requirements=unique([
  ...many(fields,"AdditionalInformationOnEligibility"),
  boolean(first(fields,"CostSharingOrMatchingRequirement"))?"Cost sharing or matching is required.":"",
 ]);
 return{
  opportunityNumber,opportunityId,title,
  agencyName:first(fields,"AgencyName")??"Federal agency",
  agencyCode:first(fields,"AgencyCode"),
  summary,description,missionTopics,eligibleApplicants,assistanceListingNumbers,
  awardMin:numeric(first(fields,"AwardFloor")),awardMax:numeric(first(fields,"AwardCeiling")),
  expectedAwardCount:numeric(first(fields,"ExpectedNumberOfAwards")),
  requiresCostShare:boolean(first(fields,"CostSharingOrMatchingRequirement")),
  postedDate,closeDate,archiveDate,lastUpdated,status:statusFor(kind,closeDate,archiveDate),
  sourceUrl:opportunityId?`https://www.grants.gov/search-results-detail/${encodeURIComponent(opportunityId)}`:"https://www.grants.gov/search-grants",
  applicationUrl:extraUrl,requirements,rawSourceReference:opportunityId||opportunityNumber,
 };
}

async function run(){
 const {details,fingerprint:sourceFingerprint}=await fingerprint(sourcePath);
 const db=openIndexDatabase();
 const sourceKey="grants-gov-daily-xml";
 const previous=db.prepare("SELECT fingerprint,status,record_count FROM source_ingestions WHERE source_key=?").get(sourceKey) as any;
 if(!force&&previous?.status==="complete"&&previous.fingerprint===sourceFingerprint){
  console.log(`[data] Grants.gov index is current (${previous.record_count.toLocaleString()} records); raw XML was not rescanned.`);
  db.close();return;
 }
 const startedAt=new Date().toISOString(),verifiedAt=new Date(details.mtimeMs).toISOString();
 const insert=db.prepare(`
 INSERT INTO federal_opportunities (
  opportunity_number,opportunity_id,title,agency_name,agency_code,summary,description,
  mission_topics_json,eligible_applicants_json,assistance_listing_numbers_json,
  award_min,award_max,expected_award_count,requires_cost_share,posted_date,close_date,
  archive_date,last_updated,status,source_url,application_url,requirements_json,
  raw_source_reference,verified_at
 ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(opportunity_number) DO UPDATE SET
  opportunity_id=excluded.opportunity_id,title=excluded.title,agency_name=excluded.agency_name,
  agency_code=excluded.agency_code,summary=excluded.summary,description=excluded.description,
  mission_topics_json=excluded.mission_topics_json,eligible_applicants_json=excluded.eligible_applicants_json,
  assistance_listing_numbers_json=excluded.assistance_listing_numbers_json,award_min=excluded.award_min,
  award_max=excluded.award_max,expected_award_count=excluded.expected_award_count,
  requires_cost_share=excluded.requires_cost_share,posted_date=excluded.posted_date,
  close_date=excluded.close_date,archive_date=excluded.archive_date,last_updated=excluded.last_updated,
  status=excluded.status,source_url=excluded.source_url,application_url=excluded.application_url,
  requirements_json=excluded.requirements_json,raw_source_reference=excluded.raw_source_reference,
  verified_at=excluded.verified_at
 `);
 db.prepare(`
 INSERT INTO source_ingestions(source_key,source_path,fingerprint,source_size,source_mtime_ms,status,record_count,started_at,completed_at,message)
 VALUES(?,?,?,?,?,'running',0,?,NULL,NULL)
 ON CONFLICT(source_key) DO UPDATE SET source_path=excluded.source_path,fingerprint=excluded.fingerprint,
 source_size=excluded.source_size,source_mtime_ms=excluded.source_mtime_ms,status='running',
 record_count=0,started_at=excluded.started_at,completed_at=NULL,message=NULL
 `).run(sourceKey,sourcePath,sourceFingerprint,details.size,Math.round(details.mtimeMs),startedAt);
 let fields:Fields|null=null,kind="",stack:{name:string;text:string}[]=[],count=0;
 const parser=new SaxesParser({xmlns:false});
 parser.on("opentag",tag=>{
  const name=tag.name.replace(/^.*:/,"");
  if(!fields&&/^Opportunity(?:Synopsis|Forecast)Detail/i.test(name)){fields={};kind=name;stack=[];return}
  if(fields)stack.push({name,text:""});
 });
 const append=(text:string)=>{if(stack.length)stack[stack.length-1]!.text+=text};
 parser.on("text",append);parser.on("cdata",append);
 parser.on("closetag",tag=>{
  if(!fields)return;
  const name=tag.name.replace(/^.*:/,"");
  if(/^Opportunity(?:Synopsis|Forecast)Detail/i.test(name)){
   const opportunity=normalize(fields,kind);fields=null;stack=[];
   if(!opportunity)return;
   insert.run(
    opportunity.opportunityNumber,opportunity.opportunityId,opportunity.title,opportunity.agencyName,opportunity.agencyCode??null,
    opportunity.summary,opportunity.description??null,JSON.stringify(opportunity.missionTopics),JSON.stringify(opportunity.eligibleApplicants),
    JSON.stringify(opportunity.assistanceListingNumbers),opportunity.awardMin??null,opportunity.awardMax??null,
    opportunity.expectedAwardCount??null,opportunity.requiresCostShare===undefined?null:Number(opportunity.requiresCostShare),
    opportunity.postedDate??null,opportunity.closeDate??null,opportunity.archiveDate??null,opportunity.lastUpdated??null,
    opportunity.status,opportunity.sourceUrl,opportunity.applicationUrl??null,JSON.stringify(opportunity.requirements),
    opportunity.rawSourceReference,verifiedAt
   );
   count++;if(count%5_000===0)console.log(`[data] indexed ${count.toLocaleString()} Grants.gov records`);
   return;
  }
  const node=stack.pop();if(node&&node.name===name){const value=node.text.replace(/\s+/g," ").trim();if(value)(fields[name]??=[]).push(value)}
 });
 parser.on("error",error=>{throw error});
 db.exec("BEGIN IMMEDIATE; DELETE FROM federal_opportunities;");
 try{
  for await(const chunk of createReadStream(sourcePath,{encoding:"utf8",highWaterMark:1024*1024}))parser.write(chunk);
  parser.close();
  db.exec(`
   DELETE FROM federal_opportunities_fts;
   INSERT INTO federal_opportunities_fts(rowid,opportunity_number,title,agency_name,summary,mission_topics,eligible_applicants)
   SELECT rowid,opportunity_number,title,agency_name,summary,mission_topics_json,eligible_applicants_json
   FROM federal_opportunities;
  `);
  db.prepare("UPDATE source_ingestions SET status='complete',record_count=?,completed_at=?,message=? WHERE source_key=?")
   .run(count,new Date().toISOString(),"Complete local index; interactive requests query SQLite and never scan this XML.",sourceKey);
  db.exec("COMMIT;");
  console.log(`[data] Grants.gov ingestion complete: ${count.toLocaleString()} records → ${db.location()}`);
 }catch(error){
  if(db.isTransaction)db.exec("ROLLBACK;");
  db.prepare("UPDATE source_ingestions SET status='failed',completed_at=?,message=? WHERE source_key=?")
   .run(new Date().toISOString(),error instanceof Error?error.message:String(error),sourceKey);
  throw error;
 }finally{db.close()}
}

run().catch(error=>{console.error("[data] Grants.gov ingestion failed:",error);process.exitCode=1});
