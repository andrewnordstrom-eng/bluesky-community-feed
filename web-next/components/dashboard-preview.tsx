// Score breakdown card — the "killer feature" UI shown below the hero
export function DashboardPreview() {
  const signals = [
    { label: "Recency", weight: 0.35, value: "+0.82", bar: 82, positive: true },
    { label: "Reply depth", weight: 0.25, value: "+0.61", bar: 61, positive: true },
    { label: "Follows author", weight: 0.20, value: "+0.44", bar: 44, positive: true },
    { label: "Quality score", weight: 0.15, value: "+0.29", bar: 29, positive: true },
    { label: "Spam risk", weight: 0.05, value: "-0.04", bar: 8, positive: false },
  ]

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
              <span className="text-foreground font-semibold text-sm">alicia.bsky.social</span>
              <span className="text-foreground/40 text-xs">· 2h</span>
              <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold font-mono">
                score: 0.57
              </span>
            </div>
            <p className="text-foreground/80 text-sm leading-relaxed">
              The governance model here is genuinely novel. Watching my community vote in real time and see the feed update is unlike anything else on Bluesky.
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
            <span className="text-primary text-lg font-bold font-mono">+0.57</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-foreground/40 text-xs">Epoch #47 · voted by 312 members</span>
            <button className="text-primary text-xs font-medium hover:underline">
              View epoch history &rarr;
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
