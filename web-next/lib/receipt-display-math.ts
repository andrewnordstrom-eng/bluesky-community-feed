import type { ShadowDemoScoreComponent } from "@/app/demo/shadow-demo-view-model"

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

export interface ReceiptDisplayMathWithServerTotal extends ReceiptDisplayMath {
  readonly serverTotalScore: number
  readonly roundingResidual: number
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

export function tryBuildReceiptDisplayMath(
  components: readonly ShadowDemoScoreComponent[],
): ReceiptDisplayMath | null {
  try {
    return buildReceiptDisplayMath(components)
  } catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
}

export function tryBuildReceiptDisplayMathWithServerTotal(
  components: readonly ShadowDemoScoreComponent[],
  serverTotalScore: number,
): ReceiptDisplayMathWithServerTotal | null {
  try {
    const display = buildReceiptDisplayMath(components)
    const roundedServerTotal = roundForDisplay(serverTotalScore)
    const roundingResidual = roundForDisplay(roundedServerTotal - display.totalScore)
    // Scores and weights are normalized; this allows ten display-precision units.
    if (Math.abs(roundingResidual) > 0.001) {
      throw new TypeError(`Receipt rounding residual exceeds 0.001; received ${roundingResidual}`)
    }
    return {
      ...display,
      serverTotalScore: roundedServerTotal,
      roundingResidual,
    }
  } catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
}

export function formatReceiptScore(value: number): string {
  return roundForDisplay(value).toFixed(4)
}

export function formatReceiptPercent(value: number): string {
  return `${(roundForDisplay(value) * 100).toFixed(2)}%`
}
