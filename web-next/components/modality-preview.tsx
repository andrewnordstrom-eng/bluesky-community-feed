import Link from "next/link"
import { BlueskyOrderedFeed } from "@/components/bluesky-sample-feed"
import { LIVE_METRICS_SNAPSHOT, LIVE_RANK_ONE_EXPLANATION } from "@/lib/live-metrics-snapshot"
import { formatSignedScore } from "@/lib/score"

function CorgiReceiptPanel() {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/55">
          Corgi view
        </p>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between lg:flex-col lg:items-start xl:flex-row xl:items-end">
          <h3 className="text-foreground font-display text-2xl font-bold leading-tight">
            Receipt, score, and why ranked.
          </h3>
          <span className="w-fit text-[10px] font-mono text-primary border border-primary/20 bg-primary/10 rounded-full px-2.5 py-1">
            Corgi-site explainer
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col rounded-2xl border border-border bg-card overflow-hidden shadow-[0_1px_4px_rgba(46,38,32,0.05)]">
        <div className="border-b border-border/60 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-mono text-foreground/55">Anonymized live receipt</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{LIVE_RANK_ONE_EXPLANATION.authorLabel}</p>
            </div>
            <span className="w-fit rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-mono font-semibold text-primary">
              rank #{LIVE_RANK_ONE_EXPLANATION.rank} in Corgi
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-foreground/65">
            {LIVE_RANK_ONE_EXPLANATION.text}
          </p>
        </div>

        <div className="flex flex-col gap-3 px-5 py-5">
          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background px-4 py-3">
            <span className="text-sm font-semibold text-foreground">Total score</span>
            <span className="font-mono text-lg font-bold text-primary">
              {formatSignedScore(LIVE_RANK_ONE_EXPLANATION.totalScore)}
            </span>
          </div>

          <div className="rounded-xl border border-border/70 bg-background overflow-hidden">
            {LIVE_RANK_ONE_EXPLANATION.components.map((component) => (
              <div key={component.key} className="flex items-center justify-between gap-4 border-b border-border/40 px-4 py-2.5 last:border-0">
                <span className="text-xs font-medium text-foreground/55">{component.label}</span>
                <span className="text-xs font-mono font-semibold text-primary">
                  {formatSignedScore(component.weighted)}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-primary/15 bg-primary/[0.06] px-4 py-3 text-sm leading-relaxed text-foreground/65">
            Corgi&apos;s receipt shows the score components, epoch {LIVE_METRICS_SNAPSHOT.epochId} weights, and counterfactual rank movement. This panel is not native Bluesky UI.
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-3 border-t border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-foreground/50">
            Snapshot collected {LIVE_METRICS_SNAPSHOT.collectedAtLabel}
          </span>
          <Link href="/demo" className="text-sm font-medium text-primary hover:underline underline-offset-2">
            Inspect live demo &rarr;
          </Link>
        </div>
      </div>
    </div>
  )
}

function ProductSurface({ showIntro }: { readonly showIntro: boolean }) {
  return (
    <div className="mx-auto w-full max-w-[1120px]">
      <div className="rounded-3xl border border-border bg-card shadow-[0_8px_40px_rgba(46,38,32,0.12)] overflow-hidden">
        <div className="border-b border-border/60 bg-card px-5 py-4 sm:px-6">
          <p className="text-sm font-semibold text-foreground">
            Bluesky shows the ordered posts. Corgi shows the receipt.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/55">
            Sample posts show the interface shape; the receipt panel uses an anonymized live snapshot.
          </p>
        </div>
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.04fr)_minmax(360px,0.96fr)]">
          <div className="border-b border-border/60 bg-background/55 p-4 sm:p-5 lg:border-b-0 lg:border-r">
            <BlueskyOrderedFeed showIntro={showIntro} showDisclosure={showIntro} />
          </div>
          <div className="bg-card p-4 sm:p-5">
            <CorgiReceiptPanel />
          </div>
        </div>
      </div>
    </div>
  )
}

// Used by /how-it-works — a static feed paired with an anonymized live receipt.
// The landing's product surface is the interactive ReplayTeaser instead.
export function ModalityPreview() {
  return <ProductSurface showIntro={true} />
}
