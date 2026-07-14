"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { AppShell } from "@/components/app-shell"
import { Container } from "@/components/ui/layout"
import { PolicyBar, PolicyLegend } from "@/components/ui/policy-bar"
import { ErrorCard, Skeleton } from "@/components/ui/state-kit"
import { SIGNAL_KEYS, SIGNAL_LABELS } from "@/lib/signals"
import { weightsApi, transparencyApi, type EpochResponse } from "@/lib/api/client"
import { policyApplied, votingState, votingClosedDate } from "@/lib/governance-status"

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—"
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString([], { dateStyle: "medium" })
}

function phaseLabel(epoch: EpochResponse): string {
  if (votingState(epoch) === "open") return "Voting open"
  if (votingState(epoch) === "review") return "Under review"
  // Voting is over; if the policy is still applied, say so.
  return policyApplied(epoch) ? "Active policy" : "Closed"
}

function wasEnacted(epoch: EpochResponse): boolean {
  return epoch.results_approved_at != null
}

/** The signal carrying the most weight in a policy — the round's headline. */
function leadSignal(weights: EpochResponse["weights"]) {
  const key = [...SIGNAL_KEYS].sort((a, b) => weights[b] - weights[a])[0]
  return { label: SIGNAL_LABELS[key], value: weights[key] }
}

export default function ProposalsPage() {
  const currentQuery = useQuery({
    queryKey: ["proposals", "current-epoch"],
    queryFn: weightsApi.getCurrentEpoch,
    retry: false,
  })
  const historyQuery = useQuery({
    queryKey: ["proposals", "epoch-history"],
    queryFn: () => transparencyApi.getEpochHistory(12),
    retry: false,
  })

  const current = currentQuery.data
  const past = (historyQuery.data?.epochs ?? []).filter((epoch) => wasEnacted(epoch) && epoch.id !== current?.id)

  return (
    <AppShell>
      <Container as="main" width="doc" className="flex flex-col gap-8 py-10 md:py-14">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/55">Governance</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">Proposals</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-foreground/60">
            Every governance round proposes a complete policy: five global signal weights, topic priorities, and content
            rules. When the voting window closes, ballots are aggregated for results review. An operator approves or
            rejects the proposal before the active policy is changed and rescored. Enacted proposals are recorded below and in the{" "}
            <Link
              href="/history"
              className="rounded text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              audit log
            </Link>
            .
          </p>
        </div>

        {/* Current round */}
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-sm uppercase tracking-[0.18em] text-foreground/55">Current round</h2>
          {currentQuery.isLoading ? (
            <Skeleton className="h-40 w-full rounded-2xl" />
          ) : currentQuery.isError || !current ? (
            <ErrorCard
              heading="Couldn't load the current round"
              body="The governance endpoint is unavailable right now. Try again in a moment."
              onRetry={() => void currentQuery.refetch()}
            />
          ) : (
            <div className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-5 shadow-[0_2px_12px_rgba(46,38,32,0.05)] sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-display text-xl font-bold text-foreground">Round #{current.id}</h3>
                  <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-xs font-semibold text-primary">
                    {phaseLabel(current)}
                  </span>
                </div>
                {votingState(current) === "open" ? (
                  <Link
                    href="/vote"
                    className="rounded text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    Cast your vote &rarr;
                  </Link>
                ) : null}
              </div>
              <div className="mt-4 flex flex-col gap-4">
                <div>
                  <PolicyBar weights={current.weights} height={12} />
                  <PolicyLegend weights={current.weights} className="mt-3" />
                </div>
                <div className="flex gap-6 border-t border-border/50 pt-3 text-sm">
                  {current.vote_count > 0 ? (
                    <span className="text-foreground/55">
                      <span className="font-mono font-bold text-foreground tabular-nums">{current.vote_count}</span> votes
                    </span>
                  ) : null}
                  {votingState(current) === "open" && current.voting_ends_at ? (
                    <span className="text-foreground/55">
                      Voting ends <span className="font-mono font-semibold text-foreground">{formatDate(current.voting_ends_at)}</span>
                    </span>
                  ) : (
                    <span className="text-foreground/55">
                      Voting closed <span className="font-mono font-semibold text-foreground">{formatDate(votingClosedDate(current))}</span>
                      {policyApplied(current) ? " · this policy ranks the feed today" : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Past proposals */}
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-sm uppercase tracking-[0.18em] text-foreground/55">Enacted proposals</h2>
          {historyQuery.isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          ) : historyQuery.isError ? (
            <ErrorCard
              heading="Couldn't load past proposals"
              body="The governance history endpoint is unavailable right now. Try again in a moment."
              onRetry={() => void historyQuery.refetch()}
            />
          ) : past.length === 0 ? (
            <p className="rounded-2xl border border-border bg-card px-5 py-6 text-sm text-foreground/55">
              No enacted proposals yet. An approved policy will appear here after results review.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {past.map((epoch) => {
                const lead = leadSignal(epoch.weights)
                return (
                  <div key={epoch.id} className="rounded-2xl border border-border bg-card p-5 shadow-[0_2px_10px_rgba(46,38,32,0.05)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-bold text-primary">
                          #{epoch.id}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-foreground">Round #{epoch.id}</p>
                          <p className="text-xs text-foreground/50">
                            Enacted {formatDate(epoch.results_approved_at)} · {epoch.vote_count} votes
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground/60">
                        Led by {lead.label} {pct(lead.value)}
                      </span>
                    </div>
                    <PolicyBar weights={epoch.weights} height={6} className="mt-4" />
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <p className="text-xs leading-relaxed text-foreground/50">
          Today, proposals are expressed as weight votes each round. Standalone proposal authoring and discussion is on
          the roadmap.
        </p>
      </Container>
    </AppShell>
  )
}
