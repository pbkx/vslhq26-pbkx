import {openIndexDatabase} from "../src/data/indexDatabase.js";

const force=process.argv.includes("--force");
const assistanceListings=[...new Set(process.argv.slice(2).filter(value=>!value.startsWith("--")).map(value=>value.trim()).filter(value=>/^\d{2}\.\d{3,}$/.test(value)))].slice(0,25);
const baseUrl=(process.env.USASPENDING_API_BASE_URL??"https://api.usaspending.gov").replace(/\/$/,"");
const endDate=new Date().toISOString().slice(0,10),startDate=`${new Date().getUTCFullYear()-5}-01-01`;

async function fetchAggregate(assistanceListingNumber:string){
 const response=await fetch(`${baseUrl}/api/v2/search/spending_by_award/`,{
  method:"POST",headers:{"content-type":"application/json"},signal:AbortSignal.timeout(15_000),
  body:JSON.stringify({
   filters:{time_period:[{start_date:startDate,end_date:endDate}],award_type_codes:["02","03","04","05"],program_numbers:[assistanceListingNumber]},
   fields:["Award ID","Recipient Name","Award Amount","Recipient State Code"],limit:100,page:1,subawards:false,
  }),
 });
 if(!response.ok)throw new Error(`USAspending HTTP ${response.status}`);
 const body:any=await response.json(),results=Array.isArray(body.results)?body.results:[],amounts=results.map((item:any)=>Number(item["Award Amount"])).filter(Number.isFinite).sort((a:number,b:number)=>a-b);
 return{
  awardCount:Number(body.page_metadata?.total??results.length),
  medianAward:amounts.length?amounts[Math.floor(amounts.length/2)]:undefined,
  washingtonAwards:results.filter((item:any)=>String(item["Recipient State Code"]).toUpperCase()==="WA").length,
 };
}

async function run(){
 if(!assistanceListings.length){
  console.error("[data] Provide one or more Assistance Listing numbers. Example: npm run data:refresh:usaspending -- 17.268 93.243");
  process.exitCode=2;return;
 }
 const db=openIndexDatabase();
 const existing=db.prepare("SELECT refreshed_at FROM federal_award_statistics WHERE assistance_listing_number=?");
 const upsert=db.prepare(`
  INSERT INTO federal_award_statistics(assistance_listing_number,award_count,median_award,washington_awards,period_start,period_end,refreshed_at,source_url)
  VALUES(?,?,?,?,?,?,?,?)
  ON CONFLICT(assistance_listing_number) DO UPDATE SET award_count=excluded.award_count,median_award=excluded.median_award,
  washington_awards=excluded.washington_awards,period_start=excluded.period_start,period_end=excluded.period_end,
  refreshed_at=excluded.refreshed_at,source_url=excluded.source_url
 `);
 for(const assistanceListingNumber of assistanceListings){
  const old=existing.get(assistanceListingNumber) as any;
  if(!force&&old&&Date.now()-Date.parse(String(old.refreshed_at))<24*60*60_000){
   console.log(`[data] USAspending ${assistanceListingNumber} is fresh; API call skipped.`);continue;
  }
  const aggregate=await fetchAggregate(assistanceListingNumber),refreshedAt=new Date().toISOString();
  upsert.run(assistanceListingNumber,aggregate.awardCount,aggregate.medianAward??null,aggregate.washingtonAwards,startDate,endDate,refreshedAt,`https://www.usaspending.gov/search/?hash=program:${assistanceListingNumber}`);
  console.log(`[data] USAspending ${assistanceListingNumber}: cached ${aggregate.awardCount.toLocaleString()} historical awards.`);
 }
 db.close();
}

run().catch(error=>{console.error("[data] USAspending refresh failed:",error);process.exitCode=1});
