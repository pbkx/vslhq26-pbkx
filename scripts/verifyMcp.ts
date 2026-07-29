import {access} from "node:fs/promises";
import {spawn,type ChildProcess} from "node:child_process";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {REQUIRED_TOOLS} from "../src/mcp/createServer.js";
import {GRANTPILOT_WIDGET_URI} from "../src/mcp/resources/grantPilotWidget.js";

const mcpUrl=process.env.MCP_URL??"http://localhost:3000/mcp";
const healthUrl=new URL("/health",mcpUrl).toString();
const ready=async()=>{try{return(await fetch(healthUrl)).ok}catch{return false}};
let child:ChildProcess|undefined;
try{await access("dist/widget.html")}catch{await import("./buildWidget.js").then(module=>module.buildWidget())}
if(!await ready()&&mcpUrl.includes("localhost")){
 child=spawn(process.execPath,["--import","tsx","src/server.ts"],{stdio:"inherit",env:{...process.env,PORT:"3000",HOST:"0.0.0.0"}});
 for(let index=0;index<30&&!await ready();index++)await new Promise(resolve=>setTimeout(resolve,200));
}
if(!await ready())throw new Error(`GrantPilot endpoint is unhealthy: ${healthUrl}`);

const client=new Client(
 {name:"grantpilot-verifier",version:"1"},
 {capabilities:{extensions:{"io.modelcontextprotocol/ui":{mimeTypes:["text/html;profile=mcp-app"]}}}as any},
);
const transport=new StreamableHTTPClientTransport(new URL(mcpUrl));
await client.connect(transport);
const listed=await client.listTools(),names=listed.tools.map(tool=>tool.name);
for(const name of REQUIRED_TOOLS)if(!names.includes(name))throw new Error(`Missing tool ${name}`);
const search=listed.tools.find(tool=>tool.name==="search_grants")!;
if((search._meta as any)?.ui?.resourceUri!==GRANTPILOT_WIDGET_URI)
 throw new Error("search_grants has no GrantPilot UI binding");

const prompt="Find grants for a Washington nonprofit teaching practical AI skills to low-income adults. We need between $100,000 and $500,000.";
const result=await client.callTool({name:"search_grants",arguments:{query:prompt,filters:{onlyOpen:true}}});
const output=result.structuredContent as any,firstBytes=Buffer.byteLength(JSON.stringify(result));
if(!output?.grants?.length||output.grants.length<3)
 throw new Error("search_grants returned too few structured grants for the demo prompt");
if((output.sourceCounts?.["grants-gov"]??0)+(output.sourceCounts?.["irs-990pf"]??0)!==output.grants.length)
 throw new Error("search_grants returned inconsistent source counts");
if("allRecordsLoaded"in output||"hasMore"in output||"offset"in output||"nextOffset"in output||output.grants.length!==output.totalResultCount)
 throw new Error("search_grants did not deliver every matched graph-ready record");
if(/cache|cached|pagination|additional cached|allRecordsLoaded|hasMore/i.test((result.content as any)?.[0]?.text??""))
 throw new Error("search_grants exposed internal result-delivery details");
const detailResult=await client.callTool({name:"get_grant_details",arguments:{grantId:output.grants[0].id}});
const detail=detailResult.structuredContent as any;
if(detail?.opportunity?.id!==output.grants[0].id||!detail?.score?.components?.missionAlignment?.reasons?.length)
 throw new Error("get_grant_details did not return silently hydratable evidence");

const allResult=await client.callTool({
 name:"search_grants",
 arguments:{query:"Find nonprofit grants for AI workforce and digital inclusion programs nationwide."},
});
const all=allResult.structuredContent as any,allBytes=Buffer.byteLength(JSON.stringify(allResult));
if("allRecordsLoaded"in all||"hasMore"in all||all.grants.length!==all.totalResultCount)
 throw new Error("The broad search did not deliver all records in its initial graph payload");
if(all.grants.length<50)
 throw new Error("The broad all-record search returned too few records to verify payload scaling");
if(allBytes>=48*1024)
 throw new Error(`All-record tool result exceeds the 48 KiB safety ceiling: ${allBytes} bytes`);

const currentOnlyResult=await client.callTool({name:"search_grants",arguments:{
 query:`${prompt} Return 20 current open federal grants. Do not include historical prospects.`,
 resultTypes:["current-federal"],
 requestedResultCount:20,
}});
const currentOnly=currentOnlyResult.structuredContent as any;
if(!currentOnly.grants?.length||currentOnly.grants.some((grant:any)=>grant.category!=="current-federal-opportunity"))
 throw new Error("current-federal filtering returned another record type");
if(currentOnly.sourceCounts?.["irs-990pf"]!==0)
 throw new Error("current-federal filtering included historical IRS prospects");
if(currentOnly.totalResultCount>20)
 throw new Error("requestedResultCount was not honored");

const ceilingResult=await client.callTool({name:"search_grants",arguments:{
 query:"Find hunger-relief funding opportunities for a Washington nonprofit with awards below $500,000.",
 resultTypes:["current-federal","forecasted-federal","historical-private-prospect"],
}});
const ceiling=ceilingResult.structuredContent as any;
if(!ceiling.grants?.length||ceiling.context?.minimumAward!==undefined||ceiling.context?.maximumAward!==500000)
 throw new Error("A below-amount request was not treated as a maximum-only award constraint");

const retainedCriteriaResult=await client.callTool({name:"search_grants",arguments:{
 query:"find 50",
 requestedResultCount:50,
}});
const retained=retainedCriteriaResult.structuredContent as any;
if(retained.context?.projectTitle!=="Food Access and Hunger Relief"||retained.context?.maximumAward!==500000)
 throw new Error("A count-only follow-up did not preserve the preceding search criteria");
if(/cache|cached|pagination|additional cached|all .* available matches/i.test((retainedCriteriaResult.content as any)?.[0]?.text??""))
 throw new Error("A count-only follow-up exposed internal cache or pagination details");

const tooMany=await client.callTool({name:"search_grants",arguments:{query:prompt,requestedResultCount:101}});
if(!tooMany.isError||(tooMany.structuredContent as any)?.error?.code!=="RESULT_LIMIT_EXCEEDED")
 throw new Error("search_grants did not return its explicit result-limit error");

const resource=await client.readResource({uri:GRANTPILOT_WIDGET_URI}),content=resource.contents[0];
if(content?.mimeType!=="text/html;profile=mcp-app"||!("text"in content)||!content.text.includes("GrantPilot"))
 throw new Error("GrantPilot widget invalid");
console.log(
 `[verify] ${mcpUrl} | tools/list ${names.length} ✓ | demo ${output.grants.length} records ${(firstBytes/1024).toFixed(1)} KiB ✓ | `+
 `all-record graph payload ${all.grants.length}/${all.totalResultCount} ${(allBytes/1024).toFixed(1)} KiB ✓ | silent details ✓ | `+
 `current-only ${currentOnly.grants.length} ✓ | below-amount ${ceiling.grants.length} ✓ | count-only criteria retained ✓ | 101-result limit rejected ✓ | `+
 `widget ${(content.text.length/1024).toFixed(1)} KiB ✓`,
);
await transport.terminateSession().catch(()=>{});
await client.close();
child?.kill("SIGTERM");
