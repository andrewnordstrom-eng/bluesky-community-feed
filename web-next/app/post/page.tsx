"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import axios from "axios"
import { AppShell } from "@/components/app-shell"
import { Container } from "@/components/ui/layout"
import { ScoreBreakdown, type ScoreComponent } from "@/components/ui/score-breakdown"
import { ScoreRadar, type RadarSignal } from "@/components/ui/score-radar"
import { PolicyBar, PolicyLegend } from "@/components/ui/policy-bar"
import { Skeleton, EmptyState, ErrorCard } from "@/components/ui/state-kit"
import { Button } from "@/components/ui/button"
import { transparencyApi } from "@/lib/api/client"
import { parseBlueskyUrlOrAtUri } from "@/lib/post-uri"
import { hasCompleteScoreComponents } from "@/lib/post-explanation"
import { SIGNAL_KEYS } from "@/lib/signals"

/* ─── Signal metadata ──────────────────────────────────── */

const SIGNAL_META: Record<string, { label: string; description: string }> = {
  recency:          { label: "Recency",          description: "How recently the post was published" },
  engagement:       { label: "Engagement",        description: "Likes, reposts, and replies weighted by author diversity" },
  bridging:         { label: "Bridging",          description: "Posts that connect different communities" },
  source_diversity: { label: "Source diversity",  description: "Variety of authors surfaced in recent feed" },
  relevance:        { label: "Relevance",         description: "Topic match against community preferences" },
}

type PageState = "loading" | "loaded" | "error" | "missing-uri" | "null-explanation"

/* ─── Helpers ──────────────────────────────────────────── */

function formatUri(uri: string): string {
  try { return decodeURIComponent(uri) } catch { return uri }
}

function truncateUri(uri: string, max = 52): string {
  const decoded = formatUri(uri)
  return decoded.length > max ? decoded.slice(0, max) + "…" : decoded
}

function blueskyUrl(uri: string): string | null {
  try {
    const decoded = decodeURIComponent(uri)
    const match = decoded.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/)
    if (!match) return null
    return `https://bsky.app/profile/${match[1]}/post/${match[2]}`
  } catch { return null }
}

