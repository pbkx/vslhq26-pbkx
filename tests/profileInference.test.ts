import { describe, expect, it } from "vitest";
import { demoOrganization, demoProject } from "../src/data/demoProfiles.js";
import { inferProfilesFromQuery, mergeProfilesFromRequest } from "../src/services/profileInference.js";

describe("prompt-derived search profiles", () => {
  it("derives New York food-relief context without leaking the Seattle AI demo profile", () => {
    const { organization, project } = inferProfilesFromQuery(
      "Find 30 possible grants for a New York nonprofit which provides free food. We need between $100,000 and $500,000.",
    );

    expect(organization.headquarters.state).toBe("NY");
    expect(organization.serviceAreas[0]?.states).toEqual(["NY"]);
    expect(organization.missionTopics).toContain("food security");
    expect(project.title).toBe("Food Access and Hunger Relief");
    expect(project.topics).toContain("hunger relief");
    expect(project.estimatedBudget).toBe(300_000);
    expect(JSON.stringify({ organization, project })).not.toMatch(/Washington|Seattle|artificial intelligence/i);
  });

  it("treats the current query as authoritative over a conflicting demo-shaped payload", () => {
    const prompt = "Find 30 possible grants for a New York nonprofit which provides free food. We need between $100,000 and $500,000.";
    const { organization, project } = mergeProfilesFromRequest(prompt, demoOrganization, demoProject);

    expect(organization.headquarters.state).toBe("NY");
    expect(organization.serviceAreas[0]?.states).toEqual(["NY"]);
    expect(organization.missionTopics).toContain("food security");
    expect(project.title).toBe("Food Access and Hunger Relief");
    expect(project.topics).toContain("hunger relief");
    expect(project.estimatedBudget).toBe(300_000);
  });
});
