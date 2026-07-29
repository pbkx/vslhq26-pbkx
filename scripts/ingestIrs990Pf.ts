import {createHash} from "node:crypto";
import {readFile,readdir,stat} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createReadStream} from "node:fs";
import {parse} from "csv-parse";
import {SaxesParser} from "saxes";
import {openIndexDatabase} from "../src/data/indexDatabase.js";

type Filing={objectId:string;ein:string;taxPeriod:string;organizationName:string;batchId:string};
type HistoricalGrant={recipientName:string;recipientState?:string;amount?:number;purpose:string};
type ParsedFiling={foundationName:string;ein:string;grants:HistoricalGrant[]};

const csvPath=resolve(process.env.IRS_INDEX_CSV_PATH??"data/raw/irs-teos/2026/index_2026.csv");
const xmlRoot=resolve(process.env.IRS_XML_ROOT??"data/raw/irs-teos/2026");
const force=process.argv.includes("--force");
const concurrency=Math.max(1,Math.min(32,Number(process.env.IRS_INGEST_CONCURRENCY??16)));
const clean=(value:unknown)=>String(value??"").replace(/\s+/g," ").trim();
const topics=(purpose:string)=>[...new Set(purpose.toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(word=>word.length>3&&!["support","general","grant","charitable","program","project"].includes(word)))].slice(0,12);

async function sourceFingerprint(path:string){
 const details=await stat(path),hash=createHash("sha256").update(`${details.size}:${details.mtimeMs}`);
 for(const parent of [xmlRoot,resolve(xmlRoot,"archives")]){
  let entries:string[]=[];
  try{entries=await readdir(parent)}catch{}
  for(const entry of entries.sort()){
   if(!/^2026_TEOS_XML_\d{2}[A-Z](?:\.zip)?$/.test(entry))continue;
   const item=await stat(resolve(parent,entry));
   hash.update(`${parent}:${entry}:${item.size}:${item.mtimeMs}`);
  }
 }
 return{details,fingerprint:hash.digest("hex")};
}

async function read990PfIndex():Promise<Filing[]>{
 const filings:Filing[]=[];
 const parser=createReadStream(csvPath).pipe(parse({columns:true,bom:true,skip_empty_lines:true,trim:true}));
 for await(const raw of parser){
  const row=Object.fromEntries(Object.entries(raw as Record<string,unknown>).map(([key,value])=>[key.trim().toUpperCase(),clean(value)]));
  if(row.RETURN_TYPE?.toUpperCase()!=="990PF")continue;
  if(!row.OBJECT_ID||!row.XML_BATCH_ID)continue;
  filings.push({objectId:row.OBJECT_ID,ein:row.EIN??"",taxPeriod:row.TAX_PERIOD??"",organizationName:row.TAXPAYER_NAME??"",batchId:row.XML_BATCH_ID});
 }
 return filings;
}

function parseFiling(xml:string,index:Filing):ParsedFiling{
 let foundationName=index.organizationName,ein=index.ein,current:HistoricalGrant|null=null;
 const grants:HistoricalGrant[]=[],stack:{name:string;text:string}[]=[];
 const parser=new SaxesParser({xmlns:false});
 parser.on("opentag",tag=>{
  const name=tag.name.replace(/^.*:/,"");stack.push({name,text:""});
  if(name==="GrantOrContributionPdDurYrGrp")current={recipientName:"",purpose:""};
 });
 const append=(value:string)=>{if(stack.length)stack[stack.length-1]!.text+=value};
 parser.on("text",append);parser.on("cdata",append);
 parser.on("closetag",tag=>{
  const name=tag.name.replace(/^.*:/,""),node=stack.at(-1),value=clean(node?.text),path=stack.map(item=>item.name);
  if(path.includes("Filer")&&name==="EIN"&&value)ein=value;
  if(path.includes("Filer")&&path.includes("BusinessName")&&name==="BusinessNameLine1Txt"&&value)foundationName=value;
  if(current){
   if(path.includes("RecipientBusinessName")&&name==="BusinessNameLine1Txt"&&value)current.recipientName=value;
   if(name==="RecipientPersonNm"&&value)current.recipientName=value;
   if(path.includes("RecipientUSAddress")&&name==="StateAbbreviationCd"&&value)current.recipientState=value;
   if(name==="GrantOrContributionPurposeTxt"&&value)current.purpose=value;
   if(name==="Amt"&&value){const parsed=Number(value.replace(/[$,]/g,""));if(Number.isFinite(parsed))current.amount=parsed}
   if(name==="GrantOrContributionPdDurYrGrp"){
    if(current.recipientName||current.purpose)grants.push(current);
    current=null;
   }
  }
  stack.pop();
 });
 parser.write(xml).close();
 return{foundationName:foundationName||"Private foundation",ein,grants};
}

