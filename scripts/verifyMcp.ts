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
if(firstBytes>=48*1024)throw new Error("Initial tool result exceeds the 48 KiB GrantPilot safety ceiling");
const pagingResult=output.hasMore?result:await client.callTool({
 name:"search_grants",
 arguments:{query:"Find nonprofit grants for AI workforce and digital inclusion programs nationwide."},
});
const paging=pagingResult.structuredContent as any;
if(!paging.hasMore||!Number.isInteger(paging.nextOffset))
 throw new Error("The paging search did not expose a load-more page");

const moreResult=await client.callTool({name:"load_more_grants",arguments:{queryId:paging.queryId,offset:paging.nextOffset}});
const more=moreResult.structuredContent as any,moreBytes=Buffer.byteLength(JSON.stringify(moreResult));
if(!more?.append||!more.grants?.length)throw new Error("load_more_grants returned no appendable records");
if(moreBytes>=48*1024)throw new Error("Load-more tool result exceeds the 48 KiB GrantPilot safety ceiling");
const firstIds=new Set(paging.grants.map((grant:any)=>grant.opportunity.id));
if(more.grants.some((grant:any)=>firstIds.has(grant.opportunity.id)))
 throw new Error("load_more_grants returned duplicate IDs from the first page");

const currentOnlyResult=await client.callTool({name:"search_grants",arguments:{
 query:`${prompt} Return 20 current open federal grants. Do not include historical prospects.`,
 resultTypes:["current-federal"],
 requestedResultCount:20,
}});
const currentOnly=currentOnlyResult.structuredContent as any;
if(!currentOnly.grants?.length||currentOnly.grants.some((grant:any)=>grant.opportunity.recordCategory!=="current-federal-opportunity"))
 throw new Error("current-federal filtering returned another record type");
if(currentOnly.sourceCounts?.["irs-990pf"]!==0)
 throw new Error("current-federal filtering included historical IRS prospects");
if(currentOnly.totalResultCount>20)
 throw new Error("requestedResultCount was not honored");

const tooMany=await client.callTool({name:"search_grants",arguments:{query:prompt,requestedResultCount:101}});
if(!tooMany.isError||(tooMany.structuredContent as any)?.error?.code!=="RESULT_LIMIT_EXCEEDED")
 throw new Error("search_grants did not return its explicit result-limit error");

const resource=await client.readResource({uri:GRANTPILOT_WIDGET_URI}),content=resource.contents[0];
if(content?.mimeType!=="text/html;profile=mcp-app"||!("text"in content)||!content.text.includes("GrantPilot"))
 throw new Error("GrantPilot widget invalid");
console.log(
 `[verify] ${mcpUrl} | tools/list ${names.length} ✓ | page 1 ${output.grants.length} records ${(firstBytes/1024).toFixed(1)} KiB ✓ | `+
 `load_more ${more.grants.length} records ${(moreBytes/1024).toFixed(1)} KiB ✓ | total cached ${paging.totalResultCount} | `+
 `current-only ${currentOnly.grants.length} ✓ | 101-result limit rejected ✓ | `+
 `widget ${(content.text.length/1024).toFixed(1)} KiB ✓`,
);
await transport.terminateSession().catch(()=>{});
await client.close();
child?.kill("SIGTERM");
