"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { AlertCircle, RotateCcw } from "lucide-react"
import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { Container } from "@/components/ui/layout"
import { PageHero, HeroGlow, HERO_TOP } from "@/components/ui/page-hero"
import { CommunityPicker } from "@/components/demo/community-picker"
import { CorpusFeed } from "@/components/demo/corpus-feed"
import { VotePanel } from "@/components/demo/vote-panel"
import { AgentsPanel } from "@/components/demo/agents-panel"
import { ReceiptPanel } from "@/components/demo/receipt-panel"
import { FlowProgress } from "@/components/demo/flow-progress"
import { DemoDisclosure } from "@/components/demo/demo-disclosure"
import { getDemoClient } from "./demo-client"
import { DemoRequestCoordinator } from "./demo-request-coordinator"
import type { DemoRequestContext } from "./demo-request-coordinator"
import { HERO, LABELS, STEP_PANELS } from "./shadow-demo-copy"
import type {
  ShadowDemoAgent,
  ShadowDemoAggregate,
  ShadowDemoCommunity,
  ShadowDemoCommunityId,
  ShadowDemoEpoch,
  ShadowDemoFeed,
  ShadowDemoPublicFeedItem,
  ShadowDemoReceipt,
  ShadowDemoSession,
  ShadowDemoTopicIntent,
  ShadowDemoVote,
  ShadowDemoWeights,
} from "./shadow-demo-contract"

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Math.floor(Math.random() * 1e9)}`
}

function stepIndex(phase: ShadowDemoSession["phase"] | null, hasReceipt: boolean): number {
  switch (phase) {
    case "corpus_ready":
      return 1
    case "reviewer_vote_cast":
      return 2
    case "agent_votes_cast":
      return 3
    case "epoch_transitioned":
    case "reranked":
      // Once a receipt is open the walkthrough is complete — index past the last
      // step so the "Receipt" circle fills in (done) instead of sitting as a
      // hollow ring that reads as unfinished.
      return hasReceipt ? 6 : 4
    default:
      return 0
  }
}

export default function DemoPage() {
  const [session, setSession] = useState<ShadowDemoSession | null>(null)
  const [community, setCommunity] = useState<ShadowDemoCommunity | null>(null)
  const [openEpochId, setOpenEpochId] = useState<string | null>(null)
  const [publishedEpoch, setPublishedEpoch] = useState<ShadowDemoEpoch | null>(null)
  const [baselineFeed, setBaselineFeed] = useState<ShadowDemoFeed | null>(null)
  const [feedAfter, setFeedAfter] = useState<ShadowDemoFeed | null>(null)
  const [agents, setAgents] = useState<readonly ShadowDemoAgent[]>([])
  const [agentVotes, setAgentVotes] = useState<readonly ShadowDemoVote[]>([])
  const [pendingAggregate, setPendingAggregate] = useState<ShadowDemoAggregate | null>(null)
  const [selectedUri, setSelectedUri] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<ShadowDemoReceipt | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestCoordinator = useRef(new DemoRequestCoordinator())

  const client = getDemoClient()
  const reduceMotion = useReducedMotion() ?? false
  const phase = session?.phase ?? null
  const feed = feedAfter ?? baselineFeed
  const reranked = phase === "reranked" || phase === "epoch_transitioned"

  useEffect(() => () => requestCoordinator.current.cancel(), [])

  async function run(action: (request: DemoRequestContext) => Promise<void>): Promise<void> {
    const request = requestCoordinator.current.start()
    setBusy(true)
    setError(null)
    try {
      await action(request)
    } catch (cause) {
      if (request.isCurrent()) {
        setError(cause instanceof Error ? cause.message : "Something went wrong in the demo.")
      }
    } finally {
      if (request.isCurrent()) {
        setBusy(false)
      }
    }
  }

  function clearRoundState(): void {
    setFeedAfter(null)
    setAgents([])
    setAgentVotes([])
    setPendingAggregate(null)
    setSelectedUri(null)
    setReceipt(null)
  }

  function handleStart(communityId: ShadowDemoCommunityId): void {
    void run(async (request) => {
      const { payload } = await client.createSession(
        { communityId, scenarioId: "guided_default", clientNonce: uid(), mode: "guided" },
        request.signal,
      )
      if (!request.isCurrent()) {
        return
      }
      setSession(payload.session)
      setCommunity(payload.community)
      setOpenEpochId(payload.currentEpoch.id)
      setBaselineFeed(payload.feed)
      clearRoundState()
      setPublishedEpoch(null)
    })
  }

  function handleVote(weights: ShadowDemoWeights, topicIntent: ShadowDemoTopicIntent): void {
    if (session === null || openEpochId === null) {
      return
    }
    void run(async (request) => {
      const { payload } = await client.castVote(
        session.id,
        { idempotencyKey: `${session.id}:${openEpochId}:vote`, baseEpochId: openEpochId, voterLabel: LABELS.reviewerVoter, weights, topicIntent },
        request.signal,
      )
      if (!request.isCurrent()) {
        return
      }
      setSession(payload.session)
    })
  }

  function handleRunAgents(): void {
    if (session === null || openEpochId === null) {
      return
    }
    void run(async (request) => {
      const { payload } = await client.runAgents(
        session.id,
        { idempotencyKey: `${session.id}:${openEpochId}:voters`, baseEpochId: openEpochId },
        request.signal,
      )
      if (!request.isCurrent()) {
        return
      }
      setAgents(payload.agents)
      setAgentVotes(payload.agentVotes)
      setPendingAggregate(payload.pendingAggregate)
      setSession(payload.session)
    })
  }

  function handleAdvance(): void {
    if (session === null || openEpochId === null) {
      return
    }
    void run(async (request) => {
      const { payload } = await client.advanceEpoch(
        session.id,
        { idempotencyKey: `${session.id}:${openEpochId}:advance`, fromEpochId: openEpochId },
        request.signal,
      )
      if (!request.isCurrent()) {
        return
      }
      setFeedAfter(payload.feedAfter)
      setPublishedEpoch(payload.currentEpoch)
      setOpenEpochId(payload.currentEpoch.id)
      setSession(payload.session)
      const top = payload.feedAfter.items.find((item): item is ShadowDemoPublicFeedItem => item.visibility === "public")
      if (top) {
        await loadReceipt(session.id, payload.currentEpoch.id, top.post.uri, request)
      }
    })
  }

  async function loadReceipt(
    sessionId: string,
    epochId: string,
    postUri: string,
    request: DemoRequestContext,
  ): Promise<void> {
    setSelectedUri(postUri)
    const { payload } = await client.getReceipt(sessionId, { epochId, postUri }, request.signal)
    if (!request.isCurrent()) {
      return
    }
    setReceipt(payload.receipt)
  }

  function handleSelect(postUri: string): void {
    if (!reranked || session === null || publishedEpoch === null) {
      return
    }
    void run((request) => loadReceipt(session.id, publishedEpoch.id, postUri, request))
  }

  function handleReset(): void {
    requestCoordinator.current.cancel()
    setBusy(false)
    setSession(null)
    setCommunity(null)
    setOpenEpochId(null)
    setPublishedEpoch(null)
    setBaselineFeed(null)
    clearRoundState()
    setError(null)
  }

  function handleAnotherEpoch(): void {
    if (session === null || feedAfter === null || publishedEpoch === null) {
      return
    }
    setSession({ ...session, phase: "corpus_ready" })
    setBaselineFeed(feedAfter)
    clearRoundState()
  }

  const selectedItem =
    feed?.items.find(
      (item): item is ShadowDemoPublicFeedItem => item.visibility === "public" && item.post.uri === selectedUri,
    ) ?? null

  // Which step panel the right column shows — also the AnimatePresence key, so
  // advancing fades one panel out and the next in (agents phase stays one key so
  // running votes doesn't re-trigger the entrance).
  const panelKey =
    phase === "corpus_ready"
      ? "vote"
      : phase === "reviewer_vote_cast" || phase === "agent_votes_cast"
        ? "agents"
        : reranked
          ? "receipt"
          : "none"

  const rightPanel =
    phase === "corpus_ready" ? (
      <VotePanel onSubmit={handleVote} busy={busy} />
    ) : phase === "reviewer_vote_cast" || phase === "agent_votes_cast" ? (
      <AgentsPanel
        agents={agents}
        agentVotes={agentVotes}
        aggregate={pendingAggregate}
        onRun={handleRunAgents}
        onAdvance={handleAdvance}
        busy={busy}
      />
    ) : reranked ? (
      receipt !== null && selectedItem !== null && publishedEpoch !== null && session !== null ? (
        <ReceiptPanel
          receipt={receipt}
          authorDisplayName={selectedItem.post.authorDisplayName}
          postText={selectedItem.post.text}
          onAnotherEpoch={publishedEpoch.sequence < session.maxEpochs ? handleAnotherEpoch : null}
          currentEpoch={publishedEpoch.sequence}
          maxEpochs={session.maxEpochs}
        />
      ) : (
        <div className="rounded-[1.5rem] border border-border bg-card px-5 py-6">
          <h2 className="font-display text-xl font-bold text-foreground">{STEP_PANELS.reorder.heading}</h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground/60">{STEP_PANELS.reorder.body}</p>
        </div>
      )
    ) : null

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <Container as="main" width="stage" className={`relative flex-1 pb-10 ${HERO_TOP}`}>
        <HeroGlow />
        <PageHero size="md" align="left" eyebrow={HERO.eyebrow} title={HERO.title} subtitle={HERO.subtitle} className="relative max-w-3xl" />

        <div className="mt-7 flex flex-col gap-3 border-y border-border/60 py-4">
          <FlowProgress currentIndex={stepIndex(phase, receipt !== null)} />
          {session !== null ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleReset}
                disabled={busy}
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-semibold text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {LABELS.reset}
              </button>
            </div>
          ) : null}
        </div>

        {error !== null ? (
          <div role="alert" className="mt-5 flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="mt-7">
          <AnimatePresence mode="wait" initial={false}>
            {session === null || feed === null || community === null ? (
              <motion.div
                key="picker"
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <CommunityPicker onStart={handleStart} busy={busy} />
              </motion.div>
            ) : (
              <motion.div
                key="workbench"
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.85fr)]"
              >
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-bold text-foreground">{community.name}</h2>
                      <p className="text-xs text-foreground/55">
                        {feed.rankingSource === "live_public_posts_shadow_weights"
                          ? LABELS.corpusFrozen
                          : "Illustrative fallback · frozen for this session"}
                      </p>
                    </div>
                    <p className="text-[11px] font-mono text-foreground/45">
                      {feed.corpusHealth.displayedPublicPostCount} in view · {feed.corpusHealth.displayedHiddenPostCount} withheld ·{" "}
                      {feed.corpusHealth.candidatePostCount.toLocaleString()} candidates /{" "}
                      {feed.corpusHealth.uniqueAuthorCount.toLocaleString()} authors over 72h
                    </p>
                  </div>
                  <CorpusFeed
                    feed={feed}
                    communityName={community.name}
                    epochLabel={publishedEpoch ? `Epoch ${publishedEpoch.sequence}` : "Baseline"}
                    selectedUri={selectedUri}
                    onSelect={handleSelect}
                    showMovement={reranked}
                    selectable={reranked}
                  />
                </div>

                {/* Grid item stretches to the feed's height; the inner wrapper
                    sticks, so the short vote/agents panels follow the scroll
                    instead of stranding a void beside the tall feed. */}
                <div>
                  <div className="xl:sticky xl:top-24">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={panelKey}
                        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      >
                        {rightPanel}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DemoDisclosure />
      </Container>
      <FooterSection />
    </div>
  )
}
