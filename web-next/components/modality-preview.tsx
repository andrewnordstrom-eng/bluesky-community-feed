import Link from "next/link"
import { BlueskyOrderedFeed } from "@/components/bluesky-sample-feed"
import { LIVE_METRICS_SNAPSHOT, LIVE_RANK_ONE_EXPLANATION } from "@/lib/live-metrics-snapshot"
import { formatSignedScore } from "@/lib/score"

function CorgiReceiptPanel() {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/35">
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
              <p className="text-xs font-mono text-foreground/45">Anonymized live receipt</p>
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
          <span className="text-xs text-foreground/40">
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

export function ModalityPreview() {
  return (
    <div className="w-full max-w-[1120px]">
      <div className="rounded-3xl border border-border bg-card shadow-[0_8px_40px_rgba(46,38,32,0.12)] overflow-hidden">
        <div className="border-b border-border/60 bg-card px-5 py-4 sm:px-6">
          <p className="text-sm font-semibold text-foreground">
            Bluesky shows the ordered posts. Corgi shows the receipt.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/45">
            Sample posts show the interface shape; the receipt panel uses an anonymized live snapshot.
          </p>
        </div>
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.04fr)_minmax(360px,0.96fr)]">
          <div className="border-b border-border/60 bg-background/55 p-4 sm:p-5 lg:border-b-0 lg:border-r">
            <BlueskyOrderedFeed showIntro={true} showDisclosure={true} />
          </div>
          <div className="bg-card p-4 sm:p-5">
            <CorgiReceiptPanel />
          </div>
        </div>
      </div>
    </div>
  )
}

export function BlueskyProductShowcase() {
  return (
    <section className="w-full max-w-[960px]">
      <div className="mx-auto mb-6 max-w-[700px] px-2 text-center">
        <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/35">
          Example community
        </p>
        <h2 className="font-display text-2xl font-bold leading-tight text-foreground md:text-4xl">
          Birders Who Code
        </h2>
        <p className="mx-auto mt-3 max-w-[620px] text-sm font-medium leading-relaxed text-foreground/55 md:text-base">
          Warblers, bug reports, and deploys that failed silently. Corgi lets this community decide which posts deserve lift while the feed still renders in Bluesky.
        </p>
      </div>

      <div className="rounded-[30px] border border-border bg-card p-3 shadow-[0_18px_60px_rgba(46,38,32,0.14)] sm:p-5">
        <div className="mb-3 grid gap-2 text-left sm:grid-cols-2">
          <div className="rounded-2xl border border-[#D4DBE2] bg-white px-4 py-3 text-[#0B0F14]">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#42576C]">
              Bluesky view
            </p>
            <p className="mt-1 text-sm font-semibold">Posts appear in Corgi-ranked order.</p>
          </div>
          <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary/60">
              Corgi view
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">Scores and receipts explain why.</p>
          </div>
        </div>
        <BlueskyOrderedFeed showIntro={false} showDisclosure={false} />
      </div>

      <p className="mx-auto mt-4 max-w-[680px] px-3 text-center text-xs font-medium leading-relaxed text-foreground/45 md:text-sm">
        Bluesky shows the ordered posts. Corgi shows why. The score rail above is a Corgi annotation for the product demo, not native Bluesky chrome.
      </p>
    </section>
  )
}

export function ModalityComparisonSection() {
  return (
    <section id="ranking-surfaces" className="w-full px-4 py-16 md:px-8 md:py-24 lg:px-12">
      <div className="mx-auto mb-8 flex max-w-[960px] flex-col gap-3 text-center">
        <h2 className="font-display text-3xl font-bold leading-tight text-foreground md:text-5xl">
          Where the ranking lives.
        </h2>
        <p className="mx-auto max-w-[700px] text-base font-medium leading-relaxed text-foreground/55 md:text-lg">
          The feed order appears in Bluesky. The score, weights, receipt, and why-ranked explanation live on Corgi, where people can inspect the mechanism.
        </p>
      </div>
      <div className="flex justify-center">
        <ModalityPreview />
      </div>
    </section>
  )
}
