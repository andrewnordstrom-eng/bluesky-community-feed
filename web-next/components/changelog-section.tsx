import Link from "next/link"
import { LIVE_METRICS_SNAPSHOT, LIVE_RANK_ONE_EXPLANATION } from "@/lib/live-metrics-snapshot"

const tagColors = {
  Live: "text-primary bg-primary/[0.08]",
  Proof: "text-foreground/60 bg-foreground/[0.06]",
  Audit: "text-[#9B6A2F] bg-[#9B6A2F]/10",
  Static: "text-foreground/55 bg-muted/70",
} as const

type ChangelogTag = keyof typeof tagColors

interface ChangelogEntry {
  readonly date: string
  readonly tag: ChangelogTag
  readonly text: string
}

const entries: readonly ChangelogEntry[] = [
  {
    date: "Snapshot",
    tag: "Live",
    text: `The no-login demo freezes a live-scored comparison corpus, applies isolated shadow governance, and keeps each ranking receipt inspectable.`,
  },
  {
    date: "Receipt",
    tag: "Proof",
    text: `Rank #${LIVE_RANK_ONE_EXPLANATION.rank} keeps component weights, weighted scores, provenance, and counterfactual rank movement in one receipt.`,
  },
  {
    date: "Epoch",
    tag: "Audit",
    text: `Active governance weights are visible on the homepage and tied to the same receipt model used by the live demo.`,
  },
  {
    date: "Export",
    tag: "Static",
    text: "The public homepage remains a static-export route, so the product page stays fast without adding a new backend dependency.",
  },
]

export function ChangelogSection() {
  return (
    <section className="w-full px-5 py-14 md:py-20 flex flex-col items-center gap-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between w-full max-w-3xl gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-foreground font-display text-2xl md:text-3xl font-bold leading-tight tracking-tight">
            Trust lives in the product
          </h2>
          <p className="text-foreground/55 text-sm font-normal">
            The landing stays product-first, with receipt details one click away.
          </p>
        </div>
        <Link
          href="/demo"
          className="text-primary text-sm font-medium hover:underline underline-offset-2 flex-shrink-0"
        >
          Open live demo &rarr;
        </Link>
      </div>

      <div className="w-full max-w-3xl flex flex-col divide-y divide-border/60 rounded-2xl border border-border overflow-hidden bg-card shadow-[0_2px_12px_rgba(46,38,32,0.05)]">
        {entries.map((entry) => (
          <div key={entry.text} className="flex items-start gap-4 px-5 py-4">
            <span className="font-mono text-foreground/55 text-xs pt-0.5 flex-shrink-0 w-[62px]">
              {entry.date}
            </span>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${tagColors[entry.tag]}`}
            >
              {entry.tag}
            </span>
            <p className="text-foreground/80 text-sm font-normal leading-relaxed">
              {entry.text}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
