"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { AlertCircle, FileSearch, ListOrdered, RotateCcw } from "lucide-react"
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
} from "./shadow-demo-view-model"

function uid(): string {
  const secureCrypto: Crypto | undefined = typeof globalThis.crypto === "undefined" ? undefined : globalThis.crypto
  if (secureCrypto === undefined) {
    throw new Error("Secure randomness is unavailable in this browser.")
  }
  if (typeof secureCrypto.randomUUID === "function") {
    return secureCrypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  secureCrypto.getRandomValues(bytes)
  return `id-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`
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
  const [mobileView, setMobileView] = useState<"feed" | "receipt">("feed")
  const [freePlayEnabled, setFreePlayEnabled] = useState(false)
  const [startingNextEpoch, setStartingNextEpoch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestCoordinator = useRef(new DemoRequestCoordinator())
  const panelRef = useRef<HTMLDivElement>(null)

  const client = getDemoClient()
  const reduceMotion = useReducedMotion() ?? false
  const phase = startingNextEpoch ? "corpus_ready" : (session?.phase ?? null)
  const feed = feedAfter ?? baselineFeed
  const reranked = phase === "reranked" || phase === "epoch_transitioned"

  useEffect(() => () => requestCoordinator.current.cancel(), [])

  useEffect(() => {
    const panel = panelRef.current
    if (session === null || panel === null) return

    panel.focus({ preventScroll: true })
    panel.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    })
  }, [phase, reduceMotion, session])

  async function run(
    action: (request: DemoRequestContext) => Promise<void>,
    recoverSessionId: string | null,
  ): Promise<void> {
    const request = requestCoordinator.current.start()
    setBusy(true)
    setError(null)
    try {
      await action(request)
    } catch (cause) {
      if (request.isCurrent()) {
        const failureMessage = cause instanceof Error ? cause.message : "Something went wrong in the demo."
        if (recoverSessionId !== null) {
          try {
            await recoverSession(recoverSessionId, request)
            if (request.isCurrent()) {
              setError(`${failureMessage} Corgi refreshed the authoritative session state before you continue.`)
            }
          } catch {
            if (request.isCurrent()) {
              setError(failureMessage)
            }
          }
        } else {
          setError(failureMessage)
        }
      }
    } finally {
      if (request.isCurrent()) {
        setBusy(false)
      }
    }
  }

  async function recoverSession(sessionId: string, request: DemoRequestContext): Promise<void> {
    const { payload } = await client.getSession(sessionId, request.signal)
    if (!request.isCurrent()) return
    setStartingNextEpoch(false)
    setSession(payload.session)
    setCommunity(payload.community)
    setOpenEpochId(payload.currentEpoch.id)
    if (payload.session.phase === "reranked" || payload.session.phase === "epoch_transitioned") {
      setFeedAfter(payload.feed)
      setPublishedEpoch(payload.currentEpoch)
    } else {
      setBaselineFeed(payload.feed)
    }
  }

  function clearRoundState(): void {
    setFeedAfter(null)
    setAgents([])
    setAgentVotes([])
    setPendingAggregate(null)
    setSelectedUri(null)
    setReceipt(null)
    setMobileView("feed")
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
      setStartingNextEpoch(false)
      clearRoundState()
      setPublishedEpoch(null)
      setFreePlayEnabled(false)
    }, null)
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
      setStartingNextEpoch(false)
    }, session.id)
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
    }, session.id)
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
    }, session.id)
  }

  async function loadReceipt(
    sessionId: string,
    epochId: string,
    postUri: string,
    request: DemoRequestContext,
  ): Promise<void> {
    setSelectedUri(postUri)
    setReceipt(null)
    setMobileView("receipt")
    const { payload } = await client.getReceipt(sessionId, { epochId, postUri }, request.signal)
    if (!request.isCurrent()) {
      return
    }
    if (payload.receipt.postUri !== postUri || payload.receipt.epochId !== epochId) {
      throw new Error("Corgi refused a receipt that did not match the selected post and epoch.")
    }
    setReceipt(payload.receipt)
  }

  function handleSelect(postUri: string): void {
    if (!reranked || session === null || publishedEpoch === null) {
      return
    }
    void run((request) => loadReceipt(session.id, publishedEpoch.id, postUri, request), null)
  }

  function handleReset(): void {
    requestCoordinator.current.cancel()
    setBusy(false)
    setSession(null)
    setCommunity(null)
    setOpenEpochId(null)
    setPublishedEpoch(null)
    setBaselineFeed(null)
    setStartingNextEpoch(false)
    setFreePlayEnabled(false)
    clearRoundState()
    setError(null)
  }

  function handleAnotherEpoch(): void {
    if (session === null || feedAfter === null || publishedEpoch === null) {
      return
    }
    setStartingNextEpoch(true)
    if (publishedEpoch.sequence >= session.guidedEpochs) {
      setFreePlayEnabled(true)
    }
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
          bskyUrl={selectedItem.post.bskyUrl}
          onAnotherEpoch={publishedEpoch.sequence < session.maxEpochs ? handleAnotherEpoch : null}
          onRestart={handleReset}
          currentEpoch={publishedEpoch.sequence}
          guidedEpochs={session.guidedEpochs}
          maxEpochs={session.maxEpochs}
          freePlayEnabled={freePlayEnabled}
        />
      ) : (
        <div className="rounded-[1.5rem] border border-border bg-card px-5 py-6">
          <h2 className="font-display text-xl font-bold text-foreground">{STEP_PANELS.reorder.heading}</h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground/60">
            {selectedUri !== null && busy ? "Loading the matching post receipt…" : STEP_PANELS.reorder.body}
          </p>
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

        <p className="sr-only" aria-live="polite">
          {busy ? "Updating the shadow demo." : session === null ? "Choose a community to begin." : `Demo phase: ${phase}.`}
        </p>

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
                {reranked ? (
                  <div className="order-1 grid grid-cols-2 rounded-lg border border-border bg-biscuit/25 p-1 xl:hidden">
                    <button
                      type="button"
                      onClick={() => setMobileView("feed")}
                      aria-pressed={mobileView === "feed"}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${mobileView === "feed" ? "bg-background text-foreground shadow-sm" : "text-foreground/60"}`}
                    >
                      <ListOrdered className="h-4 w-4" aria-hidden="true" />
                      Ranked feed
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileView("receipt")}
                      aria-pressed={mobileView === "receipt"}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${mobileView === "receipt" ? "bg-background text-foreground shadow-sm" : "text-foreground/60"}`}
                    >
                      <FileSearch className="h-4 w-4" aria-hidden="true" />
                      Receipt
                    </button>
                  </div>
                ) : null}

                <div className={`order-2 flex flex-col gap-3 xl:order-1 ${reranked && mobileView === "receipt" ? "hidden xl:flex" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-bold text-foreground">{community.name}</h2>
                      <p className="text-xs text-foreground/55">
                        {feed.rankingSource === "live_public_posts_shadow_weights"
                          ? LABELS.corpusFrozen
                          : LABELS.corpusFallback}
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
                <div className={`order-1 xl:order-2 ${reranked && mobileView === "feed" ? "hidden xl:block" : ""}`}>
                  <div ref={panelRef} tabIndex={-1} className="scroll-mt-20 focus:outline-none xl:sticky xl:top-24">
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
