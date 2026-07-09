import Link from "next/link"
import { LIVE_METRICS_SNAPSHOT, LIVE_RANK_ONE_EXPLANATION } from "@/lib/live-metrics-snapshot"

const entries = [
  {
    date: "Snapshot",
    tag: "Live",
    text: `${LIVE_METRICS_SNAPSHOT.scoredPosts.toLocaleString("en-US")} scored posts and ${LIVE_METRICS_SNAPSHOT.uniqueAuthors.toLocaleString("en-US")} authors are shown from the production snapshot collected ${LIVE_METRICS_SNAPSHOT.collectedAtLabel}.`,
  },
  {
    date: "Receipt",
    tag: "Proof",
    text: `Rank #${LIVE_RANK_ONE_EXPLANATION.rank} keeps component weights, weighted scores, and counterfactual rank movement while raw identifiers stay redacted.`,
  },
  {
    date: "Epoch",
    tag: "Audit",
    text: `Epoch ${LIVE_METRICS_SNAPSHOT.epochId} weights are visible on the homepage and tied to the same snapshot used by the reviewer demo.`,
  },
  {
    date: "Export",
    tag: "Static",
    text: "The public homepage remains a static-export route, so reviewers see the polished page without adding a new backend dependency.",
  },
]

const tagColors: Record<string, string> = {
  Live: "text-primary bg-primary/[0.08]",
  Proof: "text-foreground/60 bg-foreground/[0.06]",
  Audit: "text-[#9B6A2F] bg-[#9B6A2F]/10",
  Static: "text-foreground/55 bg-muted/70",
}

export function ChangelogSection() {
  return (
    <section className="w-full px-5 py-14 md:py-20 flex flex-col items-center gap-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between w-full max-w-3xl gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-foreground font-display text-2xl md:text-3xl font-bold leading-tight tracking-tight">
            Proof, not promises
          </h2>
          <p className="text-foreground/45 text-sm font-normal">
            The homepage keeps its claims close to receipts reviewers can inspect.
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
            <span className="font-mono text-foreground/45 text-xs pt-0.5 flex-shrink-0 w-[62px]">
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
