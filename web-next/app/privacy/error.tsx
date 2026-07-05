"use client"

import { LegalErrorBoundary, type LegalErrorBoundaryRouteProps } from "@/components/legal-error-boundary"

export default function PrivacyError({ error, reset }: LegalErrorBoundaryRouteProps) {
  return (
    <LegalErrorBoundary
      error={error}
      reset={reset}
      heading="Privacy policy unavailable"
      body="We couldn't load the Privacy Policy. Try again in a moment."
    />
  )
}
