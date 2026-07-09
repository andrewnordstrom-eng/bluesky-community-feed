export function clampPercentValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round(value)))
}

export function unitIntervalToPercentValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return clampPercentValue(value * 100)
}

export function absoluteUnitScoreToPercentValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return unitIntervalToPercentValue(Math.abs(value))
}

export function formatUnitIntervalPercent(value: number): string {
  return `${unitIntervalToPercentValue(value)}%`
}
