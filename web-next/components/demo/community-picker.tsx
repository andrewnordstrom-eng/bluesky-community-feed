"use client"

import { ArrowRight } from "lucide-react"
import type { ShadowDemoCommunityId } from "@/app/demo/shadow-demo-view-model"
import { STEP_PANELS } from "@/app/demo/shadow-demo-copy"

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"

export function CommunityPicker({
  onStart,
  busy,
}: {
  readonly onStart: (communityId: ShadowDemoCommunityId) => void
  readonly busy: boolean
}) {
  const activeId: ShadowDemoCommunityId = "community_gov"

  return (
    <div>
      <h2 className="font-display text-2xl font-bold leading-tight text-foreground md:text-3xl">
        {STEP_PANELS.community.heading}
      </h2>
      <p className="mt-2 max-w-2xl text-base leading-relaxed text-foreground/60">{STEP_PANELS.community.body}</p>

      <div className="mt-6 flex max-w-xl flex-col rounded-2xl border border-primary/25 bg-primary/[0.04] px-6 py-6 shadow-[0_2px_16px_rgba(46,38,32,0.06)]">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/65">
          Public feed · isolated shadow session
        </span>
        <h3 className="mt-2 font-display text-2xl font-bold text-foreground">Corgi Commons</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-foreground/62">
          Open-network building, research, software, data, and the conversations connecting them. Freeze a reviewer-safe comparison set, then run governance without changing what the public sees.
        </p>
        <button
          type="button"
          onClick={() => onStart(activeId)}
          disabled={busy}
          className={`mt-5 inline-flex w-fit items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_rgba(200,97,44,0.25)] transition-colors hover:bg-primary-dark disabled:opacity-60 ${FOCUS}`}
        >
          {busy ? "Starting…" : STEP_PANELS.community.cta}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