function fmtScore(n: number): string {
  return n.toFixed(3)
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(0) + "%"
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return "just now"
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/* ─── Sub-components ───────────────────────────────────── */

function SectionCard({
  title,
  annotation,
  children,
  className = "",
}: {
  title: string
  annotation?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-border bg-card overflow-hidden ${className}`}>
      <div className="flex items-baseline justify-between gap-4 px-6 py-4 border-b border-border/60">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {annotation && (
          <span className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest">{annotation}</span>
        )}
      </div>
      <div className="p-6">{children}</div>
    </section>
  )
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <div className="flex flex-col items-center justify-center w-20 h-20 rounded-2xl border-2 border-primary/30 bg-primary/8 flex-shrink-0">
      <span className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest leading-none mb-1">Rank</span>
      <span className="text-4xl font-mono font-bold text-primary leading-none tabular-nums">#{rank}</span>
    </div>
  )
}

function ScorePill({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest">{label}</span>
      <span className={`text-2xl font-bold text-foreground leading-none tabular-nums ${mono ? "font-mono" : "font-sans"}`}>
        {value}
      </span>
    </div>
  )
}

function CounterfactualBox({
  label,
  rank,
  delta,
  variant,
}: {
  label: string
  rank: number
  delta?: number
  variant: "engagement" | "governed" | "delta"
}) {
  const isGoverned = variant === "governed"
  const isDelta = variant === "delta"

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-5 flex-1
        ${isGoverned
          ? "border-primary/30 bg-primary/5"
          : isDelta
            ? delta && delta > 0
              ? "border-success/30 bg-success/5"
              : "border-tongue/30 bg-tongue/5"
            : "border-border bg-card"
        }`}
    >
      <span className="text-[10px] font-mono text-foreground/55 uppercase tracking-widest leading-tight">{label}</span>

      {isDelta ? (
        <div className="flex items-end gap-2">
          {/* Arrow icon */}
          {delta !== undefined && delta !== 0 && (
            <span className={`flex-shrink-0 ${delta > 0 ? "text-success" : "text-tongue"}`} aria-hidden="true">
              {delta > 0 ? (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 15V5M10 5l-4 4M10 5l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 5v10M10 15l-4-4M10 15l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
          )}
          <span className={`text-3xl font-mono font-bold tabular-nums leading-none
            ${delta && delta > 0 ? "text-success" : delta && delta < 0 ? "text-tongue" : "text-foreground/50"}`}>
            {delta !== undefined && delta !== 0 ? (delta > 0 ? `+${delta}` : delta) : "—"}
          </span>
          {delta !== undefined && delta !== 0 && (
            <span className="text-xs text-foreground/50 mb-0.5">positions</span>
          )}
        </div>
      ) : (
        <span className={`text-3xl font-mono font-bold tabular-nums leading-none
          ${isGoverned ? "text-primary" : "text-foreground"}`}>
          #{rank}
        </span>
      )}

      {!isDelta && (
        <p className="text-xs text-foreground/50 leading-relaxed">
          {isGoverned
            ? "With community governance applied"
            : "With engagement signals only"}
        </p>
      )}
    </div>
  )
}

function TopicRow({
  slug,
  postScore,
  communityWeight,
  contribution,
}: {
  slug: string
  postScore: number
  communityWeight: number
  contribution: number
}) {
  const sentiment = postScore >= 0.6 ? "boost" : postScore <= 0.3 ? "penalize" : "neutral"
  const sentimentStyles = {
    boost:    { chip: "bg-success/10 border-success/25 text-success",    dot: "bg-success" },
    neutral:  { chip: "bg-biscuit border-border text-foreground/55",      dot: "bg-foreground/30" },
    penalize: { chip: "bg-tongue/15 border-tongue/25 text-tongue-foreground", dot: "bg-tongue" },
  }[sentiment]

  const name = slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")

  return (
    <div className="flex items-center gap-4 py-3 border-b border-border/50 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-medium text-foreground">{name}</span>
          <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full border ${sentimentStyles.chip}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${sentimentStyles.dot}`} aria-hidden="true" />
            {sentiment}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono text-foreground/55">
          <span>Post score <span className="text-foreground/70">{fmtPct(postScore)}</span></span>
          <span>Community weight <span className="text-foreground/70">{fmtPct(communityWeight)}</span></span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <span className="text-xs text-foreground/50 font-mono">contribution</span>
        <span className={`text-sm font-mono font-semibold tabular-nums ${sentiment === "penalize" ? "text-tongue-foreground" : "text-foreground"}`}>
          +{contribution.toFixed(3)}
        </span>
      </div>
    </div>
  )
}

/* ─── Loading skeleton ─────────────────────────────────── */

function PostExplanationSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading post explanation">
      {/* Hero */}
      <div className="rounded-xl border border-border bg-card p-6 flex items-center gap-6">
        <Skeleton className="w-20 h-20 rounded-2xl" />
        <div className="flex flex-col gap-2 flex-1">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-64" />
        </div>
      </div>
      {/* Score breakdown */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border/60">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="p-6 flex flex-col gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-2 flex-1 rounded-full" />
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
      </div>
      {/* Counterfactuals */}
      <div className="flex gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 flex-1 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

/* ─── Page ─────────────────────────────────────────────── */

function PostExplanationInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const uri = searchParams.get("uri") ?? ""
  const [copied, setCopied] = useState(false)
  const [inputUri, setInputUri] = useState("")
  const [inputError, setInputError] = useState<string | null>(null)
  const explain = () => {
    try {
      const normalized = parseBlueskyUrlOrAtUri(inputUri)
      setInputError(null)
      router.push(`/post?uri=${encodeURIComponent(normalized)}`)
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "That post reference is not supported.")
    }
  }

  // Real explanation fetch. Disabled until a URI is present. A 404 from the
  // backend means the post has no score in the active round (or there is no
  // active round) — a legitimate "couldn't explain" state, distinct from a
  // transport/server failure which surfaces as the retryable error card.
  const postQuery = useQuery({
    queryKey: ["post-explain", uri],
    queryFn: () => transparencyApi.getPostExplanation(uri),
    enabled: uri !== "",
    retry: false,
  })

  const explanation = postQuery.data
  const hasCompleteComponents = explanation
    ? hasCompleteScoreComponents(explanation.components)
    : false

  const derivedState: PageState = !uri
    ? "missing-uri"
    : postQuery.isLoading
      ? "loading"
      : postQuery.isError
        ? axios.isAxiosError(postQuery.error) && postQuery.error.response?.status === 404
          ? "null-explanation"
          : "error"
        : explanation
          ? hasCompleteComponents ? "loaded" : "error"
          : "loading"

  // Dev-only override lets the state switcher below preview each chrome; in
  // production the switcher is not rendered, so the override is always null.
  const [devOverride, setDevOverride] = useState<PageState | null>(null)
  const pageState = devOverride ?? derivedState

  const decodedUri = uri ? formatUri(uri) : null
  const bskyUrl = decodedUri ? blueskyUrl(uri) : null

  function copyUri() {
    if (!decodedUri) return
    navigator.clipboard.writeText(decodedUri).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  /* Build component array for ScoreBreakdown (only when loaded) */
  const scoreComponents: ScoreComponent[] = explanation && hasCompleteComponents
    ? SIGNAL_KEYS.map((key) => {
      const c = explanation.components[key]
      return {
        key,
        label: SIGNAL_META[key]?.label ?? key,
        raw_score: c.raw_score,
        weight: c.weight,
        weighted: c.weighted,
      }
    })
    : []

  /* Build radar signals */
  const radarSignals: RadarSignal[] = explanation && hasCompleteComponents
    ? Object.entries(explanation.components).map(([key, c]) => ({
        key,
        label: SIGNAL_META[key]?.label ?? key,
        post: c.raw_score,
        governance:
          explanation.governance_weights[key as keyof typeof explanation.governance_weights] ?? 0,
      }))
    : []

  /* Collect topic breakdown rows from relevance component */
  const topicBreakdown = explanation?.components.relevance?.topicBreakdown ?? {}
  const hasTopics = Object.keys(topicBreakdown).length > 0

  const cf = explanation?.counterfactual

  return (
    <AppShell>
      <Container width="stage" className="py-8 flex flex-col gap-6">

        {/* ── Back nav + URI header ──────────────────────── */}
        <div className="flex flex-col gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-foreground/50 hover:text-primary transition-colors w-fit"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back to overview
          </Link>

          {decodedUri && (
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs font-mono text-foreground/50 bg-biscuit px-3 py-1.5 rounded-lg truncate max-w-xs sm:max-w-md">
                {truncateUri(uri)}
              </code>
              <button
                onClick={copyUri}
                className="flex items-center gap-1.5 text-xs text-foreground/50 hover:text-primary transition-colors"
                aria-label="Copy AT-URI"
              >
                {copied ? (
                  <>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <rect x="4.5" y="4.5" width="7" height="7" rx="1.25" stroke="currentColor" strokeWidth="1.25"/>
                      <path d="M2 9.5V3a1 1 0 0 1 1-1h6.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                    </svg>
                    Copy URI
                  </>
                )}
              </button>
              {bskyUrl && (
                <a
                  href={bskyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-foreground/50 hover:text-primary transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M5 2H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9M8 2h4m0 0v4m0-4L6 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  View on Bluesky
                </a>
              )}
            </div>
          )}
        </div>

        {/* ── State: missing URI — this IS the explain tool ─── */}
        {pageState === "missing-uri" && (
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <h2 className="font-display text-lg font-bold text-foreground">Explain a ranking</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground/60">
              Paste an AT-URI or Bluesky post URL to see how it was scored — which signals lifted it and which held it
              back — whenever Corgi has a receipt for it.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  value={inputUri}
                  onChange={(e) => {
                    setInputUri(e.target.value)
                    setInputError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") explain()
                  }}
                  placeholder="at://did:plc:… or https://bsky.app/profile/did:plc:…"
                  aria-label="Post AT-URI or Bluesky URL"
                  aria-invalid={inputError !== null}
                  aria-describedby={inputError ? "post-reference-error" : undefined}
                  className="h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3.5 font-mono text-sm text-foreground placeholder:text-foreground/55 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {inputError ? (
                  <p id="post-reference-error" role="alert" className="mt-2 text-xs leading-relaxed text-tongue-foreground">
                    {inputError}
                  </p>
                ) : null}
              </div>
              <Button
                disabled={!inputUri.trim()}
                onClick={explain}
                className="h-10 rounded-lg bg-primary px-5 text-sm text-primary-foreground shadow-[0_2px_8px_rgba(200,97,44,0.25)] transition-all hover:bg-primary-dark disabled:opacity-40"
              >
                Explain
              </Button>
            </div>
          </div>
        )}

        {/* ── State: loading ─────────────────────────────── */}
        {pageState === "loading" && <PostExplanationSkeleton />}

        {/* ── State: error ───────────────────────────────── */}
        {pageState === "error" && (
          <ErrorCard
            heading="Could not load explanation"
            body="We were unable to retrieve the score breakdown for this post. It may not have been scored in the current round."
            onRetry={() => { setDevOverride(null); void postQuery.refetch() }}
          />
        )}

        {/* ── State: null explanation ─────────────────────── */}
        {pageState === "null-explanation" && (
          <div className="rounded-xl border border-border bg-card py-16">
            <EmptyState
              heading="This post could not be explained"
              body="The scoring model ran but did not produce a breakdown for this post. This can happen when a post was filtered before scoring or was scored in a different round."
              showCorgi
              action={{ label: "Back to overview", onClick: () => router.push("/dashboard") }}
            />
          </div>
        )}

        {/* ── State: loaded ──────────────────────────────── */}
        {pageState === "loaded" && explanation && cf && (
          <>
            {/* Hero: rank + total score + round */}
            <div className="rounded-xl border border-border bg-card p-6 flex items-center gap-6">
              <RankBadge rank={explanation.rank} />

              <div className="flex flex-wrap gap-x-8 gap-y-3 flex-1">
                <ScorePill label="Total score" value={fmtScore(explanation.total_score)} />
                <ScorePill label="Round" value={`#${explanation.epoch_id}`} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest">Scored</span>
                  <span className="text-sm text-foreground/65 tabular-nums">
                    <span title={new Date(explanation.scored_at).toLocaleString()}>
                      {relTime(explanation.scored_at)}
                    </span>
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest">Round</span>
                  <span className="text-xs text-foreground/55">{explanation.epoch_description}</span>
                </div>
              </div>
            </div>

            {/* Score breakdown + Radar — side by side on lg+ */}
            <div className="flex flex-col lg:flex-row gap-6">

              {/* Score breakdown table */}
              <SectionCard
                title="Score breakdown"
                annotation="raw × weight = contribution"
                className="flex-1 min-w-0"
              >
                <ScoreBreakdown
                  components={scoreComponents}
                  total_score={explanation.total_score}
                  epochLabel={explanation.epoch_description ?? undefined}
                />
                {/* Inline contribution cue per brief opportunity */}
                <p className="text-[11px] text-foreground/50 italic mt-4 leading-relaxed">
                  Each bar shows a signal&apos;s weighted contribution as a share of the total score.
                  Contribution = raw score &times; community weight.
                </p>
              </SectionCard>

              {/* Radar */}
              <SectionCard
                title="Signal radar"
                annotation="post vs governance"
                className="lg:w-[340px] flex-shrink-0"
              >
                <ScoreRadar signals={radarSignals} />
              </SectionCard>
            </div>

            {/* Counterfactuals */}
            <SectionCard title="Counterfactual comparison" annotation="what if the feed were different?">
              <div className="flex flex-col sm:flex-row gap-4">
                <CounterfactualBox
                  label="Engagement-only rank"
                  rank={cf.pure_engagement_rank}
                  variant="engagement"
                />
                <CounterfactualBox
                  label="Community-governed rank"
                  rank={cf.community_governed_rank}
                  variant="governed"
                />
                <CounterfactualBox
                  label="Positions gained"
                  rank={0}
                  delta={cf.difference}
                  variant="delta"
                />
              </div>
              <p className="text-xs text-foreground/55 mt-4 leading-relaxed">
                Community governance moved this post from rank #{cf.pure_engagement_rank} (engagement-only) to #{cf.community_governed_rank} — a difference of {Math.abs(cf.difference)} position{Math.abs(cf.difference) !== 1 ? "s" : ""}.
              </p>
            </SectionCard>

            {/* Topic matches — only if relevance has a topicBreakdown */}
            {hasTopics ? (
              <SectionCard title="Topic matches" annotation="relevance signal breakdown">
                <div className="flex flex-col">
                  {Object.entries(topicBreakdown).map(([slug, t]) => (
                    <TopicRow
                      key={slug}
                      slug={slug}
                      postScore={t.postScore}
                      communityWeight={t.communityWeight}
                      contribution={t.contribution}
                    />
                  ))}
                </div>
                <p className="text-xs text-foreground/50 italic mt-4">
                  Topic scores reflect how strongly this post matches each community-weighted topic.
                </p>
              </SectionCard>
            ) : (
              <SectionCard title="Topic matches" annotation="relevance signal breakdown">
                <EmptyState
                  heading="No topic matches evaluated"
                  body="This post had no matching topics against the current community preferences."
                  showCorgi={false}
                />
              </SectionCard>
            )}

            {/* Governance weights used */}
            <SectionCard title="Governance weights applied" annotation={`Round #${explanation.epoch_id}`}>
              <PolicyBar weights={explanation.governance_weights} height={12} />
              <PolicyLegend weights={explanation.governance_weights} className="mt-3" />
              <p className="text-xs text-foreground/50 italic mt-4 border-t border-border/50 pt-3">
                These are the community-voted weights applied at the time this post was scored.
              </p>
            </SectionCard>

            {/* Post metadata footer */}
            <div className="rounded-xl border border-border/60 bg-biscuit/30 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest">AT-URI</span>
                <code className="text-xs font-mono text-foreground/60 break-all">
                  {explanation.post_uri}
                </code>
              </div>
              <div className="flex flex-col gap-1 flex-shrink-0 sm:text-right">
                <span className="text-[10px] font-mono text-foreground/50 uppercase tracking-widest">Scored at</span>
                <time
                  dateTime={explanation.scored_at}
                  className="text-xs font-mono text-foreground/60"
                  title={new Date(explanation.scored_at).toLocaleString()}
                >
                  {new Date(explanation.scored_at).toLocaleString([], {
                    month: "short", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </time>
              </div>
            </div>

            {/* Dev-only state switcher — excluded from production builds */}
            {process.env.NODE_ENV !== "production" && (
              <div className="flex items-center gap-2 pt-2 opacity-50 hover:opacity-100 transition-opacity" role="group" aria-label="Dev state switcher">
                <span className="text-[10px] text-foreground/50 font-mono uppercase">Dev:</span>
                {(["loaded", "loading", "error", "missing-uri", "null-explanation"] as PageState[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setDevOverride(s)}
                    className={`text-[10px] px-2 py-0.5 rounded border font-mono transition-colors
                      ${pageState === s
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-foreground/50 hover:border-primary/40"
                      }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

      </Container>
    </AppShell>
  )
}

export default function PostExplanationPage() {
  return (
    <Suspense fallback={<PostExplanationSkeleton />}>
      <PostExplanationInner />
    </Suspense>
  )
}
