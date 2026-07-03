"use client"

import Image from "next/image"
import { Button } from "./button"

/* ─── Skeleton ─────────────────────────────────────────── */

interface SkeletonProps {
  className?: string
}

/** Warm-shimmer skeleton block. Use for any loading placeholder. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={`rounded-lg animate-shimmer ${className ?? ""}`}
      aria-hidden="true"
    />
  )
}

/** Pre-built skeleton for a stat card cluster row */
export function StatClusterSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4" aria-label="Loading statistics" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-2.5 w-32" />
        </div>
      ))}
    </div>
  )
}

/** Pre-built skeleton for a weight-bars section */
export function WeightsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="flex justify-between">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-10" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
      ))}
    </div>
  )
}

/* ─── Empty state ───────────────────────────────────────── */

interface EmptyStateProps {
  heading: string
  body: string
  /** Optional CTA */
  action?: { label: string; onClick: () => void }
  /** Suppress the corgi wink for governance/security contexts */
  showCorgi?: boolean
}

export function EmptyState({ heading, body, action, showCorgi = true }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-16 px-6 text-center">
      {showCorgi && (
        <Image
          src="/images/corgi-icon.svg"
          alt=""
          width={56}
          height={40}
          className="w-14 h-auto opacity-30"
          aria-hidden="true"
        />
      )}
      <div className="flex flex-col gap-2 max-w-xs">
        <p className="text-base font-semibold text-foreground">{heading}</p>
        <p className="text-sm text-foreground/55 leading-relaxed">{body}</p>
      </div>
      {action && (
        <Button
          variant="outline"
          size="sm"
          onClick={action.onClick}
          className="border-border text-foreground/70 hover:text-foreground hover:bg-biscuit"
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}

/* ─── Error card ────────────────────────────────────────── */

interface ErrorCardProps {
  heading?: string
  body?: string
  onRetry?: () => void
}

export function ErrorCard({
  heading = "Something went wrong",
  body = "We couldn't load this section. Try again in a moment.",
  onRetry,
}: ErrorCardProps) {
  return (
    <div className="rounded-xl border border-status-error/30 bg-status-error-bg px-6 py-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {/* Warm brick alert icon */}
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5 text-status-error" aria-hidden="true">
          <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm0 3.5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5.5Zm0 5.5a.875.875 0 1 1 0-1.75A.875.875 0 0 1 8 11Z" fill="currentColor"/>
        </svg>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold text-status-error">{heading}</p>
          <p className="text-xs text-foreground/60 leading-relaxed">{body}</p>
        </div>
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="self-start border-status-error/40 text-status-error hover:bg-status-error/10 text-xs"
        >
          Try again
        </Button>
      )}
    </div>
  )
}
