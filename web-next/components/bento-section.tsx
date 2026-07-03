// Corgi feature bento — six cards mapping to the three brand pillars
import React from "react"

const BentoCard = ({
  title,
  description,
  children,
  accent = false,
}: {
  title: string
  description: string
  children: React.ReactNode
  accent?: boolean
}) => (
  <div
    className={`overflow-hidden rounded-2xl flex flex-col justify-start items-start relative border ${
      accent
        ? "bg-primary border-primary/30"
        : "bg-card border-border"
    } shadow-[0_2px_12px_rgba(46,38,32,0.07)]`}
  >
    <div className="self-stretch p-6 pb-4 flex flex-col justify-start items-start gap-1.5 relative z-10">
      <p className={`self-stretch text-base font-semibold leading-6 ${accent ? "text-primary-foreground" : "text-foreground"}`}>
        {title}
      </p>
      <p className={`self-stretch text-sm font-normal leading-5 ${accent ? "text-primary-foreground/75" : "text-foreground/60"}`}>
        {description}
      </p>
    </div>
    <div className="self-stretch flex-1 relative z-10 min-h-[220px]">
      {children}
    </div>
  </div>
)

// Inline mini-illustrations for each bento card
function VoteWeightsIllustration() {
  const items = [
    { label: "Recency", pct: 35 },
    { label: "Replies", pct: 25 },
    { label: "Follows", pct: 20 },
    { label: "Quality", pct: 15 },
    { label: "Novelty", pct: 5 },
  ]
  return (
    <div className="px-6 pb-6 flex flex-col gap-2.5 w-full">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="w-16 text-foreground/50 text-xs font-medium flex-shrink-0">{item.label}</span>
          <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-700"
              style={{ width: `${item.pct * 2.5}%` }}
            />
          </div>
          <span className="w-8 text-right text-foreground/40 text-xs font-mono">{item.pct}%</span>
        </div>
      ))}
      <p className="text-foreground/30 text-xs mt-1.5 font-mono">epoch #47 · community vote</p>
    </div>
  )
}

function ScoreBreakdownIllustration() {
  return (
    <div className="px-6 pb-6 flex flex-col gap-2.5 w-full">
      <div className="bg-background rounded-xl border border-border overflow-hidden">
        {/* Total score header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <span className="text-foreground/50 text-xs font-medium">Total score</span>
          <span className="text-foreground font-mono font-bold text-base">2.12</span>
        </div>
        {/* Signals */}
        {[
          { l: "Recency", v: "+0.82", neg: false },
          { l: "Reply depth", v: "+0.61", neg: false },
          { l: "Following author", v: "+0.22", neg: false },
          { l: "Spam risk", v: "−0.04", neg: true },
        ].map((r) => (
          <div key={r.l} className="flex items-center justify-between px-4 py-2 border-b border-border/40 last:border-0">
            <span className="text-foreground/50 text-xs">{r.l}</span>
            <span className={`text-xs font-mono font-medium ${r.neg ? "text-[#C0625C]" : "text-primary"}`}>{r.v}</span>
          </div>
        ))}
      </div>
      <p className="text-foreground/30 text-xs font-mono">every signal stored · open any post</p>
    </div>
  )
}

