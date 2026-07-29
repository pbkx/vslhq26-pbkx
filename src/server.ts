import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { mountMcpTransport,closeMcpTransports } from "./mcp/transport.js";
import { runGrantWatchChecks } from "./services/watchService.js";

export function createHttpApp(){
  const app=createMcpExpressApp({
    host:"0.0.0.0",
    allowedHosts:[
      "localhost",
      "127.0.0.1",
      "rqt1l69t-3000.usw2.devtunnels.ms",
    ],
  });
  app.use((_req,res,next)=>{res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Expose-Headers","mcp-session-id");next()});
  app.get("/health",(_req,res)=>res.json({status:"ok",service:"grantpilot-mcp",transport:"streamable-http"}));
  app.get("/privacy",(_req,res)=>res.type("html").send("<!doctype html><html><head><meta charset=utf-8><title>GrantPilot privacy</title></head><body><main><h1>GrantPilot privacy</h1><p>GrantPilot is a grant decision-support demonstration. Profiles, saved searches, and watches are stored locally for the demo. API credentials are never exposed to the widget.</p></main></body></html>"));
  app.get("/terms",(_req,res)=>res.type("html").send("<!doctype html><html><head><meta charset=utf-8><title>GrantPilot terms</title></head><body><main><h1>GrantPilot terms</h1><p>GrantPilot provides decision support, not legal advice or guaranteed eligibility. Requirements must be verified at the original opportunity source.</p></main></body></html>"));
  app.post("/admin/run-watches",async(req,res)=>{const expected=process.env.ADMIN_WATCH_TOKEN;if(expected&&req.headers.authorization!==`Bearer ${expected}`){res.status(401).json({error:"Unauthorized"});return}res.json(await runGrantWatchChecks())});
  mountMcpTransport(app);
  app.use((error:unknown,_req:unknown,res:any,_next:unknown)=>{console.error("[http] uncaught request error",error instanceof Error?error.message:error);if(!res.headersSent)res.status(500).json({error:"Internal server error"})});
  return app;
}

if(process.env.NODE_ENV!=="test"){
  const port=Number(process.env.PORT??3000),host=process.env.HOST??"0.0.0.0";
  const httpServer=createHttpApp().listen(port,host,()=>console.log(`[server] GrantPilot MCP listening on http://${host}:${port}/mcp`));
  const watchPollInterval=Math.max(60_000,Number(process.env.WATCH_POLL_INTERVAL_MS??900_000));
  const watchTimer=setInterval(()=>runGrantWatchChecks().catch(error=>
    console.error("[watch] scheduled check failed",error instanceof Error?error.message:"Unknown error")
  ),watchPollInterval);
  watchTimer.unref();
  const shutdown=async()=>{console.log("[server] shutting down");clearInterval(watchTimer);await closeMcpTransports();httpServer.close(()=>process.exit(0))};
  process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
}
