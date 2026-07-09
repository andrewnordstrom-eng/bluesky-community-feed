// Score breakdown card — the "killer feature" UI shown below the hero
import Link from "next/link"
import { LIVE_METRICS_SNAPSHOT, LIVE_RANK_ONE_EXPLANATION } from "@/lib/live-metrics-snapshot"

function clampScoreBarPercent(score: number): number {
  if (!Number.isFinite(score)) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round(Math.abs(score) * 100)))
}

export function DashboardPreview() {
  const signals = LIVE_RANK_ONE_EXPLANATION.components.map((component) => ({
    label: component.label,
    weight: component.weight,
    value: `${component.raw_score >= 0 ? "+" : "-"}${Math.abs(component.raw_score).toFixed(2)}`,
    bar: clampScoreBarPercent(component.raw_score),
    positive: component.weighted >= 0,
  }))
  const totalScorePrefix = LIVE_RANK_ONE_EXPLANATION.totalScore >= 0 ? "+" : "-"

  return (
    <div className="w-full max-w-[900px]">
      <div className="bg-card rounded-2xl border border-border shadow-[0_8px_40px_rgba(46,38,32,0.12)] p-4 sm:p-5 md:p-7">
        {/* Post header */}
        <div className="flex items-start gap-3 pb-4 border-b border-border">
          <div className="w-10 h-10 rounded-full bg-muted flex-shrink-0 overflow-hidden">
            <svg viewBox="0 0 40 40" className="w-full h-full">
              <rect width="40" height="40" fill="hsl(var(--muted))" />
              <circle cx="20" cy="16" r="7" fill="hsl(var(--border))" />
              <ellipse cx="20" cy="36" rx="13" ry="9" fill="hsl(var(--border))" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-foreground font-semibold text-sm">{LIVE_RANK_ONE_EXPLANATION.authorLabel}</span>
              <span className="text-foreground/40 text-xs">· anonymized live receipt</span>
              <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold font-mono">
                score: {LIVE_RANK_ONE_EXPLANATION.totalScore.toFixed(2)}
              </span>
            </div>
            <p className="text-foreground/80 text-sm leading-relaxed">
              {LIVE_RANK_ONE_EXPLANATION.text}
            </p>
          </div>
        </div>

        {/* Score breakdown */}
        <div className="pt-4">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h3 className="text-foreground text-sm font-semibold">Score breakdown</h3>
            <span className="text-foreground/40 text-xs font-mono hidden sm:block">weighted by community vote</span>
          </div>
          <div className="flex flex-col gap-3">
            {signals.map((sig) => (
              <div key={sig.label} className="flex items-center gap-2 sm:gap-3">
                <span className="w-24 sm:w-28 text-foreground/60 text-xs font-medium flex-shrink-0">{sig.label}</span>
                <div className="flex-1 min-w-0 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${sig.bar}%`,
                      backgroundColor: sig.positive ? "hsl(var(--primary))" : "#E08A8A",
                    }}
                  />
                </div>
                <span
                  className={`w-12 sm:w-14 text-right text-xs font-mono font-medium flex-shrink-0 ${sig.positive ? "text-primary" : "text-[#C0625C]"}`}
                >
                  {sig.value}
                </span>
                <span className="hidden sm:block w-12 text-right text-foreground/45 text-xs font-mono flex-shrink-0">
                  ×{sig.weight.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          {/* Total — anchors the right side and ties the math together */}
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-foreground text-sm font-semibold">Total score</span>
            <span className="text-primary text-lg font-bold font-mono">
              {totalScorePrefix}{Math.abs(LIVE_RANK_ONE_EXPLANATION.totalScore).toFixed(2)}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-foreground/40 text-xs">Epoch #{LIVE_METRICS_SNAPSHOT.epochId} · refreshed {LIVE_METRICS_SNAPSHOT.collectedAtLabel}</span>
            <Link href="/history" className="text-primary text-xs font-medium hover:underline">
              View epoch history &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
