"use client"

import { useEffect, useRef } from "react"
import { AppShell } from "@/components/app-shell"
import { ErrorCard } from "@/components/ui/state-kit"

export interface LegalErrorBoundaryRouteProps {
  error: Error & { digest?: string }
  reset: () => void
}

interface LegalErrorBoundaryProps extends LegalErrorBoundaryRouteProps {
  heading: string
  body: string
}

export function reportLegalPageError(error: Error & { digest?: string }): void {
  const digestSuffix = error.digest ? ` digest=${error.digest}` : ""
  // web-next has no client-side monitoring provider; keep this first-party fallback local.
  console.error(`Legal page error${digestSuffix}`, error)
}

export function LegalErrorBoundary({ error, reset, heading, body }: LegalErrorBoundaryProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const reportedErrorRef = useRef<Error | null>(null)

  useEffect(() => {
    if (reportedErrorRef.current !== error) {
      reportLegalPageError(error)
      reportedErrorRef.current = error
    }
    containerRef.current?.focus()
  }, [error])

  return (
    <AppShell user={null}>
      <div
        ref={containerRef}
        tabIndex={-1}
        role="alert"
        className="mx-auto flex min-h-[calc(100vh-56px)] max-w-xl items-center px-5 py-20 outline-none"
      >
        <ErrorCard heading={heading} body={body} onRetry={reset} />
      </div>
    </AppShell>
  )
}
