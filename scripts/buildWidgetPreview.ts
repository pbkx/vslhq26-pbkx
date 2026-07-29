import { readFile, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = new URL(process.env.MCP_URL ?? "http://localhost:3000/mcp");
const client = new Client({ name: "grantpilot-widget-preview", version: "1" });
const transport = new StreamableHTTPClientTransport(endpoint);
await client.connect(transport);
const query = process.env.GRANTPILOT_PREVIEW_QUERY
  ?? "Find grants for a Washington nonprofit teaching practical AI skills to low-income adults. We need between $100,000 and $500,000.";
const result = await client.callTool({
  name: "search_grants",
  arguments: {
    query,
    filters: { onlyOpen: true },
  },
});
const data = result.structuredContent;
if (!(data as any)?.grants?.length) throw new Error("Preview search returned no grants.");
const html = await readFile("dist/widget.html", "utf8");
const view = process.env.GRANTPILOT_PREVIEW_VIEW ?? "matrix";
const preview = html.replace(
  "<script>",
  `<script>globalThis.__GRANTPILOT_PREVIEW_DATA__=${JSON.stringify(data).replaceAll("<", "\\u003c")};globalThis.__GRANTPILOT_PREVIEW_VIEW__=${JSON.stringify(view)};</script><script>`,
);
await writeFile("dist/widget-preview.html", preview);
console.log("[preview] dist/widget-preview.html");
await transport.terminateSession().catch(() => undefined);
await client.close();
