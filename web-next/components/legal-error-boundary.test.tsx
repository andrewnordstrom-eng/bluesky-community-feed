import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LegalErrorBoundary, reportLegalPageError } from "./legal-error-boundary"

const hookState = vi.hoisted(() => ({
  nextRefIndex: 0,
  reportedErrorRef: { current: null as Error | null },
  containerRef: { current: { focus: vi.fn() } },
  errorCardProps: [] as Array<{ heading?: string; body?: string; onRetry?: () => void }>,
}))

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      effect()
    },
    useRef: <T,>(initialValue: T) => {
      const refIndex = hookState.nextRefIndex
      hookState.nextRefIndex += 1

      if (refIndex % 2 === 0) {
        return hookState.containerRef as { current: T }
      }

      return hookState.reportedErrorRef as { current: T }
    },
  }
})

vi.mock("@/components/app-shell", async () => {
  const react = await import("react")
  return {
    AppShell: ({ children }: { children: ReactNode }) => react.createElement("div", null, children),
  }
})

vi.mock("@/components/ui/state-kit", async () => {
  const react = await import("react")
  return {
    ErrorCard: (props: { heading?: string; body?: string; onRetry?: () => void }) => {
      hookState.errorCardProps.push(props)
      return react.createElement(
        "section",
        { "data-error-card": "true" },
        react.createElement("p", null, props.heading),
        react.createElement("p", null, props.body),
        react.createElement("button", { type: "button", onClick: props.onRetry }, "Try again")
      )
    },
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  hookState.nextRefIndex = 0
  hookState.reportedErrorRef.current = null
  hookState.containerRef.current.focus.mockReset()
  hookState.errorCardProps = []
})

describe("reportLegalPageError", () => {
  it("logs digest context", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const error = new Error("legal load failed") as Error & { digest?: string }
    error.digest = "digest-123"

    reportLegalPageError(error)

    expect(consoleError).toHaveBeenCalledWith("Legal page error digest=digest-123", error)
  })

  it("logs without digest context when no digest is available", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const error = new Error("legal load failed")

    reportLegalPageError(error)

    expect(consoleError).toHaveBeenCalledWith("Legal page error", error)
  })
})

describe("LegalErrorBoundary", () => {
  function renderBoundary(error: Error & { digest?: string }, reset: () => void) {
    hookState.nextRefIndex = 0
    return renderToStaticMarkup(
      createElement(LegalErrorBoundary, {
        error,
        reset,
        heading: "Legal page unavailable",
        body: "Try again in a moment.",
      })
    )
  }

  it("reports the same error once across re-renders", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const error = new Error("legal load failed") as Error & { digest: string }
    error.digest = "digest-boundary-123"
    const reset = vi.fn()

    const markup = renderBoundary(error, reset)
    renderBoundary(error, reset)

    expect(markup).toContain("Legal page unavailable")
    expect(markup).toContain("Try again in a moment.")
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith("Legal page error digest=digest-boundary-123", error)
    expect(hookState.containerRef.current.focus).toHaveBeenCalledTimes(2)
    expect(hookState.errorCardProps[0]?.onRetry).toBe(reset)
  })

  it("reports again for a different error instance", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const firstError = new Error("first legal load failed")
    const secondError = new Error("second legal load failed")
    const reset = vi.fn()

    renderBoundary(firstError, reset)
    renderBoundary(secondError, reset)

    expect(consoleError).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenNthCalledWith(1, "Legal page error", firstError)
    expect(consoleError).toHaveBeenNthCalledWith(2, "Legal page error", secondError)
  })
})
