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

  it("does not inherit or invent an award target when the prompt states no amount", () => {
    const prompt = "Find grants for a New York nonprofit providing free food.";
    const { organization, project } = mergeProfilesFromRequest(
      prompt,
      demoOrganization,
      { ...demoProject, id: "model-generated-project", estimatedBudget: 300_000 },
    );

    expect(organization.headquarters.state).toBe("NY");
    expect(project.title).toBe("Food Access and Hunger Relief");
    expect(project.estimatedBudget).toBeUndefined();
  });

  it("interprets below an amount as a maximum rather than an exact award", () => {
    const { project } = inferProfilesFromQuery(
      "Find hunger-relief grants for a Washington nonprofit with awards below $500,000.",
    );

    expect(project.title).toBe("Food Access and Hunger Relief");
    expect(project.estimatedBudget).toBe(500_000);
  });
});
