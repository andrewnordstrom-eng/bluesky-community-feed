export interface TrimmedMeanAggregationInput {
  rows: ReadonlyArray<Record<string, number>>;
  components: readonly string[];
}

export interface TrimmedMeanAggregationResult {
  values: Record<string, number>;
  trimCount: number;
}

export function aggregateRowsWithTrimmedMean(
  input: TrimmedMeanAggregationInput
): TrimmedMeanAggregationResult {
  const n = input.rows.length;
  if (n === 0) {
    throw new Error('aggregateRowsWithTrimmedMean requires at least one row');
  }

  const trimPct = 0.1;
  const trimCount = Math.floor(n * trimPct);
  const effectiveTrimCount = n >= 10 ? trimCount : 0;
  const values: Record<string, number> = {};

  for (const component of input.components) {
    const componentValues = input.rows
      .map((row, rowIndex) => {
        const value = row[component];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(
            `aggregateRowsWithTrimmedMean received a non-finite value for component ${component} at row ${rowIndex}`
          );
        }
        return value;
      })
      .sort((a, b) => a - b);
    const trimmed =
      effectiveTrimCount > 0
        ? componentValues.slice(effectiveTrimCount, n - effectiveTrimCount)
        : componentValues;
    values[component] = trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
  }

  return {
    values,
    trimCount: effectiveTrimCount,
  };
}
