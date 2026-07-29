import { describe, expect, it } from "vitest";
import type { GrantResult } from "../widget/src/types.js";
import {
  adaptiveAwardDomain,
  adaptiveDeadlineHorizon,
  adaptivePercentDomain,
} from "../widget/src/chartScales.js";

const grantWithAwards = (awardMin: number, awardMax: number) => ({
  opportunity: { awardMin, awardMax },
}) as GrantResult;

describe("adaptive visualization scales", () => {
  it("fits percentage domains to the visible data without changing values", () => {
    expect(adaptivePercentDomain([51, 55, 61], 20)).toEqual({ minimum: 45, maximum: 70 });
    expect(adaptivePercentDomain([2, 50, 98], 20)).toEqual({ minimum: 0, maximum: 100 });
  });

  it("fits award axes to matched awards rather than a larger search ceiling", () => {
    const grants = [
      grantWithAwards(1_500, 1_500),
      grantWithAwards(30_000, 50_000),
      grantWithAwards(100_000, 150_000),
    ];

    expect(adaptiveAwardDomain(grants, undefined, 500_000)).toBe(200_000);
  });

  it("fits deadline horizons to the dated opportunities", () => {
    expect(adaptiveDeadlineHorizon([12, 28])).toBe(30);
    expect(adaptiveDeadlineHorizon([12, 72])).toBe(90);
    expect(adaptiveDeadlineHorizon([12, 240])).toBe(365);
  });
});