export async function ingestIrs990Pf(){
 let fingerprintInfo;
 try{fingerprintInfo=await sourceFingerprint(csvPath)}
 catch{
  console.error(`[data] IRS import stopped safely. The required IRS index CSV is missing at ${csvPath}.`);
  console.error("[data] Download it from https://www.irs.gov/charities-non-profits/form-990-series-downloads. Raw XML will not be scanned without the index.");
  process.exitCode=2;return;
 }
 const db=openIndexDatabase(),sourceKey="irs-990pf-2026";
 const previous=db.prepare("SELECT fingerprint,status,record_count FROM source_ingestions WHERE source_key=?").get(sourceKey) as any;
 if(!force&&previous?.status==="complete"&&previous.fingerprint===fingerprintInfo.fingerprint){
  console.log(`[data] IRS 990-PF index is current (${previous.record_count.toLocaleString()} historical grants); XML files were not reprocessed.`);
  db.close();return;
 }
 const startedAt=new Date().toISOString(),filings=await read990PfIndex();
 console.log(`[data] IRS index selected ${filings.length.toLocaleString()} 990-PF filings; non-990-PF XML will not be opened.`);
 db.prepare(`
  INSERT INTO source_ingestions(source_key,source_path,fingerprint,source_size,source_mtime_ms,status,record_count,started_at,completed_at,message)
  VALUES(?,?,?,?,?,'running',0,?,NULL,NULL)
  ON CONFLICT(source_key) DO UPDATE SET source_path=excluded.source_path,fingerprint=excluded.fingerprint,
  source_size=excluded.source_size,source_mtime_ms=excluded.source_mtime_ms,status='running',
  record_count=0,started_at=excluded.started_at,completed_at=NULL,message=NULL
 `).run(sourceKey,csvPath,fingerprintInfo.fingerprint,fingerprintInfo.details.size,Math.round(fingerprintInfo.details.mtimeMs),startedAt);
 db.exec("BEGIN; DELETE FROM irs_filing_index; DELETE FROM private_funder_prospects; COMMIT;");
 const insertIndex=db.prepare("INSERT OR REPLACE INTO irs_filing_index(object_id,ein,tax_period,return_type,organization_name,xml_batch_id,indexed_at) VALUES(?,?,?,?,?,?,?)");
 const insertGrant=db.prepare("INSERT OR IGNORE INTO private_funder_prospects(object_id,ein,foundation_name,tax_period,recipient_name,recipient_state,amount,purpose,mission_topics_json,source_url,source_xml_path,indexed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
 let historicalGrants=0,missing=0,parsedFilings=0;
 for(let offset=0;offset<filings.length;offset+=concurrency){
  const batch=filings.slice(offset,offset+concurrency);
  const parsed=await Promise.all(batch.map(async filing=>{
   const path=resolve(xmlRoot,filing.batchId,`${filing.objectId}_public.xml`);
   try{return{filing,path,data:parseFiling(await readFile(path,"utf8"),filing)}}
   catch(error){return{filing,path,error}}
  }));
  db.exec("BEGIN;");
  try{
   for(const item of parsed){
    const indexedAt=new Date().toISOString();
    insertIndex.run(item.filing.objectId,item.filing.ein,item.filing.taxPeriod,"990PF",item.filing.organizationName,item.filing.batchId,indexedAt);
    if("error" in item){missing++;continue}
    parsedFilings++;
    for(const grant of item.data.grants){
     insertGrant.run(item.filing.objectId,item.data.ein,item.data.foundationName,item.filing.taxPeriod,grant.recipientName||null,grant.recipientState??null,grant.amount??null,grant.purpose,JSON.stringify(topics(grant.purpose)),"https://apps.irs.gov/app/eos/",item.path,indexedAt);
     historicalGrants++;
    }
   }
   db.exec("COMMIT;");
  }catch(error){db.exec("ROLLBACK;");throw error}
  if((offset+batch.length)%5_000<concurrency)console.log(`[data] parsed ${Math.min(offset+batch.length,filings.length).toLocaleString()}/${filings.length.toLocaleString()} selected filings · ${historicalGrants.toLocaleString()} historical grants`);
 }
 db.exec(`
  DELETE FROM private_funder_prospects_fts;
  INSERT INTO private_funder_prospects_fts(rowid,foundation_name,recipient_name,purpose,mission_topics)
  SELECT id,foundation_name,COALESCE(recipient_name,''),purpose,mission_topics_json FROM private_funder_prospects;
 `);
 db.prepare("UPDATE source_ingestions SET status='complete',record_count=?,completed_at=?,message=? WHERE source_key=?")
  .run(historicalGrants,new Date().toISOString(),`Parsed ${parsedFilings} index-selected 990-PF filings; ${missing} expected XML files were missing or invalid. No non-990-PF XML was opened.`,sourceKey);
 db.close();
 console.log(`[data] IRS 990-PF ingestion complete: ${historicalGrants.toLocaleString()} historical grants from ${parsedFilings.toLocaleString()} filings (${missing.toLocaleString()} missing/invalid).`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 ingestIrs990Pf().catch(error=>{console.error("[data] IRS ingestion failed:",error);process.exitCode=1});
