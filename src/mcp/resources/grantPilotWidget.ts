import{readFile}from"node:fs/promises";import{resolve}from"node:path";import type{McpServer}from"@modelcontextprotocol/sdk/server/mcp.js";import{registerAppResource,RESOURCE_MIME_TYPE}from"@modelcontextprotocol/ext-apps/server";
export const GRANTPILOT_WIDGET_URI="ui://grantpilot/opportunity-workbench-v36";
export const GRANTPILOT_LEGACY_WIDGET_URIS=[
 "ui://grantpilot/opportunity-workbench-v35",
 "ui://grantpilot/opportunity-workbench-v34",
 "ui://grantpilot/opportunity-workbench-v33",
 "ui://grantpilot/opportunity-workbench-v32",
 "ui://grantpilot/opportunity-workbench-v31",
 "ui://grantpilot/opportunity-workbench-v30",
 "ui://grantpilot/opportunity-workbench-v29",
 "ui://grantpilot/opportunity-workbench-v28",
 "ui://grantpilot/opportunity-workbench-v27",
 "ui://grantpilot/opportunity-workbench-v26",
 "ui://grantpilot/opportunity-workbench-v25",
 "ui://grantpilot/opportunity-workbench-v24",
 "ui://grantpilot/opportunity-workbench-v23",
 "ui://grantpilot/opportunity-workbench-v22",
 "ui://grantpilot/opportunity-workbench-v21",
]as const;
export function registerGrantPilotWidget(server:McpServer){
 for(const[index,resourceUri]of[GRANTPILOT_WIDGET_URI,...GRANTPILOT_LEGACY_WIDGET_URIS].entries()){
  registerAppResource(
   server,
   index===0?"Grant Opportunity Workbench":`Grant Opportunity Workbench compatibility ${index}`,
   resourceUri,
   {description:"Interactive GrantPilot workbench with match matrix, award-fit, score heatmap, deadlines, ranked evidence, comparisons, and customizable email watches."},
   async uri=>{
    console.log(`[mcp] resources/read ${uri.href}`);
    return{contents:[{uri:resourceUri,mimeType:RESOURCE_MIME_TYPE,text:await readFile(resolve("dist/widget.html"),"utf8"),_meta:{ui:{prefersBorder:false}}}]};
   },
  );
 }
}
