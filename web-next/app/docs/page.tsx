import type { Metadata } from "next"
import { AppShell } from "@/components/app-shell"
import { LegalLayout, P, UL, LI, Strong, InlineLink } from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "Corgi docs — how the ranking works",
  description:
    "How Corgi scores posts: the five signals, the scoring math, epochs and voting, transparency receipts, and where to find the source and API.",
}

const SECTIONS = [
  {
    id: "overview",
    heading: "Overview",
    body: (
      <>
        <P>
          Corgi is a community-governed custom feed for Bluesky. It ingests candidate posts, scores each one against five
          signals, applies the community&rsquo;s current weights, and serves the ordered result back to Bluesky. Every
          post keeps a receipt so the order is fully inspectable.
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
          <LI><Strong>Engagement</Strong> — replies, reposts, and likes relative to the author&rsquo;s reach.</LI>
          <LI><Strong>Bridging</Strong> — how well the post connects otherwise-separate subgroups in the community.</LI>
          <LI><Strong>Source diversity</Strong> — whether the feed is hearing from a wider set of authors and sources.</LI>
          <LI><Strong>Relevance</Strong> — how well the post matches the community&rsquo;s topics.</LI>
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
          The raw signal scores describe the post; the weights are set by the community and always sum to 100%. Change
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
    id: "epochs",
    heading: "Epochs and voting",
    body: (
      <>
        <P>
          An <Strong>epoch</Strong> is one saved feed policy — a full set of weights from a governance round. During an
          open round, members vote on the weights. When the round closes, votes are combined with a{" "}
          <Strong>trimmed mean</Strong> (a fixed share of outliers on each end is dropped) and the result becomes the
          next epoch. Every epoch is retained, so you can always see how policy changed over time.
        </P>
      </>
    ),
  },
  {
    id: "receipts",
    heading: "Transparency receipts",
    body: (
      <>
        <P>Every Corgi-scored post can show a receipt with:</P>
        <UL>
          <LI>The per-signal breakdown (raw score × weight = contribution) and the total.</LI>
          <LI>A counterfactual: where the post would rank under a pure-engagement policy versus the community policy.</LI>
          <LI>The epoch the score was computed under, and when.</LI>
        </UL>
        <P>
          Operator actions and weight changes are also written to an append-only <InlineLink href="/history">audit
          log</InlineLink>. Individual votes are never exposed — only aggregated outcomes.
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
