import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir,readFile,readdir,rm,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Script } from "node:vm";

export async function buildWidget(){
  await Promise.all(["dist/src","dist/tests","dist/scripts"].map(path=>rm(resolve(path),{recursive:true,force:true})));
  const temp=resolve("dist/widget-assets");await rm(temp,{recursive:true,force:true});await mkdir(temp,{recursive:true});
  await build({
    configFile:false,
    mode:"production",
    define:{
      "process.env.NODE_ENV":JSON.stringify("production")
    },
    plugins:[react()],
    logLevel:"warn",
    build:{
      outDir:temp,
      emptyOutDir:true,
      cssCodeSplit:false,
      minify:true,
      lib:{
        entry:resolve("widget/src/main.tsx"),
        name:"GrantPilotWidget",
        formats:["iife"],
        fileName:()=>"widget.js"
      }
    }
  });
  const files=await readdir(temp);const js=await readFile(resolve(temp,files.find(f=>f.endsWith(".js"))!),"utf8");const cssFile=files.find(f=>f.endsWith(".css"));const css=cssFile?await readFile(resolve(temp,cssFile),"utf8"):"";
  const template=await readFile(resolve("widget/index.html"),"utf8");
  const escapedJs=js.replaceAll("</script>","<\\/script>");
  // Replacement callbacks are required here. Passing minified JS directly as
  // the replacement string makes `$&`, `$`` and `$'` sequences mutate it.
  const html=template
    .replace("__GRANTPILOT_STYLE__",()=>css)
    .replace("__GRANTPILOT_SCRIPT__",()=>escapedJs);
  if(/\bprocess\.env\b/.test(html))throw new Error("Widget bundle contains a Node-only process.env reference");
  if(/<(?:script|link)[^>]+(?:src|href)=/i.test(html))throw new Error("Widget bundle contains an external asset reference");
  if(/createObjectURL\(|new Worker\(/.test(html))throw new Error("Widget bundle contains a Blob/Worker path that Copilot sandboxes cannot run");
  if(Buffer.byteLength(html)>900*1024)throw new Error("Widget bundle exceeds the 900 KiB Copilot safety budget");
  const scriptStart=html.indexOf("<script>")+"<script>".length;
  const scriptEnd=html.lastIndexOf("</script>");
  if(scriptStart<"<script>".length||scriptEnd<=scriptStart)throw new Error("Widget bundle is missing its inline script");
  new Script(html.slice(scriptStart,scriptEnd),{filename:"grantpilot-widget.js"});
  await writeFile(resolve("dist/widget.html"),html);await rm(temp,{recursive:true,force:true});
  console.log(`[build] widget.html ${(Buffer.byteLength(html)/1024).toFixed(1)} KiB`);
}
if(import.meta.url===`file://${process.argv[1]}`)await buildWidget();
