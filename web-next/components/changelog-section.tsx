import Link from "next/link"

const entries = [
  {
    date: "Jun 2025",
    tag: "Feature",
    text: "Epoch comparison view: diff any two epochs side by side to see how weights shifted.",
  },
  {
    date: "May 2025",
    tag: "Improvement",
    text: "Score breakdown is now available on every post in the feed, not just the top 50.",
  },
  {
    date: "Apr 2025",
    tag: "Feature",
    text: "Community feeds can now set a minimum epoch length to prevent vote-rushing.",
  },
  {
    date: "Mar 2025",
    tag: "Fix",
    text: "App-password revocation now propagates within 60 seconds instead of up to 10 minutes.",
  },
]

const tagColors: Record<string, string> = {
  Feature: "text-primary bg-primary/[0.08]",
  Improvement: "text-foreground/60 bg-foreground/[0.06]",
  Fix: "text-[#9B6A2F] bg-[#9B6A2F]/10",
}

export function ChangelogSection() {
  return (
    <section className="w-full px-5 py-14 md:py-20 flex flex-col items-center gap-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between w-full max-w-3xl gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-foreground font-display text-2xl md:text-3xl font-bold leading-tight tracking-tight">
            What&apos;s new
          </h2>
          <p className="text-foreground/45 text-sm font-normal">
            We ship often. Here&apos;s what&apos;s changed recently.
          </p>
        </div>
        <Link
          href="https://github.com/andrewnordstrom-eng/bluesky-community-feed/commits/main"
          className="text-primary text-sm font-medium hover:underline underline-offset-2 flex-shrink-0"
        >
          Full changelog &rarr;
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
