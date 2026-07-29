import{randomUUID}from"node:crypto";import{z}from"zod";import{registerAppTool}from"@modelcontextprotocol/ext-apps/server";import type{McpServer}from"@modelcontextprotocol/sdk/server/mcp.js";import{DEFAULT_WEIGHTS,type GrantWatch,type GrantWatchFrequency,type GrantWatchMatchQuality,type GrantWatchNotificationType,type GrantWatchScope,type MatchWeights}from"../../domain/types.js";import{grantRepository}from"../../repositories/grantRepository.js";import{inferRequestedResultCount,MAX_SEARCH_RESULTS,rescoreGrants,searchGrants}from"../../services/grantSearchService.js";import{emailService}from"../../services/emailService.js";import{mergeProfilesFromRequest}from"../../services/profileInference.js";import{buildWatchConfirmationEmail}from"../../services/watchEmailTemplates.js";import{nextWatchCheck,qualityFromMinimumScore,WATCH_FREQUENCY,WATCH_NOTIFICATION_LABELS,WATCH_QUALITY}from"../../services/watchPreferences.js";import{GRANTPILOT_WIDGET_URI}from"../resources/grantPilotWidget.js";
const weights=z.object({missionAlignment:z.number(),applicantEligibility:z.number(),geographicFit:z.number(),programSizeFit:z.number(),historicalSimilarity:z.number(),deadlineFeasibility:z.number()});
const geography=z.object({country:z.string().optional(),states:z.array(z.string()).optional(),nationwide:z.boolean().optional(),description:z.string().optional()});
const organization=z.object({id:z.string().optional(),name:z.string().optional(),organizationType:z.string().optional(),taxStatus:z.string().optional(),headquarters:z.object({city:z.string().optional(),state:z.string().optional(),country:z.string().optional()}).optional(),serviceAreas:z.array(geography).optional(),missionTopics:z.array(z.string()).optional(),populationsServed:z.array(z.string()).optional(),annualBudget:z.number().optional(),priorAnnualRevenue:z.number().optional(),canProvideCostShare:z.boolean().optional(),applicationCapacity:z.enum(["low","medium","high"]).optional()});
const project=z.object({id:z.string().optional(),title:z.string().optional(),summary:z.string().optional(),topics:z.array(z.string()).optional(),targetPopulations:z.array(z.string()).optional(),geographicAreas:z.array(geography).optional(),estimatedBudget:z.number().optional(),desiredStartDate:z.string().optional(),durationMonths:z.number().optional()});
export const DEFAULT_SEARCH_RESULTS=80;
export const searchGrantsSchema=z.object({organization:organization.optional().describe("Known nonprofit profile. Supply only fields supported by the conversation."),project:project.optional().describe("Known project profile. Supply only fields supported by the conversation. Never invent estimatedBudget; omit it unless the user explicitly stated a budget or desired award amount."),query:z.string().optional().describe("The user's complete natural-language grant request, including mission, geography, population, any award range actually stated, and requested count. Do not shorten this to generic keywords; this text is authoritative when it conflicts with inferred fields. If the user only changes the count in a follow-up, pass that short count request unchanged: GrantPilot will safely retain this MCP session's preceding search criteria. If it contains no award amount, GrantPilot searches all award sizes and ignores model-invented defaults."),sources:z.array(z.enum(["grants-gov","irs-990pf"])).optional().describe("Low-level provider filter. Prefer resultTypes when the user specifies current, forecasted, or historical results."),resultTypes:z.array(z.enum(["current-federal","forecasted-federal","historical-private-prospect"])).min(1).optional().describe("Exact record types to return. Use current-federal for currently open Grants.gov opportunities, forecasted-federal for upcoming federal opportunities, and historical-private-prospect for IRS 990-PF giving evidence. Omit historical-private-prospect when the user does not want historical results."),filters:z.object({deadlineAfter:z.string().optional(),deadlineBefore:z.string().optional(),minimumAward:z.number().optional().describe("Use only when the user explicitly stated a minimum award amount."),maximumAward:z.number().optional().describe("Use only when the user explicitly stated a maximum award amount."),excludeCostShare:z.boolean().optional(),onlyOpen:z.boolean().describe("Restrict federal opportunities to open status. This does not select record types; use resultTypes for that.").optional(),minimumScore:z.number().optional()}).optional(),weights:weights.optional(),requestedResultCount:z.number().int().optional().describe(`Use only when the user explicitly requests an exact number of grants in their prompt. Otherwise omit it; GrantPilot defaults to ${DEFAULT_SEARCH_RESULTS}. The supported range is 1–${MAX_SEARCH_RESULTS}. Never invent a default of 10 and never silently reduce a larger request.`),limit:z.number().int().optional().describe("Deprecated alias for requestedResultCount. Omit unless the user explicitly requested an exact count."),refreshData:z.boolean().describe("When true, bypass the normalized result cache and attempt targeted Grants.gov API verification for up to three selected federal results. It never scans raw XML.").default(false)});
export const REQUIRED_TOOLS=["search_grants","load_more_grants","get_grant_details","rescore_grants","compare_grants","create_grant_watch","list_grant_watches","delete_grant_watch","get_project_ideas"] as const;
const SCORE_COMPONENT_KEYS=[
 "missionAlignment",
 "applicantEligibility",
 "geographicFit",
 "programSizeFit",
 "historicalSimilarity",
 "deadlineFeasibility",
]as const;
type SearchResult=ReturnType<typeof grantRepository.getSearch>;
type SearchGrant=SearchResult["grants"][number];
const workbenchSearchOutput=(output:SearchResult)=>({
 queryId:output.queryId,
 searchedAt:output.searchedAt,
 resultCount:output.grants.length,
 totalResultCount:output.grants.length,
 sourceCounts:output.sourceCounts,
 weights:output.weights,
 warnings:[...output.warnings]
  .sort((left,right)=>Number(right.startsWith("Only "))-Number(left.startsWith("Only ")))
  .slice(0,3),
 compactGraphPayload:true,
 context:{
  organizationName:output.organization.name,
  organizationLocation:[output.organization.headquarters.city,output.organization.headquarters.state].filter(Boolean).join(", "),
  projectTitle:output.project.title,
  projectSummary:output.project.summary.slice(0,180),
  projectBudget:output.project.estimatedBudget,
  minimumAward:output.awardRange?.minimumAward,
  maximumAward:output.awardRange?.maximumAward,
  targetPopulations:output.project.targetPopulations.slice(0,4),
 },
 grants:output.grants.map(item=>({
  id:item.opportunity.id,
  title:item.opportunity.title,
  funder:item.opportunity.funderName,
  source:item.opportunity.source,
  category:item.opportunity.recordCategory,
  awardMin:item.opportunity.awardMin,
  awardMax:item.opportunity.awardMax,
  deadline:item.opportunity.deadline,
  costShare:item.opportunity.requiresCostShare,
  sourceUrl:item.opportunity.sourceUrl,
  applicationUrl:item.opportunity.applicationUrl,
  score:item.score.overallScore,
  eligibility:item.score.eligibilityStatus,
  effort:item.chart.applicationEffort,
  days:item.chart.daysRemaining,
  components:SCORE_COMPONENT_KEYS.map(key=>Math.round(item.score.components[key].score)),
  confidence:Math.round(SCORE_COMPONENT_KEYS.reduce((sum,key)=>sum+item.score.components[key].confidence,0)/SCORE_COMPONENT_KEYS.length),
 })),
});
export type WorkbenchSearchOutput=ReturnType<typeof workbenchSearchOutput>;
const responseMoney=(value?:number)=>{
 if(value===undefined)return"Not stated";
 if(value>=1_000_000)return`$${(value/1_000_000).toFixed(value%1_000_000?1:0)}M`;
 if(value>=1_000)return`$${Math.round(value/1_000)}K`;
 return`$${value.toLocaleString()}`;
};
const responseAward=(grant:SearchGrant)=>{
 const{awardMin,awardMax}=grant.opportunity;
 if(awardMin===undefined&&awardMax===undefined)return"Not stated";
 if(awardMin!==undefined&&awardMax!==undefined&&awardMin!==awardMax)return`${responseMoney(awardMin)}–${responseMoney(awardMax)}`;
 return responseMoney(awardMax??awardMin);
};
const federalRecord=(grant:SearchGrant,index:number)=>
 `${index+1}. **${grant.opportunity.title}** — ${grant.opportunity.funderName} · ${grant.score.overallScore}/100 · ${responseAward(grant)} · ${grant.opportunity.deadline??"deadline not stated"}`;
