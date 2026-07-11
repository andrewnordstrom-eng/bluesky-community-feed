"use client"

import { ArrowRight, Bot, Users } from "lucide-react"
import {
  SHADOW_DEMO_SIGNAL_KEYS,
  type ShadowDemoAgent,
  type ShadowDemoAggregate,
  type ShadowDemoVote,
  type ShadowDemoWeights,
} from "@/app/demo/shadow-demo-view-model"
import { SIGNAL_COLORS, SIGNAL_LABELS, formatPercent, normalizeWeights } from "@/app/demo/shadow-demo-fixtures"
import { STEP_PANELS } from "@/app/demo/shadow-demo-copy"
import { TopicPolicy } from "./topic-policy"
import { WeightBars } from "./weight-bars"

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"

function topSignal(weights: ShadowDemoWeights): (typeof SHADOW_DEMO_SIGNAL_KEYS)[number] {
  return SHADOW_DEMO_SIGNAL_KEYS.reduce((best, key) => (weights[key] > weights[best] ? key : best), SHADOW_DEMO_SIGNAL_KEYS[0])
}

function averageWeights(votes: readonly ShadowDemoVote[], fallback: ShadowDemoWeights): ShadowDemoWeights {
  if (votes.length === 0) return fallback
  const sum = Object.fromEntries(SHADOW_DEMO_SIGNAL_KEYS.map((key) => [key, 0])) as Record<(typeof SHADOW_DEMO_SIGNAL_KEYS)[number], number>
  for (const vote of votes) {
    for (const key of SHADOW_DEMO_SIGNAL_KEYS) sum[key] += vote.weights[key]
  }
  return normalizeWeights(Object.fromEntries(SHADOW_DEMO_SIGNAL_KEYS.map((key) => [key, sum[key] / votes.length])) as ShadowDemoWeights)
}

function AgentVoteCard({ agent, votes }: { readonly agent: ShadowDemoAgent; readonly votes: readonly ShadowDemoVote[] }) {
  const weights = averageWeights(votes, agent.baseWeights)
  const key = topSignal(weights)
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
            <Bot className="h-4 w-4 flex-shrink-0 text-primary/70" aria-hidden="true" />
            {agent.name}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/55">
            {agent.voterCount} voters · {agent.voteRationale}
          </p>
        </div>
        <span
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground/65"
          title={`Leans ${SIGNAL_LABELS[key]}`}
        >
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SIGNAL_COLORS[key] }} aria-hidden="true" />
          {SIGNAL_LABELS[key]} {formatPercent(weights[key])}
        </span>
      </div>
    </div>
  )
}

export function AgentsPanel({
  agents,
  agentVotes,
  aggregate,
  onRun,
  onAdvance,
  busy,
}: {
  readonly agents: readonly ShadowDemoAgent[]
  readonly agentVotes: readonly ShadowDemoVote[]
  readonly aggregate: ShadowDemoAggregate | null
  readonly onRun: () => void
  readonly onAdvance: () => void
  readonly busy: boolean
}) {
  const hasVoted = agentVotes.length > 0

  if (!hasVoted) {
    return (
      <div>
        <h2 className="font-display text-2xl font-bold leading-tight text-foreground">{STEP_PANELS.agents.heading}</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/60">{STEP_PANELS.agents.body}</p>
        <div className="mt-4 rounded-2xl border border-border bg-biscuit/25 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Users className="h-4 w-4 text-primary/70" aria-hidden="true" />
            {STEP_PANELS.agents.readyHeading}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/55">
            {STEP_PANELS.agents.readyBody}
          </p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={busy}
          className={`mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_rgba(200,97,44,0.25)] transition-colors hover:bg-primary-dark disabled:opacity-60 ${FOCUS}`}
        >
          {busy ? "Running…" : STEP_PANELS.agents.cta}
        </button>
      </div>
    )
  }

  return (
    <div>
      <h2 className="font-display text-2xl font-bold leading-tight text-foreground">{STEP_PANELS.epoch.heading}</h2>
      <p className="mt-2 text-sm leading-relaxed text-foreground/60">{STEP_PANELS.epoch.body}</p>

      <div className="mt-4 flex flex-col gap-2">
        {agents.map((agent) => {
          const blocVotes = agentVotes.filter((candidate) => candidate.voterId.includes(`-${agent.id}-`))
          return <AgentVoteCard key={agent.id} agent={agent} votes={blocVotes} />
        })}
      </div>

      {aggregate !== null ? <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/[0.05] px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/65">Pending community policy</p>
          <p className="text-[11px] font-medium text-foreground/55">
            {aggregate.voteSummary.totalVotes} ballots · trimmed mean · {aggregate.voteSummary.trimCount} values trimmed from each end per signal
          </p>
        </div>
        <div className="mt-3">
          <WeightBars weights={aggregate.weights} />
        </div>
        <div className="mt-4 border-t border-primary/15 pt-4">
          <TopicPolicy topicIntent={aggregate.topicIntent} label="Aggregated topic priorities" />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-foreground/55">
          Your ballot is 1 of {aggregate.voteSummary.totalVotes}. That describes ballot count, not causal influence: the scripted ballots respond partly to your proposal. All demo ballots stay isolated from production governance.
        </p>
      </div> : null}

      <button
        type="button"
        onClick={onAdvance}
        disabled={busy}
        className={`mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_rgba(200,97,44,0.25)] transition-colors hover:bg-primary-dark disabled:opacity-60 ${FOCUS}`}
      >
        {busy ? "Advancing…" : STEP_PANELS.epoch.cta}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
