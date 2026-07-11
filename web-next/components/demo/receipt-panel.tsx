"use client"

import Link from "next/link"
import { ArrowDown, ArrowRight, ArrowUp, ExternalLink, Minus, RotateCcw } from "lucide-react"
import type { ShadowDemoCounterfactual, ShadowDemoReceipt } from "@/app/demo/shadow-demo-view-model"
import { SIGNAL_COLORS, formatPercent, formatScore } from "@/app/demo/shadow-demo-fixtures"
import { DISCLOSURE } from "@/app/demo/shadow-demo-copy"
import { formatReceiptPercent, formatReceiptScore, tryBuildReceiptDisplayMathWithServerTotal } from "@/lib/receipt-display-math"

function DeltaChip({ delta }: { readonly delta: number | null }) {
  if (delta === null || delta === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-foreground/50">
        <Minus className="h-3 w-3" aria-hidden="true" />
        same
      </span>
    )
  }
  // delta = counterfactual rank − visible rank. Positive ⇒ lower there (current is better).
  const lower = delta > 0
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        lower ? "bg-success-bg text-success" : "bg-destructive/10 text-destructive"
      }`}
    >
      {lower ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUp className="h-3 w-3" aria-hidden="true" />}
      {Math.abs(delta)} {lower ? "lower" : "higher"}
    </span>
  )
}

function CounterfactualRow({ item }: { readonly item: ShadowDemoCounterfactual }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground/75">{item.label}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-foreground/55">{item.description}</span>
      </span>
      <span className="flex flex-shrink-0 items-center gap-2">
        <span className="font-mono text-sm font-semibold text-foreground">{item.rank === null ? "—" : `#${item.rank}`}</span>
        <DeltaChip delta={item.deltaFromVisibleRank} />
      </span>
    </div>
  )
}

