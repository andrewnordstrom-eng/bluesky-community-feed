import type { ShadowDemoScoreComponent } from "@/app/demo/shadow-demo-contract"

const DISPLAY_SCALE = 10_000

function roundForDisplay(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Receipt display value must be finite; received ${String(value)}`)
  }
  return Math.round((value + Number.EPSILON) * DISPLAY_SCALE) / DISPLAY_SCALE
}

export interface ReceiptDisplayMath {
  readonly components: readonly ShadowDemoScoreComponent[]
  readonly totalScore: number
}

export function buildReceiptDisplayMath(
  components: readonly ShadowDemoScoreComponent[],
): ReceiptDisplayMath {
  const displayedComponents = components.map((component) => {
    const rawScore = roundForDisplay(component.rawScore)
    const weight = roundForDisplay(component.weight)
    return {
      ...component,
      rawScore,
      weight,
      contribution: roundForDisplay(rawScore * weight),
    }
  })

  return {
    components: displayedComponents,
    totalScore: roundForDisplay(
      displayedComponents.reduce((total, component) => total + component.contribution, 0),
    ),
  }
}

export function formatReceiptScore(value: number): string {
  return roundForDisplay(value).toFixed(4)
}

export function formatReceiptPercent(value: number): string {
  return `${(roundForDisplay(value) * 100).toFixed(2)}%`
}