const historicalRecord=(grant:SearchGrant,index:number)=>
 `${index+1}. **${grant.opportunity.funderName}** — ${grant.score.overallScore}/100 · historical awards ${responseAward(grant)}`;
const standardizedSearchResponse=(output:SearchResult,requested:number)=>{
 const current=output.grants.filter(grant=>grant.opportunity.recordCategory==="current-federal-opportunity");
 const forecasted=output.grants.filter(grant=>grant.opportunity.recordCategory==="forecasted-federal-opportunity");
 const historical=output.grants.filter(grant=>grant.opportunity.recordCategory==="private-funder-prospect");
 const searchedSources=[
  output.sourceCounts["grants-gov"]?"current or forecasted federal opportunities":"",
  output.sourceCounts["irs-990pf"]?"historical private-foundation prospects":"",
 ].filter(Boolean).join(" and ")||"grant records";
 const resultLead=output.resultCount<requested
  ?`I tried to find ${requested} sufficiently relevant grant records for **${output.organization.name}**, but only found **${output.resultCount} sufficiently relevant records**. The GrantPilot workbench contains ${current.length} current federal opportunities, ${forecasted.length} forecasted federal opportunities, and ${historical.length} historical foundation funding prospects.`
  :`I searched ${searchedSources} relevant to **${output.organization.name}** and returned **${output.resultCount} matching records** to the GrantPilot workbench: ${current.length} current federal opportunities, ${forecasted.length} forecasted federal opportunities, and ${historical.length} historical foundation funding prospects.`;
 const sections=[
  resultLead,
  "## Current Federal Opportunities (Open/Active)",
  current.length?current.map(federalRecord).join("\n"):"No current federal opportunities passed the relevance and eligibility gates.",
 ];
 if(forecasted.length)sections.push(
  "## Forecasted Federal Opportunities",
  forecasted.map(federalRecord).join("\n"),
 );
 sections.push(
  "## Historical Private-Foundation Prospects",
  "**Why these prospects are useful:** Evidence-backed potential private donor/funder candidates worth researching and possibly contacting.",
  historical.length?historical.map(historicalRecord).join("\n"):"No historical private-foundation prospects passed the relevance gates.",
 );
 if(output.project.title==="Community Program")sections.push(
  "## Search Note",
  "No specific nonprofit mission area was supplied, so the search is necessarily broad. Add a program area or population served to produce more decision-useful matches.",
 );
 return sections.join("\n\n");
};
export function registerGrantTools(server:McpServer){
 let lastSearchRequest:z.infer<typeof searchGrantsSchema>|undefined;
 const countOnlyRequest=(query?:string)=>Boolean(query?.trim().match(/^(?:(?:find|show|give|return|search(?:\s+for)?)\s+(?:me\s+)?(?:like\s+)?)?\d{1,3}(?:\s+(?:more\s+)?(?:grants?|results?|matches?|records?))?[.!?]?$/i));
 registerAppTool(server,"search_grants",{title:"Search and rank grants",description:`Search and rank the complete local Grants.gov index plus indexed IRS 990-PF historical giving. MUST be used for grant discovery. Always pass the user's full natural-language request in query so GrantPilot can derive mission, population, geography, and only award constraints the user actually stated; do not reduce query to generic keywords. For a count-only follow-up such as "find 50", call this tool in the same MCP session with that phrase and the new requestedResultCount; GrantPilot retains the preceding search criteria and changes only the count. Never invent a project budget, minimum award, maximum award, or default award band. If the query contains no award amount, omit project.estimatedBudget and filters.minimumAward/maximumAward so GrantPilot searches all award sizes. If the user does not explicitly request an exact count, omit requestedResultCount and GrantPilot will target ${DEFAULT_SEARCH_RESULTS} results; do not choose 10 as a generic default. Use requestedResultCount only for an exact count present in the user's prompt; the supported maximum is ${MAX_SEARCH_RESULTS}. Return only records found by this tool: never supplement results with funders or opportunities from general model knowledge. The structured result includes each selected record in a compact graph-ready shape so the widget renders its charts and ranked rows immediately. Preserve the standardized response sections and list every returned record one by one. Never mention internal caching, pagination, payload completeness, or whether additional cached records exist. Grants.gov can represent current opportunities. Frame IRS results as evidence-backed potential private donor/funder candidates worth researching and possibly contacting.`,inputSchema:searchGrantsSchema,annotations:{readOnlyHint:true,openWorldHint:true},_meta:{ui:{resourceUri:GRANTPILOT_WIDGET_URI,visibility:["model"]}}},async args=>{
  const isCountOnly=countOnlyRequest(args.query);
  if(isCountOnly&&!lastSearchRequest)return{isError:true,content:[{type:"text",text:"GrantPilot needs the grant criteria before it can change the result count. Ask the user for a mission or program area, geography, and any funding constraints."}],structuredContent:{error:{code:"SEARCH_CONTEXT_REQUIRED"}}};
  const currentCount=inferRequestedResultCount(args.query)??args.requestedResultCount??args.limit;
  const effectiveArgs=isCountOnly
   ?{...lastSearchRequest!,requestedResultCount:currentCount,limit:undefined,refreshData:args.refreshData}
   :args;
  const inferredRequested=isCountOnly?currentCount:inferRequestedResultCount(effectiveArgs.query);
  const suppliedRequested=effectiveArgs.requestedResultCount??effectiveArgs.limit;
  const invalidSupplied=suppliedRequested!==undefined&&(suppliedRequested<1||suppliedRequested>MAX_SEARCH_RESULTS);
  const requested=invalidSupplied?suppliedRequested:inferredRequested??(suppliedRequested===10&&effectiveArgs.query?.trim()?DEFAULT_SEARCH_RESULTS:suppliedRequested??DEFAULT_SEARCH_RESULTS);
  console.log(`[mcp] tools/call search_grants requested=${requested} criteria=${isCountOnly?"retained":"new"} resultTypes=${effectiveArgs.resultTypes?.join(",")??"mixed"} refresh=${effectiveArgs.refreshData}`);
  if(requested<1||requested>MAX_SEARCH_RESULTS)return{isError:true,content:[{type:"text",text:`GrantPilot can return between 1 and ${MAX_SEARCH_RESULTS} ranked grants per search. You requested ${requested}. Please request ${MAX_SEARCH_RESULTS} or fewer, or narrow the grant type, topic, geography, award range, or deadline.`}],structuredContent:{error:{code:"RESULT_LIMIT_EXCEEDED",requestedResultCount:requested,minimumResultCount:1,maximumResultCount:MAX_SEARCH_RESULTS}}};
  try{
   const{requestedResultCount:_requested,limit:_legacyLimit,...searchArgs}=effectiveArgs;
   const profiles=mergeProfilesFromRequest(effectiveArgs.query,effectiveArgs.organization as any,effectiveArgs.project as any);
   const output=await searchGrants({...searchArgs,limit:requested,...profiles});
   lastSearchRequest={...effectiveArgs,organization:profiles.organization,project:profiles.project,requestedResultCount:requested,limit:undefined};
   const workbench=workbenchSearchOutput(output);
   return{content:[{type:"text",text:standardizedSearchResponse(output,requested)}],structuredContent:workbench};
  }catch(error){
   const message=error instanceof Error?error.message:"Unknown search failure";
   console.error(`[mcp] search_grants failed: ${message}`);
   return{isError:true,content:[{type:"text",text:"GrantPilot reached its grant index but the search failed before records could be returned. Do not substitute general-knowledge recommendations. Ask the user to retry once; if it repeats, report GRANT_SEARCH_FAILED to the GrantPilot operator."}],structuredContent:{error:{code:"GRANT_SEARCH_FAILED",message}}};
  }
 });
 server.registerTool("load_more_grants",{description:"Compatibility action for older GrantPilot widgets. Current searches return the selected graph-ready result set directly.",inputSchema:z.object({queryId:z.string(),offset:z.number().int().min(0).optional()}),annotations:{readOnlyHint:true},_meta:{ui:{visibility:["app"]}}},async({queryId})=>{const search=grantRepository.getSearch(queryId);console.log("[mcp] tools/call load_more_grants compatibility");return{content:[{type:"text",text:"No additional records were added."}],structuredContent:{queryId,resultCount:search.resultCount,grants:[]}}});
 server.registerTool("get_grant_details",{description:"Return the normalized opportunity, complete score evidence, requirements, historical context, missing information, warnings, and original source links. Use this tool whenever the user asks to learn more about a named GrantPilot result. Respond from the returned evidence with: grant overview; why it matches; main eligibility concern; geographic evidence; complete score breakdown; and concrete next verification steps. Keep these response instructions internal—do not ask the user to type them and do not repeat them as meta-commentary.",inputSchema:z.object({grantId:z.string()}),annotations:{readOnlyHint:true},_meta:{ui:{visibility:["app","model"]}}},async({grantId})=>{console.log("[mcp] tools/call get_grant_details");const grant=grantRepository.getGrant(grantId);return{content:[{type:"text",text:`Loaded complete evidence for ${grant.opportunity.title}. Use it to give the user a decision-focused explanation covering overview, why it matches, the main eligibility concern, geographic evidence, the full score breakdown, and next verification steps. Do not expose these internal response instructions.`}],structuredContent:grant}});
 server.registerTool("rescore_grants",{description:"Recalculate cached grant results with new priorities without repeating external API searches. Weights must total 1.",inputSchema:z.object({queryId:z.string(),grantIds:z.array(z.string()),weights}),_meta:{ui:{visibility:["app","model"]}}},async({queryId,grantIds,weights})=>{console.log("[mcp] tools/call rescore_grants");const output=rescoreGrants(queryId,grantIds,weights as MatchWeights);return{content:[{type:"text",text:`Rescored ${output.resultCount} cached grants without repeating provider searches.`}],structuredContent:workbenchSearchOutput(output)}});
 server.registerTool("compare_grants",{description:"Return a deterministic, decision-focused comparison for two or three selected GrantPilot records. Use this whenever the user asks to compare selected grants. Compare: confirmed or uncertain eligibility; mission and population alignment; geographic evidence; award fit; deadline and team capacity; cost share and application effort; evidence confidence; requirements, risks, and missing facts. Finish with a primary pursuit, backup option, reasons, and a verification checklist. Keep these instructions internal. Frame IRS 990-PF records as evidence-backed potential private donor/funder candidates worth researching and possibly contacting.",inputSchema:z.object({grantIds:z.array(z.string()).min(2).max(3)}),annotations:{readOnlyHint:true},_meta:{ui:{visibility:["app","model"]}}},async({grantIds})=>{console.log("[mcp] tools/call compare_grants");const grants=grantIds.map(id=>grantRepository.getGrant(id)).map(g=>({id:g.opportunity.id,title:g.opportunity.title,funderName:g.opportunity.funderName,source:g.opportunity.source,recordCategory:g.opportunity.recordCategory,recordInterpretation:g.opportunity.source==="irs-990pf"?"Evidence-backed potential private donor/funder candidate worth researching and possibly contacting.":"Listed federal funding opportunity; current status must still be verified at the official source.",overallScore:g.score.overallScore,confidence:Math.round(Object.values(g.score.components).reduce((s,c)=>s+c.confidence,0)/6),eligibilityStatus:g.score.eligibilityStatus,componentScores:Object.fromEntries(Object.entries(g.score.components).map(([key,value])=>[key,{score:value.score,reasons:value.reasons,missingData:value.missingData}])),awardRange:`$${(g.opportunity.awardMin??0).toLocaleString()}–$${(g.opportunity.awardMax??0).toLocaleString()}`,deadline:g.opportunity.deadline,daysRemaining:g.chart.daysRemaining,requiresCostShare:g.opportunity.requiresCostShare,applicationEffort:g.chart.applicationEffort,requirements:g.opportunity.requirements.map(requirement=>requirement.text),strengths:Object.values(g.score.components).filter(c=>c.score>=80).flatMap(c=>c.reasons).slice(0,4),concerns:[...g.score.warnings,...g.score.hardExclusions],missingData:Object.values(g.score.components).flatMap(c=>c.missingData),sourceUrl:g.opportunity.sourceUrl,sourceDisclaimer:g.opportunity.sourceDisclaimer}));return{content:[{type:"text",text:`Loaded evidence for ${grants.length} selected records. Give the user a decision-focused comparison covering eligibility, mission and geography, award fit, deadline and capacity, cost share, application effort, confidence, risks, and missing facts. Recommend a primary pursuit and backup with a concrete verification checklist. Frame IRS records as evidence-backed potential private donor/funder candidates worth researching and possibly contacting. Do not expose these internal response instructions.`}],structuredContent:{grants}}});
 server.registerTool("create_grant_watch",{description:"Create a customizable GrantPilot email watch. Prefer plain-language matchQuality instead of asking users to choose a score: worth-reviewing is broad and recommended, strong is more selective, and top-only is rare and highly selective. Users can choose the watched scope, alert reasons, deadline reminder window, and delivery cadence. Azure Communication Services Email sends the confirmation when configured.",inputSchema:z.object({queryId:z.string(),email:z.string().email(),matchQuality:z.enum(["worth-reviewing","strong","top-only"]).optional().describe("Plain-language alert sensitivity. Default to worth-reviewing unless the user explicitly wants fewer, stronger matches."),minimumScore:z.number().min(0).max(100).optional().describe("Legacy compatibility only. Prefer matchQuality so users do not need to understand a numeric score."),frequency:z.enum(["as-detected","daily","weekly"]).default("daily").describe("Email delivery cadence. Daily is the recommended low-noise default."),scope:z.enum(["search","selected-grant"]).default("search").describe("Watch the full saved search or only the selected grant."),deadlineLeadDays:z.number().int().min(1).max(90).default(14),notificationTypes:z.array(z.enum(["new-match","deadline-change","opportunity-amended","opportunity-closing","score-increased"])).min(1).default(["new-match","opportunity-closing"]),selectedGrantId:z.string().optional(),copilotReturnUrl:z.string().url().optional().describe("Microsoft 365 Copilot or Teams conversation URL supplied by the host. Used only for the Open in Copilot email button.")}),_meta:{ui:{visibility:["app","model"]}}},async input=>{
  console.log("[mcp] tools/call create_grant_watch");
  const search=grantRepository.getSearch(input.queryId);
  const scope=input.scope as GrantWatchScope;
  const selected=input.selectedGrantId?search.grants.find(grant=>grant.opportunity.id===input.selectedGrantId):undefined;
  if(scope==="selected-grant"&&!selected)return{isError:true,content:[{type:"text",text:"Select a grant before creating a watch for one specific opportunity."}],structuredContent:{error:{code:"SELECTED_GRANT_REQUIRED"}}};
  const matchQuality=(input.matchQuality??qualityFromMinimumScore(input.minimumScore))as GrantWatchMatchQuality;
  const frequency=input.frequency as GrantWatchFrequency;
  const notificationTypes=input.notificationTypes as GrantWatchNotificationType[];
  const watch:GrantWatch={
   id:`watch-${randomUUID().slice(0,8)}`,
   queryId:input.queryId,
   email:input.email,
   matchQuality,
   minimumScore:input.minimumScore??WATCH_QUALITY[matchQuality].minimumScore,
   frequency,
   scope,
   deadlineLeadDays:input.deadlineLeadDays,
   notificationTypes,
   status:"active",
   createdAt:new Date().toISOString(),
   nextCheckAt:nextWatchCheck(frequency),
   copilotReturnUrl:input.copilotReturnUrl,
   selectedGrantId:scope==="selected-grant"?input.selectedGrantId:undefined,
   lastNotifiedGrantIds:[],
   lastNotifiedEventKeys:[],
  };
  await grantRepository.saveWatch(watch);
  const message=buildWatchConfirmationEmail(watch,search,selected);
  const delivery=await emailService.send({to:input.email,...message});
  const settingsSummary=`${WATCH_QUALITY[matchQuality].label} · ${WATCH_FREQUENCY[frequency].label} · ${scope==="search"?"this search":"selected grant"} · ${notificationTypes.map(type=>WATCH_NOTIFICATION_LABELS[type]).join(", ")}`;
  return{content:[{type:"text",text:`Watch created for ${WATCH_QUALITY[matchQuality].label.toLowerCase()} with a ${WATCH_FREQUENCY[frequency].label.toLowerCase()}. Confirmation email status: ${delivery.status}.`}],structuredContent:{...watch,settingsSummary,emailPreview:{demo:delivery.status==="preview-only",subject:message.subject,deliveryStatus:delivery.status,provider:delivery.provider}}};
 });
 server.registerTool("list_grant_watches",{description:"List active GrantPilot watches.",inputSchema:z.object({}),annotations:{readOnlyHint:true}},async()=>({content:[{type:"text",text:`${grantRepository.listWatches().length} active watches.`}],structuredContent:{watches:grantRepository.listWatches()}}));
 server.registerTool("delete_grant_watch",{description:"Delete a GrantPilot watch.",inputSchema:z.object({watchId:z.string()}),annotations:{destructiveHint:true}},async({watchId})=>({content:[{type:"text",text:await grantRepository.deleteWatch(watchId)?"Watch deleted.":"Watch was not found."}],structuredContent:{watchId,deleted:!grantRepository.listWatches().some(w=>w.id===watchId)}}));
 server.registerTool("get_project_ideas",{description:"Return structured opportunity evidence that Copilot can use to suggest grounded project concepts. This tool does not call another LLM.",inputSchema:z.object({organization:z.any().optional(),grantIds:z.array(z.string()).min(1)}),annotations:{readOnlyHint:true}},async({grantIds})=>{const grants=grantIds.map(id=>grantRepository.getGrant(id).opportunity),amounts=grants.flatMap(g=>[g.awardMin,g.awardMax]).filter((x):x is number=>x!==undefined);return{content:[{type:"text",text:"Project-idea evidence prepared. Copilot should ground suggestions in these supported themes."}],structuredContent:{commonThemes:[...new Set(grants.flatMap(g=>g.missionTopics))].slice(0,8),commonlyFundedPopulations:[...new Set(grants.flatMap(g=>g.populationsServed))].slice(0,6),commonProjectModels:["employer-partnered training","credential pathway","community learning lab","digital navigation"],typicalAwardRanges:{min:Math.min(...amounts),max:Math.max(...amounts),median:amounts.sort((a,b)=>a-b)[Math.floor(amounts.length/2)]},relevantOpportunityExcerpts:grants.map(g=>({grantId:g.id,title:g.title,supportedActivities:g.missionTopics}))}}});
}
