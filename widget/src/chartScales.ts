type AwardDatum = {
  opportunity: {
    awardMin?: number;
    awardMax?: number;
  };
};

function niceAwardDomain(value: number) {
  const minimum = Math.max(value, 10_000);
  const magnitude = 10 ** Math.floor(Math.log10(minimum));
  const normalized = minimum / magnitude;
  const ceiling = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return ceiling * magnitude;
}

export function adaptivePercentDomain(values: number[], minimumSpan: number) {
  const valid = values.filter(Number.isFinite).map((value) => Math.max(0, Math.min(100, value)));
  if (!valid.length) return { minimum: 0, maximum: 100 };
  const rawMinimum = Math.min(...valid);
  const rawMaximum = Math.max(...valid);
  const center = (rawMinimum + rawMaximum) / 2;
  const span = Math.max(minimumSpan, (rawMaximum - rawMinimum) * 1.3);
  let minimum = Math.floor((center - span / 2) / 5) * 5;
  let maximum = Math.ceil((center + span / 2) / 5) * 5;
  if (minimum < 0) {
    maximum = Math.min(100, maximum - minimum);
    minimum = 0;
  }
  if (maximum > 100) {
    minimum = Math.max(0, minimum - (maximum - 100));
    maximum = 100;
  }
  if (maximum === minimum) maximum = Math.min(100, minimum + minimumSpan);
  return { minimum, maximum };
}

export function adaptiveAwardDomain(
  grants: AwardDatum[],
  targetMinimum?: number,
  targetMaximum?: number,
) {
  const values = grants
    .flatMap((grant) => [grant.opportunity.awardMin, grant.opportunity.awardMax])
    .filter((value): value is number => value !== undefined && value > 0)
    .sort((a, b) => a - b);
  const requestedMaximum = Math.max(targetMinimum ?? 0, targetMaximum ?? 0);
  if (!values.length) return niceAwardDomain(Math.max(requestedMaximum, 100_000));

  const largest = values[values.length - 1]!;
  return niceAwardDomain(largest * 1.02);
}

export function adaptiveDeadlineHorizon(days: number[]) {
  const largest = Math.max(0, ...days.filter((value) => Number.isFinite(value) && value >= 0));
  if (largest <= 30) return 30;
  if (largest <= 60) return 60;
  if (largest <= 90) return 90;
  if (largest <= 120) return 120;
  if (largest <= 180) return 180;
  return 365;
}
