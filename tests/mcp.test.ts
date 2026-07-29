import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGrantPilotMcpServer, REQUIRED_TOOLS } from "../src/mcp/createServer.js";
import { GRANTPILOT_WIDGET_URI } from "../src/mcp/resources/grantPilotWidget.js";

let close: (() => Promise<void>) | undefined;
afterEach(() => close?.());

describe("GrantPilot MCP", () => {
  it("discovers tools, defaults broad searches to 80, enforces explicit count limits, paginates, and serves the workbench", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createGrantPilotMcpServer();
    const client = new Client({ name: "test", version: "1" });
    await server.connect(b);
    await client.connect(a);
    close = async () => {
      await client.close();
      await server.close();
    };

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([...REQUIRED_TOOLS].sort());
    const search = tools.tools.find((tool) => tool.name === "search_grants")!;
    expect((search._meta as any).ui.resourceUri).toBe(GRANTPILOT_WIDGET_URI);
    expect((search.inputSchema as any).properties.resultTypes.items.enum).toEqual([
      "current-federal",
      "forecasted-federal",
      "historical-private-prospect",
    ]);
    expect((search.inputSchema as any).properties.requestedResultCount).toBeTruthy();
    expect(search.description).toContain("never supplement");

    const limited = await client.callTool({
      name: "search_grants",
      arguments: { query: "Find 7 AI workforce grants", requestedResultCount: 7 },
    });
    expect((limited.structuredContent as any).totalResultCount).toBeLessThanOrEqual(7);

    const rejected = await client.callTool({
      name: "search_grants",
      arguments: { query: "Find 101 AI workforce grants", requestedResultCount: 101 },
    });
    expect(rejected.isError).toBe(true);
    expect((rejected.content as any)[0].text).toContain("between 1 and 100");
    expect((rejected.structuredContent as any).error.code).toBe("RESULT_LIMIT_EXCEEDED");

    const result = await client.callTool({
      name: "search_grants",
      arguments: { query: "AI workforce", requestedResultCount: 10 },
    });
    const output = result.structuredContent as any;
    expect(output.totalResultCount).toBeGreaterThan(10);
    expect(output.grants.length).toBeGreaterThan(5);
    expect(output.context.projectTitle).toBeTruthy();
    expect((result.content as any)[0].text).toContain("Do not add or recommend any outside funder");
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(48 * 1024);

    if (output.hasMore) {
      const more = await client.callTool({
        name: "load_more_grants",
        arguments: { queryId: output.queryId },
      });
      const page = more.structuredContent as any;
      expect(page.append).toBe(true);
      expect(page.grants.length).toBeGreaterThan(0);
      expect(page.grants.some((grant: any) =>
        output.grants.some((first: any) => first.opportunity.id === grant.opportunity.id))).toBe(false);
      expect(Buffer.byteLength(JSON.stringify(more))).toBeLessThan(48 * 1024);

      if (page.hasMore) {
        const next = await client.callTool({
          name: "load_more_grants",
          arguments: { queryId: output.queryId },
        });
        const nextPage = next.structuredContent as any;
        expect(nextPage.grants.some((grant: any) =>
          page.grants.some((prior: any) => prior.opportunity.id === grant.opportunity.id))).toBe(false);
      }
    }

    const foodPrompt = "Find 30 possible grants for a New York nonprofit which provides free food. We need between $100,000 and $500,000.";
    const foodResult = await client.callTool({
      name: "search_grants",
      arguments: { query: foodPrompt, requestedResultCount: 30 },
    });
    const food = foodResult.structuredContent as any;
    expect(food.totalResultCount).toBeLessThanOrEqual(30);
    expect(food.context.organizationLocation).toBe("NY");
    expect(food.context.projectTitle).toBe("Food Access and Hunger Relief");
    expect(food.grants.length).toBeGreaterThan(0);
    expect(food.grants.every((grant: any) =>
      grant.score.components.missionAlignment.score >= 45)).toBe(true);
    expect(food.grants.every((grant: any) =>
      !grant.score.components.geographicFit.reasons.some((reason: string) => /Washington/i.test(reason)))).toBe(true);
    expect((foodResult.content as any)[0].text).toContain("Unrelated records were excluded");

    const resource = await client.readResource({ uri: GRANTPILOT_WIDGET_URI });
    expect(resource.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    expect((resource.contents[0] as any).text).toContain("GrantPilot");
  });
});
