import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createGrantPilotMcpServer } from "./createServer.js";

const transports=new Map<string,StreamableHTTPServerTransport>();
const rpcError=(res:Response,status:number,code:number,message:string)=>res.status(status).json({jsonrpc:"2.0",error:{code,message},id:null});
const sessionId=(req:Request)=>typeof req.headers["mcp-session-id"]==="string"?req.headers["mcp-session-id"]:undefined;

export function mountMcpTransport(app:Express){
  app.post("/mcp",async(req,res)=>{
    const method=Array.isArray(req.body)?"batch":req.body?.method;
    if(method==="tools/list")console.log("[mcp] tools/list");
    if(method==="resources/read")console.log(`[mcp] resources/read ${req.body?.params?.uri??""}`);
    try{
      const sid=sessionId(req);let transport=sid?transports.get(sid):undefined;
      if(!transport&&!sid&&isInitializeRequest(req.body)){
        transport=new StreamableHTTPServerTransport({
          sessionIdGenerator:()=>randomUUID(),
          enableJsonResponse:true,
          onsessioninitialized:(id)=>{transports.set(id,transport!);console.log(`[mcp] session initialized ${id.slice(0,8)}…`)}
        });
        transport.onclose=()=>{if(transport?.sessionId)transports.delete(transport.sessionId)};
        const server=createGrantPilotMcpServer();await server.connect(transport);
      }else if(!transport){rpcError(res,400,-32000,"Unknown, expired, or missing MCP session.");return}
      req.on("aborted",()=>console.warn("[mcp] client disconnected"));
      await transport.handleRequest(req,res,req.body);
    }catch(error){console.error("[mcp] request error",error instanceof Error?error.message:"Unknown error");if(!res.headersSent)rpcError(res,500,-32603,"Internal MCP server error.")}
  });
  // The standalone SSE stream is optional in Streamable HTTP. Dev Tunnel can
  // buffer an idle SSE response and prevent clients from continuing to
  // tools/list, so MCP requests use self-contained JSON POST responses.
  // Official clients treat 405 here as "standalone SSE not supported".
  app.get("/mcp",(_req,res)=>{
    res.setHeader("Allow","POST, DELETE");
    rpcError(res,405,-32000,"Standalone SSE is not supported; use MCP over POST.");
  });
  app.delete("/mcp",async(req,res)=>{const sid=sessionId(req);const transport=sid?transports.get(sid):undefined;if(!transport){rpcError(res,400,-32000,"Unknown or expired MCP session.");return}try{await transport.handleRequest(req,res);transports.delete(sid!)}catch(error){console.error("[mcp] session close error",error instanceof Error?error.message:error);if(!res.headersSent)rpcError(res,500,-32603,"Unable to close MCP session.")}});
}

export async function closeMcpTransports(){await Promise.all([...transports.values()].map(t=>t.close().catch(()=>undefined)));transports.clear()}
