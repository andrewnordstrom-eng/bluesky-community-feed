export function normalizeScoreValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return value
}

export function formatSignedScore(value: number): string {
  const normalizedValue = normalizeScoreValue(value)
  const sign = normalizedValue >= 0 ? "+" : "-"

  return `${sign}${Math.abs(normalizedValue).toFixed(2)}`
}

export function isNonNegativeScore(value: number): boolean {
  return normalizeScoreValue(value) >= 0
}
