import { watch } from "node:fs";import { spawn } from "node:child_process";import { buildWidget } from "./buildWidget.js";
await buildWidget();let timer:NodeJS.Timeout|undefined;const watcher=watch("widget",{recursive:true},()=>{clearTimeout(timer);timer=setTimeout(()=>buildWidget().catch(e=>console.error("[widget]",e)),150)});
const child=spawn(process.execPath,["--import","tsx","--watch","src/server.ts"],{stdio:"inherit",env:{...process.env,PORT:"3000",HOST:"0.0.0.0"}});
const stop=()=>{watcher.close();child.kill("SIGTERM")};process.on("SIGINT",stop);process.on("SIGTERM",stop);child.on("exit",code=>process.exit(code??0));
