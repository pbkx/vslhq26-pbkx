import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { urlencoded } from "express";
import { mountMcpTransport,closeMcpTransports } from "./mcp/transport.js";
import { runGrantWatchChecks } from "./services/watchService.js";
import { startIrsRefreshScheduler } from "./services/irsRefreshService.js";
import { grantRepository } from "./repositories/grantRepository.js";
import { maskWatchEmail } from "./services/watchOwnership.js";

const escapeHtml=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const unsubscribePage=({
  title,
  message,
  action,
}:{
  title:string;
  message:string;
  action?:string;
})=>`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(title)} · GrantPilot</title>
  <style>
    :root{color-scheme:light dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f4f1;color:#171715}
    main{width:min(520px,calc(100% - 32px));box-sizing:border-box;padding:30px;border:1px solid #deded8;border-radius:18px;background:#fff;box-shadow:0 18px 50px rgb(0 0 0/.08)}
    header{display:flex;align-items:center;gap:11px;margin-bottom:28px}
    img{width:36px;height:36px;border-radius:10px}
    header strong{font-size:20px;letter-spacing:-.02em}
    h1{margin:0;font-size:25px;line-height:1.18;letter-spacing:-.03em}
    p{margin:10px 0 0;color:#686762;font-size:15px;line-height:1.55}
    form{margin-top:25px}
    button,a.button{display:block;width:100%;box-sizing:border-box;padding:13px 18px;border:1px solid #171715;border-radius:10px;background:#171715;color:#fff;font:inherit;font-weight:700;text-align:center;text-decoration:none;cursor:pointer}
    small{display:block;margin-top:18px;color:#8b8a84;font-size:12px;line-height:1.5}
    @media(prefers-color-scheme:dark){
      body{background:#10100f;color:#f2f2ef}
      main{background:#181817;border-color:#30302e;box-shadow:none}
      p,small{color:#aaa9a3}
      button,a.button{border-color:#f2f2ef;background:#f2f2ef;color:#111}
    }
  </style>
</head>
<body>
  <main>
    <header><img src="/assets/grantpilot-logo.png" alt=""><strong>GrantPilot</strong></header>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${action??""}
    <small>This link controls only the watch referenced in the email. Other GrantPilot watches are unchanged.</small>
  </main>
</body>
</html>`;

export function createHttpApp(repository=grantRepository){
  const app=createMcpExpressApp({
    host:"0.0.0.0",
    allowedHosts:[
      "localhost",
      "127.0.0.1",
      "rqt1l69t-3000.usw2.devtunnels.ms",
    ],
  });
  app.use(urlencoded({extended:false}));
  app.use((_req,res,next)=>{res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Expose-Headers","mcp-session-id");next()});
  app.get("/health",(_req,res)=>res.json({status:"ok",service:"grantpilot-mcp",transport:"streamable-http"}));
  app.get("/assets/grantpilot-logo.png",(_req,res)=>res.sendFile("grantpilot-color-v2.png",{root:"appPackage"}));
  app.get("/watches/unsubscribe",(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Referrer-Policy","no-referrer");
    const watchId=typeof req.query.watchId==="string"?req.query.watchId:"";
    const token=typeof req.query.token==="string"?req.query.token:"";
    const watch=repository.getWatchForUnsubscribe(watchId,token);
    if(!watch){
      res.status(404).type("html").send(unsubscribePage({
        title:"This management link is invalid",
        message:"The watch may have been removed, or this email link is no longer current.",
      }));
      return;
    }
    if(watch.status==="paused"){
      res.type("html").send(unsubscribePage({
        title:"Updates are already cancelled",
        message:`GrantPilot is no longer sending this watch to ${maskWatchEmail(watch.email)}.`,
      }));
      return;
    }
    const action=`<form method="post" action="/watches/unsubscribe?watchId=${encodeURIComponent(watchId)}&amp;token=${encodeURIComponent(token)}"><button type="submit">Cancel these updates</button></form>`;
    res.type("html").send(unsubscribePage({
      title:"Cancel GrantPilot updates?",
      message:`Stop future emails for this watch to ${maskWatchEmail(watch.email)}.`,
      action,
    }));
  });
  app.post("/watches/unsubscribe",async(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Referrer-Policy","no-referrer");
    const watchId=typeof req.query.watchId==="string"?req.query.watchId:"";
    const token=typeof req.query.token==="string"?req.query.token:"";
    const watch=await repository.cancelWatchByToken(watchId,token);
    if(!watch){
      res.status(404).type("html").send(unsubscribePage({
        title:"Unable to cancel this watch",
        message:"The management link is invalid or expired.",
      }));
      return;
    }
    res.type("html").send(unsubscribePage({
      title:"Updates cancelled",
      message:`GrantPilot will no longer send this watch to ${maskWatchEmail(watch.email)}.`,
    }));
  });
  app.get("/privacy",(_req,res)=>res.type("html").send("<!doctype html><html><head><meta charset=utf-8><title>GrantPilot privacy</title></head><body><main><h1>GrantPilot privacy</h1><p>GrantPilot is a grant decision-support demonstration. Profiles, saved searches, and watches are stored locally for the demo. API credentials are never exposed to the widget.</p></main></body></html>"));
  app.get("/terms",(_req,res)=>res.type("html").send("<!doctype html><html><head><meta charset=utf-8><title>GrantPilot terms</title></head><body><main><h1>GrantPilot terms</h1><p>GrantPilot provides decision support, not legal advice or guaranteed eligibility. Requirements must be verified at the original opportunity source.</p></main></body></html>"));
  app.post("/admin/run-watches",async(req,res)=>{
    const expected=process.env.ADMIN_WATCH_TOKEN;
    if(!expected){
      res.status(503).json({error:"Watch administration is disabled until ADMIN_WATCH_TOKEN is configured."});
      return;
    }
    if(req.headers.authorization!==`Bearer ${expected}`){
      res.status(401).json({error:"Unauthorized"});
      return;
    }
    res.json(await runGrantWatchChecks());
  });
  mountMcpTransport(app);
  app.use((error:unknown,_req:unknown,res:any,_next:unknown)=>{console.error("[http] uncaught request error",error instanceof Error?error.message:error);if(!res.headersSent)res.status(500).json({error:"Internal server error"})});
  return app;
}

if(process.env.NODE_ENV!=="test"){
  const port=Number(process.env.PORT??3000),host=process.env.HOST??"0.0.0.0";
  const httpServer=createHttpApp().listen(port,host,()=>console.log(`[server] GrantPilot MCP listening on http://${host}:${port}/mcp`));
  const watchPollInterval=Math.max(60_000,Number(process.env.WATCH_POLL_INTERVAL_MS??900_000));
  let watchCheck:Promise<unknown>|undefined;
  const runScheduledWatchCheck=()=>{
    if(watchCheck){
      console.log("[watch] previous scheduled check is still running; skipping overlap");
      return;
    }
    watchCheck=runGrantWatchChecks()
      .catch(error=>console.error("[watch] scheduled check failed",error instanceof Error?error.message:"Unknown error"))
      .finally(()=>{watchCheck=undefined});
  };
  const watchTimer=setInterval(runScheduledWatchCheck,watchPollInterval);
  watchTimer.unref();
  const stopIrsRefresh=startIrsRefreshScheduler();
  const shutdown=async()=>{console.log("[server] shutting down");clearInterval(watchTimer);stopIrsRefresh();await closeMcpTransports();httpServer.close(()=>process.exit(0))};
  process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
}
