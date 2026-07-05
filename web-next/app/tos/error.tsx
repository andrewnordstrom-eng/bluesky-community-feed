"use client"

import { LegalErrorBoundary, type LegalErrorBoundaryRouteProps } from "@/components/legal-error-boundary"

export default function TosError({ error, reset }: LegalErrorBoundaryRouteProps) {
  return (
    <LegalErrorBoundary
      error={error}
      reset={reset}
      heading="Terms unavailable"
      body="We couldn't load the Terms of Service. Try again in a moment."
    />
  )
}