export function ReceiptPanel({
  receipt,
  authorDisplayName,
  postText,
  bskyUrl,
  onAnotherEpoch,
  onRestart,
  currentEpoch,
  guidedEpochs,
  maxEpochs,
  freePlayEnabled,
}: {
  readonly receipt: ShadowDemoReceipt
  readonly authorDisplayName: string
  readonly postText: string
  readonly bskyUrl: string
  readonly onAnotherEpoch: (() => void) | null
  readonly onRestart: () => void
  readonly currentEpoch: number
  readonly guidedEpochs: number
  readonly maxEpochs: number
  readonly freePlayEnabled: boolean
}) {
  const topTopics = receipt.topicBreakdown.slice(0, 3)
  const displayMath = tryBuildReceiptDisplayMathWithServerTotal(receipt.components, receipt.totalScore)
  const formula = receipt.topicRelevanceFormula

  return (
    <aside className="flex h-full flex-col rounded-[1.5rem] border border-primary/20 bg-card shadow-[0_18px_50px_rgba(46,38,32,0.08)]">
      <div className="border-b border-border/70 px-5 py-4">
        <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-primary/65">Shadow demo receipt</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-2xl font-bold leading-tight text-foreground">Why ranked #{receipt.visibleRank}</h3>
            <p className="mt-1 text-sm leading-relaxed text-foreground/60">
              <span className="font-semibold text-foreground/75">{authorDisplayName}</span> — {postText}
            </p>
          </div>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 font-mono text-xs font-semibold text-primary">
            {displayMath ? formatReceiptScore(displayMath.serverTotalScore) : "Score unavailable"}
          </span>
        </div>
        {receipt.previousRank !== null ? (
          <p className="mt-3 inline-flex rounded-full border border-border bg-biscuit/45 px-3 py-1 text-xs font-semibold text-foreground/60">
            {receipt.previousRank === receipt.visibleRank
              ? "held its position after the vote"
              : receipt.previousRank > receipt.visibleRank
                ? `up ${receipt.previousRank - receipt.visibleRank} from #${receipt.previousRank} before the vote`
                : `down ${receipt.visibleRank - receipt.previousRank} from #${receipt.previousRank} before the vote`}
          </p>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 py-5">
        <div className="rounded-xl border border-primary/15 bg-primary/[0.055] px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/65">Receipt math</p>
          {displayMath ? (
            <>
              <p className="mt-1 text-sm font-semibold text-foreground">Raw signal × community weight = contribution</p>
              <p className="mt-1 text-[11px] text-foreground/55">
                Server receipt total {formatReceiptScore(displayMath.serverTotalScore)} · displayed component sum {formatReceiptScore(displayMath.totalScore)}
              </p>
              {displayMath.roundingResidual !== 0 ? (
                <p className="mt-1 text-[11px] text-foreground/55">
                  Display rounding residual {formatReceiptScore(displayMath.roundingResidual)}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-sm leading-relaxed text-foreground/65" role="status">
              Receipt math is unavailable for this post. The rest of the frozen demo remains usable.
            </p>
          )}
        </div>

        {displayMath?.components.map((component) => (
          <div
            key={component.key}
            className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-border/70 bg-background px-4 py-2.5"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SIGNAL_COLORS[component.key] }} aria-hidden="true" />
              {component.label}
            </p>
            <p className="text-right font-mono text-xs text-foreground/60">
              {formatReceiptScore(component.rawScore)} × {formatReceiptPercent(component.weight)}
              <span className="ml-2 font-bold text-primary">= {formatReceiptScore(component.contribution)}</span>
            </p>
          </div>
        ))}

        {topTopics.length > 0 ? (
          <div className="mt-1">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/50">Topic weighting inputs</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {topTopics.map((topic) => (
                <div key={topic.slug} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-foreground/75">{topic.label}</span>
                  <span className="font-mono text-xs text-foreground/55">
                    {formatScore(topic.postScore)} × {formatPercent(topic.communityWeight)}
                    <span className="ml-2 font-semibold text-primary">= {formatScore(topic.contribution)}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-border/70 pt-3 text-xs leading-relaxed text-foreground/65">
              {formula.formulaApplied && formula.weightedSum !== null && formula.signalSum !== null ? (
                <>
                  <p className="font-mono">
                    weighted sum {formatScore(formula.weightedSum)} ÷ signal sum {formatScore(formula.signalSum)} = normalized relevance {formatScore(formula.baseRelevance)}
                  </p>
                  <p className="mt-1 font-mono">
                    {formatScore(formula.baseRelevance)} × confidence {formatScore(formula.confidenceMultiplier)} = effective relevance {formatScore(formula.effectiveRelevance)}
                  </p>
                </>
              ) : (
                <p className="font-mono">
                  Default topic weight {formatPercent(formula.defaultTopicWeight)} · effective relevance {formatScore(formula.effectiveRelevance)}
                </p>
              )}
              <p className="mt-1">
                Confidence threshold {formatScore(formula.confidenceThreshold)}{formula.usedDefaultWeight ? " · a default topic weight was used" : " · all displayed terms use the returned community policy"}.
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-1 border-t border-border/70 pt-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/50">Receipt provenance</p>
          <dl className="mt-2 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-foreground/50">AT URI</dt>
              <dd className="mt-0.5 break-all font-mono text-foreground/75">{receipt.postUri}</dd>
            </div>
            <div>
              <dt className="text-foreground/50">Corpus ID</dt>
              <dd className="mt-0.5 break-all font-mono text-foreground/75">{receipt.provenance.corpusId}</dd>
            </div>
            <div>
              <dt className="text-foreground/50">Production epoch</dt>
              <dd className="mt-0.5 font-mono text-foreground/75">{receipt.provenance.productionEpochId}</dd>
            </div>
            <div>
              <dt className="text-foreground/50">Shadow epoch</dt>
              <dd className="mt-0.5 break-all font-mono text-foreground/75">{receipt.provenance.shadowEpochId}</dd>
            </div>
            <div>
              <dt className="text-foreground/50">Snapshot sampled</dt>
              <dd className="mt-0.5 font-mono text-foreground/75">{new Date(receipt.provenance.sampledAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-foreground/50">Scored</dt>
              <dd className="mt-0.5 font-mono text-foreground/75">{new Date(receipt.scoredAt).toLocaleString()}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-foreground/65">
            Your direct ballot is {formatPercent(receipt.reviewerBallotShare)} of the 25-ballot aggregate. This is ballot share, not causal influence, because scripted ballots respond partly to the proposal.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-foreground/65">
            Included for {receipt.provenance.postInclusionReasons.matchedTopics.map((item) => `${item.topic} ${formatScore(item.score)}`).join(", ") || "the Open Science policy"}
            {receipt.provenance.postInclusionReasons.matchedTerms.length > 0
              ? `; matched terms: ${receipt.provenance.postInclusionReasons.matchedTerms.join(", ")}.`
              : "."}
          </p>
        </div>

        <div className="mt-1">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/45">Counterfactuals</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {receipt.counterfactuals.map((item) => (
              <CounterfactualRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border/70 px-5 py-4">
        {onAnotherEpoch !== null ? (
          <button
            type="button"
            onClick={onAnotherEpoch}
            className="mb-3 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {currentEpoch >= guidedEpochs && !freePlayEnabled ? "Continue in free play" : "Run another epoch"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        <p className="mb-2 text-[11px] font-mono text-foreground/50">
          Epoch {currentEpoch} · guided through {guidedEpochs} · {maxEpochs} maximum
        </p>
        <p className="text-xs leading-relaxed text-foreground/55">{DISCLOSURE.annotations}</p>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-border/70 pt-4 text-xs font-semibold">
          <a href={bskyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:text-primary-dark">
            Source post <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <Link href="/docs" className="text-primary hover:text-primary-dark">Methodology</Link>
          <Link href="/how-it-works" className="text-primary hover:text-primary-dark">How it works</Link>
          <button type="button" onClick={onRestart} className="inline-flex items-center gap-1.5 text-primary hover:text-primary-dark">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Another session
          </button>
        </div>
      </div>
    </aside>
  )
}
