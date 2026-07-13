import type { Metadata } from "next"
import { AppShell } from "@/components/app-shell"
import { LegalLayout, P, UL, LI, Strong, InlineLink } from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "Corgi docs — how the ranking works",
  description:
    "How Corgi scores posts: the five signals, the scoring math, epochs and voting, transparency receipts, and where to find the source and API.",
  alternates: { canonical: "/docs/" },
}

const SECTIONS = [
  {
    id: "overview",
    heading: "Overview",
    body: (
      <>
        <P>
          Corgi Commons is a Bluesky custom feed with inspectable, community-shaped ranking. Corgi ingests candidate
          posts, computes five global signals, applies the approved policy, and serves an ordered feed for Bluesky
          clients to render. Corgi exposes policy metadata and ranking receipts when score provenance is available.
        </P>
        <P>
          This page explains the ranking model. To see it move, use the{" "}
          <InlineLink href="/how-it-works">interactive walkthrough</InlineLink>; to inspect the live feed, use the{" "}
          <InlineLink href="/demo">demo</InlineLink>.
        </P>
      </>
    ),
  },
  {
    id: "signals",
    heading: "The five signals",
    body: (
      <>
        <P>Each post gets a raw score (0–1) on five signals:</P>
        <UL>
          <LI><Strong>Recency</Strong> — how recently the post appeared.</LI>
          <LI><Strong>Engagement</Strong> — an observed, log-scaled combination of public likes, reposts, and replies; it is not predicted engagement.</LI>
          <LI><Strong>Bridging</Strong> — Jaccard distance over engager follower sets, estimating whether a post connects otherwise-separate audiences.</LI>
          <LI><Strong>Source diversity</Strong> — an author-repetition penalty within the ranked batch.</LI>
          <LI><Strong>Relevance</Strong> — a weighted match between the post&rsquo;s sparse topic vector and the approved topic-priority map.</LI>
        </UL>
      </>
    ),
  },
  {
    id: "math",
    heading: "The scoring math",
    body: (
      <>
        <P>
          A post&rsquo;s total score is a weighted sum: <Strong>total = Σ (raw signal score × community weight)</Strong>.
          The raw signal scores describe the post; the five global signal weights sum to 100%. Change
          the weights and the same posts reorder — without pretending the posts themselves changed.
        </P>
        <P>
          The feed is re-scored on a short interval, so new posts and fresh engagement flow in continuously under the
          active weights.
        </P>
      </>
    ),
  },
  {
    id: "topics-rules",
    heading: "Topic preferences and content rules",
    body: (
      <>
        <P>
          Topic preferences are separate from the five global signal weights. Posts receive a sparse vector from a
          curated topic catalog during ingestion. The topic-priority map affects only the <Strong>relevance</Strong>
          signal; it does not add another top-level scoring term.
        </P>
        <P>
          Content rules determine eligibility. Adopted include keywords act as an allowlist, adopted excludes take
          precedence, and a keyword needs at least 30% support among ballots that submit content rules. Publication-time
          adjustments such as duplicate-link handling can also change final order after component scoring.
        </P>
      </>
    ),
  },
  {
    id: "epochs",
    heading: "Epochs and voting",
    body: (
      <>
        <P>
          An <Strong>epoch</Strong> is one saved feed policy. A round can be scheduled or opened manually, and its voting
          window is configurable. Fewer than 10 ballots use an arithmetic mean; 10 or more use a 10% trimmed mean.
          Closing the window does not apply policy automatically: results are reviewed, an operator approves or rejects
          the complete proposal, and approval applies signal weights, topic priorities, and adopted content rules before
          rescoring. Approved policy versions and governance actions are retained so changes remain inspectable.
        </P>
      </>
    ),
  },
  {
    id: "receipts",
    heading: "Transparency receipts",
    body: (
      <>
        <P>When score provenance is available, a Corgi-ranked post can show a receipt with:</P>
        <UL>
          <LI>The per-signal breakdown (raw score × weight = contribution), component total, publication adjustment, and final ranking score.</LI>
          <LI>A counterfactual: where the post would rank under a pure-engagement policy versus the community policy.</LI>
          <LI>The epoch the score was computed under, and when.</LI>
        </UL>
        <P>
          Governance actions and policy changes also appear in the <InlineLink href="/history">history</InlineLink>.
          Individual ballots are not exposed on public transparency surfaces; only aggregate outcomes are shown.
        </P>
      </>
    ),
  },
  {
    id: "source-api",
    heading: "Source and API",
    body: (
      <>
        <P>
          Corgi is open source. The ranking engine, governance pipeline, and this site live on{" "}
          <InlineLink href="https://github.com/andrewnordstrom-eng/bluesky-community-feed">GitHub</InlineLink>. The
          public read endpoints are documented in the{" "}
          <InlineLink href="https://github.com/andrewnordstrom-eng/bluesky-community-feed/blob/main/docs/openapi-public.json">
            OpenAPI specification
          </InlineLink>.
        </P>
        <P>
          The read paths are public and unauthenticated — for example the transparency stats, per-post explanations, and
          governance weights that power the <InlineLink href="/demo">demo</InlineLink>. The feed itself is a standard
          Bluesky feed generator you can subscribe to like any other custom feed.
        </P>
      </>
    ),
  },
]

export default function DocsPage() {
  return (
    <AppShell user={null}>
      <LegalLayout title="Documentation" lastUpdated="July 2026" sections={SECTIONS} backHref="/" backLabel="Back to home" />
    </AppShell>
  )
}
