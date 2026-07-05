"use client"

import { useEffect } from "react"
import { AppShell } from "@/components/app-shell"
import { ErrorCard } from "@/components/ui/state-kit"

export default function TosError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <AppShell user={null}>
      <div className="mx-auto flex min-h-[calc(100vh-56px)] max-w-xl items-center px-5 py-20">
        <ErrorCard
          heading="Terms unavailable"
          body="We couldn't load the Terms of Service. Try again in a moment."
          onRetry={reset}
        />
      </div>
    </AppShell>
  )
}
