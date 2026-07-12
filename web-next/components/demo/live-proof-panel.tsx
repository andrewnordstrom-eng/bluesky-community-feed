import { ExternalLink, Radio } from "lucide-react"
import { formatDemoTimestamp } from "@/app/demo/demo-format"
import { LABELS } from "@/app/demo/shadow-demo-copy"
import type {
  ShadowDemoCorpusProvenance,
  ShadowDemoFeed,
  ShadowDemoWarning,
} from "@/app/demo/shadow-demo-view-model"

export const COMMUNITY_GOV_FEED_URL = "https://bsky.app/profile/corgi-network.bsky.social/feed/community-gov"

export function getDegradedCorpusWarning(warnings: readonly ShadowDemoWarning[]): string {
  const warning = warnings.find((candidate) => !candidate.recoverable)
  const safeMessage = warning?.message.trim() ?? ""
  if (safeMessage.length > 0 && safeMessage.length <= 180) {
    return safeMessage
  }
  return "The published-feed snapshot is unavailable, so this session is using a mechanics fixture."
}

export function getReceiptSelectionAnnouncement(rank: number | null, ready: boolean): string {
  const subject = rank === null ? "the selected post" : `rank ${rank}`
  return ready ? `Ranking receipt ready for ${subject}.` : `Receipt view opened for ${subject}. Loading ranking details.`
}

export interface DemoCorpusPresentation {
  readonly usesMechanicsFixture: boolean
  readonly provenanceLine: string
  readonly metricsLine: string
}

export function getDemoCorpusPresentation(feed: ShadowDemoFeed): DemoCorpusPresentation {
  const usesMechanicsFixture = feed.rankingSource === "fixture_posts_shadow_weights" || feed.corpusHealth.status === "fallback"
  const shown = feed.corpusHealth.displayedPublicPostCount.toLocaleString()
  const withheld = feed.corpusHealth.displayedHiddenPostCount.toLocaleString()
  const sourceCount = (feed.corpusHealth.sourcePostCount ?? feed.corpusHealth.candidatePostCount).toLocaleString()
  const eligibleCount = (feed.corpusHealth.eligiblePostCount ?? feed.corpusHealth.publicScoredPostCount).toLocaleString()

  if (usesMechanicsFixture) {
    return {
      usesMechanicsFixture: true,
      provenanceLine: `${LABELS.corpusFallback} · illustrative data`,
      metricsLine: `${shown} shown · ${withheld} withheld · ${sourceCount} fixture items · ${eligibleCount} rankable`,
    }
  }

  const sampledAt = formatDemoTimestamp(feed.corpusProvenance.sampledAt)
  return {
    usesMechanicsFixture: false,
    provenanceLine: `${feed.corpusProvenance.label}${sampledAt ? ` · captured ${sampledAt}` : ""} · frozen for this session`,
    metricsLine: `${shown} shown · ${withheld} withheld · ${sourceCount} published entries · ${eligibleCount} eligible`,
  }
}

export interface LiveProofPresentation {
  readonly eyebrow: string
  readonly feedName: string
  readonly description: string
  readonly sourceTimestamp: string | null
}

export function getLiveProofPresentation(
  provenance: ShadowDemoCorpusProvenance | null,
  usesMechanicsFixture: boolean,
): LiveProofPresentation {
  const snapshot = provenance?.mode === "production_feed_snapshot_session_frozen" ? provenance : null
  const feedName = snapshot?.sourceFeedName ?? "Community Governed Feed"

  if (usesMechanicsFixture) {
    return {
      eyebrow: "Separate live proof on Bluesky",
      feedName,
      description: "This demo session is using a mechanics fixture. The public feed keeps updating independently on Bluesky.",
      sourceTimestamp: null,
    }
  }

  const formattedSourceTimestamp = formatDemoTimestamp(snapshot?.sourceUpdatedAt ?? provenance?.sampledAt ?? null)
  return {
    eyebrow: snapshot === null ? "Live feed on Bluesky" : "Snapshot source live on Bluesky",
    feedName,
    description: snapshot === null
      ? "The frozen comparison corpus and the public feed are separate. The public feed keeps updating independently on Bluesky."
      : "The guided demo freezes a published-feed comparison corpus. Its source feed keeps updating independently on Bluesky.",
    sourceTimestamp: formattedSourceTimestamp,
  }
}

export function LiveProofPanel({
  provenance,
  usesMechanicsFixture,
}: {
  readonly provenance: ShadowDemoCorpusProvenance | null
  readonly usesMechanicsFixture: boolean
}) {
  const presentation = getLiveProofPresentation(provenance, usesMechanicsFixture)
  return (
    <section className="mt-8 border-y border-border/70 py-6" aria-labelledby="live-proof-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/75">
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />{presentation.eyebrow}
          </p>
          <h2 id="live-proof-heading" className="mt-2 font-display text-xl font-bold text-foreground">{presentation.feedName}</h2>
          <p className="mt-1 text-sm text-foreground/60">
            {presentation.description}
            {presentation.sourceTimestamp ? ` Source state captured ${presentation.sourceTimestamp}.` : ""}
          </p>
        </div>
        <a href={COMMUNITY_GOV_FEED_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-11 flex-shrink-0 items-center justify-center gap-2 rounded-full border border-border bg-background px-5 text-sm font-semibold text-foreground transition-colors hover:border-primary/35 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          Open live feed on Bluesky <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}
