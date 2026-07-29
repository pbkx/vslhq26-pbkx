import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGrantPilotMcpServer, REQUIRED_TOOLS } from "../src/mcp/createServer.js";
import {
  GRANTPILOT_LEGACY_WIDGET_URIS,
  GRANTPILOT_WIDGET_URI,
} from "../src/mcp/resources/grantPilotWidget.js";

let close: (() => Promise<void>) | undefined;
afterEach(() => close?.());

describe("GrantPilot MCP", () => {
  it("discovers tools, returns all graph-ready records at once, silently serves details, and serves the workbench", async () => {
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
    expect(search.description).toContain("count-only follow-up");
    const loadMore = tools.tools.find((tool) => tool.name === "load_more_grants")!;
    expect((loadMore._meta as any).ui.visibility).toEqual(["app"]);
    const createWatch = tools.tools.find((tool) => tool.name === "create_grant_watch")!;
    expect((createWatch.inputSchema as any).properties.matchQuality.enum).toEqual([
      "worth-reviewing",
      "strong",
      "top-only",
    ]);
    expect((createWatch.inputSchema as any).properties.frequency.enum).toEqual([
      "as-detected",
      "daily",
      "weekly",
    ]);
    expect((createWatch.inputSchema as any).properties.notificationTypes.items.enum).toEqual(
      expect.arrayContaining([
        "opportunity-closed",
        "opportunity-removed",
        "no-longer-matching",
      ]),
    );
    expect(createWatch.description).toContain("plain-language");

    const limited = await client.callTool({
      name: "search_grants",
      arguments: { query: "Find 7 AI workforce grants", requestedResultCount: 7 },
    });
    expect((limited.structuredContent as any).totalResultCount).toBeLessThanOrEqual(7);

    const originalFiftyPrompt = await client.callTool({
      name: "search_grants",
      arguments: {
        query: "Search for nonprofit grants below $500,000 toward hunger relief. Target mostly open federal grants. Search for like 50",
      },
    });
    expect((originalFiftyPrompt.structuredContent as any).totalResultCount).toBe(50);

    const rejected = await client.callTool({
      name: "search_grants",
      arguments: { query: "Find 101 AI workforce grants", requestedResultCount: 101 },
    });
    expect(rejected.isError).toBe(true);
    expect((rejected.content as any)[0].text).toContain("between 1 and 100");
    expect((rejected.structuredContent as any).error.code).toBe("RESULT_LIMIT_EXCEEDED");

    const result = await client.callTool({
      name: "search_grants",
      arguments: {
        query: "AI workforce",
        requestedResultCount: 10,
        project: { estimatedBudget: 300_000 },
        filters: { minimumAward: 100_000, maximumAward: 500_000 },
      },
    });
    const output = result.structuredContent as any;
    expect(output.totalResultCount).toBeGreaterThan(10);
    expect(output.grants.length).toBeGreaterThan(5);
    expect(output.context.projectTitle).toBeTruthy();
    expect(output.context.projectBudget).toBeUndefined();
    expect(output.context.minimumAward).toBeUndefined();
    expect(output.context.maximumAward).toBeUndefined();
    expect(output).not.toHaveProperty("allRecordsLoaded");
    expect(output).not.toHaveProperty("hasMore");
    expect(output).not.toHaveProperty("offset");
    expect(output).not.toHaveProperty("nextOffset");
    expect(output.grants).toHaveLength(output.totalResultCount);
    expect(output.grants.every((grant: any) =>
      grant.id && grant.title && grant.components.length === 6)).toBe(true);
    const responseText = (result.content as any)[0].text as string;
    expect(responseText).toContain("## Current Federal Opportunities (Open/Active)");
    expect(responseText).toContain("## Historical Private-Foundation Prospects");
    expect(responseText).toContain("Evidence-backed potential private donor/funder candidates worth researching and possibly contacting.");
    expect(responseText).not.toMatch(/cache|cached|pagination|allRecordsLoaded|hasMore/i);
    if (output.totalResultCount < 80) {
      expect(responseText).toContain(`I tried to find 80 sufficiently relevant grant records`);
      expect(responseText).toContain(`only found **${output.totalResultCount} sufficiently relevant records**`);
      expect(output.warnings[0]).toBe(`Only ${output.totalResultCount} sufficiently relevant records matched.`);
    }
    for (const grant of output.grants) {
      expect(responseText).toContain(
        grant.source === "irs-990pf" ? grant.funder : grant.title,
      );
    }
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(48 * 1024);

    const detailResult = await client.callTool({
      name: "get_grant_details",
      arguments: { grantId: output.grants[0].id },
    });
    const detail = detailResult.structuredContent as any;
    expect(detail.opportunity.id).toBe(output.grants[0].id);
    expect(detail.score.components.programSizeFit.reasons[0]).toContain("No target award size was requested");

    const selectedIds = output.grants.slice(0, 2).map((grant: any) => grant.id);
    const comparison = await client.callTool({
      name: "compare_grants",
      arguments: { grantIds: selectedIds },
    });
    const comparisonOutput = comparison.structuredContent as any;
    expect(comparisonOutput.grants).toHaveLength(2);
    expect(comparisonOutput.grants[0].componentScores).toBeTruthy();
    expect((comparison.content as any)[0].text).toContain("primary pursuit");

    const more = await client.callTool({
      name: "load_more_grants",
      arguments: { queryId: output.queryId },
    });
    const moreOutput = more.structuredContent as any;
    expect(moreOutput.grants).toEqual([]);
    expect(moreOutput).not.toHaveProperty("allRecordsLoaded");
    expect(moreOutput).not.toHaveProperty("hasMore");
    expect((more.content as any)[0].text).not.toMatch(/cache|cached|already loaded/i);

    const foodPrompt = "Find 30 possible grants for a New York nonprofit which provides free food. We need between $100,000 and $500,000.";
    const foodResult = await client.callTool({
      name: "search_grants",
      arguments: { query: foodPrompt, requestedResultCount: 30 },
    });
    const food = foodResult.structuredContent as any;
    expect(food.totalResultCount).toBeLessThanOrEqual(30);
    expect(food.context.organizationLocation).toBe("NY");
    expect(food.context.projectTitle).toBe("Food Access and Hunger Relief");
    expect(food.context.minimumAward).toBe(100_000);
    expect(food.context.maximumAward).toBe(500_000);
    expect(food.grants.length).toBeGreaterThan(0);
    expect(food.grants.every((grant: any) => grant.components[0] >= 45)).toBe(true);
    expect(food.grants).toHaveLength(food.totalResultCount);
    const foodDetail = await client.callTool({
      name: "get_grant_details",
      arguments: { grantId: food.grants[0].id },
    });
    expect(
      (foodDetail.structuredContent as any).score.components.geographicFit.reasons
        .some((reason: string) => /Washington/i.test(reason)),
    ).toBe(false);
    expect((foodResult.content as any)[0].text).toContain(
      `I tried to find 30 sufficiently relevant grant records`,
    );
    expect(food.warnings[0]).toBe(
      `Only ${food.totalResultCount} sufficiently relevant records matched.`,
    );
    expect((foodResult.content as any)[0].text).not.toContain("Unrelated records were excluded");

    const expandedFoodResult = await client.callTool({
      name: "search_grants",
      arguments: { query: "find 50", requestedResultCount: 50 },
    });
    const expandedFood = expandedFoodResult.structuredContent as any;
    expect(expandedFood.context.organizationLocation).toBe("NY");
    expect(expandedFood.context.projectTitle).toBe("Food Access and Hunger Relief");
    expect(expandedFood.context.minimumAward).toBe(100_000);
    expect(expandedFood.context.maximumAward).toBe(500_000);
    expect(expandedFood.totalResultCount).toBeLessThanOrEqual(50);
    expect(expandedFood.grants).toHaveLength(expandedFood.totalResultCount);
    expect((expandedFoodResult.content as any)[0].text).not.toMatch(
      /cache|cached|pagination|additional cached|all .* available matches/i,
    );

    const resource = await client.readResource({ uri: GRANTPILOT_WIDGET_URI });
    expect(resource.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    expect((resource.contents[0] as any).text).toContain("GrantPilot");
    const cachedResource = await client.readResource({ uri: GRANTPILOT_LEGACY_WIDGET_URIS[0] });
    expect(cachedResource.contents[0].uri).toBe(GRANTPILOT_LEGACY_WIDGET_URIS[0]);
    expect(cachedResource.contents[0].mimeType).toBe("text/html;profile=mcp-app");
  });
});