function EpochHistoryIllustration() {
  const epochs = [44, 45, 46, 47]
  return (
    <div className="px-6 pb-6 flex flex-col gap-0 w-full">
      <div className="bg-background rounded-xl border border-border overflow-hidden">
        {epochs.map((ep, i) => (
          <div
            key={ep}
            className={`flex items-center justify-between px-4 py-2.5 ${i < epochs.length - 1 ? "border-b border-border/40" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-foreground/70 text-xs font-mono">Epoch #{ep}</span>
              {ep === 47 && (
                <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  current
                </span>
              )}
            </div>
            <span className="text-foreground/40 text-xs font-mono">{200 + ep * 3} voters</span>
          </div>
        ))}
      </div>
      <p className="text-foreground/30 text-xs mt-2.5 font-mono">auditable forever</p>
    </div>
  )
}

function CommunityVoteIllustration({ accent }: { accent?: boolean }) {
  const options = [
    { option: "Boost replies from followed accounts", votes: 78 },
    { option: "Penalise repost-heavy posts", votes: 61 },
    { option: "Increase recency weight", votes: 45 },
  ]
  const max = options[0].votes
  const bg = accent ? "bg-primary-foreground/10 border-primary-foreground/20" : "bg-muted/60 border-border"
  const textMain = accent ? "text-primary-foreground/90" : "text-foreground/70"
  const textMuted = accent ? "text-primary-foreground/50" : "text-foreground/40"
  const barBg = accent ? "bg-primary-foreground/15" : "bg-border"
  const barFill = accent ? "bg-primary-foreground/60" : "bg-primary"

  return (
    <div className="px-6 pb-6 flex flex-col gap-2.5 w-full">
      {options.map((opt) => (
        <div key={opt.option} className={`rounded-lg border px-3.5 py-3 flex flex-col gap-2 ${bg}`}>
          <p className={`text-xs leading-tight font-medium ${textMain}`}>{opt.option}</p>
          <div className="flex items-center gap-2">
            <div className={`flex-1 h-1 rounded-full overflow-hidden ${barBg}`}>
              <div
                className={`h-full rounded-full ${barFill}`}
                style={{ width: `${(opt.votes / max) * 100}%` }}
              />
            </div>
            <span className={`text-[10px] font-mono font-semibold w-8 text-right flex-shrink-0 ${textMuted}`}>{opt.votes}</span>
          </div>
        </div>
      ))}
      <p className={`text-xs mt-0.5 font-mono ${accent ? "text-primary-foreground/30" : "text-foreground/30"}`}>
        members vote · feed reranks each epoch
      </p>
    </div>
  )
}

function AppPasswordIllustration() {
  const items = [
    {
      label: "App-password only",
      icon: (
        <path d="M6 1a3 3 0 0 0-3 3v1H2a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H9V4a3 3 0 0 0-3-3Zm0 1a2 2 0 0 1 2 2v1H4V4a2 2 0 0 1 2-2Z" fill="hsl(var(--primary))" />
      ),
    },
    {
      label: "Revoke anytime, one click",
      icon: (
        <>
          <circle cx="6" cy="6" r="4" stroke="hsl(var(--primary))" strokeWidth="1.5" />
          <path d="M4 6l1.5 1.5L8 4" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ),
    },
    {
      label: "No main password, ever",
      icon: (
        <path d="M6 1L1 4v4l5 3 5-3V4L6 1Z" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinejoin="round" />
      ),
    },
  ]
  return (
    <div className="px-6 pb-6 flex flex-col gap-2 w-full">
      <div className="bg-background rounded-xl border border-border overflow-hidden">
        {items.map((item, i) => (
          <div
            key={item.label}
            className={`flex items-center gap-3 px-4 py-3 ${i < items.length - 1 ? "border-b border-border/40" : ""}`}
          >
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">{item.icon}</svg>
            </div>
            <span className="text-foreground/70 text-xs font-medium">{item.label}</span>
          </div>
        ))}
      </div>
      <p className="text-foreground/30 text-xs mt-0.5 font-mono">trustworthy by construction</p>
    </div>
  )
}

function ExportIllustration() {
  return (
    <div className="px-6 pb-6 flex flex-col gap-2.5 w-full">
      <div className="bg-background rounded-xl border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-muted/40">
          <span className="w-2.5 h-2.5 rounded-full bg-[#FF6058]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28CA41]" />
          <span className="text-foreground/40 text-[10px] font-mono ml-2">export.json</span>
        </div>
        <div className="px-4 py-3 font-mono text-xs text-foreground/60 space-y-0.5">
          <div><span className="text-primary/60">{"{"}</span></div>
          <div className="pl-3"><span className="text-foreground/40">&quot;post_uri&quot;:</span> <span className="text-foreground/55">&quot;at://...&quot;</span>,</div>
          <div className="pl-3"><span className="text-foreground/40">&quot;score&quot;:</span> <span className="text-primary font-semibold">2.12</span>,</div>
          <div className="pl-3"><span className="text-foreground/40">&quot;epoch&quot;:</span> <span className="text-foreground/55">47</span>,</div>
          <div className="pl-3"><span className="text-foreground/40">&quot;signals&quot;:</span> <span className="text-foreground/55">[...]</span></div>
          <div><span className="text-primary/60">{"}"}</span></div>
        </div>
      </div>
      <p className="text-foreground/30 text-xs font-mono">research-grade · consent-aware · yours</p>
    </div>
  )
}

export function BentoSection() {
  const cards = [
    {
      title: "Vote on the weights.",
      description: "Your community decides what the feed cares about: recency, replies, who you follow, quality.",
      Component: VoteWeightsIllustration,
    },
    {
      title: "Every post shows its work.",
      description: "Tap any post to see its full score broken down signal by signal. Nothing is hidden.",
      Component: ScoreBreakdownIllustration,
    },
    {
      title: "A full history you can audit.",
      description: "Every set of weights is saved per epoch. You can look back, compare, and propose changes.",
      Component: EpochHistoryIllustration,
    },
    {
      title: "One community, one algorithm.",
      description: "Members vote on the rules. The feed reranks. No back-room decisions.",
      Component: CommunityVoteIllustration,
      accent: true,
    },
    {
      title: "Secure by default.",
      description: "Corgi only ever uses an app-password. Your main Bluesky password stays yours. Revoke access whenever you like.",
      Component: AppPasswordIllustration,
    },
    {
      title: "Export your data.",
      description: "Download your feed data in structured JSON, ready for analysis. Consent-aware and yours to keep.",
      Component: ExportIllustration,
    },
  ]

  return (
    <section id="features-section" className="w-full px-5 flex flex-col justify-center items-center overflow-visible bg-transparent">
      <div className="w-full py-14 md:py-20 relative flex flex-col justify-start items-start gap-6">
        {/* Subtle warm glow */}
        <div className="w-[547px] h-[600px] absolute top-[400px] left-[80px] origin-top-left rotate-[-33deg] bg-primary/5 blur-[130px] z-0 pointer-events-none" />

        <div className="self-stretch pb-8 md:pb-12 flex flex-col justify-center items-center gap-2 z-10">
          <div className="flex flex-col justify-start items-center gap-4">
            <h2 className="w-full max-w-[480px] text-center text-foreground font-display text-4xl md:text-[2.75rem] font-bold leading-tight tracking-normal text-balance">
              The feed your community actually chose.
            </h2>
            <p className="w-full max-w-[460px] text-center text-foreground/55 text-base font-normal leading-relaxed">
              No hidden weights, no engagement traps. Your community votes, the feed reflects it — and everyone can see exactly why.
            </p>
          </div>
        </div>

        <div className="self-stretch grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 z-10">
          {cards.map((card) => (
            <BentoCard
              key={card.title}
              title={card.title}
              description={card.description}
              accent={card.accent}
            >
              <card.Component accent={card.accent} />
            </BentoCard>
          ))}
        </div>
      </div>
    </section>
  )
}
